# TODO

Developer notes. Lives in `dev/` because it is not part of the tool: the agent never reads
it. It still ships, since the Agent Plugins manifest has no `files` field and forbids
adding one, so an install copies the whole directory.

Every item below carries the measurement or the observation behind it, so none of them has
to be re-derived to be acted on. Where a number is quoted, it was measured rather than
estimated.

Last reviewed: three moves into the router restructure (item 3). Suite at **978 assertions**,
tsc clean. `SKILL.md` is **84,914 chars / ~19,747 tok / 636 lines**, down from 24,897 tok at
the start of the session, and the resident share is **33.8%** against 41.3%. Every reference
is inside the 23,000-byte read-whole limit.

`node dev/measure.mjs` prints the per-section and per-file map these numbers come from. Use
it before and after every move rather than estimating; `--json` diffs cleanly across one.

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
_shape_ of the run: step order, timings, gates hit or skipped, tool-call count, which
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

|                    | angular-developer            | this power                     |
| ------------------ | ---------------------------- | ------------------------------ |
| `SKILL.md`         | 10,493 chars / **2,457 tok** | 107,056 chars / **25,072 tok** |
| references         | 39 files / 148,066 chars     | 10 files / 152,278 chars       |
| **resident share** | **6.6%**                     | **41.3%**                      |
| reference size     | 37 of 39 under 8 KB          | 3 files over 21 KB             |

Comparable total corpus, six times the resident share.

**6.6% is not the target, and the reason is structural.** `angular-developer` is a topic
router: task involves forms, read `forms.md`. No ordering, no gates, nothing stops, and
reading the wrong file costs nothing. This is a state machine with hard stops where skipping
the report gate does damage — which is why the disclosure test exists at all.

**But the gate-bound floor is far lower than 25,072.** The test pins 18 items as
required-resident and they are almost all single headings or one-sentence rules: roughly
**600 tokens of anchors**. Everything else resident today is elaboration wrapped around them.

### The governing rule, established by three moves that worked

**Resident keeps the verdict. References keep the reasoning.**

This is the conflict-lane lesson generalised, and it is the only rule needed to decide any
individual move. A hard stop's _existence_ stays resident always, because the disclosure
finding is that a rule reachable only through a reference gets skipped. Its template, its
rationale and its worked examples go to a file.

**Two things make this far safer than it looked, both discovered by reading the suite:**

1. **`assertCorpusPhrases` checks SKILL.md _and_ its references together.** Its own comment
   says it exists so moving prose into a reference doesn't drop its assertion. So the large
   majority of assertions do not resist a move at all.
2. **22 strings are pinned to `skill` alone** — the invariants, the thirteen rules, the
   uncovered-case protocol, Step 0b, every `(BLOCKING)` headline, the batch plan, the prose
   rules, Step 13. That list _is_ the must-stay-resident boundary, already written down.

**The procedure that made each move evidence-driven rather than a judgement call:** splice the
content out, run the suite, and let the failures name what was uniquely there. It worked three
times out of three. On the Quick Reference it surfaced 3 rows carrying something not written
elsewhere; on the batch plan it caught 4 places where my paraphrase had drifted from a pinned
sentence. **Every failure gets re-pointed at the surviving text, never deleted** — deleting is
how a restructure silently removes the thing that catches a skipped gate.

### Pass A — DONE, and it was two splits rather than three

**The original plan here was wrong about which files needed splitting.** The test is not size, it
is whether a file's sections are read in *different batches*. Measured per-section:

