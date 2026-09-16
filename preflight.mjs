#!/usr/bin/env node
/**
 * Setup check for gitlab-mr-review. Run this once, before your first merge request.
 *
 *   node preflight.mjs [--repo <path-to-your-project>] [--json]
 *
 * Why this exists: every prerequisite of this power fails *quietly and plausibly*, and
 * each one looks like a bug in the power rather than a gap in the setup.
 *
 *   - A stale MCP server keeps serving the previous tool list, so a fix appears not to
 *     have landed.
 *   - Declining the five tool-approval prompts one at a time makes a first run look slow.
 *   - No Atlassian MCP server means the workflow correctly refuses to fake a Jira check
 *     and stops to ask by hand, which reads as broken.
 *   - `glab` present but unauthenticated fails at the first API call, several steps in.
 *
 * So this reports what is actually wrong, and what each missing piece will cost. It
 * changes nothing: no writes, no network beyond `glab auth status`, no git mutations.
 *
 * Why this is at the package root rather than under `skills/mr-comments/scripts/`: those
 * two scripts are workflow steps the agent runs mid-task, and a test pins that directory
 * to exactly those two. This is a setup tool a person runs by hand, about the install
 * rather than about any MR.
 *
 * Exit code is 0 when every required check passes, 1 when one does not.
 */

// No @types/node by design, so a local handle keeps an editor quiet without adding a
// package. Same pattern as server.js and both bundled scripts.
const proc = /** @type {any} */ (globalThis).process;
// @ts-ignore -- no @types/node by design
import { spawnSync } from "node:child_process";
// @ts-ignore -- no @types/node by design
import { existsSync, readFileSync, statSync } from "node:fs";
// @ts-ignore -- no @types/node by design
import { homedir } from "node:os";
// @ts-ignore -- no @types/node by design
import { delimiter, dirname, isAbsolute, join } from "node:path";
// @ts-ignore -- no @types/node by design
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

const argv = proc.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const asJson = argv.includes("--json");
const repo = flag("repo", proc.cwd());

/** The lowest Node this power's shipped code actually runs on, and what it supports. */
const NODE_REQUIRED = 16; // `replaceAll` in server/hunks.js, `node:` import prefixes
const NODE_SUPPORTED = 18; // oldest LTS worth telling a tester to be on

/**
 * Every check lands here as one record. `status` is the only field the summary reads:
 * `ok` and `info` pass, `warn` passes with a caveat, `fail` sets the exit code.
 */
const checks = [];
const add = (group, name, status, detail, consequence) =>
  checks.push({ group, name, status, detail, consequence: consequence ?? null });

// ---------- resolution, as a diagnostic rather than a hard stop ----------

/**
 * Resolve an executable the way the bundled scripts do, but report instead of exiting.
 *
 * It applies the same two rules those scripts apply, and a test asserts it stays that
 * way, because a check more permissive than the thing it checks is worse than no check:
 *
 *   1. The lookup happens here, not at spawn time, and the absolute result is what runs.
 *   2. `PATH` entries that are not absolute are skipped. A relative entry, including the
 *      empty one meaning the current directory, is the writable directory a
 *      PATH-shadowing attack needs (CWE-426).
 *
 * It deliberately differs from them in one way, which is the whole reason it is separate
 * code rather than a third copy: a bad `GIT_PATH`/`GLAB_PATH` pin exits the process in
 * those scripts, and here it has to be reportable alongside every other finding.
 */
function resolveDiagnostic(name, envVar) {
  const out = { name, envVar, path: null, source: null, pinError: null, skipped: [] };
  if (!applyPin(out, envVar)) searchPath(out, name);
  return out;
}

/**
 * An explicit `GIT_PATH`/`GLAB_PATH` pin. Returns true only when it resolved, so a bad
 * pin records `pinError` and still lets the PATH search report what it would have found.
 */
