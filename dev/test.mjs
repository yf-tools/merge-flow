#!/usr/bin/env node
/**
 * Regression suite for gitlab-mr-review: the bundled server's decision modules,
 * the plugin.json manifest, the skill's frontmatter, and the workflow policies
 * that a rewrite could silently drop.
 *
 * Self-contained rather than importing from a sibling power — a standalone power
 * should be verifiable standalone. Node built-ins only.
 *
 * Run: node dev/test.mjs
 *
 * Lives under `dev/` alongside the lint config because neither is part of the tool: the
 * agent never reads either one. They still ship, since the Agent Plugins manifest has no
 * `files` field and forbids adding one, so an install copies the whole directory. The
 * folder only separates what a user receives from what a developer needs, and stops a
 * stray `eslint.config.mjs` at the power root from being picked up by someone's editor.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { triageMrPayload, normalizeProjectPath, normalizeProjectHost, parseMrTitle } from "../server/mr-payload.js";
import { reconcileDiscussionCounts, slimThreadsForReport } from "../server/discussions.js";
import { attributeStagedHunks, parseStagedDiff } from "../server/hunks.js";
import { normalizeGraphqlMr, stripGid, MR_QUERY } from "../server/graphql.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** The package root, one level up: this file lives in `dev/`, everything it checks does not. */
const ROOT = resolve(__dirname, "..");
/** Developer-only files, which sit beside this one rather than at the package root. */
const DEV = __dirname;

let passed = 0;
const failures = [];

/**
 * Deterministic string order for every sort in this file.
 *
 * `Array.prototype.sort()` with no comparator coerces elements to strings and orders them
 * by UTF-16 code unit. That is correct for all of these lists — they're ASCII filenames,
 * tool names and keywords — but correct by accident, and the intent belongs in the code
 * rather than inferred from the data that happens to be there today.
 *
 * Code-unit order rather than `localeCompare`: these sorts only need *a* total order
 * applied identically to both sides of a comparison, and `localeCompare` is locale- and
 * ICU-dependent. It can also collate two distinct strings as equal, which leaves their
 * relative order unspecified and lets an assertion flake between machines.
 */
const byCodeUnit = (a, b) => {
  if (a < b) return -1;
  return a > b ? 1 : 0;
};

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else failures.push(`${label}\n      expected: ${e}\n      actual:   ${a}`);
}

function truthy(label, actual) {
  if (actual) passed++;
  else failures.push(`${label}\n      expected truthy, got: ${JSON.stringify(actual)}`);
}

function falsy(label, actual) {
  if (!actual) passed++;
  else failures.push(`${label}\n      expected falsy, got: ${JSON.stringify(actual)}`);
}

/**
 * `expect` requires the message to contain it — worth passing whenever *which*
 * error matters, since a bare-throw assertion is equally satisfied by a typo's
 * `TypeError`.
 */
function throws(label, fn, expect) {
  try {
    fn();
    failures.push(`${label}\n      expected a throw, got none`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (expect === undefined || message.includes(expect)) passed++;
    else failures.push(`${label}\n      expected a throw containing ${JSON.stringify(expect)}, got: ${message}`);
  }
}

// ---------- Agent Plugins 1.0.0 manifest constraints ----------
// Transcribed from https://agent-plugins.org/schemas/1.0.0/plugin.schema.json
// rather than fetched, so this test works offline and in CI.

const AGENT_PLUGINS_VERSION = "1.0.0";
const PLUGIN_SCHEMA_URL = `https://agent-plugins.org/schemas/${AGENT_PLUGINS_VERSION}/plugin.schema.json`;
const PLUGIN_REQUIRED = ["$schema", "name"];
const PLUGIN_ALLOWED = new Set([
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "extensions",
]);

function testPluginManifest() {
  const path = join(ROOT, "plugin.json");
  if (!existsSync(path)) {
    failures.push("plugin.json: file missing");
    return;
  }
  const json = JSON.parse(readFileSync(path, "utf8"));
  const keys = Object.keys(json);

  const illegal = keys.filter((k) => !PLUGIN_ALLOWED.has(k));
  eq("plugin.json: no keys outside the spec", illegal, []);

  const missing = PLUGIN_REQUIRED.filter((k) => !keys.includes(k));
  eq("plugin.json: all required keys present", missing, []);

  eq("plugin.json: $schema points at the expected spec version", json.$schema, PLUGIN_SCHEMA_URL);
  truthy("plugin.json: name is lowercase-hyphen", /^[a-z0-9][a-z0-9-]*$/.test(json.name ?? ""));
  truthy("plugin.json: version is semver", /^\d+\.\d+\.\d+/.test(json.version ?? ""));
  truthy("plugin.json: license present", typeof json.license === "string" && json.license.length > 0);
}

// ---------- Agent Skills frontmatter constraints ----------

const SKILL_NAME_MAX = 64;
const SKILL_DESCRIPTION_MAX = 1024;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end === -1) return null;

  const fields = {};
  let currentKey = null;
  for (const line of lines.slice(1, end)) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s?(.*)$/);
    if (m) {
      currentKey = m[1];
      fields[currentKey] = m[2];
    } else if (currentKey && /^\s+\S/.test(line)) {
      fields[currentKey] += ` ${line.trim()}`;
    }
  }
  return fields;
}

/**
 * Agent Skills spec conformance — https://agentskills.io/specification
 *
 * The hard limits are the point: `description` is what Kiro matches requests
 * against, it grows with every scope addition, and crossing 1024 fails validation
 * *quietly* — the skill just stops activating. Same for `compatibility` at 500.
 */
