#!/usr/bin/env node
/**
 * Structural map of the skill corpus, for planning and checking the router restructure.
 *
 * Prints per-section sizes for SKILL.md and per-file sizes for references/, so a move can be
 * planned against real numbers and verified after. Token counts are an estimate: chars/4.3,
 * calibrated against the tokeniser figures already recorded in dev/TODO.md rather than guessed.
 *
 * Usage:
 *   node dev/measure.mjs              # summary + SKILL.md section table
 *   node dev/measure.mjs --refs       # reference file table only
 *   node dev/measure.mjs --sections   # SKILL.md section table only
 *   node dev/measure.mjs --json       # machine-readable, for diffing across a move
 */

const proc = /** @type {any} */ (globalThis).process;
// @ts-ignore -- no @types/node by design
import { readFileSync, readdirSync } from "node:fs";
// @ts-ignore -- no @types/node by design
import { join, dirname, basename } from "node:path";
// @ts-ignore -- no @types/node by design
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = join(ROOT, "skills", "mr-comments", "SKILL.md");
const REFS = join(ROOT, "skills", "mr-comments", "references");

/** The read-whole limit the suite enforces on every reference. */
const READS_WHOLE = 23000;

/** chars/4.3 — calibrated on this corpus, not a general-purpose ratio. */
const tok = (chars) => Math.round(chars / 4.3);

/**
 * Frontmatter plus everything above the first `##`. Declared before `sections()` rather than
 * after it: the function writes into this object, so a later `const` would only work by call
 * ordering and would break the moment anything called `sections()` earlier.
 */
const preamble = { level: 0, title: "(frontmatter + preamble)", line: 1, chars: 0, lines: 0 };

/**
 * Split markdown into sections at `##`/`###` headings, ignoring `#` inside fenced code.
 * @param {string} text
 * @returns {Array<{ level: number, title: string, line: number, chars: number, lines: number }>}
 */
function sections(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let fenced = false;
  let current = null;

  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;

    const m = fenced ? null : /^(#{2,3})\s+(.*)$/.exec(line);
    if (m) {
      if (current) out.push(current);
      current = { level: m[1].length, title: m[2].trim(), line: i + 1, chars: 0, lines: 0 };
    }

    if (current) {
      current.chars += line.length + 1;
      current.lines += 1;
    } else {
      preamble.chars += line.length + 1;
      preamble.lines += 1;
    }
  });

  if (current) out.push(current);
  return out;
}

const skillText = readFileSync(SKILL, "utf8");
const skillLines = skillText.split(/\r?\n/).length;
const secs = sections(skillText);
const all = [preamble, ...secs];

const refFiles = readdirSync(REFS)
  .filter((f) => f.endsWith(".md"))
  .map((f) => ({ name: f, chars: readFileSync(join(REFS, f), "utf8").length }))
  .sort((a, b) => b.chars - a.chars);

const skillChars = skillText.length;
const refChars = refFiles.reduce((n, r) => n + r.chars, 0);
const residentShare = ((skillChars / (skillChars + refChars)) * 100).toFixed(1);

const args = new Set(proc.argv.slice(2));

if (args.has("--json")) {
  console.log(
    JSON.stringify(
      {
        skill: { chars: skillChars, tokens: tok(skillChars), lines: skillLines },
        references: refFiles.map((r) => ({ ...r, tokens: tok(r.chars) })),
        residentSharePct: Number(residentShare),
        sections: all.map((s) => ({ ...s, tokens: tok(s.chars) })),
      },
      null,
      2,
    ),
  );
  proc.exit(0);
}

const bar = (n, max, width = 24) => "#".repeat(Math.max(1, Math.round((n / max) * width)));

if (!args.has("--refs")) {
  const max = Math.max(...all.map((s) => s.chars));
  console.log(`\nSKILL.md — ${skillChars.toLocaleString()} chars / ~${tok(skillChars).toLocaleString()} tok / ${skillLines} lines\n`);
  console.log("  line  tok    chars  section");
  console.log(`  ----  -----  -----  ${"-".repeat(60)}`);
  for (const s of all) {
    const marker = s.level === 3 ? "  › " : "";
    console.log(
      `  ${String(s.line).padStart(4)}  ${String(tok(s.chars)).padStart(5)}  ${String(s.chars).padStart(5)}  ${marker}${s.title}  ${bar(s.chars, max)}`,
    );
  }
}

if (!args.has("--sections")) {
  const max = Math.max(...refFiles.map((r) => r.chars));
  console.log(`\nreferences/ — ${refFiles.length} files / ${refChars.toLocaleString()} chars / ~${tok(refChars).toLocaleString()} tok\n`);
  console.log("  tok    bytes   over?  file");
  console.log(`  -----  ------  -----  ${"-".repeat(50)}`);
  for (const r of refFiles) {
    const over = r.chars > READS_WHOLE ? " OVER" : r.chars > 20000 ? " near" : "     ";
    console.log(`  ${String(tok(r.chars)).padStart(5)}  ${String(r.chars).padStart(6)} ${over}  ${basename(r.name)}  ${bar(r.chars, max)}`);
  }
}

console.log(`\nresident share: ${residentShare}%  (angular-developer, for reference: 6.6%)\n`);