function applyPin(out, envVar) {
  const pinned = proc.env?.[envVar];
  if (!pinned) return false;

  if (!isAbsolute(pinned)) {
    out.pinError = `${envVar} is not an absolute path: ${pinned}`;
    return false;
  }
  if (!isFile(pinned)) {
    out.pinError = `${envVar} points at nothing: ${pinned}`;
    return false;
  }
  out.path = pinned;
  out.source = `pinned via ${envVar}`;
  return true;
}

/**
 * Walk `PATH`, taking the first absolute hit and collecting the relative entries that
 * were skipped. The walk continues after a hit purely to finish that skipped list, which
 * is what lets the report explain a resolution someone did not expect.
 */
function searchPath(out, name) {
  const exts =
    proc.platform === "win32" ? (proc.env?.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];

  for (const dir of (proc.env?.PATH || "").split(delimiter)) {
    if (!dir || !isAbsolute(dir)) {
      if (!out.skipped.includes(dir)) out.skipped.push(dir);
    } else if (!out.path) {
      const hit = exts.map((ext) => join(dir, name + ext)).find(isFile);
      if (hit) {
        out.path = hit;
        out.source = "PATH";
      }
    }
  }
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Run a resolved absolute binary. Never a bare name, so nothing is looked up at spawn.
 *
 * `spawnSync`, not `execFileSync`, and that is load-bearing rather than stylistic.
 * `execFileSync` returns stdout on success and only exposes stderr by throwing, so a
 * command that exits 0 while writing everything to stderr comes back empty. `glab auth
 * status` is exactly that command, and the first version of this file consequently told
 * an authenticated machine to run `glab auth login`. A check that reports a false failure
 * is worse than no check, because it sends a tester to fix something that works.
 */
function run(bin, args, cwd) {
  const r = spawnSync(bin, args, { cwd, encoding: "utf8", timeout: 30_000 });
  return { ok: r.status === 0, out: String(r.stdout ?? "").trim(), err: String(r.stderr ?? "").trim() };
}

// ---------- checks ----------

function checkPlatform() {
  const shell = proc.platform === "win32" ? "PowerShell recipes apply" : "POSIX recipes apply";
  add("Environment", "platform", "info", `${proc.platform} ${proc.arch}, ${shell}`);

  const major = Number(proc.versions?.node?.split(".")[0] ?? 0);
  const detail = `${proc.version} (needs >= ${NODE_REQUIRED}, supported >= ${NODE_SUPPORTED})`;
  if (major >= NODE_SUPPORTED) add("Environment", "node", "ok", detail);
  else if (major >= NODE_REQUIRED) {
    add("Environment", "node", "warn", detail, `Node ${major} is past end-of-life. It runs, but nothing tests it.`);
  } else {
    add("Environment", "node", "fail", detail, "The bundled server and both scripts will not run. Upgrade Node.");
  }
}

/** Required. Both bundled scripts stop rather than guess when either is unresolvable. */
function checkBinary(name, envVar, versionArgs, consequence) {
  const r = resolveDiagnostic(name, envVar);

  if (r.pinError) {
    add("Required", name, "fail", r.pinError, `Both scripts exit 2 on this before doing anything. ${consequence}`);
    return r;
  }
  if (!r.path) {
    const where = `not found in any absolute PATH directory; set ${envVar} to pin it`;
    add("Required", name, "fail", where, consequence);
    return r;
  }

  // Version text goes to stdout on some builds and stderr on others, so take either.
  const v = run(r.path, versionArgs);
  const version = (v.out || v.err).split(/\r?\n/)[0] || "version call produced no output";
  // The renderer indents the continuation, so no manual padding here.
  add("Required", name, v.ok ? "ok" : "warn", `${r.path}  (${r.source})\n${version}`);
  return r;
}

/**
 * `glab` on PATH but not logged in is the failure that costs the most, because it
 * surfaces at the first API call rather than at setup. Output has moved between stdout
 * and stderr across glab versions, so both are searched.
 */
function checkGlabAuth(glab) {
  // A bad pin is checked before a missing binary, and deliberately so: `searchPath` may
  // still have found a working `glab` on PATH, but `fetch-mr.mjs` exits 2 on the bad pin
  // and never reaches it. Reporting "auth ok" here would describe a binary the real run
  // will not use.
  if (glab.pinError) {
    add("Required", "glab auth", "fail", `not checked: ${glab.envVar} is invalid, so the fetch never gets this far`);
    return;
  }
  if (!glab.path) {
    add("Required", "glab auth", "fail", "skipped: glab itself did not resolve");
    return;
  }

  const r = run(glab.path, ["auth", "status"]);
  const text = `${r.out}\n${r.err}`;
  const login = /Logged in to (\S+) as (\S+)/i.exec(text);

  if (!login) {
    const first = text.trim().split(/\r?\n/)[0] || "no output";
    add(
      "Required",
      "glab auth",
      "fail",
      first,
      "Run `glab auth login`. Without it the run fails at its first GitLab call, several steps in.",
    );
    return;
  }

  // Where the token comes from matters for a team, not just whether one exists. A token
  // exported from a shell profile is invisible to an editor launched from a desktop
  // launcher, which inherits no interactive shell, so it works in a terminal and fails
  // in Kiro, with the same `glab` binary either way.
  const source = /Token found in ([^:\n]+)/i.exec(text);
  const fromEnv = /environment variable/i.test(source?.[1] ?? "");
  const tokenNote = source ? ` (token from ${source[1].trim()})` : "";
  const detail = `${login[2]} @ ${login[1]}${tokenNote}`;

  if (!fromEnv) {
    add("Required", "glab auth", "ok", detail);
    return;
  }
  add(
    "Required",
    "glab auth",
    "warn",
    detail,
    "That variable has to be set for the process Kiro runs in, not only your terminal. If Kiro was started from a desktop launcher it inherits no shell profile, so `glab auth login` storing a token in config or keyring is the more portable setup.",
  );
}

/**
 * Proves the bundled server's *code* runs here and still advertises its five tools.
 *
 * It cannot prove Kiro has connected to it. That lives in the editor's MCP client rather
 * than on disk, which is exactly why the reconnect reminder is in the closing notes.
 */
function checkServer() {
  const entry = join(ROOT, "server", "server.js");
  if (!existsSync(entry)) {
    add("Required", "mr-review-checks", "fail", `missing: ${entry}`, "The power's five tools are unavailable.");
    return;
  }

  const messages = [
    { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "preflight", version: "1.0.0" } } },
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  ];
  const r = spawnSync(proc.execPath, [entry], {
    input: messages.map((m) => JSON.stringify(m)).join("\n") + "\n",
    encoding: "utf8",
    timeout: 20_000,
  });

  const tools = parseToolList(String(r.stdout ?? ""));
  if (tools === null) {
    const why = String(r.stderr ?? "").trim() || `exit ${r.status}, no parsable response`;
    add("Required", "mr-review-checks", "fail", why, "The power's five tools are unavailable.");
    return;
  }
  const detail = `responds over stdio, ${tools.length} tool(s): ${tools.join(", ")}`;
  if (tools.length === 5) add("Required", "mr-review-checks", "ok", detail);
  else add("Required", "mr-review-checks", "warn", detail, "Expected 5. A tool may have been added or removed.");
}