function testSkillSpecConformance() {
  const dir = join(ROOT, "skills", "mr-comments");
  const raw = readFileSync(join(dir, "SKILL.md"), "utf8");

  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  truthy("spec: SKILL.md opens with YAML frontmatter", fm !== null);
  if (!fm) return;
  const block = fm[1];

  const field = (name) => {
    const m = new RegExp(String.raw`(?:^|\n)${name}:[ \t]*([\s\S]*?)(?=\n[a-zA-Z_-]+:|$)`).exec(block);
    return m ? m[1].trim() : null;
  };

  const name = field("name");
  eq("spec: name matches the parent directory", name, "mr-comments");
  truthy("spec: name is 1–64 chars", name.length >= 1 && name.length <= 64);
  truthy("spec: name uses only lowercase alphanumerics and single hyphens", /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name));

  // Headroom is in the label so a near-miss shows in passing output, not only on break.
  const description = field("description");
  truthy("spec: description is non-empty", (description?.length ?? 0) > 0);
  truthy(
    `spec: description is ${description.length}/1024 chars (${1024 - description.length} left)`,
    description.length <= 1024,
  );

  const compatibility = field("compatibility");
  truthy(
    `spec: compatibility is ${compatibility.length}/500 chars (${500 - compatibility.length} left)`,
    compatibility.length >= 1 && compatibility.length <= 500,
  );
  // It only earns its place if it names the things that actually gate the run.
  for (const requirement of ["GitLab only", "glab", "Node.js", "Atlassian"]) {
    truthy(`spec: compatibility names ${requirement}`, compatibility.includes(requirement));
  }

  truthy("spec: license is declared", (field("license")?.length ?? 0) > 0);

  // Optional directories: only the conventional three, correctly placed.
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort(byCodeUnit);
  eq("spec: only the conventional optional directories exist", entries, ["references", "scripts"]);

  // scripts/ — deterministic work, per the spec's own recommendation.
  const scripts = readdirSync(join(dir, "scripts")).sort(byCodeUnit);
  eq("spec: both deterministic steps are scripts", scripts, ["fetch-mr.mjs", "git-context.mjs"]);
  for (const s of scripts) {
    const src = readFileSync(join(dir, "scripts", s), "utf8");
    truthy(`spec[${s}]: has a shebang so it can be executed directly`, src.startsWith("#!/usr/bin/env node"));
    truthy(
      `spec[${s}]: documents why it is a script rather than inline commands`,
      src.includes("Why this is a script"),
    );
    // A script that exits silently is worse than the inline command it replaced,
    // because the failure is now hidden. `proc`, not `process`: both scripts reach
    // it via `globalThis` so an editor without @types/node stays quiet.
    truthy(`spec[${s}]: writes errors to stderr`, src.includes("proc.stderr.write"));
    truthy(`spec[${s}]: exits non-zero on failure`, /proc\.exit\([12]\)/.test(src));
    // Zero-dependency is a promise the README makes.
    falsy(`spec[${s}]: imports nothing outside node:`, /from\s+["'](?!node:)[^."']/.test(src));
  }

  // SKILL.md must actually route through them, or they're dead weight that ships. Matched
  // on the filename rather than on `node scripts/<s>`: the command now interpolates the
  // absolute path from `locate_bundled_scripts`, since a relative path does not resolve
  // from the user's repository.
  for (const s of scripts) {
    truthy(`spec: SKILL.md invokes ${s}`, new RegExp(String.raw`\{scripts\["${s}"\]\.run\}`).test(raw));
  }
  // And the old hand-written forms must be gone, or the run will still improvise.
  falsy("spec: the labelled-echo git chain is no longer prescribed", raw.includes('echo "---DIRTY---"'));
  falsy(
    "spec: the hand-written graphql invocation is no longer prescribed",
    raw.includes("glab api graphql --raw-field query="),
  );

  // Observed on MR !491: `node … --host <h>` matched an agent shell's
  // long-running-process check — "appears to start a server (contains port or host)" —
  // and the run got past it by overriding the safety gate. The GitLab host flag is
  // `--instance` so nothing needs overriding. Checked against the prescribed command
  // line rather than the whole file, because the prose explaining the rule necessarily
  // names the flag it forbids.
  // Anchored on the flags rather than on `node scripts/…`, because the prescribed command
  // now runs the absolute path `locate_bundled_scripts` returns: the working directory is
  // the user's repository, so a relative `scripts/` path does not resolve.
  const fetchLine = raw.split(/\r?\n/).find((l) => l.includes("fetch-mr.mjs") && l.includes("--project"));
  truthy("spec: SKILL.md prescribes the fetch with --instance", fetchLine?.includes("--instance {host}"));
  falsy("spec: the prescribed fetch carries no dev-server-shaped flag", /--(host|port)\b/.test(fetchLine ?? ""));
  truthy(
    "spec: SKILL.md tells the run to locate the scripts before running them",
    raw.includes("locate_bundled_scripts"),
  );

  // And the rejection is behavioural, not documentary: `--host` must fail loudly.
  // Silently ignoring it would query whichever host `glab` defaults to and return a
  // real merge request from the wrong GitLab, with nothing to reveal the swap. Both
  // calls exit before any network access.
  const runFetch = (args) => {
    try {
      execFileSync(process.execPath, [join(dir, "scripts", "fetch-mr.mjs"), ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { status: 0, stderr: "" };
    } catch (err) {
      return { status: err.status, stderr: String(err.stderr ?? "") };
    }
  };

  const usage = runFetch([]);
  eq("spec[fetch-mr.mjs]: a call with no arguments exits 2", usage.status, 2);
  truthy("spec[fetch-mr.mjs]: the usage line names --instance", usage.stderr.includes("--instance <host>"));
  falsy("spec[fetch-mr.mjs]: the usage line offers no --host flag", /--host\b/.test(usage.stderr));

  const rejected = runFetch(["--project", "a/b", "--iid", "1", "--host", "example.net"]);
  eq("spec[fetch-mr.mjs]: --host is rejected rather than ignored", rejected.status, 2);
  truthy("spec[fetch-mr.mjs]: the rejection names the offending flag", rejected.stderr.includes("--host"));

  // fetch-mr.mjs duplicates MR_QUERY so the skill folder stays importable on its
  // own. Invariant 4 permits that only with a test asserting they agree — this one.
  const scriptQuery = /const MR_QUERY = `([\s\S]*?)`;/.exec(readFileSync(join(dir, "scripts", "fetch-mr.mjs"), "utf8"));
  truthy("spec: fetch-mr.mjs carries its own copy of the query", scriptQuery !== null);
  const normalize = (q) => q.replace(/\s+/g, " ").trim();
  eq(
    "spec: the script's query and server/graphql.js MR_QUERY have not drifted",
    normalize(scriptQuery[1]),
    normalize(MR_QUERY),
  );
}

function testSkillFrontmatter() {
  const skillsDir = join(ROOT, "skills");
  if (!existsSync(skillsDir)) {
    failures.push("skills/: directory missing");
    return;
  }
  const dirs = readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  truthy("skills: at least one skill present", dirs.length > 0);

  for (const d of dirs) {
    const label = `skill[${d.name}]`;
    const file = join(skillsDir, d.name, "SKILL.md");
    if (!existsSync(file)) {
      failures.push(`${label}: SKILL.md missing`);
      continue;
    }
    const fm = parseFrontmatter(readFileSync(file, "utf8"));
    if (!fm) {
      failures.push(`${label}: no parseable YAML frontmatter`);
      continue;
    }

    truthy(`${label}: has name`, typeof fm.name === "string" && fm.name.length > 0);
    eq(`${label}: name matches its directory`, fm.name, d.name);
    truthy(`${label}: name is lowercase-hyphen only`, SKILL_NAME_PATTERN.test(fm.name ?? ""));
    truthy(`${label}: name within ${SKILL_NAME_MAX} chars`, (fm.name ?? "").length <= SKILL_NAME_MAX);

    const desc = fm.description ?? "";
    truthy(`${label}: has description`, desc.length > 0);
    truthy(
      `${label}: description within ${SKILL_DESCRIPTION_MAX} chars (is ${desc.length})`,
      desc.length <= SKILL_DESCRIPTION_MAX,
    );
    truthy(`${label}: description states when to use it`, /\b(use when|activate|use before|use this)\b/i.test(desc));
  }
}

/** Every path a caller might expect (README, POWER.md links) must resolve. */
function testDeclaredFilesExist() {
  for (const f of ["LICENSE", "README.md", "POWER.md", "plugin.json", "mcp.json", "preflight.mjs"]) {
    truthy(`layout: ${f} exists at package root`, existsSync(join(ROOT, f)));
  }

  // Developer-only files live in `dev/`, not at the root. Asserted in both directions,
  // because the value of the split is entirely that the root holds only the tool: a file
  // drifting back up is the regression, and it would otherwise pass unnoticed.
  for (const f of ["test.mjs", "eslint.config.mjs"]) {
    truthy(`layout: dev/${f} exists`, existsSync(join(DEV, f)));
    falsy(`layout: ${f} is NOT at the package root`, existsSync(join(ROOT, f)));
  }

  // The lint config is committed while its packages are not, which is the opposite of the
  // obvious split and therefore worth pinning. Its status as an audit rather than a gate
  // is the part that rots quietly: someone wires it into a commit hook, it fails on a
  // complexity limit this repo already exceeds, and the response is to weaken the limit.
  const lint = readFileSync(join(DEV, "eslint.config.mjs"), "utf8");
  truthy("layout: the lint config says it is an audit, not a gate", lint.includes("This is an audit, not a gate"));
  truthy("layout: and names the suite as the actual gate", /`node dev\/test\.mjs` is the gate/.test(lint));
  truthy(
    "layout: and records where a rule should go once it earns its keep",
    lint.includes("When a rule earns its keep, move it into the suite"),
  );
  truthy(
    "layout: node_modules stays excluded, so committing the config cannot drag 80 MB in",
    /^node_modules\/$/m.test(readFileSync(join(ROOT, ".gitignore"), "utf8")),
  );
  truthy("layout: skills/mr-comments/SKILL.md exists", existsSync(join(ROOT, "skills", "mr-comments", "SKILL.md")));

  // A test already guards the skill folder's contents; nothing guarded the power root,
  // and a Kiro session transcript (`sess_<uuid>/`) was found sitting there untracked and
  // uncovered by .gitignore, about to ship with the plugin.
  //
  // Presence is not the assertion: a session running from this directory legitimately
  // creates one mid-work, and failing the build for that would be hostile. What must
  // hold is that it can never be committed or shipped, so the check is on .gitignore.
  truthy(
    "layout: .gitignore excludes session transcripts so one cannot ship with the plugin",
    /^sess_/m.test(readFileSync(join(ROOT, ".gitignore"), "utf8")),
  );

  // mcp.json must conform to the Agent Plugins schema and its entry point must
  // resolve, or the server is skipped at install with a "Component Issues" warning.
  const mcp = JSON.parse(readFileSync(join(ROOT, "mcp.json"), "utf8"));
  eq(
    "mcp.json: only spec-allowed keys",
    Object.keys(mcp).sort((a, b) => a.localeCompare(b)),
    ["$schema", "mcpServers"],
  );
  eq(
    "mcp.json: $schema points at the expected spec version",
    mcp.$schema,
    `https://agent-plugins.org/schemas/${AGENT_PLUGINS_VERSION}/mcp.schema.json`,
  );
  const servers = Object.entries(mcp.mcpServers ?? {});
  eq("mcp.json: declares exactly one server", servers.length, 1);
  for (const [name, cfg] of servers) {
    eq(`mcp.json[${name}]: stdio transport`, cfg.type, "stdio");
    truthy(`mcp.json[${name}]: declares args`, Array.isArray(cfg.args));
    // An absolute or relative path breaks on another machine.
    const usesPluginRoot = (cfg.args ?? []).some((a) => String(a).includes("${PLUGIN_ROOT}"));
    truthy(`mcp.json[${name}]: paths go through \${PLUGIN_ROOT}`, usesPluginRoot);
    for (const arg of cfg.args ?? []) {
      const raw = String(arg);
      if (!raw.includes("${PLUGIN_ROOT}")) continue;
      const resolved = raw.replace("${PLUGIN_ROOT}", ROOT).replaceAll("/", sep);
      truthy(`mcp.json[${name}]: entry point exists → ${raw}`, existsSync(resolved));
    }
  }

  // Every module package.json claims to ship must be present.
  const pkg = JSON.parse(readFileSync(join(ROOT, "server", "package.json"), "utf8"));
  for (const f of pkg.files ?? []) {
    truthy(`layout: server/${f} exists as declared in package.json files`, existsSync(join(ROOT, "server", f)));
  }
  for (const target of Object.values(pkg.exports ?? {})) {
    truthy(`layout: export target ${target} resolves`, existsSync(join(ROOT, "server", String(target))));
  }
}

/**
 * Two haystacks, because SKILL.md loads whole on activation and `references/` only
 * loads when pointed at:
 *
 *   `skill`  — what is RESIDENT. Gate placement and ordering must hold here.
 *   `corpus` — SKILL.md plus every reference. For rules that need only to EXIST,
 *              so moving prose into a reference doesn't drop its assertion.
 */
function loadSkillCorpus() {
  const dir = join(ROOT, "skills", "mr-comments");
  const skill = readFileSync(join(dir, "SKILL.md"), "utf8");
  const refDir = join(dir, "references");
  const refs = existsSync(refDir)
    ? readdirSync(refDir)
        .filter((f) => f.endsWith(".md"))
        .sort(byCodeUnit)
        .map((f) => ({ name: f, text: readFileSync(join(refDir, f), "utf8") }))
    : [];
  return { skill, refs, corpus: [skill, ...refs.map((r) => r.text)].join("\n") };
}

/**
 * The split's guardrails. Deferring procedure into `references/` cut activation
 * cost and created exactly one new failure mode: something that must be in front
 * of the run every time drifts into a file that only loads when pointed at.
 */
function testProgressiveDisclosure() {
  const { skill, refs } = loadSkillCorpus();

  truthy("disclosure: at least one reference file exists", refs.length > 0);

  // A reference nobody points at is dead weight that still ships.
  for (const r of refs) {
    truthy(`disclosure: SKILL.md points at references/${r.name}`, skill.includes(`references/${r.name}`));
  }

  // The spec warns against nested reference chains — a run following two hops is
  // a run that stops following.
  for (const r of refs) {
    const others = refs.filter((o) => o.name !== r.name).filter((o) => r.text.includes(`references/${o.name}`));
    eq(
      `disclosure: references/${r.name} does not chain to another reference`,
      others.map((o) => o.name),
      [],
    );
  }

  // Anything deciding whether the run stops must be resident: reachable only via a
  // reference means optional in practice.
  for (const resident of [
    // The invariants and the numbered rules are the reasoning frame.
    "## Five invariants. Everything else is an instance of them.",
    "## The thirteen rules that matter most",
    "## When this skill doesn't cover what you're looking at",
    // Lane choice — this is precisely where !508 went wrong.
    "## Step 0b — Decide what the run is for, then pick the lane",
    "**If this file seems not to describe the task, read Step 0b before concluding that — and never improvise a run around it.**",
    // The one report, its stop, and the constraint that makes it cheap enough to
    // send first: it is written before any project file has been opened.
    "**The report is mandatory, it is the first user-facing text of the run, and it is a stop — end the turn on it and wait for a reply.**",
    "**No claim about the code belongs in this report.**",
    // Every blocking gate's own headline.
    "## Step 5 — Present the Report (BLOCKING)",
    "### Step 6b — When the picture changes (BLOCKING)",
    "## Step 8 — Present the Final Summary (BLOCKING)",
    "**The pre-push hook decision (BLOCKING).**",
    "### Preview (BLOCKING)",
    "**STOP until the user approves.**",
    // The batch plan is what makes the report fast enough to matter.
    "### Four batches, not fifteen turns",
    // The prose rules must be resident: Step 6's report is rendered long before
    // publishing.md loads at Step 9, so moving this into a reference makes the rule
    // unreachable at the first moment it applies.
    "## Anything posted to GitLab or Jira gets written like a person wrote it",
    "**The report's own prose is not exempt.**",
    // Where the run must not go.
    "## Step 13 — Where this skill ends",
  ]) {
    truthy(`disclosure: stays resident in SKILL.md — ${resident.slice(0, 56)}`, skill.includes(resident));
  }

  // Observed: inside a Power, `references/investigating.md` read as a steering path
  // and the agent called readSteering — "Steering file … not found for power". The
  // layout was right, so the fix is naming the tool before the first pointer is followed.
  truthy(
    "disclosure: the index says references are read as files, not via power steering",
    skill.includes(
      "**Read them with the ordinary file-read tool, resolving `references/…` against this skill's own folder.**",
    ) && skill.includes("not** steering files"),
  );
  // And the files must actually live there, or the pointers are lies.
  truthy(
    "disclosure: references sit beside SKILL.md per the Agent Skills layout",
    existsSync(join(ROOT, "skills", "mr-comments", "references")),
  );
  falsy("disclosure: no stray power-root steering/ directory competing with them", existsSync(join(ROOT, "steering")));

  const failures = refs.find((r) => r.name === "failures.md");
  truthy("disclosure: the run-by-run evidence log exists", failures !== undefined);
  truthy(
    "disclosure: the evidence log says it is not needed to follow the workflow",
    (failures?.text ?? "").includes("**You do not need this file to follow the workflow.**"),
  );
  // Timestamps of the form 08:07:00 / 13:16:46 are the tell for a transcript.
  eq("disclosure: no run transcripts left in SKILL.md", skill.match(/\b\d\d:\d\d:\d\d\b/g) ?? [], []);

  // A ratchet, not a target: set just above the achieved size so regrowth fails,
  // and lowered as more moves land. The spec's 500-line advice is unreachable while
  // every gate, template and stop condition stays resident — which matters more.
  const lines = skill.split(/\r?\n/).length;
  truthy(`disclosure: SKILL.md is ${lines} lines, under the 700-line ratchet`, lines < 700);

  // A reference is only useful if the run receives all of it, and a read can come back
  // truncated. Measured in one session: reporting.md at 22,426 bytes arrived complete,
  // investigating.md at 33,475 arrived truncated with roughly 2,900 bytes of its tail
  // missing — and the tail held the `--raw-field` rule, the `gid://` trap and the
  // `discussions_text` rule. Nothing failed, because nothing was checking.
  //
  // The restructure has landed, so this is now the real limit rather than a ratchet with
  // a standing exception: Step 6 moved to checkout.md (it is released by the report's
  // go-ahead, so batch 1 never needed it), the carry-forward list folded into the profile
  // table as a `Used by` column, and the table's alignment padding came out. 33,475 →
  // 22,542, which puts every reference inside the largest size observed to read whole.
  //
  // Kept as one number for every file, not a per-file allowance, because the failure is
  // about what a single read returns and that does not care which file it was.
  const READS_WHOLE = 23_000;
  for (const r of refs) {
    const bytes = Buffer.byteLength(r.text, "utf8");
    truthy(
      `disclosure: references/${r.name} is ${bytes} bytes, inside the ${READS_WHOLE}-byte read-whole limit`,
      bytes < READS_WHOLE,
    );
  }
}

/**
 * Everything the policy assertions read, loaded once. `*Flat` collapses whitespace so a
 * needle can span a line wrap in the source — most of the doc claims are sentences that
 * a formatter is free to re-wrap.
 */
function loadPolicyDocs() {
  const { skill, refs, corpus } = loadSkillCorpus();
  const power = readFileSync(join(ROOT, "POWER.md"), "utf8");
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const byName = (name) => refs.find((r) => r.name === name)?.text ?? "";

  return {
    skill,
    refs,
    corpus,
    power,
    readme,
    plugin: readFileSync(join(ROOT, "plugin.json"), "utf8"),
    powerFlat: power.replace(/\s+/g, " "),
    readmeFlat: readme.replace(/\s+/g, " "),
    // reporting.md held Steps 5, 6b and 8 until the router split. Each now has its own
    // file, read at the step that needs it, so the assertions follow the content.
    reporting: byName("reporting.md"),
    scopeGate: byName("scope-gate.md"),
    summaryGate: byName("summary-gate.md"),
  };
}

/**
 * Offsets of the headings the ordering assertions compare, resolved once in dependency
 * order — several are searched *from* another, so they can't be computed independently.
 *
 * A missing heading yields -1 rather than throwing, and that surfaces as a failed
 * comparison downstream, because every assertion built on these is a `>` between two of
 * them. Nothing here can pass by being absent.
 */
function sectionOffsets(docs) {
  const { skill } = docs;
  const at = (needle, from) => skill.indexOf(needle, from);

  const investigate = at("## Steps 1–4 — Investigate");
  const reportGate = at("## Step 5 — Present the Report (BLOCKING)");
  const idxTable = skill.slice(investigate, reportGate);
  const approval = at("## Step 8 — Present the Final Summary");
  const jiraFinish = at("## Step 11 — Return Jira to Review and Log Time");

  return {
    outputDiscipline: at("## Internal discovery is not a user-facing report"),
    formatting: at("## Formatting every report to the user"),
    parseUrl: at("## Step 0 — Parse the MR URL"),
    lane: at("## Step 0b — Decide what the run is for, then pick the lane"),
    profile: investigate,

    investigate,
    reportGate,
    startWork: at("## Step 6 — Start Work: Checkout, Jira, Then the Code"),
    idxTable,
    rowMr: idxTable.indexOf("**2 — Fetch MR**"),
    rowJira: idxTable.indexOf("**3 — Verify Jira**"),

    reportSection: at("### One report, then the work"),
    reportMandatory: at(
      "**The report is mandatory, it is the first user-facing text of the run, and it is a stop — end the turn on it and wait for a reply.**",
    ),
    batches: at("### Four batches, not fifteen turns"),
    boundedVerification: at("### Verification is bounded"),

    approval,
    commit: at("## Step 9 — Commit and Push"),
    replies: at("## Step 10 — Reply Inline and Resolve Each Thread"),
    jiraFinish,
    timeAsk: at("### Ask for time spent, then make every Jira write in one turn", jiraFinish),
    lessons: at("## Step 12 — Optional Follow-Up: Capture Recurring Lessons"),
  };
}

function testWorkflowPolicyContracts() {
  const docs = loadPolicyDocs();
  const marks = sectionOffsets(docs);

  assertCorpusPhrases(docs.corpus);
  assertStaleWordingGone(docs);
  assertDocClaims(docs);
  assertLayoutOrdering(docs, marks);
  assertInvestigateOrdering(docs, marks);
  assertPublishOrdering(docs, marks);
  assertReportSectionOrdering(docs, marks);
  assertLaneOrdering(docs, marks);
  assertReportTemplateShape(docs);
  assertBatchPlanShape(docs, marks);
  assertPortableCommands(docs);
  assertJiraCommentWiring(docs, marks);
  assertStepOwnership(docs);
  assertStepPointers(docs);
  assertNoGrowingDuplication(docs);
}

/**
 * Invariant 4 as a measurement rather than a maxim: "a fact stated in two places will drift."
 *
 * Counts passages of 12+ consecutive words shared between any two files in the corpus. Twelve
 * is long enough that shared terminology, tool names and template placeholders don't trip it,
 * and short enough to catch a restated rule.
 *
 * **This is a ratchet, not a clean bill of health.** The count is well above zero and some of
 * it is legitimate: `failures.md` exists to quote the run behind a rule, so it necessarily
 * restates the rule. The point is that the number can only go down. Lower the budget whenever
 * you reduce it — that is what makes the next accidental copy fail here.
 *
 * The manual pass this replaced was unreliable in a specific way worth recording: the
 * layout-rule paragraph reading "**The layout rules are not repeated here**" had itself been
 * copied into three files, and a shingle check found it while reading did not.
 */
function assertNoGrowingDuplication(docs) {
  const N = 12;
  /** Budget = the count measured when this assertion was added. Only ever lower it. */
  const BUDGET = 54;

  const files = [["SKILL.md", docs.skill], ...docs.refs.map((r) => [r.name, r.text])];

  const words = (t) =>
    t
      .toLowerCase()
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);

  const shingled = files.map(([name, text]) => {
    const w = words(text);
    const set = new Set();
    for (let i = 0; i + N <= w.length; i++) set.add(w.slice(i, i + N).join(" "));
    return { name, w, set };
  });

  let passages = 0;
  const worst = [];
  for (let i = 0; i < shingled.length; i++) {
    for (let j = i + 1; j < shingled.length; j++) {
      const a = shingled[i];
      const b = shingled[j];
      // Count runs of consecutive shared shingles, so one long copied sentence counts once.
      let runs = 0;
      let inRun = false;
      for (let k = 0; k + N <= a.w.length; k++) {
        const hit = b.set.has(a.w.slice(k, k + N).join(" "));
        if (hit && !inRun) runs++;
        inRun = hit;
      }
      if (runs > 0) {
        passages += runs;
        worst.push(`${a.name} <-> ${b.name}: ${runs}`);
      }
    }
  }

  worst.sort((x, y) => Number(y.split(": ")[1]) - Number(x.split(": ")[1]));
  truthy(
    `duplication: ${passages} passages of ${N}+ words shared between files, budget ${BUDGET}` +
      (passages > BUDGET ? ` — worst: ${worst.slice(0, 3).join("; ")}` : ""),
    passages <= BUDGET,
  );
}

/**
 * Step ownership: each step-bound reference holds its own step's procedure, and no other
 * reference holds a copy of it.
 *
 * This exists because `assertCorpusPhrases` cannot catch a misfiling. It proves a rule is
 * present *somewhere* in the corpus, which is exactly what makes moving prose between files
 * safe — and exactly why it is blind to prose that landed in the wrong file. Observed: the
 * Step 6 Jira transition procedure sat in `fixing.md`, which a run reads at Step 7, *after*
 * the transition should already have run, while `checkout.md`'s index row claimed that
 * content and the file did not contain `transitionJiraIssue` at all. Every phrase involved
 * was pinned and present, so 990 assertions passed across the whole period it was broken.
 *
 * The uniqueness half is the part that catches it. A marker appearing in two references
 * means either a duplicated procedure (invariant 4) or one of the two copies is misfiled;
 * both need a human look, so both fail here.
 *
 * Cross-cutting references own no step and are deliberately absent from this table:
 * `failures.md` (evidence), `batching.md` (evidence), `user-mistakes.md` (a catalogue keyed
 * by case), `glab-tooling.md` (keyed by symptom).
 */
function assertStepOwnership(docs) {
  const { refs } = docs;

  /** reference → a marker that only that file's step-owning procedure would contain. */
  const owners = {
    "investigating.md": "## The three traps, before anything else",
    "jira-identity.md": "## Reconcile one authoritative Jira identity",
    "reporting.md": "Say go and I'll",
    "scope-gate.md": "just reply to the thread without a code change",
    "checkout.md": "## The Jira transition (Step 6, with the checkout)",
    "fixing.md": "## Reading `attribute_staged_hunks`' output",
    "summary-gate.md": "Approve those Jira updates?",
    "publishing.md": "## The pre-push hook decision — presentation and follow-through",
    "jira.md": "## What the re-read tells you — five branches",
    "lessons.md": "## What earns an entry",
    "conflicts.md": "## The plan gate — the template",
  };

  for (const [name, marker] of Object.entries(owners)) {
    const own = refs.find((r) => r.name === name);
    truthy(`step-ownership: references/${name} still exists`, own !== undefined);
    truthy(
      `step-ownership: ${name} still holds the procedure its index row promises`,
      (own?.text ?? "").includes(marker),
    );
    eq(
      `step-ownership: no other reference carries ${name}'s procedure`,
      refs.filter((r) => r.name !== name && r.text.includes(marker)).map((r) => r.name),
      [],
    );
  }

  // Every reference either owns a step above or is one of the four cross-cutting files.
  // A new reference that is neither is unreachable-by-design or an unowned step, and the
  // author should have to say which.
  const crossCutting = new Set(["failures.md", "batching.md", "user-mistakes.md", "glab-tooling.md"]);
  const unclassified = refs.map((r) => r.name).filter((n) => !(n in owners) && !crossCutting.has(n));
  eq("step-ownership: every reference is either step-owning or declared cross-cutting", unclassified, []);
}

/**
 * The other half of misfiling: a step section pointing at the wrong reference.
 *
 * `assertStepOwnership` catches a procedure that sits in the wrong file. It cannot catch a
 * pointer that names the wrong file, because both files exist and both hold what they claim.
 * Observed: Step 6 sent the run to `references/investigating.md` for the checkout paths, the
 * per-thread read checklist and the two-reads cap. `investigating.md` holds none of the three;
 * `checkout.md` holds all of them. A run following the pointer would have read a file that
 * could not answer the question it was sent to answer, and nothing failed.
 *
 * So every `references/*.md` named inside a step's own section must be that step's own
 * reference, or an explicitly listed cross-reference with a reason attached.
 */
function assertStepPointers(docs) {
  const { skill } = docs;

  /** [resident heading, the reference that step hands off to] */
  const steps = [
    ["## Step 0 — Parse the MR URL", "investigating.md"],
    ["## Step 0b — Decide what the run is for, then pick the lane", "conflicts.md"],
    ["## Steps 1–4 — Investigate, without touching the working tree", "investigating.md"],
    ["## Step 5 — Present the Report (BLOCKING)", "reporting.md"],
    ["## Step 6 — Start Work: Checkout, Jira, Then the Code", "checkout.md"],
    ["### Step 6b — When the picture changes (BLOCKING)", "scope-gate.md"],
    ["## Step 7 — Fix One Comment at a Time", "fixing.md"],
    ["## Step 8 — Present the Final Summary (BLOCKING)", "summary-gate.md"],
    ["## Step 9 — Commit and Push (only after approval)", "publishing.md"],
    ["## Step 10 — Reply Inline and Resolve Each Thread", "publishing.md"],
    ["## Step 11 — Return Jira to Review and Log Time", "jira.md"],
    ["## Step 12 — Optional Follow-Up: Capture Recurring Lessons", "lessons.md"],
    ["## Step 13 — Where this skill ends", null],
  ];
  const END = "## Reference files — load these when the pointer says to";

  /** Cross-references that are correct, each with the reason it is not a misfiling. */
  const allowed = {
    // Step 3 sits inside the Steps 1–4 section, and jira-identity.md is Step 3's own file.
    "## Steps 1–4 — Investigate, without touching the working tree": ["jira-identity.md"],
    // The post-push conflict re-read is a conflict-lane concern reached from the review lane.
    "## Step 9 — Commit and Push (only after approval)": ["conflicts.md"],
  };

  for (let i = 0; i < steps.length; i++) {
    const [heading, owner] = steps[i];
    const start = skill.indexOf(heading);
    truthy(`step-pointers: ${heading.slice(0, 34)} is still present`, start >= 0);
    if (start < 0) continue;

    const nextHeading = i + 1 < steps.length ? steps[i + 1][0] : END;
    const stop = skill.indexOf(nextHeading, start + heading.length);
    const body = skill.slice(start, stop < 0 ? undefined : stop);

    const named = [...new Set([...body.matchAll(/references\/([a-z-]+\.md)/g)].map((m) => m[1]))];
    const permitted = new Set([owner, ...(allowed[heading] ?? [])].filter(Boolean));
    eq(
      `step-pointers: ${(/Steps? \d+b?/.exec(heading)?.[0] ?? heading).padEnd(8)} points only at its own reference`,
      named.filter((n) => !permitted.has(n)),
      [],
    );
  }
}

/**
 * The closing Jira comment, which had to be added without adding a gate.
 *
 * It rides on Step 8's existing Jira approval rather than asking again, so the assertions
 * here are mostly about *where* it is authorized and *what it may claim*. The failure this
 * guards against is the comment drifting into its own question (turning one decision into a
 * matrix) or into a claim about the report's intentions rather than what Step 10 actually
 * observed on the remote — a report item that became a Step 6b "already handled" is not a
 * fix, and a skipped thread is not a resolved one.
 */
function assertJiraCommentWiring(docs, m) {
  const { skill, summaryGate, refs } = docs;
  const { timeAsk, lessons } = m;
  const jira = refs.find((r) => r.name === "jira.md")?.text ?? "";

  // Authorized at Step 8, with the transition, as one question with two answers.
  truthy(
    "jira-comment: Step 8's block proposes the comment alongside the transition",
    summaryGate.includes("and one short comment on the ticket naming what was addressed"),
  );
  truthy(
    "jira-comment: and asks once, covering both",
    summaryGate.includes("Approve those Jira updates? (yes / leave Jira alone)"),
  );
  truthy(
    "jira-comment: the no-transition branch still offers the comment",
    summaryGate.includes("and post one short comment naming what was addressed"),
  );
  truthy(
    "jira-comment: summary-gate.md records why it shares the transition's gate",
    summaryGate.includes("**The comment rides with the transition rather than getting its own gate.**"),
  );

  // Resident: the write batch names it, and points at the reference for the content rules.
  const batch = skill.slice(timeAsk, lessons);
  // The three call names moved to jira.md's write-batch section; the resident half keeps the
  // ordering rule and the authorization fact, which are what decide whether a write is allowed.
  const writeBatch = jira.slice(jira.indexOf("## The write batch"), jira.indexOf("## Verifying the transition result"));
  truthy("jira-comment: jira.md has a write-batch section", writeBatch.length > 100);
  for (const call of ["transitionJiraIssue", "addCommentToJiraIssue", "addWorklogToJiraIssue"]) {
    truthy(`jira-comment: the write batch issues ${call}`, writeBatch.includes(call));
  }
  truthy(
    "jira-comment: the resident file says Step 8 authorizes it, not the time question",
    batch.includes("**The comment is authorized by Step 8's Jira block, not by this question**"),
  );
  // Ordering: it is a write, so the batch must sit after the time question, not before it.
  truthy(
    "jira-comment: the write batch follows the time question in jira.md",
    jira.indexOf("## The write batch") > jira.indexOf("## The time question's details"),
  );

  // Evidence rule: the ledger, never the report.
  truthy(
    "jira-comment: jira.md sources it from Step 10's ledger",
    jira.includes("Step 10's ledger already holds") || jira.includes("what Step 10's ledger observed remotely"),
  );
  truthy(
    "jira-comment: and says a skipped thread is not a resolved one",
    jira.includes("a thread you skipped is not a thread you resolved"),
  );
  // The two things that must never reach a remote surface.
  truthy("jira-comment: --no-verify stays out of it", jira.includes("`--no-verify` choice"));
  truthy(
    "jira-comment: prose rules apply because a colleague reads it",
    jira.includes("It is remote text a colleague reads"),
  );
  // Flatness, so nobody promises threading the API cannot do.
  truthy("jira-comment: the API's lack of threading is stated, not implied", jira.includes("no parent-comment field"));

  // Independence: a failed comment must not hold back the transition or the worklog.
  truthy(
    "jira-comment: a failure is reported without blocking the other writes",
    jira.includes("**A failed comment is reported, not retried silently, and it holds nothing back.**"),
  );

  // The Step 11 read batch shares the time question's turn, and Step 8 no longer re-reads.
  // Both are latency findings from a live run: the same two Jira reads were prescribed at
  // Step 3, Step 8 and Step 11 — six calls for two facts — and the Step 11 pair landed
  // *after* the answer, costing a round trip and a question with no figures behind it.
  truthy(
    "jira-reads: Step 11 batches the two reads into the time question's turn",
    skill.includes(
      "go out as one batch of two in the same turn as the time question, before you emit it — never after the answer",
    ),
  );
  truthy(
    "jira-reads: and forbids narrating what they found",
    skill.includes("**Say nothing between the reads and the question**"),
  );
  truthy(
    "jira-reads: Step 8 calls transitions only, not a second re-read",
    docs.summaryGate.includes("**that one call, not a re-read as well**"),
  );
  falsy(
    "jira-reads: the phrasing a run misread as 'after they reply' is gone",
    skill.includes("Re-read the ticket immediately before any automated write."),
  );
  truthy(
    "jira-reads: jira.md records the run and why Step 8 doesn't re-read",
    jira.includes("**This is also the whole reason Step 8 does not re-read.**"),
  );

  // Stale enumerations. Every place that used to say "two writes" or "both" now covers three.
  for (const stale of [
    "**Ask for the time before the two Jira writes, then make both in one turn.**",
    "issue both writes in one turn",
    "with both results stated separately",
    "before the two Jira writes",
  ]) {
    falsy(`jira-comment: no stale two-write wording — ${stale.slice(0, 44)}`, skill.includes(stale));
  }
}

/**
 * Cross-platform portability of every prescribed command.
 *
 * This ships to testers who are not all on Windows, and three prescribed commands were
 * PowerShell-only. One of them was the only documented way to see which files actually
 * conflict, so the conflict lane broke outright on macOS with nothing to say why.
 *
 * The tool name was the subtler half. `execute_pwsh` is what one environment calls its
 * terminal tool, and naming it pins the instruction to that environment when what the
 * rule actually depends on is a tool that streams output and accepts a timeout — see
 * publishing.md's "Use terminal commands, not git MCP tools" for why those two
 * properties, and not the shell, are the point.
 */
function assertPortableCommands(docs) {
  const { skill, refs } = docs;
  const files = [{ name: "SKILL.md", text: skill }, ...refs];

  const CMDLETS = /Out-File|Select-String|ConvertFrom-Json|ConvertTo-Json|Select-Object|Get-Content|\$env:/;

  /**
   * Fenced blocks, by walking lines rather than matching pairs.
   *
   * The obvious form, ```` /```(\S*)\r?\n([\s\S]*?)```/g ````, is a `slow-regex` finding:
   * a backtick is not whitespace, so `\S*` swallows every later fence marker and then
   * backtracks looking for the newline that follows the language tag. A line walk is
   * linear by construction and needs no reasoning about whether the input is hostile.
   */
  const fences = (text) => {
    const out = [];
    let open = null;
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("```")) {
        if (open) open.lines.push(line);
      } else if (open) {
        out.push({ lang: open.lang, body: open.lines.join("\n") });
        open = null;
      } else {
        open = { lang: line.slice(3).trim(), lines: [] };
      }
    }
    return out;
  };

  for (const f of files) {
    const blocks = fences(f.text);
    const shellSpecific = blocks.filter((b) => b.lang === "powershell" || CMDLETS.test(b.body));

    // An environment-specific tool name inside an instruction is the same defect as a
    // shell-specific command: it names what one machine happens to have.
    falsy(`portable[${f.name}]: names no environment-specific terminal tool`, f.text.includes("execute_pwsh"));

    // The resident file is read on every run on every machine, so keep it shell-neutral.
    if (f.name === "SKILL.md") {
      eq(`portable[${f.name}]: carries no shell-specific command block`, shellSpecific.length, 0);
      continue;
    }
    if (shellSpecific.length === 0) continue;

    // A PowerShell recipe is fine, but only standing next to one a POSIX shell can run.
    const posix = blocks.filter((b) => (b.lang === "bash" || b.lang === "sh") && !CMDLETS.test(b.body));
    truthy(`portable[${f.name}]: its PowerShell recipe is paired with a POSIX one`, posix.length > 0);
  }

  // Dropping the tool name is only safe if the rule states what it actually relies on.
  const gitRule = [skill, refs.find((r) => r.name === "publishing.md")?.text ?? ""].join("\n");
  truthy("portable: the git-over-terminal rule gives streaming as a reason", /stream/i.test(gitRule));
  truthy("portable: and a timeout it can set", /timeout/i.test(gitRule));

  // `node` is already a hard requirement, which makes it the one filter present on every
  // tester's machine — unlike `jq`, and unlike any shell's own JSON cmdlets.
  const tooling = refs.find((r) => r.name === "glab-tooling.md")?.text ?? "";
  truthy("portable[glab-tooling.md]: the response filter runs through node", tooling.includes("node -e"));
}

/**
 * Rules that must be present somewhere in SKILL.md or its references. Asserted against the
 * whole corpus, not SKILL.md alone, so moving prose into a reference doesn't drop its
 * assertion — that is the one failure mode progressive disclosure introduced.
 */
