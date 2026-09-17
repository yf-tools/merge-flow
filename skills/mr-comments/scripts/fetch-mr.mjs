#!/usr/bin/env node
/**
 * Batch 1's merge-request fetch: one GraphQL call for the MR *and* its discussions.
 *
 * Measured on two real MRs: ~10.5–13.4 KB against two REST calls at ~28–30 KB, and no
 * truncation path, since field selection sets the size.
 *
 * Why this is a script: `--field iid=508` coerces to a number and GraphQL rejects it
 * (`$iid: String!`), and a hand-written query drifts from the fields the reconciler
 * needs. Both have to be right every time.
 *
 * **The GitLab host flag is `--instance`, and must never be renamed to `--host`.**
 * Agent shells screen commands for long-running processes, and `node … --host <h>` is
 * the shape of a dev server: the check fires, the run is told the command "appears to
 * start a server (contains port or host)", and the only ways past are to abandon the
 * fetch or to override a safety gate. Observed on a real run, which chose the
 * override. `--instance` carries no dev-server token, so nothing needs overriding.
 *
 * **It also triages and reconciles here, and prints only the result.** The payload is
 * already in this process; the decision modules are pure functions in the same
 * package. Printing the raw ~10 KB response for a caller to hand back to
 * `triage_graphql_mr` sends it *out through the model and back*, which costs far more
 * than the fetch and, observed on a real run, fails: a payload that large arrived as a
 * string instead of an object, and the recovery was to start trimming note fields —
 * the exact way `resolvable` has been dropped before, now reached by a different road.
 * So the round trip is removed rather than warned about. `--raw` restores the old
 * behaviour, and is the automatic fallback when the modules aren't reachable.
 *
 * Needs `glab` on PATH and authenticated.
 */

// No @types/node by design, so a local handle and one suppression keep an editor
// quiet without adding a package. Same pattern as server.js.
const proc = /** @type {any} */ (globalThis).process;
// @ts-ignore -- no @types/node by design
import { execFileSync, spawnSync } from "node:child_process";
// @ts-ignore -- no @types/node by design
import { statSync } from "node:fs";
// @ts-ignore -- no @types/node by design
import { delimiter, isAbsolute, join } from "node:path";

/**
 * Duplicated from server/graphql.js rather than imported: the import would be
 * `../../../server/graphql.js`, which breaks when this skill folder is used on its
 * own. A test asserts the two haven't drifted — invariant 4's sanctioned trade.
 */
const MR_QUERY = `query($fullPath: ID!, $iid: String!) {
  project(fullPath: $fullPath) {
    mergeRequest(iid: $iid) {
      iid title state sourceBranch targetBranch userNotesCount
      conflicts mergeStatusEnum detailedMergeStatus draft webUrl
      author { username }
      assignees { nodes { username } }
      discussions(first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          notes(first: 100) {
            pageInfo { hasNextPage }
            nodes { id system resolvable resolved body createdAt author { username } position { newPath newLine oldPath oldLine } }
          }
        }
      }
    }
  }
}`;

const USAGE =
  "usage: node scripts/fetch-mr.mjs --project <group/repo> --iid <n> [--instance <host>] [--note <id>] [--rest] [--raw]\n";

const argv = proc.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : undefined;
};
const has = (name) => argv.includes(`--${name}`);

// Reject unrecognised flags instead of ignoring them. A dropped `--instance` would
// query whichever host `glab` is configured for by default, and iid 491 exists on more
// than one GitLab — so the run would get a real merge request from the wrong server
// and have no way to tell. Failing here is the only outcome that can't be mistaken.
const KNOWN = new Set(["project", "iid", "instance", "note", "rest", "raw"]);
const unknown = argv.filter((a) => a.startsWith("--") && !KNOWN.has(a.slice(2)));
if (unknown.length > 0) {
  proc.stderr.write(`unknown flag(s): ${unknown.join(", ")}\n${USAGE}`);
  proc.exit(2);
}

const project = flag("project");
const iid = flag("iid");
const instance = flag("instance");
const noteIdFromUrl = flag("note");

if (!project || !iid) {
  proc.stderr.write(USAGE);
  proc.exit(2);
}

/** `a/b/repo` → `a%2Fb%2Frepo`, for REST paths. */
const encoded = project.split("/").map(encodeURIComponent).join("%2F");

