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
import { join, dirname } from "node:path";
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
  for (const f of ["LICENSE", "README.md", "POWER.md", "plugin.json"]) {
    truthy(`layout: ${f} exists at package root`, existsSync(join(ROOT, f)));
  }
  truthy("layout: skills/mr-comments/SKILL.md exists", existsSync(join(ROOT, "skills", "mr-comments", "SKILL.md")));
}

function testWorkflowPolicyContracts() {
  const skill = readFileSync(join(ROOT, "skills", "mr-comments", "SKILL.md"), "utf8");
  const power = readFileSync(join(ROOT, "POWER.md"), "utf8");
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const plugin = readFileSync(join(ROOT, "plugin.json"), "utf8");
  const powerFlat = power.replace(/\s+/g, " ");

  for (const phrase of [
    "Internal discovery is not a user-facing report",
    "Steps 0–5 are investigation. Run them quietly",
    "Which power or skill you activated",
    "Checks that passed — host is GitLab, tree is clean",
    "A different current branch than `source_branch` is normal, not an alarm",
    "Output discipline",
    "Step 2.5 — Verify the Jira Ticket (silent; no writes, no gate)",
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
    "Call `transitionJiraIssue` with the exact transition recorded in Step 2.5",
    "confirm the resulting `status.name` is exactly the approved target",
    "Jira approval is independent from commit approval and time logging",
    "If no direct review transition exists:",
    "Confirm leave unchanged/manual?",
    "Recover safely from partial publication",
    "never repost an approved reply already present",
    "Resume Step 11 only after every approved action is observed remotely",
    "Step 11 — Return Jira to Review and Log Time",
    "Publication success is a hard precondition for review status",
    "failed push, failed approved reply, or failed approved resolution leaves Jira in active development",
    "closing time-log question below still runs",
    "Do not ask for time spent at this gate",
    "### Ask for time spent last, then log it",
    "**This is the final question in the workflow.**",
    "How much time should I log against it?",
    "**Never infer the duration**",
    "Ask even when earlier stages failed",
    "Time log (last)",
    "Call `getJiraIssue` again immediately before automated writes",
    "exact review target approved in Step 8",
    "worklog and status transition are independent approvals",
    "never suppress the worklog because status synchronization could not complete",
    "Definitive validation and staging",
    "loops back through this entire phase",
    "Do not stage or format here",
    "fetch and show ahead/behind state",
    "Never write or disclose it",
    "Optional Follow-Up: Capture Recurring Lessons",
    "append-only provenance",
    "Never replace or drop earlier sources",
  ])
    truthy(`workflow: contains ${phrase}`, skill.includes(phrase));

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
  ])
    truthy(`${label}: excludes stale policy ${forbidden}`, !text.includes(forbidden));

  truthy("plugin: Jira lifecycle release is 1.3.0", plugin.includes('"version": "1.3.0"'));
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

  const outputDiscipline = skill.indexOf("## Internal discovery is not a user-facing report");
  const formatting = skill.indexOf("## Formatting every report to the user");
  const parseUrl = skill.indexOf("## Step 0 — Parse the MR URL");
  truthy(
    "workflow: output discipline precedes formatting rules and the first step",
    outputDiscipline >= 0 && outputDiscipline < formatting && formatting < parseUrl,
  );

  const mrDetails = skill.indexOf("## Step 2 — Fetch MR Details");
  const jiraStart = skill.indexOf("## Step 2.5 — Verify the Jira Ticket");
  const checkout = skill.indexOf("## Step 3 — Check Out the Right Branch");
  truthy(
    "workflow: MR evidence then Jira verification before checkout",
    mrDetails >= 0 && mrDetails < jiraStart && jiraStart < checkout,
  );

  // The active-development transition itself is deliberately deferred past checkout
  // (it's applied in Step 7, after Step 6 approval) — only identity/terminal-status
  // verification is gated before checkout. Assert that deferral is real, not that the
  // transition happens early.
  const applyTransition = skill.indexOf("### First: apply the Jira transition, if it was approved");
  const step7 = skill.indexOf("## Step 7 — Fix One Comment at a Time");
  truthy(
    "workflow: active-development transition is applied in Step 7, after checkout and approval",
    applyTransition > checkout && applyTransition > step7,
  );

  const noKeyStop = skill.indexOf("**No key**", jiraStart);
  const manualToolStop = skill.indexOf("If Atlassian tools are unavailable, ask once", jiraStart);
  truthy(
    "workflow: missing Jira identity and unavailable tooling fail closed before checkout",
    noKeyStop > jiraStart && noKeyStop < checkout && manualToolStop > jiraStart && manualToolStop < checkout,
  );

  const validation = skill.indexOf("### Definitive validation and staging");
  const selfReview = skill.indexOf("### Self-review pass");
  const approval = skill.indexOf("## Step 8 — Present the Final Summary");
  const commit = skill.indexOf("## Step 9 — Commit and Push");
  const replies = skill.indexOf("## Step 10 — Reply Inline and Resolve Each Thread");
  const jiraFinish = skill.indexOf("## Step 11 — Return Jira to Review and Log Time");
  truthy(
    "workflow: validate, approve, commit, reply, then synchronize Jira",
    validation >= 0 &&
      validation < selfReview &&
      selfReview < approval &&
      approval < commit &&
      commit < replies &&
      replies < jiraFinish,
  );

  const noDirectReview = skill.indexOf("If no direct review transition exists:", approval);
  const leaveManual = skill.indexOf("Confirm leave unchanged/manual?", noDirectReview);
  const jiraApproval = skill.indexOf("Jira approval is independent from commit approval and time logging", approval);
  truthy(
    "workflow: Step 8 renders and gates both reachable and unreachable Jira review outcomes before commit",
    noDirectReview > approval && noDirectReview < leaveManual && leaveManual < jiraApproval && jiraApproval < commit,
  );

  const publicationRecovery = skill.indexOf("### Recover safely from partial publication", replies);
  const remoteCompletion = skill.indexOf(
    "Resume Step 11 only after every approved action is observed remotely",
    publicationRecovery,
  );
  truthy(
    "workflow: partial publication is reconciled idempotently before Jira synchronization",
    publicationRecovery > replies && publicationRecovery < remoteCompletion && remoteCompletion < jiraFinish,
  );

  const publicationGate = skill.indexOf("### Publication success is a hard precondition for review status", jiraFinish);
  const finalReread = skill.indexOf("Call `getJiraIssue` again immediately before automated writes", jiraFinish);
  const finalTransition = skill.indexOf("Call `transitionJiraIssue`, then re-read the issue", jiraFinish);
  truthy(
    "workflow: publication success and Jira re-read precede final transition",
    publicationGate > jiraFinish && publicationGate < finalReread && finalReread < finalTransition,
  );

  const noEarlyTimeAsk = skill.indexOf("Do not ask for time spent at this gate", approval);
  const timeAsk = skill.indexOf("### Ask for time spent last, then log it", jiraFinish);
  const timeQuestion = skill.indexOf("How much time should I log against it?", timeAsk);
  const lessons = skill.indexOf("## Step 12 — Optional Follow-Up: Capture Recurring Lessons");
  truthy("workflow: time is not requested at the commit gate", noEarlyTimeAsk > approval && noEarlyTimeAsk < commit);
  truthy(
    "workflow: time is requested last, after publication and the review transition",
    timeAsk > finalTransition && timeAsk < timeQuestion && timeQuestion < lessons,
  );

  const checkoutFetch = skill.indexOf("git fetch origin {source_branch}");
  const checkoutCreate = skill.indexOf("git checkout -b {source_branch} origin/{source_branch}");
  truthy("workflow: fetches before creating tracking branch", checkoutFetch >= 0 && checkoutFetch < checkoutCreate);
}

