#!/usr/bin/env node
/**
 * Setup check for MergeFlow. Run this once, before your first merge request.
 *
 *   node preflight.mjs [--repo <path-to-your-project>] [--json] [--redact]
 *
 * `--redact` replaces your home path, GitLab username, GitLab host, repo path and branch
 * name with placeholders, so the output can be pasted into a bug report without being
 * read first. Credential scrubbing is separate and always on; see `scrubSecrets`.
 *
 * Every prerequisite of this power fails quietly and plausibly, and reads as a bug in
 * the power rather than a gap in the setup: a stale MCP server, an unapproved tool, a
 * missing Atlassian server, an unauthenticated `glab`. This reports what is actually
 * wrong and what it will cost. It changes nothing: no writes, no network beyond
 * `glab auth status`, no git mutations.
 *
 * Lives at the package root rather than under `skills/mr-resolve/scripts/`: those two
 * are workflow steps the agent runs mid-task, and a test pins that directory to exactly
 * those two. This is a setup tool a person runs by hand.
 *
 * Exit code is 0 when every required check passes, 1 when one does not.
 */

// No @types/node by design, so a local handle keeps an editor quiet without adding a
// package. Same pattern as server.js and both bundled scripts.
const proc = /** @type {any} */ (globalThis).process;
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

const argv = proc.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const asJson = argv.includes("--json");
const redactMode = argv.includes("--redact");
const repo = flag("repo", proc.cwd());

/**
 * Two independent layers, because they answer different questions.
 *
 * `scrubSecrets` is always on and removes anything credential-shaped. There is no case
 * where a token should reach a terminal, a log or an issue, so it needs no flag.
 *
 * The identity map below is `--redact`, and it is opt-in: debugging your own machine
 * needs the real paths, and pasting into a bug report does not. It replaces who and
 * where you are, and leaves every diagnostic fact intact.
 */
const identity = new Map();
const hideValue = (value, placeholder) => {
  const v = String(value ?? "").trim();
  if (v.length >= 3) identity.set(v, placeholder);
};