function assertCorpusPhrases(corpus) {
  for (const phrase of [
    "Internal discovery is not a user-facing report",
    "Steps 0–4 are investigation, and all of them run *before* the report. Run them quietly",
    "Which power or skill you activated",
    "Checks that passed — host is GitLab, tree is clean",
    "A different current branch than `source_branch` is normal, not an alarm",
    // Was pinned on the Quick Reference row titled "Output discipline". That row was a
    // paraphrase of "Internal discovery is not a user-facing report" and went with the rest
    // of the duplicated table; this points at the clause that carries the rule.
    "go quiet until Step 8's summary",
    "Step 3 — Verify the Jira Ticket (silent; no writes, no gate)",
    "Ticket identity for Jira lifecycle synchronization",
    "git merge --ff-only",
    "git diff --cached",
    "No key at all is a hard stop",
    "ask once — here, because you genuinely cannot proceed without it",
    "exactly one `(Jira hostname, ticket key)` pair",
    "One key but several Jira browse-link hostnames",
    "summary that does not match the MR's work is a 🛑 stop",
    "getJiraIssue",
    "Never match on `to.statusCategory` alone",
    "Call `transitionJiraIssue` with the exact transition recorded in Step 3",
    "the resulting `status.name` is exactly the approved target",
    "Jira approval is independent from commit approval and time logging",
    "If no direct review transition exists:",
    "Confirm leave unchanged/manual?",
    "Recover safely from partial publication",
    "never repost an approved reply already present",
    "Resume Step 11 only after every approved action is observed remotely",
    "Step 11 — Return Jira to Review and Log Time",
    "**Publication success is a hard precondition.**",
    "a failed push, reply or resolution **leaves Jira in active development**",
    "The time question below still runs; time was spent either way.",
    "Do not ask for time spent at this gate",
    "### Ask for time spent, then make every Jira write in one turn",
    "**This is the final question in the workflow**",
    // The time question moved ahead of the two Jira writes so they share one turn
    // (observed: three turns for two writes and a question). Asking first also makes
    // rule 12's failure unavailable rather than forbidden — with no transition yet,
    // there is no resulting status to announce early.
    "It is the last *question*, not the last *write*:",
    "**Name the target as pending, never as done.**",
    "**Then stop and go ask about time.**",
    "**This ordering is also why there's nothing to announce here.**",
    "**issue every Jira write in one turn:**",
    "**Then one closing line, with each result stated separately:**",
    // The closing Jira comment. Approved at Step 8 with the transition rather than at its
    // own gate, written from Step 10's ledger rather than the report's intentions, and
    // flat because Jira has no parent-comment field.
    "## The closing comment",
    "**Jira comments are flat.**",
    "**What it may claim is exactly what Step 10's ledger observed remotely.**",
    "addCommentToJiraIssue",
    "**When the comment is the only Jira write**",
    "How much time should I log against it?",
    "**Never infer the duration**",
    "Ask even when earlier stages failed",
    // Same: was the "Time log (last)" row title. The rule lives in Step 11's own section.
    "Ask for time spent, then make every Jira write in one turn",
    "Call `getJiraIssue` again immediately before automated writes",
    "exact review target approved in Step 8",
    "worklog and status transition are independent approvals",
    "never suppress the worklog because status synchronization could not complete",
    "Definitive validation and staging",
    "loops back through this entire phase",
    "No staging, no formatting after approval",
    "stop for an explicit reconciliation decision",
    "**never write or disclose it** in any remote text",
    "Optional Follow-Up: Capture Recurring Lessons",
    "append-only provenance",
    "Never replace or drop earlier sources",
    // Asserted in both powers so the `ndjson` workaround can't drift apart.
    'List endpoints need `output: "ndjson"`',
    "single resource → default output; collection → `ndjson`",
    // --- MR !500: four regressions. 1. Conflict state was fetched and never read.
    "`has_conflicts`, `merge_status`, `detailed_merge_status`",
    "A conflicted MR changes the plan — say so before triaging anything",
    "Do you want the conflict resolved first",
    "A conflict resolution is new scope, not part of the review pass",
    // 2. The pre-report output was replaced with narration, twice. The count line
    // grew into orientation facts because the run had them and no slot for them.
    "### One report, then the work",
    "**There is one report now, and it is the run's first output.**",
    "**What must never appear in the report:**",
    "**Anything you'd have to read a project file to know.**",
    "the blocker's question replaces the closing one",
    "**Non-blocking flags belong in the same message, on the Flags row**",
    "don't preface the report with a sentence restating its own numbers",
    // 2b. MR !491: the content was correct and in the right slot, but six tool calls
    // shared its turn and the client collapsed them into a progress line, scrolling
    // it out of view. Content was never the problem; the missing pause was.
    "**The report is mandatory, it is the first user-facing text of the run, and it is a stop — end the turn on it and wait for a reply.**",
    "No tool call goes out in the same turn that emits it",
    '**What a bare "go ahead" covers: batches 3 and 4, the Jira transition the report named, and the ✅ Fix / 🔵 Nitpick items.**',
    "**That answer is also the go-ahead**",
    // Anchored on the imperative, not the narrative — evidence is in failures.md.
    "**Four ways this has gone wrong. Each is a thing not to do:**",
    "**Don't split it in two.**",
    "**Don't emit it and keep going.**",
    "An unread report is worth about as much as no report",
    "Go ahead?",
    // 2c. MR !491 again: the brief-then-report split was two stops for one decision,
    // the second message led with nine settled threads, and Jira was asked separately.
    "**Resolved threads are a number, never a list.**",
    "**Resolved threads never become items.**",
    "**One question, and it covers everything the run does next.**",
    "**The Jira move is a line in that list, not a second question.**",
    "the order in that list is not cosmetic**",
    "### Verification is bounded — don't let it eat the run",
    "Bound the API verification in Step 6 to a couple of reads",
    "Cap this at a couple of reads",
    // 3. `git merge-tree` output misread four times in a row. Verified on git 2.53:
    // markers sit inside the diff with a leading `+`, so anchoring matches nothing.
    "`git merge-tree` reports every touched file, not just conflicts",
    "**Grep for the conflict markers, and do not anchor the pattern.**",
    "So `^<<<<<<<` matches nothing",
    // 4. Step 11's re-read skipped because no transition was needed.
    "This applies even when no transition is needed",
    "the worklog-only path too",
    "must come from that re-read, not from Step 3",
    // --- Generalization layer: without invariants and an uncovered-case protocol,
    // --- an unlisted scenario gets mapped onto the nearest paragraph.
    "## Five invariants. Everything else is an instance of them.",
    "A claim needs evidence from this run",
    "A gate closes only on the user's words",
    "Every list here is examples, never a boundary",
    "A fact stated in two places will drift",
    "Open-ended work needs a stopping rule",
    "## When this skill doesn't cover what you're looking at",
    "You will hit situations described nowhere in this file",
    "Which decision it blocks",
    "Mapping it onto the closest documented case",
    "Retrying the same call unchanged",
    "Naming a cause you haven't confirmed",
    "Uncovered does not mean unbounded",
    // --- Decisions that moved out of prose into the bundled server. The skill must
    // --- route through them rather than reasoning inline.
    "### Run the payload through `triage_mr_payload` — don't eyeball it",
    "A check that didn't run is not a check that passed",
    "Get these numbers from `reconcile_discussion_counts`, not by counting",
    // gid stripping and `--raw-field` are the two GraphQL traps that break silently.
    // SKILL.md no longer spells the invocation out, but a reader of the fallback
    // path still has to hit them.
    "**`--raw-field`, never `--field`.**",
    "`triage_graphql_mr`",
    "**`discussions_text`**",
    "The bare remainders are **exactly** the REST ids",
    "**Don't rebuild the payload as objects to pass it in.**",
    "**`reconciles: null`**",
    "attribute_staged_hunks",
    "Only list a file in `formatter_files` if the formatter said it changed that file",
    // The rule is resident in Step 7; the deleted Quick Reference row phrased it "is not",
    // the prose phrases it "as". Same rule, so the pin moves to the surviving wording.
    'as "attribution done."',
    // The template must use the tool's own field names. `threadsTotal` is the raw
    // payload length — on MR !508 that was 5 against 3 real threads, because GitLab
    // returns "requested review from @x" as a discussion.
    "**Report `feedbackThreads`, never `threadsTotal`.**",
    // Observed on MR !491: ten threads rendered as ten identical five-line blocks, so
    // the single item needing a decision sat below nine settled ones. Resolved threads
    // are now a bare count. The safety property is that the count can only ever hold
    // threads GitLab itself marked resolved, so nothing the run would change hides there.
    "{needsYou} of {feedbackThreads} thread(s) need your call",
    "**`{needsYou} + {rolledUp}` must equal `feedbackThreads`.**",
    // ...and it must not imply they were verified, because no file was opened.
    "I haven't re-checked those against the code",
    // Resolve state is GitLab's bookkeeping and the classification is the run's; a
    // report that conflates them mislabels a resolved thread that still holds a question.
    "**Resolve state and `{needsYou}` are not quite the same split",
    // Emoji help only while the set stays small enough to scan.
    "### The fixed marker set",
    // Observed: a run issued `git remote get-url origin; git branch --show-current; git
    // status --porcelain`, couldn't tell the empty status from a broken separator,
    // re-issued `git status --porcelain` alone, then ran git-context.mjs anyway. Three
    // calls and nineteen seconds for what the script returns in one. The prohibition
    // existed, 436 lines away in the reference-index section, and the run had the whole
    // file in context — so this is about where the rule sits, not whether it exists.
    "**Never hand-roll these reads.**",
    "don't `list_directory` the scripts folder to check the file is there",
    // git-context.mjs returns `remote`, and a run called `git remote get-url origin`
    // separately four seconds before getting the same value from the script.
    "**`remote` is in that output, so there is no separate `git remote get-url origin`**",
    // The paths now arrive in the tool description, so the skill must stop presenting
    // them as a convention to be checked and start pointing at the evidence.
    "**You already have the script paths — don't go looking for them.**",
    // Observed: five update_session_information calls across 38 seconds, three of them
    // setting the same waiting_on_user status, before a single readable word was written.
    // The skill never mentions that tool; the emphasis on stopping invited it.
    "**The stop is ending the turn, not announcing that you are about to.**",
    // Observed: the run passed the site's `name` as cloudId, and both Atlassian reads
    // failed with "Input does not look like a valid domain or URL" before being retried
    // with the hostname. The response carries id, url and name, and nothing said which
    // one to use, so it was a coin flip — the run before this one guessed right.
    "never its `name`",
    "Input does not look like a valid domain or URL",
    // Observed: a run made zero read_file calls, skipped reporting.md, and improvised a
    // report missing the title heading, the needsYou lead, the verbatim countLine and the
    // closing list, while adding the "Suggested fix" the template forbids before any code
    // is read. The bullet had described the read as a batching optimisation, not a
    // requirement, so "cheap to batch" read equally as "safe to skip".
    "and this read is not optional",
    "you may not render Step 5 from memory",
    // Anything posted to GitLab or Jira outlives the run and a colleague reads it, so
    // the prose rules cover replies, the commit body and worklog notes. The report's
    // own sentences are included: only its markers and headings exist to be scanned.
    "**The report's own prose is not exempt.**",
    "no escalating agreement",
    "**Escalating agreement.**",
    "The rules below govern what you post, not how this file is written",
    // The length heuristic is the one that survives after every other tell is fixed.
    "A reply three sentences longer than the comment it answers",
    "**`threadsTotal` does not appear in this header at all**",
    // --- Line-by-line audit: mandated checks that were impossible as written, and
    // --- inputs no step established.
    // General MR comments aren't resolvable, so unresolved+resolved sits below
    // threadsTotal by design — the header arithmetic named the wrong field.
    "`{X} + {Y} == resolvableThreads`",
    // Anchored on words, not emphasis syntax: an editor may rewrite *diff* to _diff_.
    "threads resolvable, so a general MR-level comment is a thread you must triage",
    // numstat is repo-wide; Step 8's template needs per-file figures.
    "`numstat` and `totals` are **repo-wide**",
    "those come from `files[].added` / `files[].removed`",
    // current_user is required by two tool calls and was never sourced.
    "The GitLab username you're authenticated as",
    "`glab_auth_status` reports",
    // Step 4 told the agent to hand-filter nine lines before forbidding it.
    "**Don't pre-filter or pre-count anything first.**",
    // The count line has three endings; the templates showed only the tick.
    "**Use the tool's `countLine` verbatim rather than typing that shape.**",
    // --- MR !500 latency: five minutes to the first phase over ~15 serial round
    // --- trips, none individually slow. One rule per observed cause.
    // Profiling ran as six turns before the MR fetch; half isn't needed until Step 7.
    "**The Batch column is the whole point of splitting this table.**",
    "**This call is batch 1**",
    "**This checkout is batch 3 — after the report and the reply to it, not before.**",
    "**This is batch 4.**",
    // getJiraIssue and getTransitionsForJiraIssue went out nine seconds apart. They
    // moved forward to batch 2 as well, so the ticket's status is a row in the report
    // rather than a question a turn later.
    "go out together in **batch 2**: **issue both in the same turn.**",
    "**Batch 2, not batch 3, and that is the change that made the report whole.**",
    // reconcile was called three times: once missing `resolvable`, once correctly,
    // once with `user_notes_count: 0` alone after the schema had rejected it.
    "**Keep five fields per note, and don't trim below them:**",
    "**One call.**",
    "**A truncated response is not a failed fetch.**",
    // Two builds started "as diagnostics" while the pre-push hook already built all
    // six projects, then polled ~2 minutes before the summary.
    "**A development build is still a build.**",
    // `--max-warnings=0` appended to a script that already carried it.
    "**Run project scripts exactly as the `scripts` block defines them.**",
    // Ten calls across four tools chasing one symbol, with the cap already written down.
    "**Two escalations of the same question is the cap, not two of each tool.**",
    // --- MR !508 leftovers: three wasted calls and one improvised workaround.
    // A bare `;` between git reads made a clean tree indistinguishable from a mangled
    // separator. `git-context.mjs` returns JSON now, so there is no separator to
    // mangle; the old chained form is in the forbidden list below.
    "JSON makes empty structurally empty instead of conventionally empty",
    // The same confusion also re-fetched an MR payload that had returned fine.
    "**Re-issue only the call that failed. A batch is not a transaction**",
    // A getJiraIssue after a transition that already named its resulting status is a
    // round trip for evidence you were handed.
    // jira.md writes this with underscore emphasis; the deleted resident copy used asterisks.
    "when the transition response itself names the resulting status, that _is_ the read-back",
    // Eight hunks exceeded diff_text; the run condensed the diff and took counts from
    // --numstat, which is right and now written down.
    "**When the diff is too large to pass whole, pass a condensed one — and then stop trusting its counts.**",
    // `locked` was missing from the terminal-state list the tool enforces.
    "/ `locked`. The last three all raise a `terminal-state` blocker",
    // --- Conflict handling had detection and a gate but no exit: nothing confirmed
    // --- the conflict cleared, and resolution hunks had no attribution basis of
    // --- their own, so they passed Step 7 only by laundering through `approved_files`.
    "**Resolution files go in `conflict_files`, never in `approved_files`.**",
    "**A file in `mixedFiles` carries both, and that's the case to split.**",
    "**Confirm the conflict actually cleared — from GitLab, after the push.**",
    "**If this run resolved a conflict, re-read the MR payload after the push**",
    // --- MR !508: the skill activated, was judged inapplicable ("designed for
    // --- reviewing comments rather than fixing conflicts"), and set aside. The run
    // --- improvised — no brief, no gate, eight ungated edits, a --no-verify commit,
    // --- none of the bundled tools. The gap was at the door, not in the workflow.
    "## Step 0b — Decide what the run is for, then pick the lane",
    "**If this file seems not to describe the task, read Step 0b before concluding that — and never improvise a run around it.**",
    "**Pick from what the user said, not from what the payload says.**",
    "**The lane changes the middle of the run. It never changes which gates exist.**",
    "### The resolution plan gate (conflict-first lane, replaces Step 5)",
    "**Beyond a mechanical pick:**",
    '**The "Beyond a mechanical pick" row is the one that matters, and it is not optional.**',
    "**Never start the merge or rebase before this gate closes.**",
    "it reports conflicts **without** touching the working tree",
    "**A dirty tree or a branch switch is a bigger deal in this lane, not a smaller one.**",
    // The review-lane conflict section has to say it's the review lane, or the
    // two conflict paths read as contradicting each other.
    "**This section is the review lane, where a conflict arrives uninvited.**",
    '**If they choose "resolve first", the run switches to the conflict-first lane**',
    // `conflicts` and `zero-comments` stop the review lane but not this one, and the
    // tool still raises them — so the skill says what they mean here rather than
    // leaving the run to suppress them silently.
    "**Two of `triage_mr_payload`'s blockers mean something different in this lane, and neither is suppressed — both get *reinterpreted out loud*.**",
    "Here it stops nothing: an MR can have a conflict and no feedback at all",
    "Do **not** treat this as licence to skip `reconcile_discussion_counts`",
    "Every other blocker (wrong project, terminal state) means exactly what it means in the review lane",
    // Two online paths the workflow didn't know about (verified against
    // docs.gitlab.com): the rebase endpoint fixes behind-but-clean in one call, and
    // the UI resolver isn't reachable from /api/v4/ at all — offer it, never attempt it.
    "### Before planning a local merge: two cheaper paths",
    // Formatting-agnostic: these two are headings in conflicts.md now, and were bold in
    // SKILL.md before the conflict-lane detail moved out of the resident file.
    "1. Is it actually a conflict, or is the branch just behind?",
    "merge_requests/{iid}/rebase",
    '"merge_error": "Rebase failed. Please rebase locally"',
    "**Its documented prerequisite is that no conflicts exist**",
    "2. Could GitLab resolve it online instead?",
    "under 200 KB once conflict markers are added",
    "free of pre-existing conflict markers",
    "present at the same path on both branches",
    "**You cannot drive any of that yourself, and must not claim to have.**",
    "it has no parameter for a second parent",
    "Steps 7–9 drop out and the verification doesn't.",
    // A local merge exiting 0 is not evidence about the MR: GitLab recomputes
    // has_conflicts asynchronously against the current target branch.
    "tells you the merge succeeded locally, not that the MR can merge",
    "`checking` / `unchecked`** — GitLab hasn't finished recomputing. That is not a pass.",
  ])
    truthy(`workflow: contains ${phrase}`, corpus.includes(phrase));
}

/**
 * Wording that must be gone. Every entry is a rule that moved, was replaced, or was
 * disproved by a run — and the risk each covers is an old copy surviving somewhere the
 * rewrite didn't look, which is why most of these check the whole corpus rather than
 * SKILL.md alone.
 */
function assertStaleWordingGone(docs) {
  const { skill, corpus, power, readme } = docs;

  // Duplicated rules now reference one home instead of restating it.
  for (const stale of [
    "Mention it in your Step 2 recap",
    "one line each in your Step 2 recap",
    'See the latest commit."',
    // Transition-then-ask wording: all three assert a status as written at a point
    // where, under the current ordering, no write has happened.
    "is now **{resulting status}**",
    "This line is the first time the resulting Jira status appears anywhere in the conversation",
    "**Do not report this success as its own message.**",
    // MR !491: the brief was licensed to continue in the same turn, which buried it.
    "the brief is mandatory output rather than a pause, so it never waits for a reply",
    "→ **Emit the brief.**",
    // The flat report shape, where every thread got an identical block and the header
    // led with resolve state instead of with how much of the user's attention it costs.
    "thread(s) to triage — {X} unresolved",
    "**1. [✅ Fix] `{file}:{line}`**",
    "**The header is two lines because the numbers measure different things**",
    // MR !491 round two: the brief/report split itself, the resolved-thread zone that
    // led the second message, and the Jira row asked as its own question.
    "### The MR brief comes first",
    "→ **Emit the brief and stop.**",
    "### 👉 Needs your call ({needsYou})",
    "### ✔️ Already addressed ({handled})",
    "{handled}",
    "→ **Proposed action:**",
    "Move it to **{exact active status}** when I start on these? (yes / leave it)",
    // A report written before any file is opened cannot claim it verified anything.
    "I confirmed each fix is present in the code as it stands",
    // Replaced by scripts/. Either hand-written form reappearing means the run is
    // improvising a command whose failure modes are already documented.
    'echo "---DIRTY---"',
    "**separated by labelled echoes**, not bare `;`",
  ]) {
    // Corpus, not SKILL.md: stale wording must be gone everywhere, and a
    // reference file is exactly where an old copy could survive unnoticed.
    falsy(`workflow: stale duplicate removed — ${stale.slice(0, 40)}`, corpus.includes(stale));
  }

  // The hand-derivation steps that contradicted the tool must stay gone.
  for (const stale of [
    "1. Drop activity-log noise: keep only notes where `system == false`",
    "2. Compare your remaining **note** count against `user_notes_count`",
    "`gitHooks.prePushContent`",
  ]) {
    falsy(`workflow: no longer instructs the pre-tool method — ${stale.slice(0, 48)}`, corpus.includes(stale));
  }

  // The old hand-derivation placeholders must not come back alongside the tool.
  for (const stale of ["{threads_total}", "{reviewer_notes}", "{notes_total}"]) {
    falsy(`workflow: report template no longer uses the stale placeholder ${stale}`, corpus.includes(stale));
  }

  for (const [label, text, forbidden] of [
    ["workflow", skill, "Pushed with `--no-verify`"],
    ["workflow", skill, "pre-push lint/build skipped, relying on CI"],
    ["workflow", skill, "pull or rebase first"],
    ["workflow", skill, "Before writing any worklog, reconcile ticket identity from Step 2"],
    ["workflow", skill, "Only that explicit no-ticket answer waives Jira synchronization"],
    ["workflow", skill, "or explicitly waive Jira synchronization"],
    ["workflow", skill, "explicit no-ticket or manual-synchronization waiver"],
    ["workflow", skill, "user-approved synchronization waiver"],
    ["workflow", skill, "explicit statement that this MR has no Jira ticket"],
    ["workflow", skill, "**Time spent on this review pass?**"],
    ["workflow", skill, "Use the duration gathered in Step 8"],
    ["workflow", skill, "duration gathered in Step 8 — **don't ask again.**"],
    ["README", readme, "worklog duration remain independent"],
    ["workflow", skill, "keeps this workflow at six gates"],
    ["power", power, "including a bare '#note_' link"],
    ["power", power, "no ticket transitions"],
    ["README", readme, "only if you want Step 11's time"],
    // MR !491 round two collapsed the brief into the report, so the count goes back
    // to six — and neither doc may still promise two messages before the first edit.
    ["power", power, "seven possible approval gates"],
    ["README", readme, "seven possible gates"],
    ["power", power, "It tells you what it found before it starts working"],
    ["power", power, "presents the triage report rather than interrupting first"],
    ["power", power, "## It tells you what it found, then waits"],
    ["README", readme, "It opens with a brief, not with silence"],
    // The comments-only framing is what got the skill set aside on MR !508 — the H1
    // and the twelve-rule heading both have to be gone.
    ["workflow", skill, "# MR Workflow — Addressing Review Comments"],
    ["workflow", skill, "## The twelve rules that matter most"],
    ["workflow", skill, "End-to-end workflow for GitLab merge request review comments"],
  ])
    truthy(`${label}: excludes stale policy ${forbidden}`, !text.includes(forbidden));
}

