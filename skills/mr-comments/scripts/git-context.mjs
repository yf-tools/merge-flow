#!/usr/bin/env node
/**
 * Batch 1's git reads, as one call returning JSON.
 *
 *   node scripts/git-context.mjs [--cwd <repo>] [--log-count 40]
 *
 * Why this is a script: `git status --porcelain` prints nothing on a clean tree, so in
 * concatenated shell output an empty section is indistinguishable from a mangled
 * separator — which cost a real run a wasted re-issue. JSON makes empty structurally
 * empty, and `dirty` a boolean rather than a line to interpret.
 *
 * Exits non-zero only when the directory isn't a git repo; one failed read lands in
 * its own `*Error` field rather than costing you the other three.
 */

// No @types/node by design, so a local handle and one suppression keep an editor
// quiet without adding a package. Same pattern as server.js.
const proc = /** @type {any} */ (globalThis).process;
// @ts-ignore -- no @types/node by design
import { execFileSync } from "node:child_process";
// @ts-ignore -- no @types/node by design
import { statSync } from "node:fs";
// @ts-ignore -- no @types/node by design
import { delimiter, isAbsolute, join } from "node:path";

const argv = proc.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const cwd = flag("cwd", proc.cwd());
const logCount = Number(flag("log-count", "40"));

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
 * this script does. Where a caller needs a hard guarantee, `GIT_PATH` pins the binary
 * outright and skips the search.
 *
 * Returns `null` when nothing was found. Callers fail — **never** by falling back to the
 * bare name, which would hand the lookup straight back to spawn time.
 *
 * Duplicated in `fetch-mr.mjs` rather than shared, for the same reason `MR_QUERY` is:
 * a third file under `scripts/` would break the layout the spec test pins. A test
 * asserts the two copies haven't drifted.
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

const gitBin = resolveBin("git", "GIT_PATH");
if (!gitBin) {
  proc.stderr.write(
    "git not found in any absolute PATH directory.\n" +
      "Install it, or set GIT_PATH to its absolute path. (A bare `git` is deliberately not attempted.)\n",
  );
  proc.exit(1);
}

/** Run one git command; return its trimmed stdout, or an error marker. */
function git(args) {
  try {
    return { ok: true, out: execFileSync(gitBin, args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim() };
  } catch (err) {
    return { ok: false, error: (err.stderr || err.message || String(err)).trim() };
  }
}

const inside = git(["rev-parse", "--is-inside-work-tree"]);
if (!inside.ok || inside.out !== "true") {
  proc.stderr.write(`not a git repository: ${cwd}\n`);
  proc.exit(1);
}

const remote = git(["remote", "get-url", "origin"]);
const branch = git(["branch", "--show-current"]);
const status = git(["status", "--porcelain"]);
const log = git(["log", "--oneline", "-n", String(Number.isFinite(logCount) ? logCount : 40)]);

const lines = (r) => (r.ok && r.out ? r.out.split(/\r?\n/) : []);

// `null` on a failed read with the reason alongside — never a silent "".
const result = {
  remote: remote.ok ? remote.out : null,
  remoteError: remote.ok ? undefined : remote.error,

  branch: branch.ok ? branch.out || null : null,
  branchError: branch.ok ? undefined : branch.error,

  dirty: status.ok ? status.out.length > 0 : null,
  dirtyFiles: lines(status),
  dirtyError: status.ok ? undefined : status.error,

  log: lines(log),
  logError: log.ok ? undefined : log.error,
};

proc.stdout.write(JSON.stringify(result, null, 2) + "\n");