/**
 * Regression test for the fabrication-shape bug: a discovered self-review
 * checklist reported as a completed result ("no BEM violations", "checked
 * against X") instead of the open question the template requires. This
 * doesn't prove the agent won't fabricate at runtime — prose can't guarantee
 * that — but it does mechanically catch someone editing the *template itself*
 * back into a non-question, completed-result shape without noticing.
 */
function testSelfReviewTemplateShape() {
  const skill = readFileSync(join(ROOT, "skills", "mr-comments", "SKILL.md"), "utf8");

  const bulletMarker = "{Found `{path}`";
  const bulletStart = skill.indexOf(bulletMarker);
  truthy("self-review template: Self-review bullet placeholder is present", bulletStart >= 0);
  if (bulletStart < 0) return;

  // Pull just that one bulleted line out of the template block.
  const lineEnd = skill.indexOf("\n", bulletStart);
  const bullet = skill.slice(bulletStart, lineEnd);

  truthy("self-review template: bullet offers both a found-resource and a nothing-found branch", bullet.includes(" / "));

  const [foundBranch, nothingBranch] = bullet.split(" / ");
  truthy("self-review template: found-resource branch ends in a question mark", /\?\}?\s*$/.test(foundBranch.trim()));
  truthy("self-review template: nothing-found branch ends in a question mark", /\?\}?\s*$/.test(nothingBranch.trim()));

  // The template placeholder must never itself read like a completed result —
  // that's the exact shape of the observed fabrication ("no BEM violations",
  // "checked against X, no issues found") that skipped the open question.
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

// ---------- Runner ----------

const suites = [
  ["workflow policy contracts", testWorkflowPolicyContracts],
  ["self-review template shape", testSelfReviewTemplateShape],
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