/**
 * What POWER.md, README.md and plugin.json promise. These are presence checks rather than
 * orderings: the risk they cover is a doc still advertising a flow the skill no longer has,
 * which is how "then it investigates" survived a rewrite once.
 */
function assertDocClaims(docs) {
  const { power, readme, plugin, powerFlat, readmeFlat } = docs;

  truthy("plugin: bundled-server release is 1.5.0", plugin.includes('"version": "1.5.0"'));
  truthy("power: activation requires a full MR URL", power.includes("full GitLab merge request URL"));
  truthy(
    "power: documents Jira pre-check",
    powerFlat.includes("Verify the ticket silently — stopping only if it's terminal,"),
  );
  truthy("power: prohibits fail-open Jira waiver", power.includes("There is no fail-open synchronization waiver"));
  truthy("README: usage requires a full MR URL", readme.includes("Paste a full GitLab merge request URL"));
  truthy("README: documents pre-work Jira verification", readme.includes("Reads the Jira ticket before code work"));
  truthy(
    "README: gates review status on publication",
    readme.includes("successful push and all approved replies/resolutions"),
  );
  truthy("README: no-verify stays private", readme.includes("private execution detail"));

  // MR !491: both docs advertised the opener without saying it waits, so "then it
  // investigates" could be taken literally. Round two collapsed brief+report into one,
  // so both must now describe a single opening message rather than a two-step reveal.
  truthy(
    "power: counts the report as the one pre-work gate",
    power.includes("six possible approval gates: the opening report"),
  );
  truthy("README: counts six gates", readme.includes("six possible gates"));
  truthy(
    "power: states the report ends its turn",
    powerFlat.includes("**Then it stops.** No checkout, no Jira write, no file read goes out in the same turn."),
  );
  truthy(
    "README: states the report ends its turn",
    readmeFlat.includes("the turn ends and it waits for your go-ahead"),
  );
  truthy(
    "README: nothing slow runs before the report is answered",
    readme.includes(
      "Never checks out a branch, moves the Jira ticket, or opens a referenced file before the report has been answered",
    ),
  );
  // The property that makes one report possible at all, in both docs.
  truthy(
    "power: says the report makes no claim about the code",
    powerFlat.includes("it makes no claim about\nyour code.".replace(/\s+/g, " ")),
  );
  truthy(
    "README: says the report makes no claim about the code",
    readmeFlat.includes("it makes no claim about your\ncode.".replace(/\s+/g, " ")),
  );
  // And that resolved threads are not itemised, which is what the user asked for.
  truthy(
    "power: resolved threads are one not-re-checked count",
    powerFlat.includes("It doesn't list the threads GitLab has already resolved"),
  );
  truthy(
    "README: resolved threads are one not-re-checked count",
    readmeFlat.includes("it won't list the threads GitLab has already resolved"),
  );
}

/**
 * Steps 1–4 are one index table, procedure in references/investigating.md. The ordering
 * that matters — MR evidence, Jira identity, then classification, all before the report,
 * and the checkout only after it — is the row order plus the heading order, so both get
 * asserted rather than headings that no longer exist.
 */
function assertInvestigateOrdering(docs, m) {
  const { skill, refs } = docs;
  const { investigate, reportGate, startWork, idxTable, rowMr, rowJira } = m;

  const rowClassify = idxTable.indexOf("**4 — Classify**");
  truthy(
    "workflow: MR evidence, then Jira verification, then classification — all before the report",
    investigate > 0 && rowMr > 0 && rowMr < rowJira && rowJira < rowClassify && reportGate > investigate,
  );
  truthy("workflow: the checkout and the code reads sit after the report, not before it", startWork > reportGate);
  // The claim has to be the true one: a fixed handful of local reads is fine, the
  // per-thread reads that scale are what must wait. An absolute "no project file"
  // would be contradicted by Step 1's own conditional read.
  truthy(
    "workflow: Steps 1–4 open no file a comment points at, which is what makes the report cheap",
    skill
      .slice(investigate, reportGate)
      .includes(
        "**None of these four steps opens a file a comment points at, checks out a branch, or writes anything.**",
      ),
  );
  truthy(
    "workflow: the investigate index points at its procedure file",
    idxTable.includes("references/investigating.md"),
  );
  // `checkout` still anchors the "everything before code work" boundary below.
  const checkout = startWork;

  // Only identity/terminal-status verification precedes the report; the
  // active-development transition is applied in Step 6, after Step 5's approval, and
  // before the first code read — not after the diff is written.
  const applyTransition = skill.indexOf("**Apply the Jira transition — only if Step 5's line was approved.**");
  const step7 = skill.indexOf("## Step 7 — Fix One Comment at a Time");
  truthy(
    "workflow: active-development transition is applied in Step 6, after approval and before any edit",
    applyTransition > reportGate && applyTransition > checkout && applyTransition < step7,
  );

  // The branch table moved to references/jira.md, but "terminal, blocked, or no
  // unambiguous ticket stops the run" is a stop condition and must stay resident.
  truthy(
    "workflow: missing Jira identity and unavailable tooling fail closed before checkout",
    idxTable.includes("Terminal, blocked, unclassifiable, or no unambiguous ticket"),
  );

  // Raised at the MR fetch, ahead of the report and the checkout: the reason to
  // surface it is that resolving a conflict can rewrite the code the comments are about.
  truthy(
    "workflow: conflict state is surfaced inside Step 2, before the report",
    rowMr > 0 && rowMr < rowJira && idxTable.slice(rowMr, rowJira).includes("conflicts"),
  );

  // Step 6 moved to references/checkout.md, because it is released by the report's
  // go-ahead and batch 1 has no use for it — and because investigating.md had grown past
  // the size a single read reliably returns. The fetch-before-create ordering is a
  // correctness property of those commands, so it is asserted wherever they live.
  const checkoutRef = refs.find((r) => r.name === "checkout.md")?.text ?? "";
  const checkoutFetch = checkoutRef.indexOf("git fetch origin {source_branch}");
  const checkoutCreate = checkoutRef.indexOf("git checkout -b {source_branch} origin/{source_branch}");
  truthy("workflow: fetches before creating tracking branch", checkoutFetch >= 0 && checkoutFetch < checkoutCreate);
}

/**
 * The publish half: validate, approve, commit, reply, then synchronize Jira — and the
 * time question last of all, ahead of the two writes it releases. Every assertion here is
 * an ordering, because each of these steps is only safe once the previous one succeeded.
 */
function assertPublishOrdering(docs, m) {
  const { skill } = docs;
  const { approval, commit, replies, jiraFinish, timeAsk, lessons } = m;

  // Step 7's two procedures moved to references/fixing.md, so the resident anchors are now
  // the stop each one carries rather than the section heading each one used to have.
  const validation = skill.indexOf("**The final approval must cover the exact bytes that will be committed.**");
  const selfReview = skill.indexOf("**The self-review pass is not optional and not deferrable to after the push.**");
  truthy(
    "workflow: validate, approve, commit, reply, then synchronize Jira",
    validation >= 0 &&
      validation < selfReview &&
      selfReview < approval &&
      approval < commit &&
      commit < replies &&
      replies < jiraFinish,
  );

  // And the ordering follows the content: fixing.md must prescribe validation before the
  // self-review, since that is now the only place the sequence is spelled out.
  const fixing = docs.refs.find((r) => r.name === "fixing.md")?.text ?? "";
  const refValidation = fixing.indexOf("## Definitive validation and staging");
  const refSelfReview = fixing.indexOf("## The self-review pass");
  truthy(
    "workflow: fixing.md still orders validation before the self-review pass",
    refValidation >= 0 && refSelfReview > refValidation,
  );

  // Step 8's template lives in references/summary-gate.md, but the independence rule
  // stays resident in SKILL.md: it decides what a "yes" authorizes.
  const { summaryGate } = docs;
  const noDirectReview = summaryGate.indexOf("If no direct review transition exists:");
  const leaveManual = summaryGate.indexOf("Confirm leave unchanged/manual?", noDirectReview);
  truthy(
    "workflow: Step 8 renders and gates both reachable and unreachable Jira review outcomes before commit",
    noDirectReview > 0 &&
      leaveManual > noDirectReview &&
      summaryGate.includes("**Jira approval is independent from commit approval and time logging.**") &&
      skill.slice(approval, commit).includes("commit, Jira transition, and — later — the worklog"),
  );

  const publicationRecovery = skill.indexOf("**Keep a per-discussion ledger**", replies);
  const remoteCompletion = skill.indexOf(
    "Resume Step 11 only after every approved action is observed remotely",
    publicationRecovery,
  );
  truthy(
    "workflow: partial publication is reconciled idempotently before Jira synchronization",
    publicationRecovery > replies && publicationRecovery < remoteCompletion && remoteCompletion < jiraFinish,
  );

  const publicationGate = skill.indexOf("**Publication success is a hard precondition.**", jiraFinish);
  // Anchored on the batch instruction rather than the old "immediately before any
  // automated write" phrasing, which a real run read as "after they reply" — the write
  // does follow the answer — and so paid an extra round trip and asked the time question
  // with nothing read behind it.
  const finalReread = skill.indexOf("go out as one batch of two in the same turn as the time question", jiraFinish);
  // The write itself. Its template and the read-back rule moved to references/jira.md, so the
  // resident anchor is now the fabrication guard that gates the write. The execution order the
  // templates follow is asserted against jira.md further down, where that sequence now lives.
  const finalTransition = skill.indexOf(
    '**Never write "Jira is now {status}" before the server has said so.**',
    jiraFinish,
  );
  truthy(
    "workflow: publication success and Jira re-read precede final transition",
    publicationGate > jiraFinish && publicationGate < finalReread && finalReread < finalTransition,
  );

  const noEarlyTimeAsk = skill.indexOf("**Never ask for time spent at this gate**", approval);
  truthy("workflow: time is not requested at the commit gate", noEarlyTimeAsk > approval && noEarlyTimeAsk < commit);
  truthy(
    "workflow: time is requested after publication, and before Step 12",
    timeAsk > publicationGate && timeAsk < lessons,
  );

  // The transition write sits after the time question so both Jira writes share one
  // turn. The re-read still comes first — it's what the question quotes.
  truthy(
    "workflow: the time question precedes the transition write, which follows the re-read",
    finalReread < timeAsk && timeAsk < finalTransition && finalTransition < lessons,
  );
  // Ask, then write, then verify, then report. That sequence used to be readable off SKILL.md's
  // document order; the four templates now live in references/jira.md, so it is asserted there.
  // Same ordering, checked against the file that actually prescribes it.
  const jira11 = docs.refs.find((r) => r.name === "jira.md")?.text ?? "";
  const jAsk = jira11.indexOf("## The time question's details");
  const jWrite = jira11.indexOf("## The write batch");
  const jVerify = jira11.indexOf("## Verifying the transition result");
  const jReport = jira11.indexOf("## Reporting both results");
  truthy(
    "workflow: every result is reported after the write, not before it",
    jAsk > 0 && jAsk < jWrite && jWrite < jVerify && jVerify < jReport,
  );
}

/**
 * The one-report section, stated before the first step so it reads as a standing rule
 * rather than a Step 5 detail. Its own section has to declare the stop and scope the
 * go-ahead: on MR !491 the batch plan said so and the section didn't, and the section is
 * what's read when the report is composed.
 */
function assertReportSectionOrdering(docs, m) {
  const { skill } = docs;
  const { outputDiscipline, parseUrl, batches, boundedVerification, reportSection, reportMandatory } = m;

  truthy(
    "workflow: the mandatory report and the verification cap sit in output discipline, before Step 0",
    reportMandatory > outputDiscipline && reportMandatory < boundedVerification && boundedVerification < parseUrl,
  );

  // Its section precedes the batch plan that produces it, and both precede the steps.
  // Placed after the steps they'd read as an optimization, not the shape of the run.
  truthy(
    "workflow: the report's section precedes the batch plan, and both precede Step 0",
    reportSection > outputDiscipline && reportSection < batches && batches < parseUrl,
  );

  // MR !491: the pause belongs in the report's own section, not only in the batch
  // plan — the section is what's read when the report is composed.
  const reportIsStop = reportMandatory;
  const goAheadScope = skill.indexOf(
    '**What a bare "go ahead" covers: batches 3 and 4, the Jira transition the report named, and the ✅ Fix / 🔵 Nitpick items.**',
  );
  truthy(
    "workflow: the report's own section declares the stop and scopes the go-ahead, before the batch plan",
    reportIsStop > reportSection && reportIsStop < batches && goAheadScope > reportIsStop && goAheadScope < batches,
  );

  // No leading list marker in the needle: an editor formatter rewrites `-` to `*` on
  // save, and this asserts the line's content, not its bullet character.
  truthy(
    "workflow: the report is listed first among the defined gates",
    skill.includes("The defined gates: Step 5's report"),
  );

  // Rule 3 carries one stop now. The two-message wording licensed a second round trip.
  truthy(
    "workflow: rule 3 states the single report is the first output and the only pre-work stop",
    skill.includes(
      "**One report reaches the user before any code changes. It is the run's first output and its only pre-work stop.**",
    ) && skill.includes("Rules 1 and 3–9 are hard stops when applicable."),
  );
  // Rule 1 must place the Jira read before the report and the write after approval.
  truthy(
    "workflow: rule 1 reads Jira before the report and writes it in Step 6",
    skill.includes("**Verify the Jira ticket before the report, silently; ask about moving it inside the report.**"),
  );
}

/**
 * Step 0b's lane decision. It sits between URL parsing and the first step that acts on a
 * lane, and must be reachable by a skim of the file's top — all the MR !508 run did.
 */
function assertLaneOrdering(docs, m) {
  const { skill, power, readme, powerFlat, refs } = docs;
  const { parseUrl, lane, profile } = m;

  const cheaper = skill.indexOf("### Before planning a local merge: two cheaper paths");
  const planGate = skill.indexOf("### The resolution plan gate (conflict-first lane, replaces Step 5)");
  truthy(
    "workflow: the lane decision follows URL parsing and precedes every step that acts on a lane",
    parseUrl > 0 && lane > parseUrl && planGate > lane && planGate < profile,
  );
  // Read before the local plan is built, or the run spends twenty minutes on a merge
  // a single PUT would have settled.
  truthy(
    "workflow: the cheaper online paths are stated before the local resolution plan",
    cheaper > lane && cheaper < planGate,
  );

  // The H1 and the intro are what the failing run actually read before deciding.
  truthy(
    "workflow: the title covers both jobs rather than review comments alone",
    skill.includes("# MR Workflow — Working an Existing Merge Request"),
  );
  truthy(
    "workflow: the intro names both kinds of work before any step",
    skill.indexOf("Two kinds of work arrive at the same URL") < lane,
  );
  truthy(
    "workflow: the frontmatter description names conflict resolution as in scope",
    skill.slice(0, skill.indexOf("\n---", 4)).includes("resolving a merge conflict"),
  );
  truthy(
    "workflow: rule 13 forbids setting the file aside and improvising",
    skill.includes("**Decide what the run is for before planning it, and don't set this file aside.**"),
  );
  // The table moved to references/conflicts.md — it is step-by-step detail, and a review-lane
  // run was carrying all twelve rows to learn that its own lane is "as written". What stays
  // resident is the lane choice itself and the claim that the gates don't change.
  const laneTableHome = docs.refs.find((r) => r.name === "conflicts.md")?.text ?? "";
  truthy(
    "workflow: the lane table maps every phase, including the ones that drop out",
    [
      "| 0–3 |",
      "| 4 classify |",
      "| 5 report |",
      "| 6 |",
      "| 6b |",
      "| 7 |",
      "| 8 |",
      "| 9 |",
      "| 10 |",
      "| 11 |",
    ].every((row) => laneTableHome.includes(row)),
  );
  truthy(
    "workflow: and SKILL.md still says the gates are identical in both lanes",
    skill
      .slice(lane, profile)
      .includes("**The lane changes the middle of the run. It never changes which gates exist.**"),
  );
  // Same stop, different contents — not a seventh gate, which would contradict the
  // six-gate claim in both docs.
  truthy(
    "workflow: the plan gate replaces rule 3's report rather than adding a gate",
    skill.includes(
      "In the conflict-first lane rule 3's report is the resolution plan gate rather than the triage report",
    ),
  );
  // The conflict lane's *detail* lives in conflicts.md; only its gate declaration is
  // resident. This is the one measured case where relocating resident prose saves a run
  // something rather than moving the cost later: a review-lane run never enters this lane,
  // and most runs are review-lane. The headings and the two named rules stay, because the
  // disclosure test's finding is that a gate reachable only through a reference goes unread.
  const conflicts = refs.find((r) => r.name === "conflicts.md")?.text ?? "";
  truthy(
    "lane-split: the plan gate template lives in conflicts.md",
    conflicts.includes("## The plan gate — the template"),
  );
  falsy("lane-split: and not in SKILL.md", skill.includes("**Conflicted files:**") || skill.includes("| # | Region |"));
  truthy(
    "lane-split: the resident gate says the template is elsewhere and must be read first",
    skill.includes("**The template is in `references/conflicts.md`, which you must read before rendering this.**"),
  );
  truthy(
    "lane-split: the resident gate still declares itself a hard stop",
    skill.includes("it is the same hard stop: present it, end the turn, wait"),
  );
  // These three were duplicated verbatim in both files before the move.
  for (const rule of [
    '**The "Beyond a mechanical pick" row is the one that matters, and it is not optional.**',
    "**Never start the merge or rebase before this gate closes.**",
    "**A dirty tree or a branch switch is a bigger deal in this lane, not a smaller one.**",
  ]) {
    truthy(`lane-split: conflicts.md keeps — ${rule.slice(0, 46)}`, conflicts.includes(rule));
    falsy(`lane-split: SKILL.md no longer duplicates it`, skill.includes(rule));
  }
  truthy(
    "lane-split: conflicts.md says the template is its own, not SKILL.md's",
    conflicts.includes("the gate's template is in this file, not in SKILL.md"),
  );

  truthy("power: documents the two lanes and one gate set", power.includes("## Two kinds of work, one set of gates"));
  truthy("README: documents the second job", readme.includes("**It handles two jobs, not one.**"));
  truthy(
    "power: documents the rebase endpoint as the behind-but-clean exit",
    powerFlat.includes("PUT .../merge_requests/:iid/rebase` endpoint in one call"),
  );
  truthy(
    "power: states the online resolver has no REST endpoint rather than implying it does",
    powerFlat.includes("there is no `/api/v4/` endpoint for the web conflict resolver"),
  );
  truthy(
    "README: offers the browser path instead of deciding a local merge",
    readme.includes("you're offered the browser path") &&
      readme.includes("there's no REST endpoint for the web resolver"),
  );
}

/**
 * Step 5's report template. Every rendered field must come from batches 1–2 — that's what
 * makes the report cheap enough to send first. The Jira status is included now, because
 * the ticket is read in batch 2; what stays out is anything requiring a project file.
 */
function assertReportTemplateShape(docs) {
  const { reporting } = docs;

  const reportTemplate = reporting.slice(
    reporting.indexOf("## Step 5 — the report"),
    reporting.indexOf("### The fixed marker set"),
  );
  for (const field of [
    "{countLine, verbatim",
    "{X} unresolved / {Y} resolved on GitLab",
    "{TICKET-KEY}` — **{exact current status}**",
    "{source_branch}",
    "**Blockers:**",
    "**Flags:**",
    // The closing list is the gate: it names every action a go-ahead authorizes, in
    // execution order, with the Jira move as one of them rather than a second question.
    "**Say go and I'll:**",
    "Move `{TICKET-KEY}` from **{current status}** to **{exact active status}**",
    "Stop again before anything is committed, pushed or replied to",
  ]) {
    truthy(`report template: renders ${field}`, reportTemplate.includes(field));
  }
  // The two forbidden shapes are checked against the fenced block alone — the prose
  // around it necessarily names both in order to forbid them.
  const reportFence = reportTemplate.slice(
    reportTemplate.indexOf("```text"),
    reportTemplate.indexOf("```", reportTemplate.indexOf("```text") + 7),
  );
  truthy("report template: the fenced template block was found", reportFence.length > 200);
  falsy("report template: never itemises resolved threads", /✔️|Already addressed/.test(reportFence));
  falsy("report template: never proposes a code change it hasn't verified", /Proposed action/.test(reportFence));
}

/**
 * The four-batch plan. Each batch has to name what goes in it, and the report has to sit
 * between batch 2 and batch 3 — emitting it after the checkout is the observed failure.
 */
function assertBatchPlanShape(docs, m) {
  const { skill } = docs;
  const { batches, boundedVerification } = m;

  const batchBlock = skill.slice(batches, boundedVerification);
  for (const marker of [
    "**Batch 1 —",
    "**Batch 2 —",
    "**Batch 3 —",
    "**Batch 4 —",
    "→ **Emit the report and stop.**",
    "getTransitionsForJiraIssue",
    "glab_auth_status",
    "getAccessibleAtlassianResources",
  ]) {
    truthy(`batch plan: names ${marker}`, batchBlock.includes(marker));
  }
  const emitReport = batchBlock.indexOf("→ **Emit the report and stop.**");
  truthy(
    "batch plan: the report is emitted after batch 2 and before batch 3",
    emitReport > batchBlock.indexOf("**Batch 2 —") && emitReport < batchBlock.indexOf("**Batch 3 —"),
  );
  // The Jira read moved into batch 2 so its status can be a row in the report.
  truthy(
    "batch plan: the Jira read sits in batch 2, ahead of the report",
    batchBlock.indexOf("getJiraIssue") > batchBlock.indexOf("**Batch 2 —") &&
      batchBlock.indexOf("getJiraIssue") < batchBlock.indexOf("**Batch 3 —"),
  );

  // MR !491: batch 3 followed the opener in the same turn. The wait is stated in both
  // places, or "batch 3 is next" reads as "now".
  truthy(
    "batch plan: batch 2 ends the turn on the report",
    batchBlock.includes("End the turn there; batch 3 waits for the reply."),
  );
  truthy(
    "batch plan: batch 3 is gated on the reply, not merely ordered after the report",
    batchBlock.includes("**Batch 3 — what the go-ahead unblocked.** One turn, *after* the user answers the report:"),
  );
  // The checkout and the transition share batch 3, and the code reads wait for batch 4.
  truthy(
    "batch plan: batch 3 carries the checkout and the transition, batch 4 the code reads",
    batchBlock.includes("**Batch 3 — what the go-ahead unblocked.**") &&
      batchBlock
        .slice(batchBlock.indexOf("**Batch 3 —"), batchBlock.indexOf("**Batch 4 —"))
        .includes("the approved Jira transition") &&
      batchBlock.slice(batchBlock.indexOf("**Batch 4 —")).includes("must follow the checkout"),
  );
}

