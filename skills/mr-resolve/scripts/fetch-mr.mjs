#!/usr/bin/env node
/**
 * Batch 1's merge-request fetch: one GraphQL call for the MR *and* its discussions.
 * Measured on two real MRs: ~10.5–13.4 KB against two REST calls at ~28–30 KB, with no
 * truncation path since field selection sets the size.
 *
 * Why this is a script: `--field iid=508` coerces to a number and GraphQL rejects it
 * (`$iid: String!`), and a hand-written query drifts from the fields the reconciler
 * needs.
 *
 * **The GitLab host flag is `--instance`, never `--host`.** Agent shells screen
 * commands for long-running processes, and `--host <h>` reads as a dev server —
 * observed forcing a real run through a safety-gate override.
 *
 * **It also triages and reconciles here, printing only the result.** The decision
 * modules are pure functions in the same package, so handing the raw ~10 KB response
 * back out to be re-passed to `triage_graphql_mr` sends it through the model and back
 * for nothing — and, observed on a real run, arrived as a string and got "fixed" by
 * trimming note fields, the same way `resolvable` has been dropped before. `--raw`
 * restores the old behaviour, and is the automatic fallback when the modules aren't
 * reachable.
 *
 * **`--brief` swaps `discussions`/`omitted` for `threadIndex`** under `mode: "brief"`:
 * one bodyless row per feedback thread — id, resolve state, path, line, note count,
 * last author. Three runs wrapped this script in `node -e` to compute exactly those
 * fields by hand instead, one of them writing its own file-capturing projector script
 * that then corrupted the quotes in its report. For a triage-only read, not a cheaper
 * batch 1 — Step 5 still needs bodies, which only the default output carries.
 *
 * Needs `glab` on PATH and authenticated.
 */

// No @types/node by design, so a local handle and one suppression keep an editor
// quiet without adding a package. Same pattern as server.js.
const proc = /** @type {any} */ (globalThis).process;
// @ts-ignore -- no @types/node by design
import { execFile } from "node:child_process";
// @ts-ignore -- no @types/node by design
import { promisify } from "node:util";
// @ts-ignore -- no @types/node by design
import { statSync, writeFileSync, mkdirSync } from "node:fs";
// @ts-ignore -- no @types/node by design
import { delimiter, isAbsolute, join, dirname } from "node:path";

const execFileAsync = promisify(execFile);

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
      headPipeline { id status detailedStatus { text label } }
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
  "usage: node scripts/fetch-mr.mjs --project <group/repo> --iid <n> [--instance <host>] [--note <id>] [--rest] [--raw] [--brief] [--out <filepath>]\n";

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
const KNOWN = new Set(["project", "iid", "instance", "note", "rest", "raw", "brief", "out"]);
const unknown = argv.filter((a) => a.startsWith("--") && !KNOWN.has(a.slice(2)));
if (unknown.length > 0) {
  proc.stderr.write(`unknown flag(s): ${unknown.join(", ")}\n${USAGE}`);
  proc.exit(2);
}

const outPath = flag("out");
const MAX_INLINE_BYTES = 20 * 1024; // 20 KB adaptive inline threshold

