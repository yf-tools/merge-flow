# TODO

Developer notes. Lives in `dev/` because it is not part of the tool: the agent never reads
it. It still ships, since the Agent Plugins manifest has no `files` field and forbids
adding one, so an install copies the whole directory.

Every item below carries the measurement or the observation behind it, so none of them has
to be re-derived to be acted on. Where a number is quoted, it was measured rather than
estimated.

Last reviewed: after the `branch-mismatch` triage check. Suite at **970 assertions**, tsc
clean. `SKILL.md` is at 669 lines against a 700-line ratchet, and every reference is inside
the 23,000-byte read-whole limit — `reporting.md` only after a third trim in one session,
which is what turns Pass A in item 3 from tidying into the next thing to do.

---

## 1. One real MR run against the current build

**This is also the baseline the restructure in item 3 depends on.** Without a live run on the
current structure, a regression after the restructure cannot be attributed to it.

**Nothing from the cross-platform, preflight, redaction or `dev/` work has touched a real
merge request.** All of it is verified by the suite and by synthetic input, which is not
the same claim.

Specifically unexercised in a live run:

- The reworded git rule, now that it names no terminal tool
- `preflight.mjs` on any machine other than the one it was written on
- `scrubSecrets` against a real `glab` failure rather than a planted string
- `--redact` output as an actual paste into an actual report
- The closing Jira comment, which has never been posted to a real ticket
- The Step 11 read batch sharing the time question's turn — the exact thing the last live
  run got wrong, and the fix is prose, so only a run can confirm it took

Do this before a tester sees it, not after.

---

## 2. The reporting loop (what the pilot is actually for)

This power got good because roughly twenty real failures became rules, and each one came
from watching a run go wrong. **Testers will not do that.** Preflight covers setup
problems; nothing covers "the report was wrong" or "it skipped a gate", which is where
every existing rule came from.

Two pieces, decided but not built:

### 2a. GitHub issue form

`.github/ISSUE_TEMPLATE/` does not exist yet. The repo is `yf-tools/gitlab-mr-review` and
is **private** (the unauthenticated GitHub API returns 404 for a repo whose `origin/main`
this clone tracks, which for GitHub means private).

The form should ask for what the existing rules were actually made from: which lane, which
step, expected versus observed, whether the run stopped at the report gate, and a preflight
block. It should say explicitly not to paste code or reviewer names.

### 2b. Run-shape summary

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

## 3. Restructure toward a router, in two passes

The reference point is Kiro's own `angular-developer` skill, which uses the shape this
project has been approaching. Measured side by side:

| | angular-developer | this power |
| --- | --- | --- |
| `SKILL.md` | 10,493 chars / **2,457 tok** | 107,056 chars / **25,072 tok** |
| references | 39 files / 148,066 chars | 10 files / 152,278 chars |
| **resident share** | **6.6%** | **41.3%** |
| reference size | 37 of 39 under 8 KB | 3 files over 21 KB |

Comparable total corpus, six times the resident share.

**6.6% is not the target, and the reason is structural.** `angular-developer` is a topic
router: task involves forms, read `forms.md`. No ordering, no gates, nothing stops, and
reading the wrong file costs nothing. This is a state machine with hard stops where skipping
the report gate does damage — which is why the disclosure test exists at all.

**But the gate-bound floor is far lower than 25,072.** The test pins 18 items as
required-resident and they are almost all single headings or one-sentence rules: roughly
**600 tokens of anchors**. Everything else resident today is elaboration wrapped around them.

### Pass A — split the three oversized references by step

Mechanical, low risk, and it fixes a recurring problem rather than only saving tokens.

| Reference | bytes | Steps it currently serves |
| --------- | ----- | ------------------------- |
| `investigating.md` | 22,542 | 1, 2, 3, 4 |
| `reporting.md` | 22,240 | 5, 6b **and** 8 |
| `jira.md` | 20,701 | 3 **and** 11 |

A run at Step 8 reloads Step 5's template; a run at Step 11 reloads Step 3's identity rules.
This is also why the 23,000-byte read-whole limit keeps getting hit — **`reporting.md` hit it
three times in one session**, and the third trim was the marker table's alignment padding,
which is to say the content itself no longer has slack. It serves three steps, so it is the
file to split first. Splitting by step removes the ceiling permanently.