/**
 * Document-level layout: the standing rules sit above the steps and the pointers sit
 * below them. Order carries meaning here, which is why these are position comparisons
 * rather than presence checks.
 */
function assertLayoutOrdering(docs, m) {
  const { skill } = docs;
  const { outputDiscipline, formatting, parseUrl, jiraFinish, timeAsk, lessons } = m;

  truthy(
    "workflow: output discipline precedes formatting rules and the first step",
    outputDiscipline >= 0 && outputDiscipline < formatting && formatting < parseUrl,
  );

  // Step 11's re-read must be stated before the time-log ask that depends on it, and it
  // must cover the worklog-only path — "no transition to make" is the shape in which the
  // whole batch has been skipped.
  const rereadCoversWorklog = skill.indexOf("batch runs even when no transition is needed");
  truthy(
    "workflow: the worklog-path re-read is stated before the time-log question",
    rereadCoversWorklog > jiraFinish && rereadCoversWorklog < timeAsk,
  );

  // Order carries the meaning: stated after the cases, invariants read as an
  // afterthought rather than the frame those cases instantiate.
  const invariants = skill.indexOf("## Five invariants. Everything else is an instance of them.");
  const numberedRules = skill.indexOf("## The thirteen rules that matter most");
  const uncovered = skill.indexOf("## When this skill doesn't cover what you're looking at");
  truthy(
    "workflow: invariants frame the numbered rules rather than trailing them",
    invariants >= 0 && numberedRules > 0 && invariants < numberedRules,
  );
  truthy(
    "workflow: the uncovered-case protocol is stated before the first step",
    uncovered > numberedRules && uncovered < parseUrl,
  );

  // The index that replaces both appendices sits after the last step and before the
  // Quick Reference: a pointer table above the workflow gets read as the workflow.
  const refIndex = skill.indexOf("## Reference files — load these when the pointer says to");
  const quickRef = skill.indexOf("## Quick Reference");
  truthy(
    "workflow: the reference index sits after the last step and before the Quick Reference",
    refIndex > lessons && quickRef > refIndex,
  );
}

/**
 * `fetch-mr.mjs` composes triage + counts locally now, instead of printing a ~10 KB
 * payload for the caller to hand back to `triage_graphql_mr`. That round trip went out
 * through the model and back, which cost more than the fetch and, on a real run,
 * failed outright: the argument arrived as a string instead of an object, and the
 * recovery was to start trimming note fields — the same way `resolvable` has been
 * dropped before, reached by a different road.
 *
 * Two call sites for one answer is invariant 4's shape, so this pins them together.
 */
