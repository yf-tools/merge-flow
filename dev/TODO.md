# TODO

Developer notes. Lives in `dev/` because it is not part of the tool: the agent never reads
it. It still ships, since the Agent Plugins manifest has no `files` field and forbids
adding one, so an install copies the whole directory.

Every item below carries the measurement or the observation behind it, so none of them has
to be re-derived to be acted on. Where a number is quoted, it was measured rather than
estimated.

Last reviewed: after the cross-platform, preflight and redaction work. Suite at **918
assertions**, tsc clean, power ships as **42 files / ~3 MB**.

---

## 1. Commit (blocking everything else)

Six modified files, `test.mjs` showing as deleted from its old path, and an untracked
`dev/` holding 178 KB. All of it uncommitted.

This is first because the work is already done and only the record is missing, and because
this project has lost an edit to an accidental revert before. Nothing else on this list is
worth starting while a day of work sits unstaged.

Note when staging: `test.mjs` → `dev/test.mjs` was done with `git mv`, so it should land as
a rename rather than a delete plus an add.

---

## 2. One real MR run against the current build

**Nothing from the cross-platform, preflight, redaction or `dev/` work has touched a real
merge request.** All of it is verified by the suite and by synthetic input, which is not
the same claim.

Specifically unexercised in a live run:

- The reworded git rule, now that it names no terminal tool
- `preflight.mjs` on any machine other than the one it was written on
- `scrubSecrets` against a real `glab` failure rather than a planted string
- `--redact` output as an actual paste into an actual report

Do this before a tester sees it, not after.

---

## 3. The reporting loop (what the pilot is actually for)

This power got good because roughly twenty real failures became rules, and each one came
from watching a run go wrong. **Testers will not do that.** Preflight covers setup
problems; nothing covers "the report was wrong" or "it skipped a gate", which is where
every existing rule came from.

Two pieces, decided but not built:

### 3a. GitHub issue form

`.github/ISSUE_TEMPLATE/` does not exist yet. The repo is `yf-tools/gitlab-mr-review` and
is **private** (the unauthenticated GitHub API returns 404 for a repo whose `origin/main`
this clone tracks, which for GitHub means private).

The form should ask for what the existing rules were actually made from: which lane, which
step, expected versus observed, whether the run stopped at the report gate, and a preflight
block. It should say explicitly not to paste code or reviewer names.

### 3b. Run-shape summary

A script that reads a Kiro session folder (`sess_<uuid>/` with `messages.jsonl` and
`session.json`, which appears in the workspace root during a session) and emits only the
*shape* of the run: step order, timings, gates hit or skipped, tool-call count, which
references were read. No code, no comments, no names.

**Why shape and not a transcript.** Every rule in `references/failures.md` was derived from
shape, never from content: the report arriving at 3m48s instead of turn two, the checkout
landing before the gate, five `update_session_information` calls burning 38 seconds, ten
calls chasing one symbol through four tools, `investigating.md` coming back truncated. A
raw transcript contains full code diffs, and the company policy answer on that is already
**no**. Shape sidesteps the question instead of managing it.

Build it format-agnostically. That transcript layout is undocumented and can change, so
scrub and summarise structurally rather than parsing a schema that is not promised.

Optional follow-up, only if shape turns out to be insufficient: a redacted full transcript
behind an explicit flag, with the tester deciding case by case.

---

## 4. Pin the Quick Reference to its prose

`## Quick Reference` in `SKILL.md` is **4,331 tokens, 17.18% of the file**, and only **2 of
its 40 rows** are pinned by any test assertion.

It is not a copy of the prose above it, which was measured: 38 of 40 rows sit under 20%
shingle overlap and none reaches 50%. It is a *paraphrase*, which is worse for drift than a
copy would be. The table and the prose can come to disagree about what a step requires and
nothing would catch it. That is invariant 4's failure mode, at the largest scale in the
project.

The suite already does this kind of check for POWER.md against `plugin.json` keywords, and
for the three `scrubSecrets` copies. The table never got it.

**Do not simply delete the table.** The redundancy is deliberate: the report skeleton was
put there precisely because a run skipped `reporting.md` and improvised. The question worth
answering is which rows are load-bearing fallbacks and which are a second copy.

---

## 5. Smaller, genuinely optional

- **Version skew.** `plugin.json` and `SKILL.md` say `1.5.0`; `server/package.json` says
  `1.0.0`. Harmless until a tester reports "server 1.0.0" and it costs a confused
  exchange. A test already asserts `serverInfo.version` matches `server/package.json`, so
  whichever way this is resolved, resolve it there.
- **No mechanical gate enforcement.** `plugin.json` declares no hooks, so every gate in the
  workflow depends on the model reading prose and choosing to stop. A `PreToolUse` hook is
  the escalation if a gate keeps getting skipped in practice. Prose has been enough so far;
  do not build this speculatively.
- **`testWorkflowPolicyContracts` is at cognitive complexity 32** against the advisory 15
  in `dev/eslint.config.mjs`. Splitting it further is cosmetic. It is only worth noting
  because it is the reason that lint rule cannot be an error.

---

## Settled, so it does not get re-litigated

Each of these was investigated and closed. The reasoning is here so the idea does not come
back around as if it were new.

- **Symbol or emoji compression of repeated phrases.** Measured ceiling **1.01%** (29
  repeated phrases, 76 occurrences past the first, best case with two-character ASCII
  symbols). With emoji it is **zero or negative**: `never use that` is 3 tokens and `🔴` is
  also 3, while `Fix` is 1 token and `✅` is 2. BPE already compresses common English.
  Worse, a legend adds indirection distance, and attention rather than window space is the
  binding constraint here.
- **Gitignoring `dev/test.mjs` to keep GitHub clean.** Strictly worse. The file vanishes
  from the repo, so no tester can run the 918 assertions, while it still sits in your own
  install because that copy comes from your local directory. `.gitignore` controls the
  repo, not what a user receives, and what a user receives is not adjustable at all.
- **Making SonarJS a commit gate.** It is already overridden (see item 5), it returned empty
  output four or five times in one session with one 300-second run killed, and what it
  caught was advisory while the bugs that shipped were caught by the suite. It stays an
  occasional audit. When a rule earns its keep, move it into the suite as
  `testInputRobustness` did.
- **Shrinking `SKILL.md`.** Both candidates were checked and both failed. The Quick
  Reference is not duplicated text (item 4). The 15% of the file that cites specific runs
  (15,969 characters over 28 lines) has the evidence welded into each rule one clause at a
  time, so cutting it means rewriting the rules. The compression pass already happened:
  `investigating.md` went 33,475 → 22,542, the references were extracted, `failures.md` was
  separated. What is left is load-bearing.