| Reference | was | split? | why |
| --- | --- | --- | --- |
| `reporting.md` | 22,002 | **yes → 3** | Step 5 (batch 1), 6b (after batch 4), 8 (Step 7's batch) |
| `jira.md` | 20,569 | **yes → 2** | Step 3 (batch 1) and Step 11 (the last thing the run does) |
| `investigating.md` | 22,368 | **no** | Steps 1–4 are *all* batch 1 — splitting turns one read into four in the same turn, which is strictly worse |
| `fixing.md` | 21,256 | **no** | almost entirely Step 7 already |

Ten references became fifteen, and **both ceiling-hitters are gone**: `reporting.md` 22,002 →
12,221, `jira.md` 20,569 → 12,529. New files are `scope-gate.md` (3,271), `summary-gate.md`
(7,626) and `jira-identity.md` (8,568).

**`jira.md` kept its name and Step 11 kept the file.** Its header already said "Step 11 in full"
and nearly every `jira.includes(...)` assertion targeted Step 11 content, so Step 3 moved out
instead — and that split needed **zero** assertion changes. Splitting the other way round would
have needed seven. Check which direction is cheaper before splitting anything else.

**One duplicated rule vanished for free.** `reporting.md`'s header restated the blank-line
formatting rule, which is already resident in SKILL.md's "Formatting every report to the user" as
rule 1. Splitting would have copied it into three files, so it was deleted and each new file
points at the resident version instead.

**Round trips did not get worse**, because two small files in one turn cost the same as one big
file in one turn. That is the condition to keep watching, and it is why every new file's header
states which batch it belongs to.

### A routing bug Pass A surfaced, now fixed

The per-section map showed **`fixing.md` holding the Step 6 Jira transition procedure**, under an
umbrella heading, while the index row for `checkout.md` claimed that content. `checkout.md` did
not contain `transitionJiraIssue` at all.

So a run at Step 6 read `checkout.md` in batch 3 and would not find the procedure. It appeared
only later in `fixing.md`, which is read at Step 7 — *after* the transition should already have
happened. The index row was not merely stale, it was false, and the sequence was unrunnable as
written. Moved into `checkout.md` between the checkout and the per-thread reads, which is the
order Step 6 actually runs in: check out, move the board, then read the code.

**This is the argument for per-step files beyond token count.** A big topic file hides a misfiled
procedure; a per-step layout makes "why is Step 6 content in Step 7's file" visible on a section
map. **Nothing in the 990-assertion suite caught it**, because every phrase involved is pinned
corpus-wide and all of them were present — just in the wrong file.

### `assertStepOwnership` — the blind spot, now closed

That gap is a class of bug, not one instance, so it got a guard rather than a note.
`assertStepOwnership` holds one distinctive procedure marker per step-owning reference and
asserts it is **present in that file and absent from every other**. The uniqueness half is the
part that catches misfiling: a marker in two references means either a duplicated procedure
(invariant 4) or one copy in the wrong place, and both need a human look.

**Verified by sabotage in both directions, not by assuming it runs.** Re-adding the Step 6
transition heading to `fixing.md` fires *"no other reference carries checkout.md's procedure"*;
renaming it out of `checkout.md` fires *"checkout.md still holds the procedure its index row
promises"*. Both restored, suite green at 1,024.

It also asserts every reference is either step-owning or one of four declared cross-cutting files
(`failures.md`, `batching.md`, `user-mistakes.md`, `glab-tooling.md`), so a new reference that is
neither has to be classified deliberately rather than drifting in unowned.

**Two cheaper approaches were tried first and both failed on false positives.** Comparing step
numbers in a file's headings against the steps its index row names flags `failures.md` (*"The Step
11 re-read skipped because no transition was needed"* — an evidence entry, not a procedure) and
`jira-identity.md` (*"Why the transition question defers to Step 6"* — Step 3 explaining a
deferral). Heading text cannot distinguish *mentions* step N from *is* step N's procedure. A
hand-picked marker per file can, and costs one line each.

**Known limit:** the marker table is hand-maintained, so it catches a procedure that moved and a
procedure that got duplicated, but not a step whose procedure was never written down anywhere.

**Remaining `near` files, all legitimately single-purpose:** `investigating.md` 22,368 (632 bytes
of headroom, now the tightest thing in the repo), `failures.md` 20,466, `fixing.md` 19,974.

### Pass B — thin `SKILL.md` toward the floor

Target roughly **8,000–10,000 tokens**, about 16% resident. From 24,897, so ~60%.

**Three moves are done, worth 5,150 tokens (21%):**

| Section                      | before | after     | went to                                                          |
| ---------------------------- | ------ | --------- | ---------------------------------------------------------------- |
| Quick Reference              | 4,390  | **719**   | deleted as invariant-4 duplication; 4 unique rows kept           |
| Four batches                 | 2,300  | **1,606** | `references/batching.md`                                         |
| Mistakes a user can hand you | 1,529  | **689**   | `references/user-mistakes.md`                                    |
| Step 9 — Commit and Push     | 747    | **550**   | option template → `publishing.md`; two paragraphs were duplicate |
| Step 11 — time question      | 706    | **~500**  | four paragraphs deleted, all already in `jira.md`                |

**A pattern worth naming, since it held on four of five moves.** The biggest wins came from
looking for the same rule stated twice, not from relocating unique prose. Quick Reference, Step 9
and Step 11 were all mostly duplication of something already resident or already in the reference
a run reads at that step. Check for a second copy before planning a move: deleting is cheaper than
relocating and carries no reachability risk.

**Step 9's move also fixed a contradiction.** The resident three-option template was rendered
*inside a blockquote*, immediately after the instruction saying never to use a blockquote because
it collapses the options into one unreadable line. `publishing.md` carried the same prohibition.
An agent copying the shape would have broken the rule it was illustrating. The template now sits
in `publishing.md` as a ```text fence, matching every other template in the corpus.

The Quick Reference is the one to understand before doing more. It was not a cheat sheet to
relocate — it was the whole workflow written a second time, which is invariant 4 at the largest
scale in the project (item 4 said exactly this). So 36 of 40 rows were **deleted**, not moved: a
second paraphrase of resident prose is the drift risk, not a safety net. What stayed is only
what is written nowhere else — the report skeleton (which labels itself "if you somehow have
only this row", and is the fallback item 4 was protecting), the stop list, and the two `Never`
aggregations that collect rules spread across a dozen steps. **Item 4 is now closed by this.**

**What's left, and why the easy wins are gone.** The two biggest remaining sections resist:
`One report, then the work` (1,753) is almost entirely pinned rule sentences, so only ~440
tokens of it are movable and not worth the risk; `The thirteen rules` (1,300) is the gate list
itself. The remaining bulk is the long tail — roughly fourteen per-step sections averaging ~400
tokens, about 5,600 total. That is Pass A's real payoff: per-step reference files give each of
those bodies somewhere precise to go, leaving a heading, a gate declaration and a pointer.

So the order inverts from what this file originally said: **Pass A is no longer optional
plumbing, it is the prerequisite for the rest of Pass B.**

Reasoning from the project's own principle (resident = decides whether the run stops), what
has to stay: the four-batch execution plan (~2,316, needed before anything else can be
read), the thirteen rules compressed to one-liners (~800), Step 0b's lane decision (951),
the reference index itself (783), the uncovered-case protocol (622), output discipline
(668), the five invariants (386), the prose rules (400 — needed at Step 5, long before
`publishing.md` loads at Step 9), each gate's headline and stop property (~800), and Step
13's stop list (252).

Of the pieces originally listed as movable, three are done (see the table above) and the
estimates held up well: Quick Reference 4,382 estimated / 3,671 delivered, Mistakes 1,539 /
840, batch plan 2,300 / 694. **The remaining one is the big one: the per-step bodies beyond
their declarations, ~5,600 across roughly fourteen sections.** The report's _rationale_ was
also on that list at 1,766, but reading it closely showed only ~440 tokens of it are anything
other than pinned rule sentences, so it is not worth the risk of touching.

**Do Pass B after a live run on Pass A, not together.** The failure mode of moving content
out of resident is a rule quietly stopping being followed, and only a live run detects that.
Two passes with a run between them means a regression is attributable.

---

## ~~4. Pin the Quick Reference to its prose~~ — CLOSED, see Pass B in item 3

Kept for the reasoning, since the conclusion inverted. The plan was to pin the table's 40 rows
to their prose so the two couldn't drift. The measurement that motivated it — 38 of 40 rows
under 20% shingle overlap with the prose, only 2 rows test-pinned — turned out to be the
argument for **deleting** the rows rather than pinning them: a paraphrase you have to keep in
sync with its original is a maintenance cost that buys nothing the original doesn't already
give. Pinning 40 rows would have locked in the duplication and made every future edit touch two
places. The four rows that survived are the ones with no original to drift from.

The concern behind the item was real and is still honoured: the report skeleton stayed resident,
because that is the row a run actually fell back on.

<details>
<summary>Original item, for the record</summary>

`## Quick Reference` in `SKILL.md` was **4,331 tokens, 17.18% of the file**, and only **2 of
its 40 rows** were pinned by any test assertion.

It was not a copy of the prose above it, which was measured: 38 of 40 rows sat under 20%
shingle overlap and none reached 50%. It was a _paraphrase_, which is worse for drift than a
copy would be. The table and the prose could come to disagree about what a step requires and
nothing would catch it. That is invariant 4's failure mode, at the largest scale in the project.

The suite already does this kind of check for POWER.md against `plugin.json` keywords, and for
the three `scrubSecrets` copies. The table never got it.

**Do not simply delete the table.** The redundancy is deliberate: the report skeleton was put
there precisely because a run skipped `reporting.md` and improvised. The question worth
answering is which rows are load-bearing fallbacks and which are a second copy.

</details>

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
- **Stripping the run citations to shrink `SKILL.md`.** Still closed. The 15% of the file that
  cites specific runs (15,969 characters over 28 lines) has the evidence welded into each rule
  one clause at a time, so cutting it means rewriting the rules. The earlier compression pass
  already landed too: `investigating.md` went 33,475 → 22,542, the references were extracted,
  `failures.md` was separated. Note this does **not** close relocating step-local detail — the
  conflict lane was exactly that and it landed (see Done).
- **~~Deleting the Quick Reference to shrink `SKILL.md`.~~ This entry was wrong, and it was
  acted on and reversed — see Pass B in item 3.** It was closed on the grounds that the table
  "is not duplicated text," which conflated _not a verbatim copy_ with _not duplication_. It was
  a paraphrase of the whole workflow, and being a paraphrase makes it **worse** for drift than a
  copy: nothing can assert two paraphrases agree. 36 of 40 rows were deleted, the suite named the
  3 rows that held anything unique, and resident dropped 3,671 tokens.

  **The lesson worth keeping is about the test that closed it.** "Is this a copy?" was the wrong
  question and the shingle-overlap measurement answered it faithfully. The right question is
  "does this row have an original elsewhere?" — and if it does, the row is a liability whatever
  its overlap score. Watch for the same error in the other direction before trusting any future
  settled entry that rests on a similarity metric.
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
  resident. That caution turned out not to generalise: the three router moves came in at 84%,
  55% and 30% of estimate rather than 39%, because deleting duplication is predictable in a way
  that relocating gate-adjacent prose is not.
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
  wrong branch is normal and only _claiming_ otherwise is the fault. An absent or empty branch
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
- **Router restructure, first three moves.** 24,897 → **19,747 tok**, 41.3% → **33.8%** resident,
  670 → 636 lines, suite 970 → **978**. The rule that governs it and the evidence-driven
  procedure behind it are in item 3; the per-move table is in Pass B. Two new references, both
  under 8 KB and so inside the profile `angular-developer` keeps: `user-mistakes.md` (7,488) and
  `batching.md` (6,585). **Item 4 closed as a by-product** — its own measurement turned out to
  argue for deleting the duplication rather than pinning it.
- **`dev/measure.mjs`.** Prints the per-section map of `SKILL.md` and the per-file map of
  `references/`, with token estimates at chars/4.3 calibrated against the tokeniser figures
  already in this file. `--json` for diffing across a move, `--refs`/`--sections` to narrow.
  Written because the first two moves were planned against estimates and the estimates were
  wrong in both directions; every number quoted above came out of this instead.
- **A line ratchet measures the wrong thing during this work.** Converting the mistakes section
  from bullets to a table _added_ 5 lines while removing 840 tokens, which took `SKILL.md` to 675
  against the `< 700` ratchet with the restructure barely started. Pulling the Quick Reference
  then returned 35 lines, so it self-resolved and the ratchet stayed untouched. **If it binds
  again, the fix is a character ratchet set just above the achieved size and tightened per move,
  not a raised line limit** — characters are what actually cost context, and the ratchet's stated
  intent is to block regrowth, which a char limit does more honestly here.
- **Pass A, the per-step reference split.** Detail in item 3. Ten references became fifteen, both
  byte-ceiling files dropped to about 12 KB, and the split surfaced a routing bug that had made
  the Step 6 Jira transition unreachable at Step 6. Suite 978 → **990**, all four splits verified
  green with no rule lost. Resident share unchanged at 33.8%, which is expected: Pass A moves
  content between references and buys correctness plus headroom, not resident tokens. It is the
  prerequisite for the rest of Pass B, where the per-step bodies finally have somewhere to go.
- **`assertStepOwnership`.** Closes the blind spot Pass A exposed: corpus-wide pinning proves a
  rule exists, never that it is reachable at its step. One marker per step-owning reference,
  asserted present in its own file and absent from every other. Sabotage-verified in both
  directions. Detail and the two rejected approaches are in item 3. Suite 990 → **1,024**.
- **Step 9 and Step 11's time question thinned.** 747 → 550 and 706 → ~500, almost entirely by
  deleting paragraphs that already existed in `publishing.md` and `jira.md`. Step 9's move also
  removed a template rendered in a blockquote directly beneath the rule forbidding blockquotes.