/**
 * Resolve an executable to an absolute path, once, in-process. **Never spawn a bare
 * command name.**
 *
 * `execFileSync("git", …)` leaves the lookup to the OS at spawn time, against whatever
 * `PATH` happens to be — so any writable directory earlier in `PATH` can substitute its
 * own `git` (CWE-426, untrusted search path). Two things here address that:
 *
 * 1. **The lookup happens here, not at spawn time**, and every later call uses the
 *    absolute result. Resolving via `where`/`which` would not achieve this: those are
 *    themselves found on `PATH`, so the finder is as shadowable as the target.
 * 2. **`PATH` entries that are not absolute are skipped**, which the OS would not do.
 *    A relative entry — and on some systems the empty entry, meaning the current
 *    directory — is precisely the writable directory this class of attack needs.
 *
 * What it deliberately does **not** claim is that the surviving directories are
 * unwriteable. That isn't portably checkable (Windows ACLs aren't in `st_mode`), and an
 * attacker who can already write to a system `PATH` directory owns the session whatever
 * this script does. Where a caller needs a hard guarantee, `GLAB_PATH` / `GIT_PATH` pin
 * the binary outright and skip the search.
 *
 * Returns `null` when nothing was found. Callers degrade or fail — **never** by falling
 * back to the bare name, which would hand the lookup straight back to spawn time.
 */
function resolveBin(name, envVar) {
  const pinned = proc.env?.[envVar];
  if (pinned) {
    if (isAbsolute(pinned) && fileExists(pinned)) return pinned;
    proc.stderr.write(`${envVar} must be an absolute path to an existing file, got: ${pinned}\n`);
    proc.exit(2);
  }

  // On Windows an extensionless name is not executable; PATHEXT decides what is.
  const exts = proc.platform === "win32" ? (proc.env?.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];

  for (const dir of (proc.env?.PATH || "").split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      if (fileExists(candidate)) return candidate;
    }
  }
  return null;
}