function dirExists(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function ensureDir(filePath) {
  const dir = dirname(filePath);
  if (dir && dir !== "." && !dirExists(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function parseAndFormat(text) {
  try {
    const parsed = JSON.parse(text);
    return { parsed, formatted: JSON.stringify(parsed, null, 2) };
  } catch {
    return { parsed: null, formatted: text };
  }
}

function writeOutputFile(targetPath, text) {
  ensureDir(targetPath);
  const { parsed, formatted } = parseAndFormat(text);
  const content = formatted.endsWith("\n") ? formatted : formatted + "\n";
  writeFileSync(targetPath, content, "utf8");
  return parsed;
}

function saveAndEmit({ fullText, summaryObj }) {
  if (!outPath) {
    proc.stdout.write(fullText.endsWith("\n") ? fullText : fullText + "\n");
    return;
  }

  let parsed = null;
  try {
    parsed = writeOutputFile(outPath, fullText);
  } catch (err) {
    proc.stderr.write(`failed to write output to ${outPath}: ${err?.message ?? err}\n`);
    proc.exit(1);
  }

  const isSmall = Buffer.byteLength(fullText, "utf8") <= MAX_INLINE_BYTES;
  if (isSmall && parsed && typeof parsed === "object") {
    proc.stdout.write(JSON.stringify({ writtenTo: outPath, inlined: true, ...parsed }) + "\n");
    return;
  }

  const baseSummary = summaryObj ?? {};
  proc.stdout.write(JSON.stringify({ writtenTo: outPath, inlined: false, ...baseSummary }) + "\n");
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
 * Resolve an executable to an absolute path once, in-process, so every later call is
 * immune to a writable `PATH` entry substituting its own binary (CWE-426). Skips
 * non-absolute `PATH` entries, which the OS itself would not. This does **not** claim
 * the surviving directories are unwriteable; `GLAB_PATH`/`GIT_PATH` pin the binary
 * outright when a caller needs a hard guarantee.
 *
 * Returns `null` when nothing was found. Callers degrade or fail — never fall back to
 * the bare name, which hands the lookup back to spawn time.
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
      indexThreadsForReport: discussions.indexThreadsForReport,
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
async function localContext() {
  let remote;
  let branch;
  let user;

  const remoteTask = gitBin
    ? execFileAsync(gitBin, ["remote", "get-url", "origin"], { encoding: "utf8" })
        .then((res) => {
          const raw = (res.stdout || "").trim();
          remote = raw ? scrubSecrets(raw) : undefined;
        })
        .catch(() => {
          // Not a git repo, or no `origin`.
        })
    : Promise.resolve();

  const branchTask = gitBin
    ? execFileAsync(gitBin, ["branch", "--show-current"], { encoding: "utf8" })
        .then((res) => {
          branch = (res.stdout || "").trim() || undefined;
        })
        .catch(() => {
          // Detached HEAD, or not a git repo.
        })
    : Promise.resolve();

  let dirty = false;
  let dirtyFiles = [];

  const statusTask = gitBin
    ? execFileAsync(gitBin, ["status", "--porcelain"], { encoding: "utf8" })
        .then((res) => {
          const lines = (res.stdout || "")
            .split(/\r?\n/)
            .filter(Boolean)
            .filter((l) => !l.slice(3).trim().startsWith(".scratch"));
          dirty = lines.length > 0;
          dirtyFiles = lines.map((l) => l.slice(3).trim());
        })
        .catch(() => {})
    : Promise.resolve();

  const authTask = execFileAsync(glabBin, instance ? ["auth", "status", "--hostname", instance] : ["auth", "status"], {
    encoding: "utf8",
  })
    .then((res) => {
      user = /\bas\s+([A-Za-z0-9._-]+)/.exec(`${res.stdout ?? ""}\n${res.stderr ?? ""}`)?.[1];
    })
    .catch((err) => {
      user = /\bas\s+([A-Za-z0-9._-]+)/.exec(`${err.stdout ?? ""}\n${err.stderr ?? ""}`)?.[1];
    });

  await Promise.all([remoteTask, branchTask, statusTask, authTask]);
  return { remote, user, branch, dirty, dirtyFiles };
}

/**
 * Substrings that mean "the network was the problem, not the request". Matched against a
 * lowercased message, so capitalisation in glab's output doesn't decide whether a retry
 * happens. `glab` is Go, which is why `context deadline exceeded` and `no such host` are
 * here — they are Go's usual wording for a timeout and a DNS failure, and the obvious
 * `timeout` check alone misses both.
 */
const TRANSIENT = [
  "timeout",
  "timed out",
  "connection refused",
  "connection reset",
  "dial tcp",
  "context deadline exceeded",
  "no such host",
  "tls handshake",
  "eof",
];

/**
 * Run `glab` and return stdout, retrying only a transient network failure.
 *
 * **Retrying is only safe because every call in this file is a read** — one GraphQL query,
 * or the REST fallback's GETs. Do not reuse this for a POST or PUT: a reply that timed out
 * after the server accepted it would be posted twice.
 *
 * Two attempts rather than more. This sits on the critical path to Step 5's report, so the
 * budget is one retry to cover a genuine blip, not a general resilience layer — a host that
 * is actually down should fail fast and let the run report it.
 */
async function executeGlab(args, attempt, maxAttempts) {
  try {
    // An args array, not a shell string: the query contains braces, spaces and
    // newlines, and no quoting scheme survives all three across shells.
    // `--hostname` is glab's own spelling; ours is `--instance` for the reason in the
    // header. The rename stops at this boundary.
    const res = await execFileAsync(glabBin, instance ? [...args, "--hostname", instance] : args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return res.stdout;
  } catch (err) {
    const raw = (err.stderr || err.stdout || err.message || String(err)).trim();
    const transient = TRANSIENT.some((s) => raw.toLowerCase().includes(s));
    if (attempt < maxAttempts && transient) {
      // Said out loud: a silent stall here is indistinguishable from a slow network in the
      // transcript, and this file's whole job is to be the fast part of batch 1.
      const backoffMs = 500;
      proc.stderr.write(`note: glab ${args.slice(0, 2).join(" ")} hit a transient failure, retrying once in ${backoffMs}ms\n`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return executeGlab(args, attempt + 1, maxAttempts);
    }

    // Another program's output, so bounded in both length and content before it lands
    // in this process's stderr and from there in the transcript.
    const detail = scrubSecrets((err.stderr || err.stdout || err.message || String(err)).trim());
    proc.stderr.write(`glab ${args.slice(0, 2).join(" ")} failed: ${detail}\n`);
    proc.exit(1);
  }
}

async function glab(args, maxAttempts = 2) {
  return executeGlab(args, 1, maxAttempts);
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
function emitTriaged({ mr, discussions, hasNextPage, endCursor, ctx, checks: activeChecks }) {
  const c = activeChecks;
  // Counts come from the unfiltered set, before any trimming, or the reconciliation
  // against `user_notes_count` would compare against a number we just changed.
  const counts = c.reconcileDiscussionCounts({
    discussions,
    userNotesCount: mr.user_notes_count,
    currentUser: ctx.user,
    noteIdFromUrl,
  });

  // `--brief` keeps the decision layer and drops the threads. `counts` above is computed
  // from the unfiltered set either way, so a brief read reconciles identically to a full
  // one — the number is never a function of what got printed.
  const brief = has("brief");
  const slim = brief ? null : c.slimThreadsForReport(discussions, 40, ctx.user);

  const payloadObj = {
    mode: brief ? "brief" : "triaged",
    triage: c.triageMrPayload({
      mr,
      workspaceRemote: ctx.remote,
      currentUser: ctx.user,
      currentBranch: ctx.branch,
      dirty: ctx.dirty,
      dirtyFiles: ctx.dirtyFiles,
    }),
    counts: counts,
    mr,
    git: {
      dirty: ctx.dirty ?? false,
      dirtyFiles: ctx.dirtyFiles ?? [],
      branch: ctx.branch ?? null,
      remote: ctx.remote ?? null,
    },
    ...(brief ? { threadIndex: c.indexThreadsForReport(discussions, ctx.user) } : {}),
    ...(slim ? { discussions: slim.threads, omitted: slim.omitted } : {}),
    hasNextPage,
    endCursor,
  };

  saveAndEmit({
    fullText: JSON.stringify(payloadObj),
    summaryObj: {
      mode: payloadObj.mode,
      triage: payloadObj.triage,
      counts: payloadObj.counts,
      mr: payloadObj.mr,
      git: payloadObj.git,
      hasNextPage,
      endCursor,
    },
  });
}

const checks = has("raw") ? null : await loadChecks();
const contextPromise = localContext();

if (has("rest")) {
  const ctx = await contextPromise;
  if (!checks && !has("raw")) {
    proc.stderr.write(
      "note: server/ modules not reachable from this skill folder — printing the raw payload.\n" +
        "      Call triage_graphql_mr (or triage_mr_payload + reconcile_discussion_counts) on it yourself.\n",
    );
  }
  const mrText = await glab(["api", `projects/${encoded}/merge_requests/${iid}`]);
  const discussions = await glab(["api", `projects/${encoded}/merge_requests/${iid}/discussions?per_page=100`, "--paginate"]);

  if (!checks) {
    saveAndEmit({
      fullText: JSON.stringify({ mode: "rest", mr: JSON.parse(mrText), discussions }, null, 2),
      summaryObj: { mode: "rest" },
    });
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
      ctx,
      checks,
    });
  }
} else {
  const queryPromise = (async () => {
    const token = proc.env?.GITLAB_TOKEN || proc.env?.GITLAB_ACCESS_TOKEN;
    if (typeof fetch === "function" && token && instance) {
      try {
        const res = await fetch(`https://${instance}/api/graphql`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "PRIVATE-TOKEN": token,
          },
          body: JSON.stringify({
            query: MR_QUERY,
            variables: { fullPath: project, iid: String(iid) },
          }),
        });
        if (res.ok) {
          const text = await res.text();
          if (text.includes("mergeRequest")) return text;
        }
      } catch {
        // Fallback to glab CLI
      }
    }
    return glab([
      "api",
      "graphql",
      "--raw-field",
      `query=${MR_QUERY}`,
      "--raw-field",
      `fullPath=${project}`,
      "--raw-field",
      `iid=${iid}`,
    ]);
  })();

  const [ctx, out] = await Promise.all([contextPromise, queryPromise]);

  if (!checks && !has("raw")) {
    proc.stderr.write(
      "note: server/ modules not reachable from this skill folder — printing the raw payload.\n" +
        "      Call triage_graphql_mr (or triage_mr_payload + reconcile_discussion_counts) on it yourself.\n",
    );
  }

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
    saveAndEmit({
      fullText: out,
      summaryObj: { mode: "raw" },
    });
  } else {
    emitTriaged({ ...checks.normalizeGraphqlMr(parsed), ctx, checks });
  }
}