/**
 * Remove anything credential-shaped from text that came from another program.
 *
 * The vendor prefixes are matched rather than long random-looking runs, deliberately: a
 * 40-character hex string is far more often a git SHA than a secret, and destroying SHAs
 * would cost real diagnostic value for no gain.
 *
 * The first rule is the one the audit turned up. `git remote get-url origin` returns
 * whatever is configured, and `https://oauth2:TOKEN@host/group/repo.git` is a form people
 * really use, so the userinfo half of any URL goes before anything else looks at it.
 *
 * Duplicated verbatim in both bundled scripts, which cannot import from here; a test
 * asserts all three copies are identical.
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

/** Escape a literal for use in a regex, treating `/` and `\` as interchangeable. */
function literalRegex(value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(escaped.replace(/\\\\|\//g, String.raw`[\\/]`), "gi");
}

/** Applied at output time, once every check has contributed what it discovered. */
function applyRedaction(text) {
  if (!redactMode) return String(text);
  let out = String(text);
  // Longest first, so a hostname nested inside a longer value is not half-replaced.
  const ordered = [...identity.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [value, placeholder] of ordered) out = out.replace(literalRegex(value), placeholder);
  return out;
}

hideValue(homedir(), "<home>");
hideValue(repo, "<repo>");

/** The lowest Node this power's shipped code actually runs on, and what it supports. */
const NODE_REQUIRED = 16; // `replaceAll` in server/hunks.js, `node:` import prefixes
const NODE_SUPPORTED = 18; // oldest LTS worth telling a tester to be on

/**
 * Every check lands here as one record. `status` is the only field the summary reads:
 * `ok` and `info` pass, `warn` passes with a caveat, `fail` sets the exit code.
 */
const checks = [];

/**
 * The single choke point every finding passes through, which is why the credential scrub
 * lives here rather than at each call site. Scrubbing at the ~20 places that build a
 * detail string would mean one forgotten call is a leak; scrubbing here means a new check
 * inherits it for free.
 */
const add = (group, name, status, detail, consequence) =>
  checks.push({
    group,
    name,
    status,
    detail: scrubSecrets(detail),
    consequence: consequence == null ? null : scrubSecrets(consequence, 600),
  });

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
  // in your IDE, with the same `glab` binary either way.
  // Only the variable NAME is captured, never the value: the class stops at the colon,
  // and glab prints the token itself after one.
  const source = /Token found in ([^:\n]+)/i.exec(text);
  const fromEnv = /environment variable/i.test(source?.[1] ?? "");
  const tokenNote = source ? ` (token from ${source[1].trim()})` : "";
  const detail = `${login[2]} @ ${login[1]}${tokenNote}`;

  hideValue(login[1], "<gitlab-host>");
  hideValue(login[2], "<user>");

  if (!fromEnv) {
    add("Required", "glab auth", "ok", detail);
    return;
  }
  add(
    "Required",
    "glab auth",
    "warn",
    detail,
    "That variable has to be set for the process your IDE runs in, not only your terminal. If your IDE (Antigravity, Claude Code, Kiro, Cursor) was started from a desktop launcher it inherits no shell profile, so `glab auth login` storing a token in config or keyring is the more portable setup.",
  );
}

/**
 * Proves the bundled server's *code* runs here and still advertises its five tools.
 *
 * It cannot prove your IDE has connected to it. That lives in the editor's MCP client rather
 * than on disk, which is exactly why the reconnect reminder is in the closing notes.
 */
function checkServer() {
  const entry = join(ROOT, "server", "server.js");
  if (!existsSync(entry)) {
    add("Required", "mr-review-checks", "fail", `missing: ${entry}`, "The power's five tools are unavailable.");
    return;
  }

  const messages = [
    {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "preflight", version: "1.0.0" } },
    },
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
  const dir = join(ROOT, "skills", "mr-resolve", "scripts");
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
    // A branch name carries the ticket key, which gives away the project prefix.
    hideValue(parsed.branch, "<branch>");
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
  else
    add(
      "Required",
      "fetch-mr.mjs",
      "fail",
      `expected exit 2 with a usage line, got exit ${r.status}`,
      "The MR fetch will fail.",
    );
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
 * by name and command text across supported IDEs (Antigravity, Claude Code, Kiro, Cursor,
 * Windsurf).
 */
function checkMcpConfig(glabBinInfo) {
  const xdgConfig = proc.env?.XDG_CONFIG_HOME || join(homedir(), ".config");
  const sources = [
    { label: "kiro (user)", path: join(homedir(), ".kiro", "settings", "mcp.json") },
    { label: "kiro (workspace)", path: join(repo, ".kiro", "settings", "mcp.json") },
    { label: "antigravity (user)", path: join(homedir(), ".gemini", "antigravity", "mcp_config.json") },
    { label: "antigravity (user-alt)", path: join(homedir(), ".gemini", "mcp_config.json") },
    { label: "antigravity (workspace)", path: join(repo, ".gemini", "antigravity", "mcp_config.json") },
    { label: "antigravity (workspace-alt)", path: join(repo, ".gemini", "mcp_config.json") },
    {
      label: "claude desktop (user)",
      path:
        proc.platform === "win32"
          ? join(proc.env?.APPDATA || join(homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json")
          : proc.platform === "darwin"
            ? join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json")
            : join(xdgConfig, "Claude", "claude_desktop_config.json"),
    },
    { label: "claude (user)", path: join(homedir(), ".claude", "mcp.json") },
    { label: "claude (state)", path: join(homedir(), ".claude.json") },
    { label: "claude (workspace)", path: join(repo, ".mcp.json") },
    { label: "cursor (user)", path: join(homedir(), ".cursor", "mcp.json") },
    { label: "cursor (workspace)", path: join(repo, ".cursor", "mcp.json") },
    { label: "windsurf (user)", path: join(homedir(), ".codeium", "windsurf", "mcp_config.json") },
    { label: "windsurf (workspace)", path: join(repo, ".windsurf", "mcp.json") },
    { label: "vscode (workspace)", path: join(repo, ".vscode", "mcp.json") },
    { label: "workspace", path: join(repo, "mcp.json") },
    { label: "plugin", path: join(ROOT, "mcp.json") },
  ];

  const found = [];
  for (const s of sources) {
    if (!existsSync(s.path)) continue;
    const parsed = tryParse(readFileSync(s.path, "utf8"));
    if (!parsed) {
      add("MCP config", s.label, "warn", `${s.path} is not valid JSON`, "The editor will ignore this file.");
      continue;
    }
    for (const [name, cfg] of Object.entries(parsed.mcpServers ?? {})) {
      const text = `${name} ${cfg?.command ?? ""} ${(cfg?.args ?? []).join(" ")}`.toLowerCase();
      found.push({ name, text, origin: s.label, disabled: cfg?.disabled === true });
    }
    for (const proj of Object.values(parsed.projects ?? {})) {
      for (const [name, cfg] of Object.entries(proj?.mcpServers ?? {})) {
        const text = `${name} ${cfg?.command ?? ""} ${(cfg?.args ?? []).join(" ")}`.toLowerCase();
        found.push({ name, text, origin: `${s.label} (project)`, disabled: cfg?.disabled === true });
      }
    }
    for (const [name, cfg] of Object.entries(parsed.servers ?? {})) {
      const text = `${name} ${cfg?.command ?? ""} ${(cfg?.args ?? []).join(" ")}`.toLowerCase();
      found.push({ name, text, origin: s.label, disabled: cfg?.disabled === true });
    }
  }

  // Antigravity registers MCP server tools as subdirectories under ~/.gemini/antigravity/mcp/
  const agyMcpDir = join(homedir(), ".gemini", "antigravity", "mcp");
  if (existsSync(agyMcpDir)) {
    try {
      const entries = readdirSync(agyMcpDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          found.push({ name: e.name, text: e.name.toLowerCase(), origin: "antigravity", disabled: false });
        }
      }
    } catch {
      // Unreadable directory; skip quietly
    }
  }

  matchGlabServer(found, glabBinInfo);
  matchServer(
    found,
    "atlassian",
    /atlassian|jira/,
    "warn",
    "Jira verification, both status transitions and the worklog fall back to asking you by hand. The workflow will not skip them.",
  );
}

function matchGlabServer(found, glabBinInfo) {
  const hits = found.filter((s) => /glab|gitlab/.test(s.text));
  const live = hits.filter((s) => !s.disabled);
  if (live.length > 0) {
    const describe = hits.map((s) => `"${s.name}" (${s.origin}${s.disabled ? ", DISABLED" : ""})`).join(", ");
    add("MCP config", "glab", "ok", `${describe}, matched by name, capability not exercised`);
    return;
  }

  // When glab CLI is installed and valid, bundled scripts execute it directly
  if (glabBinInfo?.path && !glabBinInfo?.pinError) {
    add(
      "MCP config",
      "glab",
      "ok",
      "using glab CLI directly (bundled scripts; GitLab MCP not required)",
    );
    return;
  }

  const consequence = "Every GitLab call in the workflow goes through this. Install glab CLI or configure a GitLab MCP server.";
  if (hits.length > 0) {
    const describe = hits.map((s) => `"${s.name}" (${s.origin}, DISABLED)`).join(", ");
    add("MCP config", "glab", "fail", `${describe}, all disabled`, consequence);
  } else {
    add("MCP config", "glab", "fail", "no server found matching this in your IDE MCP config", consequence);
  }
}

function matchServer(found, label, pattern, missingStatus, consequence) {
  const hits = found.filter((s) => pattern.test(s.text));
  if (hits.length === 0) {
    add("MCP config", label, missingStatus, "no server found matching this in your IDE MCP config", consequence);
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
  const lines = ["", "MergeFlow preflight", ""];
  for (const group of ["Environment", "Required", "MCP config", "Notes"]) {
    const rows = checks.filter((c) => c.group === group);
    if (rows.length === 0) continue;
    lines.push(group);
    for (const c of rows) {
      const [first, ...rest] = detailLines(applyRedaction(c.detail));
      lines.push(`  ${MARK[c.status]} ${c.name.padEnd(NAME_WIDTH)} ${first}`, ...rest);
      if (c.consequence) {
        const wrapped = wrap(applyRedaction(c.consequence), 92);
        lines.push(...wrapped.map((l, i) => GUTTER + (i === 0 ? "-> " : "   ") + l));
      }
    }
    lines.push("");
  }

  const failed = checks.filter((c) => c.status === "fail");
  const warned = checks.filter((c) => c.status === "warn");
  lines.push(
    failed.length === 0
      ? "Ready. No blocking problems found."
      : `${failed.length} blocking problem(s): ${failed.map((c) => c.name).join(", ")}`,
  );
  if (warned.length > 0) lines.push(`${warned.length} warning(s): ${warned.map((c) => c.name).join(", ")}`);

  // Two things no script can observe from here, and both have cost real time.
  if (redactMode) lines.push("", "Identity redacted for sharing. Re-run without --redact to see real paths.");

  lines.push(
    "",
    "Two things this cannot check for you:",
    "  1. Whether your IDE has connected to the bundled server. After installing, and after any",
    "     change under server/, reconnect it from your IDE's MCP settings or the running process",
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
checkMcpConfig(glab);
checkPathHygiene([git, glab]);

const failedCount = checks.filter((c) => c.status === "fail").length;

if (asJson) {
  // Redaction applies to the structured form too, or `--redact --json` would quietly
  // hand back everything the text form just removed.
  const report = {
    repo: applyRedaction(repo),
    platform: proc.platform,
    node: proc.version,
    redacted: redactMode,
    checks: checks.map((c) => ({
      ...c,
      detail: applyRedaction(c.detail),
      consequence: c.consequence == null ? null : applyRedaction(c.consequence),
    })),
    failed: failedCount,
  };
  proc.stdout.write(JSON.stringify(report, null, 2) + "\n");
} else {
  proc.stdout.write(render());
}
proc.exit(failedCount === 0 ? 0 : 1);