function fileExists(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Remove anything credential-shaped from text that came from another program.
 *
 * The vendor prefixes are matched rather than long random-looking runs, deliberately: a
 * 40-character hex string is far more often a git SHA than a secret, and destroying SHAs
 * would cost real diagnostic value for no gain.
 *
 * Two things here need it. `git remote get-url origin` returns whatever is configured,
 * and `https://oauth2:TOKEN@host/group/repo.git` is a form people really use, so the
 * userinfo half of any URL goes first. And a failing `glab` call has its stderr echoed
 * verbatim, which is an unbounded pass-through of a third party's output into this
 * process's own — bounded here in length as well as content.
 *
 * Duplicated verbatim in git-context.mjs and preflight.mjs, which cannot share a module
 * without breaking this folder's standalone use; a test asserts all three are identical.
 */
function scrubSecrets(text, maxLength = 400) {
  let out = String(text ?? "")
    .replace(/:\/\/[^/@\s]+@/g, "://<redacted>@")
    .replace(/\bgl[a-z]{2,8}-[A-Za-z0-9_-]{20,}/g, "<redacted>")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "<redacted>")
    .replace(/\bATATT[A-Za-z0-9_=-]{20,}/g, "<redacted>")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, "<redacted>")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "<redacted>")
    // `\w` rather than `[A-Za-z0-9_]`: this pattern is case-insensitive for `Bearer`/`Basic`,
    // and under `/i` spelling both `A-Z` and `a-z` declares the same range twice.
    .replace(/\b(?:Bearer|Basic) [\w.+/=-]{12,}/gi, "<redacted>")
    // No `\b` before the keyword: `_` is a word character, so `\bTOKEN` never matches
    // inside `GITLAB_TOKEN`, which is the commonest spelling of all. Starting the match at
    // the keyword leaves any prefix outside it and intact, so `GITLAB_TOKEN=x` becomes
    // `GITLAB_TOKEN=<redacted>` and the variable stays identifiable.
    .replace(/(token|secret|password|passwd|api[_-]?key)( *[:=] *)[^\s"',;)]{8,}/gi, "$1$2<redacted>");
  if (out.length > maxLength) out = `${out.slice(0, maxLength)}... (truncated)`;
  return out;
}

const glabBin = resolveBin("glab", "GLAB_PATH");
if (!glabBin) {
  proc.stderr.write(
    "glab not found in any absolute PATH directory.\n" +
      "Install it, or set GLAB_PATH to its absolute path. (A bare `glab` is deliberately not attempted.)\n",
  );
  proc.exit(1);
}

// Optional, unlike glab: git supplies one input to one check here, so a missing binary
// degrades that check to `undetermined` instead of stopping the fetch.
const gitBin = resolveBin("git", "GIT_PATH");

/**
 * The bundled decision modules, or `null` when they aren't reachable — which is the
 * case this skill folder's portability depends on, so it degrades rather than throws.
 * A dynamic import, not a static one, for exactly that reason.
 *
 * Note what is *not* duplicated here: no counting, no classification, no field
 * filtering. Only the transport changes. If these load, the numbers come from the same
 * code the MCP tools run; if they don't, the caller gets the raw payload and calls the
 * tools itself. There is no third path where this script decides anything on its own.
 */
async function loadChecks() {
  try {
    const dir = new URL("../../../server/", import.meta.url);
    const [graphql, payload, discussions] = await Promise.all([
      import(new URL("graphql.js", dir).href),
      import(new URL("mr-payload.js", dir).href),
      import(new URL("discussions.js", dir).href),
    ]);
    return {
      normalizeGraphqlMr: graphql.normalizeGraphqlMr,
      triageMrPayload: payload.triageMrPayload,
      reconcileDiscussionCounts: discussions.reconcileDiscussionCounts,
      slimThreadsForReport: discussions.slimThreadsForReport,
    };
  } catch (err) {
    // Absent is the expected, supported case. Present-but-broken is a bug, and
    // swallowing it would silently downgrade every run to the expensive path with
    // nothing to show why — so only the not-found code degrades quietly.
    if (err?.code === "ERR_MODULE_NOT_FOUND") return null;
    proc.stderr.write(`server/ modules failed to load (not a missing-file problem): ${err?.message ?? String(err)}\n`);
    proc.exit(1);
  }
}

/**
 * The two inputs whose absence makes `triageMrPayload` report `undetermined` instead
 * of a verdict: the workspace remote (for the wrong-project check) and the
 * authenticated username (for the ownership check, and to keep your own replies out of
 * the reviewer count). Both are local reads, so gathering them here removes the chance
 * of a caller forgetting to pass them — which used to silently cost two checks.
 *
 * Either can come back undefined. That is reported honestly as `undetermined`
 * downstream; it is never guessed at.
 */
function localContext() {
  let remote;
  // `gitBin`, never a bare "git" — see resolveBin. A null binary is the same outcome as
  // a failed read: the wrong-project check reports `undetermined` rather than passing.
  if (gitBin) {
    try {
      // Scrubbed: a configured remote can embed a credential, and this value is printed,
      // fed to the wrong-project check, and captured in the session transcript.
      const raw = execFileSync(gitBin, ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
      remote = raw ? scrubSecrets(raw) : undefined;
    } catch {
      // Not a git repo, or no `origin`.
    }
  }

  // `spawnSync`, because `glab auth status` prints its "Logged in to X as Y" line to
  // stderr on several versions and exits non-zero when only some hosts are logged in.
  // Reading both streams regardless of exit code is the only form that works across them.
  const auth = spawnSync(glabBin, instance ? ["auth", "status", "--hostname", instance] : ["auth", "status"], {
    encoding: "utf8",
  });
  const user = /\bas\s+([A-Za-z0-9._-]+)/.exec(`${auth.stdout ?? ""}\n${auth.stderr ?? ""}`)?.[1];

  return { remote, user };
}

function glab(args) {
  try {
    // An args array, not a shell string: the query contains braces, spaces and
    // newlines, and no quoting scheme survives all three across shells.
    // `--hostname` is glab's own spelling; ours is `--instance` for the reason in the
    // header. The rename stops at this boundary.
    return execFileSync(glabBin, instance ? [...args, "--hostname", instance] : args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // Another program's output, so bounded in both length and content before it lands
    // in this process's stderr and from there in the transcript.
    const detail = scrubSecrets((err.stderr || err.stdout || err.message || String(err)).trim());
    proc.stderr.write(`glab ${args.slice(0, 2).join(" ")} failed: ${detail}\n`);
    proc.exit(1);
  }
}

const checks = has("raw") ? null : await loadChecks();
if (!checks && !has("raw")) {
  proc.stderr.write(
    "note: server/ modules not reachable from this skill folder — printing the raw payload.\n" +
      "      Call triage_graphql_mr (or triage_mr_payload + reconcile_discussion_counts) on it yourself.\n",
  );
}

/**
 * Everything the caller needs, and nothing it doesn't: the same triage and counts
 * `triage_graphql_mr` returns, plus `mr` so the branch/state/ticket facts are readable
 * without a second call, plus the trimmed threads Step 10 needs the ids from.
 *
 * The trimming rule is `slimThreadsForReport` in `discussions.js`, not here — this
 * script decides nothing about what a thread is or whether it counts. It took a real
 * payload from 41,752 bytes to 12,798, which matters because the untrimmed version
 * overran the tool-result limit and the run answered that by writing it to a file,
 * reading it twice and deleting it.
 *
 * Emitted without indentation: pretty-printing cost 9,411 bytes on that MR, 23% of it,
 * for whitespace nothing downstream reads.
 */
function emitTriaged({ mr, discussions, hasNextPage, endCursor, ctx }) {
  // Counts come from the unfiltered set, before any trimming, or the reconciliation
  // against `user_notes_count` would compare against a number we just changed.
  const counts = checks.reconcileDiscussionCounts({
    discussions,
    userNotesCount: mr.user_notes_count,
    currentUser: ctx.user,
    noteIdFromUrl,
  });

  const slim = checks.slimThreadsForReport(discussions);

  proc.stdout.write(
    JSON.stringify({
      mode: "triaged",
      triage: checks.triageMrPayload({ mr, workspaceRemote: ctx.remote, currentUser: ctx.user }),
      counts: counts,
      mr,
      discussions: slim.threads,
      omitted: slim.omitted,
      hasNextPage,
      endCursor,
    }) + "\n",
  );
}

if (has("rest")) {
  // Fallback transport: two calls. `discussions` stays a raw string in `--raw` mode —
  // pass it to `reconcile_discussion_counts` as `discussions_text` rather than
  // re-parsing it. With the modules loaded it is parsed here instead, once, locally.
  const mrText = glab(["api", `projects/${encoded}/merge_requests/${iid}`]);
  const discussions = glab(["api", `projects/${encoded}/merge_requests/${iid}/discussions?per_page=100`, "--paginate"]);

  if (!checks) {
    proc.stdout.write(JSON.stringify({ mode: "rest", mr: JSON.parse(mrText), discussions }, null, 2) + "\n");
  } else {
    // ndjson: one discussion per line. A trailing blank line is normal; a line that
    // won't parse is a truncated response, and that must fail loudly rather than
    // silently shortening the count.
    const parsedDiscussions = discussions
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "")
      .map((line, i) => {
        try {
          return JSON.parse(line);
        } catch {
          proc.stderr.write(`discussions line ${i + 1} is not valid JSON — the response was truncated\n`);
          proc.exit(1);
        }
      });

    emitTriaged({
      mr: JSON.parse(mrText),
      discussions: parsedDiscussions,
      hasNextPage: false,
      endCursor: null,
      ctx: localContext(),
    });
  }
} else {
  const out = glab([
    "api",
    "graphql",
    "--raw-field",
    `query=${MR_QUERY}`,
    "--raw-field",
    `fullPath=${project}`,
    "--raw-field",
    `iid=${iid}`,
  ]);

  // GraphQL answers 200 with an `errors` array rather than a non-zero exit, so a
  // failure here would otherwise look like a successful empty fetch.
  const parsed = JSON.parse(out);
  if (parsed.errors) {
    proc.stderr.write(`GraphQL returned errors: ${scrubSecrets(JSON.stringify(parsed.errors), 800)}\n`);
    proc.exit(1);
  }
  if (!parsed.data?.project?.mergeRequest) {
    proc.stderr.write(`no merge request at ${project}!${iid} — check the project path and iid\n`);
    proc.exit(1);
  }

  if (!checks) {
    proc.stdout.write(out.endsWith("\n") ? out : out + "\n");
  } else {
    emitTriaged({ ...checks.normalizeGraphqlMr(parsed), ctx: localContext() });
  }
}