/** Returns tool names, or null when no `tools/list` result came back. */
function parseToolList(stdout) {
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    try {
      const msg = JSON.parse(line);
      if (msg.id === 1 && Array.isArray(msg.result?.tools)) return msg.result.tools.map((t) => t.name);
    } catch {
      // A non-JSON line is not the response; keep looking rather than failing here.
    }
  }
  return null;
}

/**
 * Runs `git-context.mjs` for real against `--repo`, which exercises the whole path the
 * workflow's batch 1 takes: resolution, spawn, and JSON out. `fetch-mr.mjs` is checked
 * by its own argument guard instead, because the only way to make it do real work is to
 * make a live GitLab call.
 */
function checkScripts() {
  const dir = join(ROOT, "skills", "mr-comments", "scripts");
  checkGitContext(join(dir, "git-context.mjs"));
  checkFetchMr(join(dir, "fetch-mr.mjs"));
}

/** Runs for real against `--repo`: resolution, spawn and JSON out, all three. */
function checkGitContext(script) {
  if (!existsSync(script)) {
    add("Required", "git-context.mjs", "fail", `missing: ${script}`, "Batch 1's git reads will fail.");
    return;
  }

  const r = spawnSync(proc.execPath, [script, "--cwd", repo], { encoding: "utf8", timeout: 30_000 });
  const parsed = tryParse(String(r.stdout ?? ""));
  if (parsed && typeof parsed.dirty === "boolean") {
    const branch = parsed.branch ?? "(detached)";
    add("Required", "git-context.mjs", "ok", `ran against ${repo}: branch ${branch}, dirty ${parsed.dirty}`);
    return;
  }

  // A directory that is not a repo is the caller's mistake, not a broken install.
  const why = String(r.stderr ?? "").trim() || "no JSON on stdout";
  const wrongDir = why.includes("not a git repository");
  const consequence = wrongDir
    ? `Point --repo at your project. ${repo} is not a git repository.`
    : "Batch 1's git reads will fail.";
  add("Required", "git-context.mjs", wrongDir ? "warn" : "fail", why, consequence);
}