function testLocalTriageParity() {
  const scriptPath = join(ROOT, "skills", "mr-comments", "scripts", "fetch-mr.mjs");
  const script = readFileSync(scriptPath, "utf8");
  const server = readFileSync(join(ROOT, "server", "server.js"), "utf8");

  // Dynamic, not static: a static import of ../../../server/ breaks the moment this
  // skill folder is used on its own, which is the property the duplicated MR_QUERY
  // exists to protect.
  for (const mod of ["graphql.js", "mr-payload.js", "discussions.js"]) {
    truthy(`local triage: imports ${mod} dynamically`, script.includes(`import(new URL("${mod}", dir).href)`));
  }
  falsy(
    "local triage: no static import of the server modules",
    /^import .* from ["']\.\.\/\.\.\/\.\.\/server\//m.test(script),
  );
  // Absent is supported and quiet; present-but-broken must be loud, or a wiring bug
  // silently downgrades every run to the expensive path with nothing to show why.
  truthy("local triage: only a missing file degrades quietly", script.includes('err?.code === "ERR_MODULE_NOT_FOUND"'));
  truthy("local triage: --raw restores the payload-printing behaviour", script.includes('has("raw")'));

  // The script must route through the modules, never re-derive their answers. Any
  // counting of its own is the hand-tally failure moved into a file where nobody
  // reviews it against the tool.
  for (const re of [/notes\s*\.\s*filter/, /\.system\s*===/, /resolvable\s*===/]) {
    falsy(`local triage: does not re-derive counts itself (${re})`, re.test(script));
  }

  // Same three functions, same argument names as the MCP handler. A field added to one
  // and not the other is the realistic drift, and it would show up as two different
  // answers for the same MR depending on which path ran.
  const handler = server.slice(
    server.indexOf("triage_graphql_mr: (args)"),
    server.indexOf("attribute_staged_hunks: (args)"),
  );
  // Matched on the property name alone: either side may legitimately use shorthand
  // (`noteIdFromUrl,`) where the other spells it out (`noteIdFromUrl: args.…`). What
  // must not differ is *which* inputs get passed.
  for (const arg of ["workspaceRemote", "currentUser", "userNotesCount", "noteIdFromUrl", "discussions"]) {
    const named = new RegExp(String.raw`\b${arg}\s*[:,}]`);
    truthy(`local triage: passes ${arg} exactly as the MCP handler does`, named.test(handler) && named.test(script));
  }
  // Every key the tool returns must also appear in what the script prints, or a caller
  // switching paths loses a field.
  for (const key of ["triage:", "counts:", "discussions,", "hasNextPage,", "endCursor,"]) {
    truthy(`local triage: emits the tool's ${key}`, script.includes(key));
  }

  // The relative path the script imports from has to resolve, or `loadChecks` returns
  // null forever and every run silently takes the expensive path.
  for (const mod of ["graphql.js", "mr-payload.js", "discussions.js"]) {
    truthy(`local triage: ${mod} exists where ../../../server/ resolves to`, existsSync(join(ROOT, "server", mod)));
  }

  // Functional: the composition really does produce a verdict rather than throwing,
  // and the numbers are the tool's numbers. Uses the statically imported modules —
  // the same code the script loads.
  const fixture = {
    data: {
      project: {
        mergeRequest: {
          iid: "491",
          title: "fix(BIDAYA-2084): add text truncation",
          state: "opened",
          sourceBranch: "fix/BIDAYA-2084",
          targetBranch: "develop",
          userNotesCount: 2,
          conflicts: false,
          mergeStatusEnum: "CAN_BE_MERGED",
          detailedMergeStatus: "MERGEABLE",
          draft: false,
          webUrl: "https://git.example.net/a/b/repo/-/merge_requests/491",
          author: { username: "jane.doe" },
          assignees: { nodes: [{ username: "jane.doe" }] },
          discussions: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: "gid://gitlab/Discussion/abc",
                notes: {
                  nodes: [
                    {
                      id: "gid://gitlab/Note/1",
                      system: false,
                      resolvable: true,
                      resolved: false,
                      body: "needs an id",
                      createdAt: "",
                      author: { username: "hodei" },
                      position: { newPath: "a.html", newLine: 12 },
                    },
                  ],
                },
              },
              {
                id: "gid://gitlab/Discussion/def",
                notes: {
                  nodes: [
                    {
                      id: "gid://gitlab/Note/2",
                      system: false,
                      resolvable: true,
                      resolved: true,
                      body: "done",
                      createdAt: "",
                      author: { username: "hodei" },
                      position: { newPath: "a.scss", newLine: 3 },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  };

  const { mr, discussions, hasNextPage } = normalizeGraphqlMr(fixture);
  const triage = triageMrPayload({
    mr,
    workspaceRemote: "git@git.example.net:a/b/repo.git",
    currentUser: "jane.doe",
    currentBranch: mr.source_branch,
  });
  const counts = reconcileDiscussionCounts({
    discussions,
    userNotesCount: mr.user_notes_count,
    currentUser: "jane.doe",
  });

  eq("local triage: composes a real verdict", triage.proceed, true);
  eq("local triage: nothing undetermined once the script supplies all three local inputs", triage.undetermined, []);
  eq("local triage: reconciles against user_notes_count", counts.reconciles, true);
  eq("local triage: splits resolved from unresolved", [counts.unresolvedThreads, counts.resolvedThreads], [1, 1]);
  eq("local triage: gids are stripped for Step 10's replies", discussions[0].id, "abc");
  falsy("local triage: the fetch was complete", hasNextPage);
}

/**
 * Executable resolution (CWE-426, untrusted search path).
 *
 * `execFileSync("git", …)` lets the OS resolve the name at spawn time against whatever
 * `PATH` holds, so a writable directory earlier in `PATH` substitutes its own binary.
 * The earlier mitigation — `where`/`which` then fall back to the bare name — closed
 * neither half: the finder is itself found on `PATH`, and the fallback handed the lookup
 * straight back to spawn time.
 *
 * Both scripts now resolve in-process, skip non-absolute `PATH` entries, and fail rather
 * than degrade to a bare name. Asserted textually *and* behaviourally, because the whole
 * point is what happens with a hostile `PATH`.
 */
function testExecutableResolution() {
  const scriptsDir = join(ROOT, "skills", "mr-comments", "scripts");
  /**
   * Comments are stripped before any code-shape assertion. Both scripts *document* the
   * forbidden `execFileSync("git", …)` form in order to explain why it's forbidden, and
   * a scan that can't tell prose from code fires on the explanation.
   */
  const stripComments = (src) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*)/.test(l))
      .join("\n");

  const sources = ["fetch-mr.mjs", "git-context.mjs"].map((name) => {
    const text = readFileSync(join(scriptsDir, name), "utf8");
    return { name, text, code: stripComments(text) };
  });

  for (const { name, text, code } of sources) {
    // A resolved binary is always held in a variable, so any string literal in the
    // first argument position is a bare command name. `exec`/`execSync` are excluded
    // from the pattern and forbidden at the import instead — `.exec(` on a RegExp is
    // unrelated and would make this assertion fire on every regex match in the file.
    falsy(`exec[${name}]: never spawns a bare command name`, /(?:execFileSync|spawnSync)\(\s*["'`]/.test(code));
    const imported = /import \{([^}]*)\} from "node:child_process"/.exec(code)?.[1] ?? "";
    eq(
      `exec[${name}]: imports no shell-string spawner`,
      imported
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s === "exec" || s === "execSync"),
      [],
    );
    // The old mitigation, in both its halves.
    falsy(
      `exec[${name}]: does not resolve through a PATH-found where/which`,
      /\bplatform === "win32" \? "where"/.test(code),
    );
    falsy(`exec[${name}]: has no bare-name fallback`, /return "(?:git|glab)";/.test(code));

    truthy(`exec[${name}]: resolves in-process`, code.includes("function resolveBin(name, envVar)"));
    // The step the OS would not take, and the one that actually answers the finding.
    truthy(`exec[${name}]: skips non-absolute PATH entries`, code.includes("if (!dir || !isAbsolute(dir)) continue;"));
    truthy(`exec[${name}]: honours an absolute pin`, /isAbsolute\(pinned\) && fileExists\(pinned\)/.test(code));
    // Windows needs PATHEXT, or an extensionless probe finds nothing and the script
    // reports "not found" on a machine that has the binary.
    truthy(`exec[${name}]: applies PATHEXT on Windows`, code.includes("PATHEXT"));
    // The comment must not overclaim: nothing here proves a directory is unwriteable.
    truthy(`exec[${name}]: does not claim to verify directory writability`, text.includes("does **not** claim"));
  }

  // Duplicated rather than shared, because a third file under scripts/ breaks the
  // layout the spec test pins. Invariant 4 allows that only with this assertion.
  const body = (text) =>
    text
      .slice(text.indexOf("function resolveBin(name, envVar) {"), text.indexOf("\nfunction fileExists(p) {"))
      .replace(/\s+/g, " ")
      .trim();
  truthy("exec: both copies of resolveBin were located", body(sources[0].text).length > 200);
  eq("exec: the two copies of resolveBin have not drifted", body(sources[0].text), body(sources[1].text));

  // --- Behavioural. git-context.mjs is the cheap one to drive: no network.
  const script = join(scriptsDir, "git-context.mjs");
  const spawn = (env) => {
    const r = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return { status: r.status, err: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  };

  // The attack vector itself: `.` on PATH means the current directory, which is
  // writable. The OS would honour it; this must not.
  const relativeOnly = spawn({ PATH: ".", GIT_PATH: "" });
  eq("exec: a PATH of only '.' resolves nothing", relativeOnly.status, 1);
  truthy(
    "exec: and says so rather than trying a bare name",
    relativeOnly.err.includes("not found in any absolute PATH directory"),
  );

  const emptyPath = spawn({ PATH: "", GIT_PATH: "" });
  eq("exec: an empty PATH fails loudly", emptyPath.status, 1);

  // A relative pin is a pin an attacker could satisfy from the cwd, so it is refused
  // outright rather than falling through to the search.
  const relativePin = spawn({ GIT_PATH: "git" });
  eq("exec: a non-absolute GIT_PATH is rejected", relativePin.status, 2);
  truthy("exec: and names the variable", relativePin.err.includes("GIT_PATH must be an absolute path"));

  const missingPin = spawn({ GIT_PATH: join(ROOT, "no-such-git-binary") });
  eq("exec: a GIT_PATH pointing at nothing is rejected", missingPin.status, 2);

  // And the happy path still works, or all of the above is just a broken script.
  //
  // Asserted on the *reason* rather than on exit 0, because this test is about resolution
  // and `git-context.mjs` also exits non-zero for a completely unrelated reason: the
  // directory isn't a repo. It passes no `--cwd`, so it inherits the one the suite was
  // invoked from, and that made the assertion quietly depend on where you ran it — green
  // from the repo root, red from anywhere else. It failed the first time the suite was run
  // from a parent directory, which is exactly the sort of thing that gets "fixed" by
  // running it from the right place instead of by understanding it.
  //
  // "not a git repository" is itself proof that git resolved and ran. Only a resolution
  // failure is a failure here.
  const ok = spawn({});
  const resolved = ok.status === 0 || ok.err.includes("not a git repository");
  truthy(`exec: a normal environment still resolves git (exit ${ok.status})`, resolved);
  falsy("exec: and does not report it missing", ok.err.includes("not found in any absolute PATH"));
}

/** Pull the keyword flow-sequence out of a POWER.md frontmatter block. */
function powerKeywords(text) {
  const m = text.match(/^keywords:\s*\[([\s\S]*?)\]/m);
  if (!m) return null;
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/**
 * POWER.md and plugin.json each hand-maintain the same keyword list — invariant 4's
 * drift shape, where a keyword edited in one changes activation without failing
 * anything. Observed: a cleanup landed in POWER.md while plugin.json kept the old spelling.
 */
function testKeywordParity() {
  const power = readFileSync(join(ROOT, "POWER.md"), "utf8");
  const manifest = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf8")).keywords;
  const declared = powerKeywords(power);

  truthy("keywords: POWER.md declares a keyword list", Array.isArray(declared) && declared.length > 0);
  truthy("keywords: plugin.json declares a keyword list", Array.isArray(manifest) && manifest.length > 0);
  if (!declared || !manifest) return;

  // Sorting was only a way to compare two unordered lists, and it reported drift as two
  // fifteen-element arrays to diff by eye. The observed failure is a rename — a keyword
  // edited in one file and not the other — so ask directionally and name the keyword.
  eq(
    "keywords: POWER.md lists nothing plugin.json is missing",
    declared.filter((k) => !manifest.includes(k)),
    [],
  );
  eq(
    "keywords: plugin.json lists nothing POWER.md is missing",
    manifest.filter((k) => !declared.includes(k)),
    [],
  );
  eq("keywords: POWER.md has no duplicates", declared.length, new Set(declared).size);
  eq("keywords: plugin.json has no duplicates", manifest.length, new Set(manifest).size);

  // MR !508 reached this power by URL alone. Conflict wording has to be able to
  // reach it too, or the conflict-first lane is only findable by accident.
  for (const kw of ["merge-conflict", "conflict", "resolve-conflict"]) {
    truthy(`keywords: conflict work is discoverable via "${kw}"`, declared.includes(kw));
  }
}

/**
 * Fabrication shape: a self-review checklist reported as a completed result ("no BEM
 * violations", "checked against X") instead of the open question the template needs.
 * This can't stop runtime fabrication, but it catches the *template* being edited
 * back into a completed-result shape.
 */
function testSelfReviewTemplateShape() {
  // The Step 8 card lives in references/summary-gate.md, so the assertion follows it.
  const skill = loadSkillCorpus().refs.find((r) => r.name === "summary-gate.md")?.text ?? "";

  const bulletMarker = "{Found `{path}`";
  const bulletStart = skill.indexOf(bulletMarker);
  truthy("self-review template: Self-review bullet placeholder is present", bulletStart >= 0);
  if (bulletStart < 0) return;

  // Pull just that one bulleted line out of the template block.
  const lineEnd = skill.indexOf("\n", bulletStart);
  const bullet = skill.slice(bulletStart, lineEnd);

  truthy(
    "self-review template: bullet offers both a found-resource and a nothing-found branch",
    bullet.includes(" / "),
  );

  const [foundBranch, nothingBranch] = bullet.split(" / ");
  truthy("self-review template: found-resource branch ends in a question mark", /\?\}?\s*$/.test(foundBranch.trim()));
  truthy("self-review template: nothing-found branch ends in a question mark", /\?\}?\s*$/.test(nothingBranch.trim()));

  // The placeholder must never itself read like a completed result — that's the shape
  // of the observed fabrication that skipped the open question.
  const fabricationPhrases = [
    "no issues found",
    "no new issues",
    "checked against",
    "no violations",
    "consistent with",
    "all consistent",
  ];
  for (const phrase of fabricationPhrases) {
    truthy(
      `self-review template: bullet placeholder doesn't contain a completed-result phrase ("${phrase}")`,
      !bullet.toLowerCase().includes(phrase),
    );
  }
}

// ---------- MR payload triage ----------

/**
 * Motivating regression: a run had `has_conflicts: true` and
 * `detailed_merge_status: "conflict"` in the fetched payload and mentioned neither.
 * Fixtures are payload shapes, so no GitLab access is needed.
 */
function testMrPayloadTriage() {
  const base = {
    iid: 500,
    title: "fix(BIDAYA-699): Issues when rejecting location",
    source_branch: "fix/BIDAYA-699-Issues-when-rejecting-location",
    target_branch: "develop",
    state: "opened",
    user_notes_count: 19,
    web_url: "https://git.example.net/retail/bidaya/frontend/bidaya/-/merge_requests/500",
    author: { username: "jane.doe" },
    assignees: [{ username: "jane.doe" }],
  };
  const remote = "git@git.example.net:retail/bidaya/frontend/bidaya.git";

  // `currentBranch` matches `source_branch` here: this fixture models a *complete* call, and
  // every input a check needs has to be present or `undetermined` is correctly non-empty.
  const clean = triageMrPayload({
    mr: base,
    workspaceRemote: remote,
    currentUser: "jane.doe",
    currentBranch: base.source_branch,
  });
  eq("triage[clean MR]: proceeds", clean.proceed, true);
  eq("triage[clean MR]: no blockers", clean.blockers, []);
  eq("triage[clean MR]: nothing undetermined", clean.undetermined, []);
  eq("triage[clean MR]: parses the ticket key", clean.facts.ticketKey, "BIDAYA-699");
  eq("triage[clean MR]: parses the commit type", clean.facts.commitType, "fix");

  // The observed failure, as a fixture.
  const conflicted = triageMrPayload({
    mr: { ...base, has_conflicts: true, merge_status: "cannot_be_merged", detailed_merge_status: "conflict" },
    workspaceRemote: remote,
    currentUser: "jane.doe",
  });
  eq("triage[conflicted MR]: does not proceed", conflicted.proceed, false);
  truthy(
    "triage[conflicted MR]: raises a conflicts blocker",
    conflicted.blockers.some((b) => b.code === "conflicts"),
  );
  eq("triage[conflicted MR]: surfaces has_conflicts as a fact", conflicted.facts.hasConflicts, true);

  // A payload omitting has_conflicts is not a payload without conflicts.
  const partialSignal = triageMrPayload({
    mr: { ...base, detailed_merge_status: "conflict" },
    workspaceRemote: remote,
    currentUser: "jane.doe",
  });
  truthy(
    "triage[conflict via detailed_merge_status only]: still caught",
    partialSignal.blockers.some((b) => b.code === "conflicts"),
  );

  for (const state of ["merged", "closed", "locked"]) {
    const r = triageMrPayload({ mr: { ...base, state }, workspaceRemote: remote, currentUser: "jane.doe" });
    truthy(
      `triage[${state}]: blocks`,
      r.blockers.some((b) => b.code === "terminal-state"),
    );
  }

  const wrongProject = triageMrPayload({
    mr: base,
    workspaceRemote: "git@git.example.net:other/team/unrelated.git",
    currentUser: "jane.doe",
  });
  truthy(
    "triage[wrong project]: blocks before any checkout",
    wrongProject.blockers.some((b) => b.code === "wrong-project"),
  );

  const zero = triageMrPayload({
    mr: { ...base, user_notes_count: 0 },
    workspaceRemote: remote,
    currentUser: "jane.doe",
  });
  truthy(
    "triage[zero comments]: blocks",
    zero.blockers.some((b) => b.code === "zero-comments"),
  );

  // --- Branch comparison. Observed on MR !510: the run held `git-context.mjs` output
  // reading `branch: "fix/BIDAYA-2084"` against a source branch of `fix/BIDAYA-2315`, then
  // wrote "already checked out" in the report and "Stay on {source}" in the closing list.
  // The approved list therefore had no checkout in it, and nine grep/read calls ran against
  // the previous MR's branch before an unprompted `git branch --show-current` caught it.
  // A prose rule already covered this; comparing two strings the caller holds is a tool's job.
  const wrongBranch = triageMrPayload({
    mr: { ...base, source_branch: "fix/BIDAYA-2315" },
    workspaceRemote: remote,
    currentUser: "jane.doe",
    currentBranch: "fix/BIDAYA-2084",
  });
  truthy(
    "triage[branch-mismatch]: flags a different checked-out branch",
    wrongBranch.flags.some((f) => f.code === "branch-mismatch"),
  );
  eq("triage[branch-mismatch]: is a flag, not a blocker — checking out is the normal fix", wrongBranch.proceed, true);
  truthy(
    "triage[branch-mismatch]: names both branches so the report can render the switch",
    wrongBranch.flags.find((f) => f.code === "branch-mismatch")?.message.includes("fix/BIDAYA-2084") &&
      wrongBranch.flags.find((f) => f.code === "branch-mismatch")?.message.includes("fix/BIDAYA-2315"),
  );
  eq(
    "triage[branch-mismatch]: surfaces the checked-out branch as a fact",
    wrongBranch.facts.currentBranch,
    "fix/BIDAYA-2084",
  );

  const rightBranch = triageMrPayload({
    mr: { ...base, source_branch: "fix/BIDAYA-2315" },
    workspaceRemote: remote,
    currentUser: "jane.doe",
    currentBranch: "fix/BIDAYA-2315",
  });
  eq(
    "triage[branch match]: raises no flag",
    rightBranch.flags.filter((f) => f.code === "branch-mismatch"),
    [],
  );
  eq(
    "triage[branch match]: and nothing undetermined about the branch",
    rightBranch.undetermined.filter((u) => u.startsWith("branch")),
    [],
  );

  // Omitted is unknown, and unknown must never read as "already checked out" — that is the
  // exact sentence the failing run produced.
  for (const [label, value] of [
    ["omitted", undefined],
    ["empty (detached HEAD)", ""],
  ]) {
    const unknown = triageMrPayload({
      mr: { ...base, source_branch: "x" },
      workspaceRemote: remote,
      currentUser: "jane.doe",
      currentBranch: value,
    });
    truthy(
      `triage[branch ${label}]: reported undetermined rather than passing`,
      unknown.undetermined.some((u) => u.startsWith("branch:")),
    );
    falsy(
      `triage[branch ${label}]: raises no false mismatch flag`,
      unknown.flags.some((f) => f.code === "branch-mismatch"),
    );
    truthy(
      `triage[branch ${label}]: says explicitly it is not "checked out"`,
      unknown.undetermined.find((u) => u.startsWith("branch:"))?.includes("do not report it as checked out"),
    );
  }

  const notYours = triageMrPayload({ mr: base, workspaceRemote: remote, currentUser: "someone.else" });
  eq("triage[not yours]: still proceeds", notYours.proceed, true);
  truthy(
    "triage[not yours]: flags ownership",
    notYours.flags.some((f) => f.code === "not-yours"),
  );

  const noKey = triageMrPayload({
    mr: { ...base, title: "tidy up the modal service" },
    workspaceRemote: remote,
    currentUser: "jane.doe",
  });
  truthy(
    "triage[no ticket key]: flags it",
    noKey.flags.some((f) => f.code === "no-ticket-key"),
  );
  eq("triage[no ticket key]: does not invent one", noKey.facts.ticketKey, null);

  // A check that could not run must never be reported as a check that passed.
  const noInputs = triageMrPayload({ mr: base });
  truthy(
    "triage[missing inputs]: wrong-project reported undetermined, not passed",
    noInputs.undetermined.some((u) => u.startsWith("wrong-project")),
  );
  truthy(
    "triage[missing inputs]: ownership reported undetermined, not passed",
    noInputs.undetermined.some((u) => u.startsWith("not-yours")),
  );
  eq(
    "triage[missing inputs]: raises no false ownership flag",
    noInputs.flags.filter((f) => f.code === "not-yours"),
    [],
  );

  // SSH remote, HTTPS web URL, trailing .git and case must all compare equal.
  eq(
    "triage: ssh remote normalizes to the same path as the MR web_url",
    normalizeProjectPath(remote),
    normalizeProjectPath(base.web_url),
  );
  eq(
    "triage: https remote normalizes too",
    normalizeProjectPath("https://git.example.net/Retail/Bidaya/Frontend/Bidaya.git"),
    "retail/bidaya/frontend/bidaya",
  );
  eq("triage: unusable remote yields null rather than a wrong guess", normalizeProjectPath(""), null);

  eq("triage: parses a bare conventional title", parseMrTitle("feat(ABC-1): thing").commitType, "feat");
  eq("triage: tolerates a breaking-change marker", parseMrTitle("feat(ABC-1)!: thing").commitType, "feat");

  throws("triage: rejects a non-object payload", () => triageMrPayload({ mr: [] }));

  // All three default their input as `input ?? {}` rather than `= {}` on the
  // parameter (see hunks.js). What that must not alter: a no-argument call still
  // reaches the documented error, not a TypeError from destructuring undefined.
  throws("triage: a no-argument call reaches the documented error", () => triageMrPayload(), "mr must be");
  throws(
    "reconcile: a no-argument call reaches the documented error",
    () => reconcileDiscussionCounts(),
    "discussions must be an array",
  );
  throws(
    "hunks: a no-argument call reaches the documented error",
    () => attributeStagedHunks(),
    "diffText must be a string",
  );
}

// ---------- Discussion count reconciliation ----------

function testDiscussionReconciliation() {
  const note = (id, username, extra = {}) => ({ id, author: { username }, system: false, ...extra });

  const discussions = [
    { id: "d1", notes: [note(1, "reviewer"), note(2, "jane.doe")] },
    { id: "d2", notes: [note(3, "reviewer", { resolvable: true, resolved: true })] },
    { id: "d3", notes: [note(4, "reviewer", { resolvable: true, resolved: false })] },
    { id: "d4", notes: [{ id: 5, system: true, author: { username: "jane.doe" } }] },
  ];

  const r = reconcileDiscussionCounts({ discussions, userNotesCount: 4, currentUser: "jane.doe" });
  eq("reconcile: counts threads", r.threadsTotal, 4);
  // d4 is system-only: a discussion, not a thread to triage. MR !508 counted 5
  // against 3 and produced "3 reviewer comments across 5 threads (3 notes)".
  eq("reconcile: excludes system-only threads from the triage count", r.feedbackThreads, 3);
  eq("reconcile: counts all notes including system", r.notesTotal, 5);
  eq("reconcile: counts system notes separately", r.systemNotes, 1);
  eq("reconcile: excludes own replies from the reviewer count", r.reviewerNotes, 3);
  eq("reconcile: counts own replies separately", r.ownNotes, 1);
  eq("reconcile: compares non-system notes against user_notes_count", r.expectedNotes, 4);
  eq("reconcile: reconciles", r.reconciles, true);
  eq("reconcile: counts resolved threads", r.resolvedThreads, 1);
  eq("reconcile: counts unresolved threads", r.unresolvedThreads, 1);
  truthy("reconcile: builds the count line", r.countLine.includes("3 reviewer comments across 3 threads"));
  falsy("reconcile: count line never reports the raw discussion total", r.countLine.includes("4 threads"));
  truthy("reconcile: reason explains the excluded system-only threads", r.reason.includes("only system notes"));

  // It used to end "Reading the referenced files now.", duplicating the brief's own
  // "Next:" row — or contradicting it when a blocker stopped the run before any read.
  truthy("reconcile: count line ends on the reconciliation verdict", r.countLine.endsWith("reconciles ✓)"));
  falsy("reconcile: count line carries no next-action sentence", /Reading|now\./i.test(r.countLine));

  // What an unexhausted paginated fetch looks like. It must not read as agreement.
  const short = reconcileDiscussionCounts({ discussions, userNotesCount: 19, currentUser: "jane.doe" });
  eq("reconcile[under-fetch]: does not reconcile", short.reconciles, false);
  truthy("reconcile[under-fetch]: reason names pagination", short.reason.includes("paginated"));
  truthy("reconcile[under-fetch]: count line says MISMATCH", short.countLine.includes("MISMATCH"));
  falsy("reconcile[under-fetch]: mismatch line carries no next-action sentence", /Reading/i.test(short.countLine));

  // No expectation supplied is unknown, never a pass.
  const unknown = reconcileDiscussionCounts({ discussions, currentUser: "jane.doe" });
  eq("reconcile[no user_notes_count]: reconciles is null, not true", unknown.reconciles, null);
  truthy("reconcile[no user_notes_count]: says so in the count line", unknown.countLine.includes("not reconciled"));

  const linked = reconcileDiscussionCounts({ discussions, userNotesCount: 4, noteIdFromUrl: "3" });
  eq("reconcile: finds a linked note id from the URL", linked.linkedNoteFound, true);
  eq(
    "reconcile: reports a linked note id that isn't in the fetch",
    reconcileDiscussionCounts({ discussions, userNotesCount: 4, noteIdFromUrl: "999" }).linkedNoteFound,
    false,
  );
  eq(
    "reconcile: linkedNoteFound is null when no note id was in the URL",
    reconcileDiscussionCounts({ discussions, userNotesCount: 4 }).linkedNoteFound,
    null,
  );

  eq(
    "reconcile[empty]: zero threads",
    reconcileDiscussionCounts({ discussions: [], userNotesCount: 0 }).threadsTotal,
    0,
  );
  throws("reconcile: rejects a non-array", () => reconcileDiscussionCounts({ discussions: null }));
}

// ---------- Staged hunk attribution ----------

function testStagedHunkAttribution() {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 111..222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,3 +1,4 @@ export class A {",
    " keep",
    "-old",
    "+new",
    "+extra",
    "@@ -20,2 +21,2 @@ method() {",
    "-gone",
    "+back",
    "diff --git a/src/untouched.ts b/src/untouched.ts",
    "index 333..444 100644",
    "--- a/src/untouched.ts",
    "+++ b/src/untouched.ts",
    "@@ -5,1 +5,2 @@",
    "+someone elses line",
    "diff --git a/assets/logo.png b/assets/logo.png",
    "Binary files a/assets/logo.png and b/assets/logo.png differ",
  ].join("\n");

  const parsed = parseStagedDiff(diff);
  eq("hunks: parses every file", parsed.length, 3);
  eq("hunks: parses both hunks of the first file", parsed[0].hunks.length, 2);
  eq("hunks: counts additions", parsed[0].hunks[0].added, 2);
  eq("hunks: counts removals", parsed[0].hunks[0].removed, 1);
  falsy("hunks: does not count the +++ header as an addition", parsed[0].hunks[0].added > 2);

  const r = attributeStagedHunks({ diffText: diff, approvedFiles: ["src/a.ts"], formatterFiles: [] });
  eq("hunks: totals added", r.totals.added, 4);
  eq("hunks: totals removed", r.totals.removed, 2);
  eq("hunks: builds the numstat string used in the summary", r.numstat, "+4 / -2");
  eq("hunks: flags the file with no basis at all", r.unexplainedFiles, ["src/untouched.ts", "assets/logo.png"]);
  eq("hunks: not all files explained", r.allFilesExplained, false);
  eq("hunks: lists binary files", r.binaryFiles, ["assets/logo.png"]);

  // The honest limit: a file with a basis still yields per-hunk items, because
  // file-level basis can't prove line-level authorship.
  eq("hunks: every hunk in an approved file still needs judgement", r.needsJudgement.length, 2);
  truthy(
    "hunks: reason states that file-level basis is not line-level proof",
    r.reason.includes("does not prove line-level authorship"),
  );

  const formatted = attributeStagedHunks({
    diffText: diff,
    approvedFiles: ["src/a.ts"],
    formatterFiles: ["src/untouched.ts", "assets/logo.png"],
  });
  eq("hunks: a formatter-reported file counts as a basis", formatted.unexplainedFiles, []);
  eq("hunks: then all files are explained", formatted.allFilesExplained, true);
  truthy(
    "hunks: basis is recorded per file",
    formatted.files.find((f) => f.path === "src/untouched.ts").basis.includes("formatter-reported"),
  );

  // A resolution is a third basis, not folded into approvedFiles: it can be a real
  // design decision (observed: a service rewritten to delegate, plus a file deleted),
  // and merged in it would pass attribution under a review comment's approval.
  const resolvedOnly = attributeStagedHunks({
    diffText: diff,
    approvedFiles: [],
    conflictFiles: ["src/a.ts"],
  });
  eq("hunks: a conflict resolution is its own basis", resolvedOnly.files[0].basis, ["conflict-resolution"]);
  eq("hunks: resolution files are reported", resolvedOnly.resolutionFiles, ["src/a.ts"]);
  eq("hunks: a resolution alone is not a mixed file", resolvedOnly.mixedFiles, []);
  truthy(
    "hunks: reason tells the caller to keep a resolution in its own commit",
    resolvedOnly.reason.includes("keep it in its own commit"),
  );

  const mixed = attributeStagedHunks({
    diffText: diff,
    approvedFiles: ["src/a.ts"],
    conflictFiles: ["src/a.ts"],
  });
  eq("hunks: a file carrying both bases records both", mixed.files[0].basis, [
    "approved-change",
    "conflict-resolution",
  ]);
  eq("hunks: a file carrying both is reported as mixed", mixed.mixedFiles, ["src/a.ts"]);

  // Same laundering rule as formatterFiles: output derives from the diff, so naming
  // an unstaged path doesn't make it a resolution that happened.
  eq(
    "hunks: a conflict_files path absent from the diff is not reported as a resolution",
    attributeStagedHunks({ diffText: diff, approvedFiles: ["src/a.ts"], conflictFiles: ["src/never-staged.ts"] })
      .resolutionFiles,
    [],
  );

  eq("hunks[empty diff]: nothing staged", attributeStagedHunks({ diffText: "" }).totals.files, 0);
  eq(
    "hunks: windows-style paths normalize",
    attributeStagedHunks({ diffText: diff, approvedFiles: [String.raw`src\a.ts`] }).files[0].basis,
    ["approved-change"],
  );
  eq(
    "hunks: windows-style conflict paths normalize too",
    attributeStagedHunks({ diffText: diff, conflictFiles: [String.raw`src\a.ts`] }).files[0].basis,
    ["conflict-resolution"],
  );
  throws("hunks: rejects a non-string diff", () => attributeStagedHunks({ diffText: null }));
  throws("hunks: rejects non-array approvedFiles", () =>
    attributeStagedHunks({ diffText: diff, approvedFiles: "src/a.ts" }),
  );
  throws("hunks: rejects non-array conflictFiles", () =>
    attributeStagedHunks({ diffText: diff, conflictFiles: "src/a.ts" }),
  );
}

// ---------- GraphQL normalization ----------

/**
 * The fixture is trimmed from a real `glab api graphql` response against GitLab 18.x,
 * so the field names, enum casing and `gid://` prefixes are the actual ones.
 *
 * The trap it pins: ids come back as global IDs whose bare remainders ARE the REST
 * ids. One left in place 404s every reply POST at the end of a run, after the
 * approval gate has closed.
 */
function testGraphqlNormalization() {
  const payload = {
    data: {
      project: {
        mergeRequest: {
          iid: "508",
          title: "fix(BIDAYA-2096): add missing icons",
          state: "opened",
          sourceBranch: "fix/BIDAYA-2096",
          targetBranch: "develop",
          userNotesCount: 3,
          conflicts: true,
          mergeStatusEnum: "CANNOT_BE_MERGED",
          detailedMergeStatus: "CONFLICT",
          draft: false,
          webUrl: "https://git.example.net/a/b/repo/-/merge_requests/508",
          author: { username: "youssef" },
          assignees: { nodes: [{ username: "youssef" }] },
          discussions: {
            pageInfo: { hasNextPage: false, endCursor: "eyJpZCI6IjEifQ" },
            nodes: [
              {
                // System-only thread: activity log, not feedback.
                id: "gid://gitlab/Discussion/aaa111",
                notes: {
                  nodes: [
                    {
                      id: "gid://gitlab/Note/87594",
                      system: true,
                      resolvable: false,
                      resolved: false,
                      body: "requested review from @hodei",
                      author: { username: "youssef" },
                      position: null,
                    },
                  ],
                },
              },
              {
                // Diff thread, unresolved, from a reviewer.
                id: "gid://gitlab/Discussion/bbb222",
                notes: {
                  nodes: [
                    {
                      id: "gid://gitlab/Note/87600",
                      system: false,
                      resolvable: true,
                      resolved: false,
                      body: "use the directional radius mixin",
                      createdAt: "2026-09-10T10:00:00Z",
                      author: { username: "hodei" },
                      position: { newPath: "src/_banner.scss", newLine: 17 },
                    },
                  ],
                },
              },
              {
                // General MR comment: no position, resolvable false.
                id: "gid://gitlab/Discussion/ccc333",
                notes: {
                  nodes: [
                    {
                      id: "gid://gitlab/Note/87601",
                      system: false,
                      resolvable: false,
                      resolved: false,
                      body: "looks good overall",
                      author: { username: "hodei" },
                      position: null,
                    },
                    {
                      id: "gid://gitlab/Note/87602",
                      system: false,
                      resolvable: false,
                      resolved: false,
                      body: "thanks, pushed a fix",
                      author: { username: "youssef" },
                      position: null,
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  };

  const { mr, discussions, hasNextPage, endCursor } = normalizeGraphqlMr(payload);

  // camelCase → snake_case, so the existing REST-shaped tools need no changes.
  eq("graphql: iid becomes a number", mr.iid, 508);
  eq("graphql: sourceBranch → source_branch", mr.source_branch, "fix/BIDAYA-2096");
  eq("graphql: userNotesCount → user_notes_count", mr.user_notes_count, 3);
  eq("graphql: conflicts → has_conflicts", mr.has_conflicts, true);
  // Skip the enum lowercasing and the conflict blocker never fires: it compares
  // against "cannot_be_merged".
  eq("graphql: mergeStatusEnum is lowercased to the REST spelling", mr.merge_status, "cannot_be_merged");
  eq("graphql: detailedMergeStatus is lowercased too", mr.detailed_merge_status, "conflict");
  eq("graphql: assignees connection is unwrapped", mr.assignees, [{ username: "youssef" }]);

  // The gid trap.
  eq("graphql: discussion gid is stripped to the REST id", discussions[0].id, "aaa111");
  eq("graphql: note gid is stripped to the REST id", discussions[1].notes[0].id, "87600");
  truthy(
    "graphql: no gid:// survives anywhere in the normalized output",
    !JSON.stringify(discussions).includes("gid://"),
  );
  eq("graphql[stripGid]: leaves a bare REST id untouched", stripGid("87600"), "87600");
  eq("graphql[stripGid]: tolerates a non-string", stripGid(undefined), null);

  // `old_path`/`old_line` carry a comment on a deleted line, which has null new_* and
  // used to render as `null:null`. `line_range` stays null because GitLab's DiffPosition
  // has no such field, so the query cannot ask for one.
  eq("graphql: position is renamed to the REST shape", discussions[1].notes[0].position, {
    new_path: "src/_banner.scss",
    new_line: 17,
    old_path: null,
    old_line: null,
    line_range: null,
  });
  eq("graphql: a general comment keeps a null position, as REST does", discussions[2].notes[0].position, null);

  // GraphQL's version of the REST paging shortfall: surfaced, not swallowed, because
  // it means the same as `reconciles: false`.
  eq("graphql: hasNextPage is reported", hasNextPage, false);
  eq("graphql: endCursor is reported for continuation", endCursor, "eyJpZCI6IjEifQ");

  // End to end: the normalized output must drive the decision tools to the same
  // answers the REST shape would have.
  const triage = triageMrPayload({ mr, workspaceRemote: "git@git.example.net:a/b/repo.git", currentUser: "youssef" });
  truthy(
    "graphql: the conflict blocker fires from the normalized payload",
    triage.blockers.some((b) => b.code === "conflicts"),
  );
  eq("graphql: the ticket key is parsed from the title", triage.facts.ticketKey, "BIDAYA-2096");

  const counts = reconcileDiscussionCounts({
    discussions,
    userNotesCount: mr.user_notes_count,
    currentUser: "youssef",
  });
  eq("graphql: threadsTotal counts every discussion", counts.threadsTotal, 3);
  eq("graphql: feedbackThreads excludes the system-only thread", counts.feedbackThreads, 2);
  eq("graphql: own replies are excluded from the reviewer count", counts.reviewerNotes, 2);
  eq("graphql: the note count reconciles against userNotesCount", counts.reconciles, true);

  // Envelope tolerance: the same payload should normalize whether it arrives
  // wrapped by the transport or as a bare mergeRequest.
  eq(
    "graphql: a bare mergeRequest object normalizes identically",
    normalizeGraphqlMr(payload.data.project.mergeRequest).mr.iid,
    508,
  );
  throws("graphql: rejects a non-payload", () => normalizeGraphqlMr(null));
  throws("graphql: rejects an array", () => normalizeGraphqlMr([1, 2, 3]));

  // The query and the normalizer live in the same module so they can't drift.
  for (const field of [
    "mergeStatusEnum",
    "detailedMergeStatus",
    "userNotesCount",
    "sourceBranch",
    "pageInfo",
    "position",
  ]) {
    truthy(`graphql: MR_QUERY selects ${field}`, MR_QUERY.includes(field));
  }
  truthy(
    "graphql: MR_QUERY declares iid as String!, which is why --raw-field is required",
    MR_QUERY.includes("$iid: String!"),
  );
}

// ---------- Server transport ----------

/**
 * The direct-import tests prove the logic; this proves the wiring, and that bad
 * input returns an explicit error rather than a fabricated result.
 */
function testServerTransport() {
  const SERVER = resolve(ROOT, "server", "server.js");

  const call = (messages) => {
    const input = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
    const out = execFileSync(process.execPath, [SERVER], { input, encoding: "utf8" });
    return out
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  };

  const init = {
    jsonrpc: "2.0",
    id: 0,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } },
  };

  const handshake = call([init]).find((m) => m.id === 0);
  eq("transport: negotiates the requested protocol version", handshake.result.protocolVersion, "2025-06-18");
  eq("transport: reports its name", handshake.result.serverInfo.name, "mr-review-checks");
  const pkg = JSON.parse(readFileSync(join(ROOT, "server", "package.json"), "utf8"));
  eq("transport: serverInfo.version matches package.json", handshake.result.serverInfo.version, pkg.version);
  // And both track the power's version. The server ships only inside this power, so a second
  // version number can only ever confuse a bug report — a tester reading "server 1.0.0" out of
  // a handshake while plugin.json says 1.5.0 has to be told the two are unrelated.
  const manifestVersion = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf8")).version;
  eq("transport: serverInfo.version tracks plugin.json", handshake.result.serverInfo.version, manifestVersion);

  const tools = call([init, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }]).find((m) => m.id === 1).result
    .tools;
  eq("transport: advertises five tools", tools.length, 5);
  const names = tools.map((t) => t.name).sort(byCodeUnit);
  eq("transport: tool names", names, [
    "attribute_staged_hunks",
    "locate_bundled_scripts",
    "reconcile_discussion_counts",
    "triage_graphql_mr",
    "triage_mr_payload",
  ]);
  // Docs versus reality. POWER.md, the README and a reference file all claimed three
  // tools while four shipped, and the README told the reader to expect three two
  // paragraphs after naming the fourth — so a correct install reads as broken. The
  // keyword-parity suite already proves this pattern was understood; this applies it to
  // the one other pair of hand-maintained facts.
  const count = tools.length;
  const word = ["zero", "one", "two", "three", "four", "five", "six"][count] ?? String(count);
  const power = readFileSync(join(ROOT, "POWER.md"), "utf8");
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const investigating = readFileSync(join(ROOT, "skills", "mr-comments", "references", "investigating.md"), "utf8");

  for (const [label, text] of [
    ["POWER.md", power],
    ["README.md", readme],
    ["investigating.md", investigating],
  ]) {
    const wrong = ["zero", "one", "two", "three", "four", "five", "six"]
      .filter((w) => w !== word)
      .filter((w) => new RegExp(String.raw`\b${w} tools\b`, "i").test(text));
    eq(`parity[${label}]: names no tool count other than ${word}`, wrong, []);
    const wrongDigits = [1, 2, 3, 4, 5, 6]
      .filter((n) => n !== count)
      .filter((n) => new RegExp(String.raw`\b${n} tools\b`).test(text));
    eq(`parity[${label}]: no digit tool count other than ${count}`, wrongDigits, []);
  }
  // Every shipped tool must appear in POWER.md's table, or the table is a partial list
  // presented as a complete one.
  for (const t of tools) {
    truthy(`parity[POWER.md]: documents \`${t.name}\``, power.includes(`\`${t.name}\``));
  }

  const noRequiredExpected = new Set([
    // Takes EITHER `discussions_text` or `discussions`, which JSON Schema can't express.
    // The handler enforces it and returns an explicit tool error either way.
    "reconcile_discussion_counts",
    // Takes no arguments at all, so there is nothing to require.
    "locate_bundled_scripts",
  ]);
  for (const t of tools) {
    if (!noRequiredExpected.has(t.name)) {
      truthy(`transport[${t.name}]: declares required inputs`, Array.isArray(t.inputSchema.required));
    }
    const props = Object.keys(t.inputSchema.properties ?? {});
    eq(
      `transport[${t.name}]: params are snake_case`,
      props.filter((p) => /[A-Z]/.test(p)),
      [],
    );
  }

  const triaged = call([
    init,
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "triage_mr_payload",
        arguments: { mr: { iid: 1, state: "opened", user_notes_count: 3, has_conflicts: true, title: "fix(A-1): x" } },
      },
    },
  ]).find((m) => m.id === 2).result;
  falsy("transport[triage]: a valid call is not an error", triaged.isError);
  truthy(
    "transport[triage]: conflict blocker survives the JSON-RPC boundary",
    JSON.parse(triaged.content[0].text).blockers.some((b) => b.code === "conflicts"),
  );

  // The path lookup exists because a measured run spent 60s and nine directory listings
  // guessing where its own scripts were. It has to come back with something runnable, so
  // the assertion is that the file is actually there and the quoted `run` string works.
  const located = call([
    init,
    { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "locate_bundled_scripts", arguments: {} } },
  ]).find((m) => m.id === 9).result;
  falsy("transport[locate]: takes no arguments and is not an error", located.isError);
  const paths = JSON.parse(located.content[0].text);
  for (const s of ["fetch-mr.mjs", "git-context.mjs"]) {
    truthy(`transport[locate]: returns a path for ${s}`, typeof paths.scripts?.[s]?.path === "string");
    truthy(`transport[locate]: the path for ${s} resolves to a real file`, existsSync(paths.scripts[s].path));
    // Quoted, because the default install path contains the user's name and that
    // usually contains a space.
    eq(`transport[locate]: the run string for ${s} is quoted`, paths.scripts[s].run, `node "${paths.scripts[s].path}"`);
  }
  truthy("transport[locate]: powerRoot points at this power", existsSync(join(paths.powerRoot, "plugin.json")));
  falsy("transport[locate]: no Windows drive-letter path leaks a leading slash", /^\/[a-zA-Z]:/.test(paths.powerRoot));

  // The description has to carry the resolved commands, not just describe them. A tool
  // description ships with the tool list, which the run holds before it reads the skill,
  // so this is the one channel that delivers the path without being asked. Three runs
  // spent between two and nine calls verifying a path documented as a convention;
  // a path the server computed from its own location is evidence instead of a claim.
  const locateTool = tools.find((t) => t.name === "locate_bundled_scripts");
  for (const s of ["fetch-mr.mjs", "git-context.mjs"]) {
    truthy(
      `transport[locate]: the description states the resolved command for ${s}`,
      locateTool.description.includes(paths.scripts[s].run),
    );
  }
  truthy(
    "transport[locate]: and tells the run not to verify it first",
    /Do not verify them with `file_search` or `list_directory`/.test(locateTool.description),
  );

  // The whole path for the newest input: schema → snake_case unwrap → camelCase set
  // in hunks.js → output field.
  const attributed = call([
    init,
    {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "attribute_staged_hunks",
        arguments: {
          diff_text: ["diff --git a/src/svc.ts b/src/svc.ts", "@@ -1,2 +1,2 @@", "-old", "+resolved"].join("\n"),
          approved_files: [],
          conflict_files: ["src/svc.ts"],
        },
      },
    },
  ]).find((m) => m.id === 5).result;
  falsy("transport[hunks]: a valid call is not an error", attributed.isError);
  eq(
    "transport[hunks]: conflict_files reaches the resolution basis across the boundary",
    JSON.parse(attributed.content[0].text).resolutionFiles,
    ["src/svc.ts"],
  );

  // `discussions_text` passes the response through instead of rebuilding it, so a
  // field can't be lost on the way in. Prove it reaches the same counts.
  const ndjson = [
    JSON.stringify({
      id: "d1",
      notes: [{ id: 1, system: true, resolvable: false, resolved: false, author: { username: "bot" } }],
    }),
    JSON.stringify({
      id: "d2",
      notes: [{ id: 2, system: false, resolvable: true, resolved: false, author: { username: "hodei" } }],
    }),
  ].join("\n");
  const viaText = call([
    init,
    {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "reconcile_discussion_counts",
        arguments: { discussions_text: ndjson, user_notes_count: 1, current_user: "youssef" },
      },
    },
  ]).find((m) => m.id === 6).result;
  falsy("transport[reconcile]: the ndjson text path is not an error", viaText.isError);
  const textCounts = JSON.parse(viaText.content[0].text);
  eq("transport[reconcile]: ndjson text yields the same feedbackThreads", textCounts.feedbackThreads, 1);
  eq("transport[reconcile]: ndjson text reconciles", textCounts.reconciles, true);

  // Truncation is the common real failure, and it must name the line so the caller
  // continues from an offset instead of reconciling on half.
  const truncated = call([
    init,
    {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "reconcile_discussion_counts", arguments: { discussions_text: '{"id":"d1","notes":[{"id":1' } },
    },
  ]).find((m) => m.id === 7).result;
  truthy("transport[reconcile]: a truncated ndjson line is an explicit error", truncated.isError);
  truthy(
    "transport[reconcile]: the truncation error names the line and the remedy",
    truncated.content[0].text.includes("line 1") && truncated.content[0].text.includes("offset"),
  );

  // One call replacing two, across the JSON-RPC boundary, gid stripping intact.
  const gqlCall = call([
    init,
    {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "triage_graphql_mr",
        arguments: {
          graphql: {
            data: {
              project: {
                mergeRequest: {
                  iid: "77",
                  title: "fix(A-1): x",
                  state: "opened",
                  userNotesCount: 1,
                  conflicts: true,
                  mergeStatusEnum: "CANNOT_BE_MERGED",
                  discussions: {
                    pageInfo: { hasNextPage: true },
                    nodes: [
                      {
                        id: "gid://gitlab/Discussion/zz9",
                        notes: {
                          nodes: [
                            {
                              id: "gid://gitlab/Note/4242",
                              system: false,
                              resolvable: true,
                              resolved: false,
                              author: { username: "hodei" },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
          current_user: "youssef",
        },
      },
    },
  ]).find((m) => m.id === 8).result;
  falsy("transport[graphql]: a valid call is not an error", gqlCall.isError);
  const combined = JSON.parse(gqlCall.content[0].text);
  truthy(
    "transport[graphql]: returns the triage half, with the conflict blocker",
    combined.triage.blockers.some((b) => b.code === "conflicts"),
  );
  eq("transport[graphql]: returns the counts half", combined.counts.feedbackThreads, 1);
  truthy("transport[graphql]: counts carry the ready-made countLine", typeof combined.counts.countLine === "string");
  eq("transport[graphql]: hands back REST-usable discussion ids", combined.discussions[0].id, "zz9");
  eq("transport[graphql]: hands back REST-usable note ids", combined.discussions[0].notes[0].id, "4242");
  eq("transport[graphql]: surfaces hasNextPage rather than swallowing it", combined.hasNextPage, true);

  const bad = call([
    init,
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "attribute_staged_hunks", arguments: {} } },
  ]).find((m) => m.id === 3).result;
  truthy("transport: malformed input returns an explicit tool error", bad.isError);

  const unknown = call([
    init,
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope", arguments: {} } },
  ]).find((m) => m.id === 4);
  truthy("transport: an unknown tool is a JSON-RPC error", unknown.error !== undefined);

  // Zero dependencies means no `@types/node`, so every bare `process.` reads as an
  // unknown name under checkJs. One locally-typed handle fixes that; an ambient
  // `declare var process` was rejected because it collides with `@types/node`
  // wherever a parent directory supplies it. Assert the handle, and no bare use back.
  const serverSource = readFileSync(SERVER, "utf8");
  truthy(
    "transport: process is reached through one locally-typed handle",
    /const proc = \/\*\* @type \{any\} \*\/ \(globalThis\)\.process;/.test(serverSource),
  );
  falsy(
    "transport: no bare `process.` use outside that handle",
    /(^|[^.\w])process\.(stdin|stdout|stderr|exit|argv|env)/m.test(serverSource),
  );
}

// ---------- Audit regressions ----------

/**
 * Every case here is a bug that shipped while the whole suite was green, found by an
 * audit that executed the modules instead of reading them. The happy-path fixtures
 * above pass on all of them, which is why these are separate: each one is a shape the
 * original tests never fed in.
 */
function testAuditRegressions() {
  // --- hunks: `---`/`+++` are file headers only before the first `@@`. Filtering them
  // inside a hunk silently drops content lines, and markdown and YAML front matter hit
  // it constantly. `numstat` is documented as authoritative, so it was wrong at the
  // one gate the user approves.
  const md = attributeStagedHunks({
    diffText: [
      "diff --git a/doc.md b/doc.md",
      "index 1..2 100644",
      "--- a/doc.md",
      "+++ b/doc.md",
      "@@ -1,4 +1,4 @@",
      " keep",
      "----",
      "--- old front matter",
      "+++ new content",
      "+kept",
    ].join("\n"),
    approvedFiles: ["doc.md"],
  });
  eq("audit[hunks]: a removed line whose content starts with --- is counted", md.numstat, "+2 / -2");
  eq("audit[hunks]: the real file headers are still not counted", md.totals.hunks, 1);

  // --- hunks: git quotes any path with a non-ASCII byte, a tab or a quote. The old
  // regex required a bare `a/`, so the header didn't match, no new file was started,
  // and the following `@@` opened a hunk on the PREVIOUS file — laundering a
  // colleague's staged lines into an approved change with allFilesExplained true.
  const quoted = attributeStagedHunks({
    diffText: [
      "diff --git a/mine.ts b/mine.ts",
      "@@ -1,1 +1,2 @@",
      "+approved",
      String.raw`diff --git "a/caf\303\251.ts" "b/caf\303\251.ts"`,
      "@@ -1,1 +1,4 @@",
      "+foreign1",
      "+foreign2",
      "+foreign3",
    ].join("\n"),
    approvedFiles: ["mine.ts"],
  });
  eq("audit[hunks]: a quoted path is its own file, not a hunk on the previous one", quoted.files.length, 2);
  eq("audit[hunks]: the quoted path is decoded from its octal escapes", quoted.files[1]?.path, "café.ts");
  eq("audit[hunks]: the foreign file has no basis and is reported", quoted.unexplainedFiles, ["café.ts"]);
  falsy("audit[hunks]: so the diff is not declared fully explained", quoted.allFilesExplained);
  eq("audit[hunks]: the approved file keeps only its own hunk", quoted.files[0]?.hunks.length, 1);

  // A `diff --git` line always starts a new file even when neither form parses,
  // because attributing its hunks to the previous file is the unsafe direction.
  const unparsed = attributeStagedHunks({
    diffText: [
      "diff --git a/mine.ts b/mine.ts",
      "@@ -1,1 +1,2 @@",
      "+approved",
      "diff --git something unparseable",
      "@@ -1,1 +1,3 @@",
      "+x",
      "+y",
    ].join("\n"),
    approvedFiles: ["mine.ts"],
  });
  eq("audit[hunks]: an unparseable header still starts a new file", unparsed.files.length, 2);
  falsy("audit[hunks]: and it fails safe as unexplained", unparsed.allFilesExplained);

  // --- hunks: an unmerged path emits a combined `@@@` header. The old pattern didn't
  // match, so the file parsed to zero hunks and still counted as basis-explained,
  // meaning needsJudgement never asked for the per-hunk verdict.
  const combined = attributeStagedHunks({
    diffText: [
      "diff --git a/svc.ts b/svc.ts",
      "@@@ -1,5 -1,5 +1,7 @@@ ctx",
      "++resolved",
      "+ ours",
      " keep",
      "--gone",
    ].join("\n"),
    conflictFiles: ["svc.ts"],
  });
  eq("audit[hunks]: a combined @@@ header produces a hunk", combined.totals.hunks, 1);
  truthy("audit[hunks]: and the hunk still needs a verdict", combined.needsJudgement.length > 0);
  eq("audit[hunks]: a combined diff is surfaced rather than counted silently", combined.combinedFiles, ["svc.ts"]);
  truthy("audit[hunks]: the reason names the combined diff", combined.reason.includes("combined"));

  // --- graphql: the lookup chain ended in `?? payload`, so an envelope carrying no
  // mergeRequest fell through to itself, passed the object guard, and produced
  // all-null fields — which silenced every blocker and returned proceed: true.
  throws(
    "audit[graphql]: a payload whose project is null is rejected",
    () => normalizeGraphqlMr({ data: { project: null } }),
    "no merge request",
  );
  throws(
    "audit[graphql]: a null mergeRequest is rejected",
    () => normalizeGraphqlMr({ data: { project: { mergeRequest: null } } }),
    "no merge request",
  );
  throws(
    "audit[graphql]: an errors array is rejected rather than triaged",
    () => normalizeGraphqlMr({ errors: [{ message: "boom" }], data: { project: { mergeRequest: null } } }),
    "GraphQL returned errors",
  );
  // The bare-mergeRequest form still has to work; it's how fixtures read.
  eq("audit[graphql]: a bare mergeRequest is still accepted", normalizeGraphqlMr({ iid: "5" }).mr.iid, 5);

  // --- graphql: DiffPosition has no lineRange field (verified by introspection), so
  // the normalizer was reading something the query could never supply. oldPath and
  // oldLine do exist, and a comment on a deleted line needs them.
  falsy("audit[graphql]: MR_QUERY does not ask for a field the schema lacks", MR_QUERY.includes("lineRange"));
  truthy("audit[graphql]: MR_QUERY selects oldPath", MR_QUERY.includes("oldPath"));
  truthy("audit[graphql]: MR_QUERY selects oldLine", MR_QUERY.includes("oldLine"));
  truthy("audit[graphql]: the inner notes connection is paginated", /notes\(first:\s*\d+\)/.test(MR_QUERY));
  truthy(
    "audit[graphql]: and its pageInfo is selected so truncation is detectable",
    /notes\(first:[^)]*\)\s*\{\s*pageInfo/.test(MR_QUERY),
  );

  const deleted = normalizeGraphqlMr({
    iid: "9",
    discussions: {
      nodes: [
        {
          id: "gid://gitlab/Discussion/d",
          notes: {
            nodes: [
              {
                id: "gid://gitlab/Note/1",
                position: { newPath: null, newLine: null, oldPath: "gone.ts", oldLine: 12 },
              },
            ],
          },
        },
      ],
    },
  });
  eq(
    "audit[graphql]: a comment on a deleted line keeps the old path",
    deleted.discussions[0]?.notes[0]?.position?.old_path,
    "gone.ts",
  );
  eq("audit[graphql]: and the old line", deleted.discussions[0]?.notes[0]?.position?.old_line, 12);

  // Inner-notes truncation has to surface the same way the outer page does.
  const innerTruncated = normalizeGraphqlMr({
    iid: "9",
    discussions: {
      nodes: [
        {
          id: "gid://gitlab/Discussion/d",
          notes: { pageInfo: { hasNextPage: true }, nodes: [{ id: "gid://gitlab/Note/1" }] },
        },
      ],
    },
  });
  truthy("audit[graphql]: a truncated notes connection sets hasNextPage", innerTruncated.hasNextPage);

  // --- mr-payload: the path comparison threw the host away, so the same path on two
  // different GitLab instances compared equal and the highest-priority blocker
  // couldn't fire. This is the threat fetch-mr.mjs rejects unknown flags to prevent.
  const crossInstance = triageMrPayload({
    mr: {
      iid: 1,
      state: "opened",
      user_notes_count: 3,
      title: "fix(A-1): x",
      web_url: "https://gitlab.com/acme/app/-/merge_requests/1",
    },
    workspaceRemote: "git@git.internal.corp:acme/app.git",
    currentUser: "me",
  });
  truthy(
    "audit[triage]: the same path on a different host raises wrong-project",
    crossInstance.blockers.some((b) => b.code === "wrong-project"),
  );
  falsy("audit[triage]: so it does not proceed", crossInstance.proceed);
  // Same host reached two ways must still compare equal, or every run blocks.
  const sameHost = triageMrPayload({
    mr: {
      iid: 1,
      state: "opened",
      user_notes_count: 3,
      title: "fix(A-1): x",
      web_url: "https://git.example.net/Retail/App/-/merge_requests/1",
    },
    workspaceRemote: "git@git.example.net:retail/app.git",
    currentUser: "me",
  });
  eq("audit[triage]: ssh and https on one host still agree", sameHost.blockers, []);

  // --- mr-payload: the key pattern cannot tell a Jira key from a standards name, so
  // it invented tickets out of encodings and browser versions and suppressed the
  // no-ticket-key flag while doing it.
  for (const title of [
    "fix: handle UTF-8 filenames",
    "chore: bump to SHA-256",
    "fix: drop IE-11",
    "perf: switch to HTTP-2",
  ]) {
    eq(`audit[triage]: ${JSON.stringify(title)} yields no ticket key`, parseMrTitle(title).ticketKey, null);
  }
  eq("audit[triage]: a real key is still parsed", parseMrTitle("fix(BIDAYA-2084): x").ticketKey, "BIDAYA-2084");
  eq(
    "audit[triage]: a two-letter project key still parses when the branch agrees",
    parseMrTitle("fix(AB-12): x").ticketKey,
    "AB-12",
  );

  // A key found only in the title is weaker evidence than one the branch repeats.
  const corroborated = triageMrPayload({
    mr: {
      iid: 1,
      state: "opened",
      user_notes_count: 3,
      title: "fix: handle UTF-8 and BIDAYA-1 together",
      source_branch: "fix/BIDAYA-1",
    },
  });
  eq(
    "audit[triage]: a branch-corroborated key wins over an earlier candidate",
    corroborated.facts.ticketKey,
    "BIDAYA-1",
  );
  truthy("audit[triage]: candidates are all reported", (corroborated.facts.ticketKeys ?? []).includes("BIDAYA-1"));
  const uncorroborated = triageMrPayload({
    mr: { iid: 1, state: "opened", user_notes_count: 3, title: "fix(AB-12): x", source_branch: "fix/something-else" },
  });
  truthy(
    "audit[triage]: an uncorroborated key is reported as undetermined, not trusted",
    uncorroborated.undetermined.some((u) => u.startsWith("ticket-key")),
  );

  // --- discussions: the system-note early return sat above the linked-note check, so
  // a #note_ copied from the activity feed reported a broken fetch on a correct one.
  const linkedSystem = reconcileDiscussionCounts({
    discussions: [{ id: "d1", notes: [{ id: 900, system: true, author: { username: "bot" } }] }],
    userNotesCount: 0,
    noteIdFromUrl: "900",
  });
  eq("audit[reconcile]: a system note satisfies linkedNoteFound", linkedSystem.linkedNoteFound, true);
  eq("audit[reconcile]: and it is still excluded from the feedback counts", linkedSystem.feedbackThreads, 0);

  // --- discussions: reconciles is an equality test, so false covered excess too, and
  // both directions got the shortfall text prescribing a re-paginate that cannot help.
  const excess = reconcileDiscussionCounts({
    discussions: [{ id: "d1", notes: [{ id: 1, system: false, author: { username: "r" } }] }],
    userNotesCount: 0,
  });
  eq("audit[reconcile]: excess still fails to reconcile", excess.reconciles, false);
  falsy("audit[reconcile]: excess is not diagnosed as a shortfall", excess.reason.includes("shortfall"));
  truthy("audit[reconcile]: excess is named as more notes than expected", excess.reason.includes("more"));
  const shortfall = reconcileDiscussionCounts({
    discussions: [{ id: "d1", notes: [{ id: 1, system: false, author: { username: "r" } }] }],
    userNotesCount: 9,
  });
  truthy("audit[reconcile]: a real shortfall still names pagination", shortfall.reason.includes("paginated"));

  // --- discussions: omitting current_user counted every one of your own replies as
  // reviewer feedback with no signal at all, so the count line overstated the feedback
  // on exactly the MRs where you had already replied once per thread.
  const noUser = reconcileDiscussionCounts({
    discussions: [
      {
        id: "d1",
        notes: [
          { id: 1, system: false, author: { username: "me" } },
          { id: 2, system: false, author: { username: "me" } },
        ],
      },
    ],
    userNotesCount: 2,
  });
  truthy(
    "audit[reconcile]: a missing current_user is reported as undetermined",
    (noUser.undetermined ?? []).some((u) => u.startsWith("own-notes")),
  );
  // --- slimThreadsForReport states the resolution rule a second time in discussions.js,
  // which invariant 4 allows only with a test proving the two agree. This is that test:
  // the trimmer's per-thread verdicts must sum to the counter's totals, on a fixture that
  // mixes a system-only thread, a resolved diff thread, an unresolved one, and a general
  // comment that GitLab cannot mark resolvable at all.
  const mixed = [
    { id: "sysonly", notes: [{ id: 1, system: true, author: { username: "bot" } }] },
    {
      id: "done",
      notes: [
        {
          id: 2,
          system: false,
          resolvable: true,
          resolved: true,
          body: "x".repeat(500),
          author: { username: "r" },
          position: { new_path: "a.ts", new_line: 1 },
        },
      ],
    },
    {
      id: "open",
      notes: [
        {
          id: 3,
          system: false,
          resolvable: true,
          resolved: false,
          body: "y".repeat(500),
          author: { username: "r" },
          position: { new_path: "b.ts", new_line: 2 },
        },
      ],
    },
    {
      id: "general",
      notes: [{ id: 4, system: false, resolvable: false, resolved: false, body: "z", author: { username: "r" } }],
    },
  ];
  const mixedCounts = reconcileDiscussionCounts({ discussions: mixed, userNotesCount: 3 });
  const slim = slimThreadsForReport(mixed);
  eq(
    "audit[slim]: resolution agrees with the counter",
    [slim.threads.filter((t) => t.resolved).length, slim.threads.filter((t) => t.resolvable && !t.resolved).length],
    [mixedCounts.resolvedThreads, mixedCounts.unresolvedThreads],
  );
  eq("audit[slim]: emits one thread per feedback thread", slim.threads.length, mixedCounts.feedbackThreads);
  eq("audit[slim]: drops system-only threads and says how many", slim.omitted.systemOnlyThreads, 1);
  eq("audit[slim]: counts the system notes it dropped", slim.omitted.systemNotes, 1);
  // The saving that removes the truncation, and the information that must survive it.
  const resolved = slim.threads.find((t) => t.id === "done");
  const open = slim.threads.find((t) => t.id === "open");
  truthy(
    "audit[slim]: a resolved body is excerpted",
    resolved.notes[0].body.length < 200 && resolved.notes[0].bodyExcerpted === true,
  );
  eq("audit[slim]: an unresolved body is kept whole", open.notes[0].body.length, 500);
  falsy("audit[slim]: and is not marked excerpted", open.notes[0].bodyExcerpted);
  eq("audit[slim]: position is hoisted to the thread", open.position, { new_path: "b.ts", new_line: 2 });
  // A general MR comment is neither resolvable nor resolved, and must still be reported.
  eq(
    "audit[slim]: a general comment survives as unresolvable",
    slim.threads.find((t) => t.id === "general").resolvable,
    false,
  );
  throws("audit[slim]: rejects a non-array", () => slimThreadsForReport(null), "must be an array");

  const withUser = reconcileDiscussionCounts({
    discussions: [{ id: "d1", notes: [{ id: 1, system: false, author: { username: "me" } }] }],
    userNotesCount: 1,
    currentUser: "me",
  });
  eq("audit[reconcile]: supplying it clears the undetermined entry", withUser.undetermined, []);
  eq("audit[reconcile]: and attributes the note correctly", withUser.ownNotes, 1);
}

// ---------- git-context.mjs behaviour ----------

/**
 * The script existed with no behavioural coverage at all: the suite only grepped it
 * for two substrings. Its JSON shape is the entire reason it replaced a shell chain,
 * so `dirty` regressing from boolean to string would have gone unnoticed.
 */
function testGitContextScript() {
  const script = join(ROOT, "skills", "mr-comments", "scripts", "git-context.mjs");

  const run = (args) => {
    try {
      return {
        status: 0,
        stdout: execFileSync(process.execPath, [script, ...args], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
        stderr: "",
      };
    } catch (err) {
      return { status: err.status, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? "") };
    }
  };

  // This repo is a git repo, so the happy path is exercisable without a fixture.
  const ok = run(["--cwd", ROOT, "--log-count", "3"]);
  eq("git-context: exits 0 inside a repo", ok.status, 0);
  let parsed;
  try {
    parsed = JSON.parse(ok.stdout);
  } catch {
    parsed = null;
  }
  truthy("git-context: stdout is a single JSON object", parsed !== null && typeof parsed === "object");
  if (!parsed) return;

  // The whole point of the rewrite: `dirty` is a boolean, so "clean tree" cannot be
  // confused with a mangled shell separator.
  eq("git-context: dirty is a boolean, never a string", typeof parsed.dirty, "boolean");
  truthy("git-context: dirtyFiles is an array", Array.isArray(parsed.dirtyFiles));
  eq("git-context: dirty agrees with dirtyFiles", parsed.dirty, parsed.dirtyFiles.length > 0);
  truthy("git-context: log is an array", Array.isArray(parsed.log));
  truthy("git-context: honours --log-count", parsed.log.length <= 3);
  truthy(
    "git-context: reports the origin remote as a string or null",
    parsed.remote === null || typeof parsed.remote === "string",
  );
  truthy(
    "git-context: reports the branch as a string or null",
    parsed.branch === null || typeof parsed.branch === "string",
  );

  // Outside a repo it must fail loudly rather than return a plausible empty object.
  const outside = run(["--cwd", tmpdir()]);
  eq("git-context: exits non-zero outside a repo", outside.status, 1);
  truthy("git-context: and says why on stderr", outside.stderr.includes("not a git repository"));
}

/**
 * The setup check, and specifically the two bugs it shipped with before it worked.
 *
 * 1. `execFileSync` returns stdout on success and only reveals stderr by throwing, so
 *    `glab auth status` — which writes everything to stderr and exits 0 — came back
 *    empty and the check told an authenticated machine to run `glab auth login`. A
 *    diagnostic that reports a false failure is worse than no diagnostic.
 * 2. Em dashes in the emitted strings rendered as mojibake in the Windows console, on
 *    the very platform most of the first testers are on.
 *
 * It lives at the package root rather than under `skills/mr-comments/scripts/` because a
 * test pins that directory to exactly the two scripts the agent runs mid-workflow, and
 * because this is a setup tool a person runs by hand.
 */
function testPreflight() {
  const path = join(ROOT, "preflight.mjs");
  const src = readFileSync(path, "utf8");

  truthy("preflight: has a shebang so it can be executed directly", src.startsWith("#!/usr/bin/env node"));
  falsy("preflight: imports nothing outside node:", /from\s+["'](?!node:)[^."']/.test(src));

  // Bug 2. Every byte reaches a terminal whose encoding is not ours to choose.
  const nonAscii = src.match(/[^\x00-\x7F]/g) ?? [];
  eq(`preflight: output is pure ASCII (${nonAscii.length} non-ASCII bytes)`, nonAscii.length, 0);

  // Bug 1. `spawnSync` exposes both streams regardless of exit code; `execFileSync` does not.
  truthy("preflight: captures both streams with spawnSync", src.includes("spawnSync(bin, args"));
  falsy("preflight: does not capture command output with execFileSync", /import \{[^}]*execFileSync/.test(src));
  truthy(
    "preflight: records why, so the stderr-only case is not reintroduced",
    src.includes("writing everything to stderr comes back empty"),
  );

  // Same untrusted-search-path discipline as the two scripts. Deliberately NOT asserted
  // as byte-identical to their `resolveBin`: this one must report a bad env pin alongside
  // every other finding instead of exiting on it, which is why it is separate code.
  falsy("preflight: never spawns a bare command name", /(?:execFileSync|spawnSync)\(\s*["'`]/.test(src));
  truthy("preflight: skips non-absolute PATH entries", src.includes("if (!dir || !isAbsolute(dir))"));
  truthy("preflight: applies PATHEXT on Windows", src.includes("PATHEXT"));
  truthy("preflight: explains why it is not a third copy of resolveBin", src.includes("rather than a third copy"));

  // Behavioural, and machine-independent: assert the SHAPE, never that the checks pass.
  // A box without glab must still run this suite green.
  const r = spawnSync(process.execPath, [path, "--json", "--repo", ROOT], { encoding: "utf8", timeout: 120_000 });
  truthy(`preflight: exits 0 or 1, never a crash (got ${r.status})`, r.status === 0 || r.status === 1);

  let report = null;
  try {
    report = JSON.parse(String(r.stdout ?? ""));
  } catch {
    report = null;
  }
  truthy("preflight: --json emits parsable JSON", report !== null);
  if (!report) return;

  eq("preflight: --json carries the documented top-level keys", Object.keys(report).sort(byCodeUnit), [
    "checks",
    "failed",
    "node",
    "platform",
    "redacted",
    "repo",
  ]);
  truthy("preflight: reports at least the required checks", report.checks.length >= 8);
  const STATUSES = new Set(["fail", "info", "ok", "warn"]);
  for (const c of report.checks) {
    truthy(`preflight[${c.name}]: has a group`, typeof c.group === "string" && c.group.length > 0);
    truthy(`preflight[${c.name}]: has a known status`, STATUSES.has(c.status));
    truthy(`preflight[${c.name}]: has a detail string`, typeof c.detail === "string");
  }
  // `failed` drives the exit code, so the two must agree or the exit code is decoration.
  eq(
    "preflight: failed count matches the fail-status checks",
    report.failed,
    report.checks.filter((c) => c.status === "fail").length,
  );
  eq("preflight: exit code follows the failed count", r.status, report.failed === 0 ? 0 : 1);

  // Every check that can fail has to say what the failure costs, or a tester learns
  // nothing they could not have guessed from the name.
  const named = new Set(report.checks.map((c) => c.name));
  for (const required of ["node", "git", "glab", "glab auth", "mr-review-checks", "git-context.mjs", "fetch-mr.mjs"]) {
    truthy(`preflight: checks ${required}`, named.has(required));
  }

  // And it has to be discoverable, or nobody runs it.
  truthy(
    "preflight: the README tells a tester to run it",
    readFileSync(join(ROOT, "README.md"), "utf8").includes("node preflight.mjs"),
  );
}

/**
 * Credential scrubbing and identity redaction, which are two separate layers on purpose.
 *
 * `scrubSecrets` is always on. It exists because three places pass another program's
 * output straight through: a failing `glab` call's stderr, a failing git read's stderr,
 * and `glab auth status` when it finds no login. None of them has leaked anything, since
 * `glab` masks its own tokens, but they are unbounded pass-throughs.
 *
 * The case that made it necessary rather than merely tidy is `git remote get-url origin`.
 * It returns whatever is configured, `https://oauth2:TOKEN@host/group/repo.git` is a form
 * people really use, and that value is printed, fed to the wrong-project check, and
 * captured in the session transcript a tester might attach to a bug report.
 *
 * `--redact` is opt-in and covers identity rather than secrets: home path, GitLab user,
 * GitLab host, repo path, branch name. Debugging your own machine wants the real values.
 */
function testRedaction() {
  const files = [
    ["preflight.mjs", join(ROOT, "preflight.mjs")],
    ["fetch-mr.mjs", join(ROOT, "skills", "mr-comments", "scripts", "fetch-mr.mjs")],
    ["git-context.mjs", join(ROOT, "skills", "mr-comments", "scripts", "git-context.mjs")],
  ].map(([name, path]) => ({ name, text: readFileSync(path, "utf8") }));

  // Invariant 4: three copies are only allowed with a test proving they agree.
  const body = (text) =>
    text
      .slice(
        text.indexOf("function scrubSecrets(text, maxLength = 400) {"),
        text.indexOf("\n  return out;\n}", text.indexOf("function scrubSecrets")),
      )
      .replace(/\s+/g, " ")
      .trim();
  for (const f of files) {
    truthy(`redact[${f.name}]: carries scrubSecrets`, f.text.includes("function scrubSecrets(text, maxLength = 400)"));
    truthy(`redact[${f.name}]: its copy was locatable`, body(f.text).length > 200);
  }
  eq("redact: preflight and fetch-mr copies have not drifted", body(files[0].text), body(files[1].text));
  eq("redact: preflight and git-context copies have not drifted", body(files[0].text), body(files[2].text));

  // The pass-throughs must actually route through it, or the function is decoration.
  truthy(
    "redact[git-context.mjs]: the remote value is scrubbed before it is printed",
    /remote:\s*remote\.ok \? scrubSecrets\(remote\.out\)/.test(files[2].text),
  );
  truthy(
    "redact[git-context.mjs]: every git error field is scrubbed",
    ["remoteError", "branchError", "dirtyError", "logError"].every((f) =>
      new RegExp(String.raw`${f}:[^,]*scrubSecrets\(`).test(files[2].text),
    ),
  );
  truthy(
    "redact[fetch-mr.mjs]: the remote value is scrubbed",
    files[1].text.includes("remote = raw ? scrubSecrets(raw) : undefined"),
  );
  truthy(
    "redact[fetch-mr.mjs]: a failing glab call's stderr is scrubbed",
    /const detail = scrubSecrets\(/.test(files[1].text),
  );
  truthy(
    "redact[preflight.mjs]: every finding is scrubbed at the single choke point",
    /detail: scrubSecrets\(detail\)/.test(files[0].text),
  );

  // --- Behavioural: run the real scrubber over planted credentials.
  const scrub = extractScrubber(files[0].text);
  const cases = [
    ["remote with embedded token", "https://oauth2:glpat-ABCDEFGHIJ1234567890xyz@git.internal/g/r.git", "glpat-"],
    ["bare GitLab PAT", "fatal: auth failed for glpat-ABCDEFGHIJ1234567890xyz", "glpat-ABCDEFGHIJ"],
    ["GitLab deploy token", "using gldt-ABCDEFGHIJ1234567890xyz now", "gldt-ABCDEFGHIJ"],
    ["GitHub token", "token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345", "ghp_ABCDEF"],
    ["Atlassian token", "ATATT3xFfGF0ABCDEFGHIJKLMNOPQRSTUVWXYZ", "ATATT3xFfGF0"],
    ["bearer header", "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123", "abcdefghijklm"],
    ["JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r", "eyJhbGciOi"],
    ["key=value", "GITLAB_TOKEN=supersecretvalue123", "supersecretvalue123"],
  ];
  for (const [label, input, mustNotAppear] of cases) {
    const out = scrub(input);
    falsy(`redact[scrub]: ${label} is removed`, out.includes(mustNotAppear));
    truthy(`redact[scrub]: ${label} leaves a marker`, out.includes("<redacted>"));
  }

  // A git SHA is not a secret and destroying it would cost real diagnostic value.
  const sha = "fde055d3ea1a78320aa927196da841573e6b01c6";
  truthy("redact[scrub]: a 40-char git SHA survives", scrub(`commit ${sha}`).includes(sha));
  // And the host survives the userinfo strip, or the wrong-project check loses its input.
  truthy(
    "redact[scrub]: stripping userinfo keeps the host and path",
    scrub("https://oauth2:glpat-ABCDEFGHIJ1234567890xyz@git.internal/g/r.git").includes("@git.internal/g/r.git"),
  );
  // Unbounded pass-through is the other half of the finding.
  const long = scrub("x".repeat(5000));
  truthy(`redact[scrub]: output is bounded (${long.length} chars)`, long.length < 500);
  truthy("redact[scrub]: and says it truncated", long.includes("(truncated)"));

  // --- Behavioural: --redact must remove identity and keep the diagnostics.
  const run = (args) =>
    spawnSync(process.execPath, [join(ROOT, "preflight.mjs"), ...args], { encoding: "utf8", timeout: 120_000 });
  const plain = run(["--json", "--repo", ROOT]);
  const hidden = run(["--redact", "--json", "--repo", ROOT]);

  const plainReport = JSON.parse(String(plain.stdout));
  const hiddenReport = JSON.parse(String(hidden.stdout));
  eq("redact: the plain report is marked unredacted", plainReport.redacted, false);
  eq("redact: the redacted report says so", hiddenReport.redacted, true);
  eq(
    "redact: --redact does not change any verdict",
    hiddenReport.checks.map((c) => c.status),
    plainReport.checks.map((c) => c.status),
  );
  eq("redact: nor the failed count", hiddenReport.failed, plainReport.failed);

  // The repo path is the one value present on every machine this suite runs on.
  const hiddenText = JSON.stringify(hiddenReport);
  falsy("redact: the repo path is gone from the redacted report", hiddenText.includes(ROOT));
  truthy("redact: replaced by a placeholder", hiddenText.includes("<repo>"));
  // Versions are diagnostics and must survive.
  truthy("redact: the node version still appears", hiddenText.includes(process.version));
}

/**
 * Every function that parses input this project does not control, timed against inputs
 * shaped to make it work hardest.
 *
 * This exists because a linter flagged one regex for possible backtracking and the useful
 * answer turned out not to be the linter's. Measuring the real function against hostile
 * input is direct evidence; a heuristic about pattern shape is not, and it both misses
 * cases and fires on safe ones. So the rule that earned its keep moved in here, where it
 * runs with the rest of the suite, needs no packages and no network, and covers whole
 * parsers rather than individual patterns.
 *
 * What it protects: an MR payload, a discussions response and a `git diff` all arrive from
 * somewhere else, and a run that hangs on one looks exactly like a run that crashed.
 *
 * The budget is deliberately loose. Observed worst case across everything here is a couple
 * of milliseconds, so 250 ms fails on a genuine blowup while staying quiet on a loaded CI
 * box. A tight budget on a fast operation is just a flaky test.
 */
function testInputRobustness() {
  const BUDGET_MS = 250;
  const scrub = extractScrubber(readFileSync(join(ROOT, "preflight.mjs"), "utf8"));

  // --- Hostile shapes, each aimed at a specific parser.
  const bigDiff = [
    "diff --git a/a.ts b/a.ts",
    "@@ -1,1 +1,2 @@",
    "+x",
    // Unterminated hunk headers, quoted paths, and header-shaped content lines together.
    String.raw`diff --git "a/caf\303\251.ts" "b/caf\303\251.ts"`,
    "@@@ -1,5 -1,5 +1,7 @@@ ctx",
    "--- not a header",
    "+++ also not a header",
  ].join("\n");

  const manyThreads = Array.from({ length: 4000 }, (_, i) => ({
    id: `d${i}`,
    notes: [
      {
        id: i,
        system: i % 3 === 0,
        resolvable: true,
        resolved: i % 2 === 0,
        body: "b".repeat(200),
        author: { username: `u${i % 7}` },
      },
    ],
  }));

  const deepGraphql = {
    data: {
      project: {
        mergeRequest: {
          iid: "1",
          title: `fix(${"AB-1 ".repeat(500)}): x`,
          userNotesCount: 1,
          discussions: {
            nodes: Array.from({ length: 2000 }, (_, i) => ({
              id: `gid://gitlab/Discussion/${i}`,
              notes: { nodes: [{ id: `gid://gitlab/Note/${i}`, body: "z".repeat(100), author: { username: "u" } }] },
            })),
          },
        },
      },
    },
  };

  const cases = [
    // The credential scrubber, on inputs built to make each pattern scan far then fail.
    ["scrubSecrets: :// with no @", () => scrub(`https://${"a".repeat(50_000)}`)],
    ["scrubSecrets: gl prefix, no dash", () => scrub(`gl${"abcdefgh".repeat(6_000)}`)],
    ["scrubSecrets: eyJ with no dots", () => scrub(`eyJ${"A".repeat(50_000)}`)],
    ["scrubSecrets: Bearer + long run", () => scrub(`Bearer ${"A".repeat(50_000)}`)],
    ["scrubSecrets: token= + long value", () => scrub(`token=${"v".repeat(50_000)}`)],
    ["scrubSecrets: repeated near-misses", () => scrub("gl-x ".repeat(10_000))],
    ["scrubSecrets: nested :// runs", () => scrub("://a@".repeat(10_000))],

    // Diff parsing, which reads whatever git printed.
    ["parseStagedDiff: adversarial headers", () => parseStagedDiff(bigDiff.repeat(400))],
    [
      "parseStagedDiff: one enormous line",
      () => parseStagedDiff(`diff --git a/a b/a\n@@ -1 +1 @@\n+${"x".repeat(200_000)}`),
    ],
    [
      "attributeStagedHunks: same, with bases",
      () => attributeStagedHunks({ diffText: bigDiff.repeat(400), approvedFiles: ["a.ts"] }),
    ],

    // Payload parsing, which reads whatever the API returned.
    [
      "reconcileDiscussionCounts: 4000 threads",
      () => reconcileDiscussionCounts({ discussions: manyThreads, userNotesCount: 1, currentUser: "u1" }),
    ],
    ["slimThreadsForReport: 4000 threads", () => slimThreadsForReport(manyThreads)],
    ["normalizeGraphqlMr: 2000 discussions", () => normalizeGraphqlMr(deepGraphql)],
    [
      "triageMrPayload: pathological title",
      () =>
        triageMrPayload({
          mr: {
            iid: 1,
            state: "opened",
            user_notes_count: 1,
            title: `fix(${"UTF-8 ".repeat(5_000)}): x`,
            web_url: `https://h/${"g/".repeat(5_000)}r/-/merge_requests/1`,
          },
        }),
    ],

    // String normalisers, which read URLs and titles from the payload.
    ["parseMrTitle: many key candidates", () => parseMrTitle(`fix(${"AB-12 ".repeat(10_000)}): x`)],
    ["normalizeProjectPath: many slashes", () => normalizeProjectPath(`https://h/${"a/".repeat(20_000)}r.git`)],
    ["normalizeProjectPath: many @ signs", () => normalizeProjectPath(`https://${"u:p@".repeat(10_000)}h/g/r.git`)],
    ["normalizeProjectHost: same", () => normalizeProjectHost(`https://${"u:p@".repeat(10_000)}h/g/r.git`)],
    ["stripGid: long gid", () => stripGid(`gid://gitlab/Note/${"1".repeat(50_000)}`)],
  ];

  let worst = 0;
  let worstLabel = "";
  for (const [label, fn] of cases) {
    const started = process.hrtime.bigint();
    try {
      fn();
    } catch {
      // A rejected input is a valid outcome; this measures time, not the verdict. Several
      // of these functions throw on malformed input by design and that is correct.
    }
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (ms > worst) {
      worst = ms;
      worstLabel = label;
    }
    truthy(`robust[${label}]: completes in ${ms.toFixed(1)}ms (budget ${BUDGET_MS}ms)`, ms < BUDGET_MS);
  }
  // Surfaced in passing output so a slow drift is visible before it becomes a failure.
  truthy(`robust: slowest was ${worstLabel} at ${worst.toFixed(1)}ms`, worst < BUDGET_MS);
}

/**
 * Evaluate the shipped `scrubSecrets` rather than a copy of its rules, so this tests the
 * real function. Reading it out of the file is what keeps the drift check above honest:
 * if the source changes, this exercises the change.
 */
function extractScrubber(source) {
  const start = source.indexOf("function scrubSecrets(text, maxLength = 400) {");
  const end = source.indexOf("\n  return out;\n}", start) + "\n  return out;\n}".length;
  // eslint-disable-next-line no-new-func
  return new Function(`${source.slice(start, end)}\nreturn scrubSecrets;`)();
}

// ---------- Runner ----------

const suites = [
  ["audit regressions", testAuditRegressions],
  ["local triage parity", testLocalTriageParity],
  ["executable resolution", testExecutableResolution],
  ["git-context script behaviour", testGitContextScript],
  ["preflight setup check", testPreflight],
  ["credential scrubbing and redaction", testRedaction],
  ["input robustness", testInputRobustness],
  ["workflow policy contracts", testWorkflowPolicyContracts],
  ["progressive disclosure", testProgressiveDisclosure],
  ["self-review template shape", testSelfReviewTemplateShape],
  ["keyword parity", testKeywordParity],
  ["MR payload triage", testMrPayloadTriage],
  ["discussion reconciliation", testDiscussionReconciliation],
  ["staged hunk attribution", testStagedHunkAttribution],
  ["graphql normalization", testGraphqlNormalization],
  ["server transport", testServerTransport],
  ["plugin.json manifest", testPluginManifest],
  ["skill frontmatter", testSkillFrontmatter],
  ["Agent Skills spec conformance", testSkillSpecConformance],
  ["declared files exist", testDeclaredFilesExist],
];

for (const [name, fn] of suites) {
  try {
    fn();
    process.stdout.write(`  ok    ${name}\n`);
  } catch (err) {
    failures.push(`${name}: CRASHED — ${err.message}`);
    process.stdout.write(`  CRASH ${name}: ${err.message}\n`);
  }
}

process.stdout.write(`\n${passed} assertions passed, ${failures.length} failed\n`);
if (failures.length) {
  process.stdout.write("\nFailures:\n");
  for (const f of failures) process.stdout.write(`  - ${f}\n`);
}
process.exit(failures.length > 0 ? 1 : 0);