**Round trips do not get worse, provided reads stay batched:** two small files in one turn
costs the same as one big file in one turn. That condition is the thing to keep an eye on —
the batching rule in SKILL.md is what makes the split free rather than expensive.

### Pass B — thin `SKILL.md` toward the floor

Target roughly **8,000–10,000 tokens**, about 16% resident. From 25,072, so ~60%.

Reasoning from the project's own principle (resident = decides whether the run stops), what
has to stay: the four-batch execution plan (~2,316, needed before anything else can be
read), the thirteen rules compressed to one-liners (~800), Step 0b's lane decision (951),
the reference index itself (783), the uncovered-case protocol (622), output discipline
(668), the five invariants (386), the prose rules (400 — needed at Step 5, long before
`publishing.md` loads at Step 9), each gate's headline and stop property (~800), and Step
13's stop list (252).

The large movable pieces are the Quick Reference (4,382 — but see item 4 first, it is a
deliberate fallback), "Mistakes a user can hand you" (1,539 — a catalogue whose entries each
name the step that handles them), the report's *rationale* as distinct from its gate
declaration (1,766), and the per-step bodies beyond their declarations (~6,000).

**Do Pass B after a live run on Pass A, not together.** The failure mode of moving content
out of resident is a rule quietly stopping being followed, and only a live run detects that.
Two passes with a run between them means a regression is attributable.

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

## 6. The lint ladder is prose, and a run skipped rung 1

Recorded in `references/failures.md` as the second finding from MR !510. The run issued
`npx nx lint business-services --max-warnings=0`, it failed, and it was corrected to
`pnpm run lint:business-services`. `package.json` had been read **100 seconds earlier in the
same turn**, so rung 1 — the project-scoped script — was in context and passed over for
rung 2 with a flag appended that the script already carried.

**This is the same shape as the branch fabrication, and it is the reason that one is worth
generalising.** In both cases the rule was already written, the run held the evidence, and
the run did the other thing. Prose lost to recall. The branch case got fixed by moving the
comparison into `triage_mr_payload`, so the answer arrives as a `branch-mismatch` flag the
report reads off rather than a comparison the model is trusted to make.

The equivalent here: have the tool compose the command instead of describing how to choose
it. `git-context.mjs` already detects the lockfile; the `scripts` block is a Step 1 artifact
(`investigating.md` lists both). A `lint_command` field carrying the resolved rung — script
name, run prefix, and the flags the script already has — turns four rungs of prose into one
string to run.

**Do not build this before item 1's live run.** One observation is not yet a pattern, the
branch fix is unproven in a real run, and the rung order may hold fine on a repo whose
scripts are conventional. Note it, watch for a second instance.

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
- **Shrinking `SKILL.md` by deleting the Quick Reference, or by stripping the run
  citations.** Both were checked and both failed. The Quick Reference is not duplicated text
  (item 4). The 15% of the file that cites specific runs (15,969 characters over 28 lines)
  has the evidence welded into each rule one clause at a time, so cutting it means rewriting
  the rules. Note this does **not** close relocating step-local detail — the conflict lane
  was exactly that and it landed (see Done), it just returned half what was projected. The
  earlier compression pass already landed too: `investigating.md` went 33,475 →
  22,542, the references were extracted, `failures.md` was separated.
- **Relocating step-local detail one section at a time, as a way to shrink `SKILL.md`.**
  This is the narrow version, and it is closed: of ~4,100 tokens of step-local detail, only
  the conflict lane's share saved a review-lane run anything, and **that one returned 441
  tokens against a 1,125 estimate** (see Done) because half of it was gate declaration that
  must stay. The rest sits in steps nearly every run reaches, so moving it shifts the same
  cost from activation to the step.

  **This does not close the restructure — item 3 supersedes it, and the reason the earlier
  conclusion was too pessimistic is worth keeping.** That reasoning worked section by
  section, asking "does moving this one save a run anything." Measuring against
  `angular-developer` reframed it: the resident share is 41.3% against their 6.6%, and the
  disclosure test's genuinely gate-bound floor is only ~600 tokens of anchors. The win is
  structural rather than the sum of individual moves. Both lessons still hold, though —
  estimates here have run about 2× optimistic, and a rule reachable only through a reference
  does get skipped.