/**
 * Checked by its own argument guard rather than by running it, because the only way to
 * make it do real work is a live GitLab call. No arguments must be a usage error, which
 * proves the module loads and the guard runs without touching the network.
 */
function checkFetchMr(script) {
  if (!existsSync(script)) {
    add("Required", "fetch-mr.mjs", "fail", `missing: ${script}`, "The MR fetch will fail.");
    return;
  }

  const r = spawnSync(proc.execPath, [script], { encoding: "utf8", timeout: 30_000 });
  const guarded = r.status === 2 && String(r.stderr ?? "").includes("--instance");
  if (guarded) add("Required", "fetch-mr.mjs", "ok", "loads, and its argument guard holds");
  else add("Required", "fetch-mr.mjs", "fail", `expected exit 2 with a usage line, got exit ${r.status}`, "The MR fetch will fail.");
}

function tryParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Greedy word wrap. Consequences are full sentences and some are long. */
function wrap(text, width) {
  const out = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

/**
 * Neither of these is bundled, and both are read from the user's own config. Matching is
 * by name and command text, so this reports what it recognised rather than claiming a
 * capability it has not exercised.
 */
function checkMcpConfig() {
  const sources = [
    { label: "user", path: join(homedir(), ".kiro", "settings", "mcp.json") },
    { label: "workspace", path: join(repo, ".kiro", "settings", "mcp.json") },
  ];

  const found = [];
  for (const s of sources) {
    if (!existsSync(s.path)) continue;
    const parsed = tryParse(readFileSync(s.path, "utf8"));
    if (!parsed) {
      add("MCP config", s.label, "warn", `${s.path} is not valid JSON`, "Kiro will ignore this file.");
      continue;
    }
    for (const [name, cfg] of Object.entries(parsed.mcpServers ?? {})) {
      const text = `${name} ${cfg?.command ?? ""} ${(cfg?.args ?? []).join(" ")}`.toLowerCase();
      found.push({ name, text, origin: s.label, disabled: cfg?.disabled === true });
    }
  }

  matchServer(found, "glab", /glab|gitlab/, "fail", "Every GitLab call in the workflow goes through this. Nothing will work without it.");
  matchServer(found, "atlassian", /atlassian|jira/, "warn", "Jira verification, both status transitions and the worklog fall back to asking you by hand. The workflow will not skip them.");
}

function matchServer(found, label, pattern, missingStatus, consequence) {
  const hits = found.filter((s) => pattern.test(s.text));
  if (hits.length === 0) {
    add("MCP config", label, missingStatus, "no server found matching this in either mcp.json", consequence);
    return;
  }
  const live = hits.filter((s) => !s.disabled);
  const describe = hits.map((s) => `"${s.name}" (${s.origin}${s.disabled ? ", DISABLED" : ""})`).join(", ");
  if (live.length === 0) add("MCP config", label, missingStatus, `${describe}, all disabled`, consequence);
  else add("MCP config", label, "ok", `${describe}, matched by name, capability not exercised`);
}

/** PATH hygiene. Not a failure, but it explains a resolution that surprised someone. */
function checkPathHygiene(resolutions) {
  const skipped = [...new Set(resolutions.flatMap((r) => r.skipped))];
  if (skipped.length === 0) return;
  const shown = skipped.map((d) => (d === "" ? '"" (current directory)' : `"${d}"`)).join(", ");
  add(
    "Notes",
    "PATH",
    "info",
    `${skipped.length} non-absolute entr${skipped.length === 1 ? "y" : "ies"} skipped by design: ${shown}`,
  );
}

// ---------- rendering ----------

const MARK = { ok: "[ ok ]", info: "[info]", warn: "[warn]", fail: "[FAIL]" };
const NAME_WIDTH = 18;
/** Width of `"  " + mark + " " + paddedName + " "`, so continuations line up under detail. */
const GUTTER = " ".repeat(2 + 6 + 1 + NAME_WIDTH + 1);

/**
 * A detail can be several lines: a version banner under a path, or a script's own multi-line
 * error. Indenting continuations matters most in the failure path, which is the only time
 * anyone reads this closely.
 */
function detailLines(text) {
  const [first, ...rest] = String(text).split(/\r?\n/);
  return [first, ...rest.map((l) => GUTTER + l)];
}

function render() {
  const lines = ["", "gitlab-mr-review preflight", ""];
  for (const group of ["Environment", "Required", "MCP config", "Notes"]) {
    const rows = checks.filter((c) => c.group === group);
    if (rows.length === 0) continue;
    lines.push(group);
    for (const c of rows) {
      const [first, ...rest] = detailLines(c.detail);
      lines.push(`  ${MARK[c.status]} ${c.name.padEnd(NAME_WIDTH)} ${first}`);
      lines.push(...rest);
      if (c.consequence) lines.push(...wrap(c.consequence, 92).map((l, i) => GUTTER + (i === 0 ? "-> " : "   ") + l));
    }
    lines.push("");
  }

  const failed = checks.filter((c) => c.status === "fail");
  const warned = checks.filter((c) => c.status === "warn");
  lines.push(failed.length === 0 ? "Ready. No blocking problems found." : `${failed.length} blocking problem(s): ${failed.map((c) => c.name).join(", ")}`);
  if (warned.length > 0) lines.push(`${warned.length} warning(s): ${warned.map((c) => c.name).join(", ")}`);

  // Two things no script can observe from here, and both have cost real time.
  lines.push(
    "",
    "Two things this cannot check for you:",
    "  1. Whether Kiro has connected to the bundled server. After installing, and after any",
    "     change under server/, reconnect it from the MCP Servers view or the running process",
    "     keeps serving the old code and the old tool list.",
    "  2. Tool approval. The five tools each prompt the first time. They are pure functions",
    "     over data already fetched, with no filesystem or network access, so choosing",
    "     'Always allow' is safe and keeps a run from stalling on you mid-flow.",
    "",
  );
  return lines.join("\n");
}

// ---------- main ----------

checkPlatform();
const git = checkBinary("git", "GIT_PATH", ["--version"], "Nothing in this workflow works without git.");
const glab = checkBinary("glab", "GLAB_PATH", ["--version"], "The MR fetch cannot run. Install glab or pin GLAB_PATH.");
checkGlabAuth(glab);
checkServer();
checkScripts();
checkMcpConfig();
checkPathHygiene([git, glab]);

const failedCount = checks.filter((c) => c.status === "fail").length;
proc.stdout.write(asJson ? JSON.stringify({ repo, platform: proc.platform, node: proc.version, checks, failed: failedCount }, null, 2) + "\n" : render());
proc.exit(failedCount === 0 ? 0 : 1);
