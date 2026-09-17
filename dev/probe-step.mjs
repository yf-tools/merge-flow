#!/usr/bin/env node
/**
 * For each resident step section, split it into sentences and report which ones already exist
 * in the reference that step hands off to.
 *
 * Built because shingle-overlap scores misled three separate decisions during the router
 * restructure: they measure phrasing, so two files saying the same thing in different words
 * score low. This probes for the *rule* instead, sentence by sentence, using a distinctive
 * word window from each sentence rather than the whole sentence.
 *
 * A sentence reported as "in reference" is deletable from SKILL.md. A "resident only" sentence
 * is either a gate that must stay, or content that has to be moved before the resident copy
 * goes — and moving is where the risk is, so those get read individually.
 *
 * Usage:
 *   node dev/probe-step.mjs            # every step
 *   node dev/probe-step.mjs "Step 0b"  # one step, showing full sentences
 */

const proc = /** @type {any} */ (globalThis).process;
// @ts-ignore -- no @types/node by design
import { readFileSync } from "node:fs";
// @ts-ignore -- no @types/node by design
import { join, dirname } from "node:path";
// @ts-ignore -- no @types/node by design
import { fileURLToPath } from "node:url";

const SK = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "mr-comments");
const skill = readFileSync(join(SK, "SKILL.md"), "utf8");
const ref = (n) => readFileSync(join(SK, "references", n), "utf8");

/** Resident step heading → the reference it hands off to. */
const STEPS = [
  ["## Step 0 — Parse the MR URL", "investigating.md"],
  ["## Step 0b — Decide what the run is for, then pick the lane", "conflicts.md"],
  ["## Steps 1-4 — Investigate, without touching the working tree", "investigating.md"],
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

const norm = (t) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Does any 7-word window of `sentence` appear in `haystack`? */
function echoedIn(sentence, haystackWords) {
  const w = norm(sentence);
  if (w.length < 7) return null; // too short to judge
  for (let i = 0; i + 7 <= w.length; i++) {
    if (haystackWords.includes(w.slice(i, i + 7).join(" "))) return true;
  }
  return false;
}

const only = proc.argv[2];
const tok = (n) => Math.round(n / 4.3);

for (let i = 0; i < STEPS.length; i++) {
  const [heading, refName] = STEPS[i];
  if (only && !heading.includes(only)) continue;

  const start = skill.indexOf(heading);
  if (start < 0) {
    console.log(`!! not found: ${heading}`);
    continue;
  }
  const next = i + 1 < STEPS.length ? STEPS[i + 1][0] : END;
  const stop = skill.indexOf(next, start + heading.length);
  const body = skill.slice(start, stop < 0 ? undefined : stop);

  const label = /Steps? \d+b?/.exec(heading)?.[0] ?? heading;
  if (!refName) {
    console.log(`\n=== ${label}  ${tok(body.length)} tok  (no reference)`);
    continue;
  }

  const hay = norm(ref(refName)).join(" ");
  // Sentence-ish split that keeps list items and bold leads intact.
  const sentences = body
    .split(/\n{2,}|(?<=\.)\s+(?=[A-Z*`])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40 && !s.startsWith("#") && !s.startsWith("```"));

  const echoed = [];
  const residentOnly = [];
  for (const s of sentences) {
    const r = echoedIn(s, hay);
    if (r === true) echoed.push(s);
    else if (r === false) residentOnly.push(s);
  }

  console.log(`\n=== ${label}  ${tok(body.length)} tok  → ${refName}`);
  console.log(`    ${echoed.length} of ${echoed.length + residentOnly.length} passages already in the reference (deletable)`);
  for (const s of residentOnly) {
    console.log(only ? `\n  RESIDENT ONLY: ${s}` : `  · ${s.replace(/\s+/g, " ").slice(0, 96)}`);
  }
}