---

## Done

- **Commit.** Pushed as `d3d471e` and `3d78129`. Verified: local `HEAD` matches
  `origin/main` at `3d78129`, `git log --follow` traces `dev/test.mjs` through its full
  history rather than seeing a delete plus an add, `node dev/test.mjs` reports 918 passing
  from that commit.
- **Closing Jira comment.** One flat comment on the ticket in Step 11's write batch, saying
  what was addressed, carrying the MR link. Authorized by Step 8's existing Jira block
  rather than a new gate, so "leave Jira alone" declines it too. Claims only what Step 10's
  ledger observed remotely, never the report's intentions. Jira's API has no
  parent-comment field, so it cannot thread under a reviewer's comment and says so.
- **Jira read deduplication.** The same `getJiraIssue` + `getTransitionsForJiraIssue` pair
  was prescribed three times per run — Step 3, Step 8, Step 11 — six calls for two facts.
  Step 8 now calls transitions only: Step 6 already confirmed the status with evidence from
  this run, and Step 11 re-reads before writing anyway. Six reads became five.
- **Conflict-lane detail moved to `conflicts.md`.** The plan-gate template, the strategy
  wording and the two cheaper-path procedures left `SKILL.md`; the heading, the "replaces
  Step 5 / same hard stop" declaration and the two rules worth naming stayed, because the
  disclosure finding is that a gate reachable only through a reference goes unread. Turned
  out to be a dedup as well: three rules ("Beyond a mechanical pick", "never start the merge
  before this gate closes", the dirty-tree one) were already in `conflicts.md` verbatim.
  **Estimated 1,125 tokens, delivered 441** — 670 lines from 699. The estimate treated both
  sections as fully relocatable when roughly half was gate declaration that has to stay
  resident. Worth remembering before trusting the same arithmetic on the Quick Reference.
- **The Step 11 round trip.** `"Re-read the ticket immediately before any automated write"`
  was read by a live run as "after they reply", since the write does follow the answer. It
  asked the time question with nothing read behind it, spent a turn on the two reads, a
  message on _"Confirmed still In Progress"_, then a third turn on the writes. The rule now
  says the reads share the question's turn and that nothing is said between them; the
  wasted round trip was the smaller symptom, since the question also could not quote the
  `timetracking` figures it is required to quote. Five assertions pin it, verified by
  sabotage rather than by assuming they run.
- **`branch-mismatch`, from the MR !510 transcript.** The Step 5 report said
  `` `fix/BIDAYA-2315` — already checked out`` while `git-context.mjs` had returned
  `"branch": "fix/BIDAYA-2084"` in the same turn. Because the closing list then contained no
  checkout, it was executed faithfully: **nine grep and read calls went out against the wrong
  branch** before `git branch --show-current` ran, and five of those reads had to be redone
  after the checkout landed. The template's third variant already covered this, so a sixth
  prose rule would have been the fourth copy of one that had just lost. The comparison moved
  into the tool instead — `triage_mr_payload` and `triage_graphql_mr` now accept
  `current_branch` and emit a `branch-mismatch` **flag, not a blocker**, since starting on the
  wrong branch is normal and only *claiming* otherwise is the fault. An absent or empty branch
  reports `undetermined`, never "already checked out". Five files: `mr-payload.js` (the check
  and `facts.currentBranch`), `fetch-mr.mjs` (`localContext` now returns the branch),
  `server.js` (both schemas, both handlers), `reporting.md` (the row and closing item 1 read
  off `triage.flags`), `failures.md` (the run). Four cases verified against the built server:
  mismatch, match, omitted, empty — and `proceed` stays `true` in all four.
- **`reporting.md` back under the byte limit.** 23,233 → **22,240**, cut from the marker
  table's column-alignment padding rather than from content, since no formatter in this repo
  enforces it. The widest cell was shortened too, so a stray reformat re-pads to a narrower
  width than before. Fixing this also surfaced a stale assertion: the suite pinned
  `**that one call, not a re-read as well.**` with the period inside the bold, which the
  sentence cannot carry because it continues with a comma. The prose was right, the assertion
  was wrong, and it had been failing quietly behind the byte-limit failure.
