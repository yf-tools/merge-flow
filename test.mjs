#!/usr/bin/env node
/**
 * Manifest and skill-frontmatter regression test for gitlab-mr-review.
 *
 * This power ships no server, so there's no scanner logic to test — but the
 * plugin.json manifest and the skill's YAML frontmatter can still drift and
 * silently break distribution, the same failure mode jira-ticket-workflow's
 * suite guards against. Kept as its own file rather than importing from the
 * sibling power, since a standalone power should be verifiable standalone.
 *
 * Zero dependencies — Node built-ins only.
 *
 * Run: node test.mjs
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

let passed = 0;
const failures = [];

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

// ---------- Agent Plugins 1.0.0 manifest constraints ----------
// Transcribed from https://agent-plugins.org/schemas/1.0.0/plugin.schema.json
// rather than fetched, so this test works offline and in CI.

const AGENT_PLUGINS_VERSION = "1.0.0";
const PLUGIN_SCHEMA_URL = `https://agent-plugins.org/schemas/${AGENT_PLUGINS_VERSION}/plugin.schema.json`;
const PLUGIN_REQUIRED = ["$schema", "name"];
const PLUGIN_ALLOWED = [
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
];

function testPluginManifest() {
  const path = join(ROOT, "plugin.json");
  if (!existsSync(path)) {
    failures.push("plugin.json: file missing");
    return;
  }
  const json = JSON.parse(readFileSync(path, "utf8"));
  const keys = Object.keys(json);

  const illegal = keys.filter((k) => !PLUGIN_ALLOWED.includes(k));
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
      desc.length <= SKILL_DESCRIPTION_MAX
    );
    truthy(
      `${label}: description states when to use it`,
      /\b(use when|activate|use before|use this)\b/i.test(desc)
    );
  }
}

/** Every path a caller might expect (README, POWER.md links) must resolve. */
function testDeclaredFilesExist() {
  for (const f of ["LICENSE", "README.md", "POWER.md", "plugin.json"]) {
    truthy(`layout: ${f} exists at package root`, existsSync(join(ROOT, f)));
  }
  truthy(
    "layout: skills/mr-comments/SKILL.md exists",
    existsSync(join(ROOT, "skills", "mr-comments", "SKILL.md"))
  );
}

function testWorkflowPolicyContracts() {
  const skill = readFileSync(join(ROOT, "skills", "mr-comments", "SKILL.md"), "utf8");
  const power = readFileSync(join(ROOT, "POWER.md"), "utf8");
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");

  for (const phrase of [
    "git merge --ff-only",
    "Definitive validation and staging",
    "loops back through this entire phase",
    "git diff --cached",
    "Do not stage or format here",
    "fetch and show ahead/behind state",
    "preserving any Jira browse-link hostname",
    "Verify the chosen `cloudId` + key",
    "Never write or disclose it",
    "Optional Follow-Up: Capture Recurring Lessons",
    "append-only provenance",
    "Never replace or drop earlier sources",
  ]) truthy(`workflow: contains ${phrase}`, skill.includes(phrase));

  for (const [label, text, forbidden] of [
    ["workflow", skill, "Pushed with `--no-verify`"],
    ["workflow", skill, "pre-push lint/build skipped, relying on CI"],
    ["workflow", skill, "pull or rebase first"],
    ["workflow", skill, "keeps this workflow at six gates"],
    ["power", power, "including a bare '#note_' link"],
  ]) truthy(`${label}: excludes stale policy ${forbidden}`, !text.includes(forbidden));

  truthy("power: activation requires a full MR URL", power.includes("full GitLab merge request URL"));
  truthy("README: usage requires a full MR URL", readme.includes("Paste a full GitLab merge request URL"));
  truthy("README: no-verify stays private", readme.includes("private execution detail"));

  const validation = skill.indexOf("### Definitive validation and staging");
  const selfReview = skill.indexOf("### Self-review pass");
  const approval = skill.indexOf("## Step 8 — Present the Final Summary");
  const commit = skill.indexOf("## Step 9 — Commit and Push");
  truthy(
    "workflow: validate/stage before self-review, approval, and commit",
    validation >= 0 && validation < selfReview && selfReview < approval && approval < commit
  );

  const checkoutFetch = skill.indexOf("git fetch origin {source_branch}");
  const checkoutCreate = skill.indexOf("git checkout -b {source_branch} origin/{source_branch}");
  truthy("workflow: fetches before creating tracking branch", checkoutFetch >= 0 && checkoutFetch < checkoutCreate);

  const identity = skill.indexOf("Before writing any worklog, reconcile ticket identity");
  const worklog = skill.indexOf("`addWorklogToJiraIssue` with that verified");
  truthy("workflow: reconciles and verifies identity before worklog", identity >= 0 && identity < worklog);
}

// ---------- Runner ----------

const suites = [
  ["workflow policy contracts", testWorkflowPolicyContracts],
  ["plugin.json manifest", testPluginManifest],
  ["skill frontmatter", testSkillFrontmatter],
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
