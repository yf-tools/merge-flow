# Steps 5, 6b and 8 in full — the blocking report templates

Read this in batch 1, with the fetch — Step 5's report is only two turns away, so a separate turn spent reading it is a round trip wasted on a local file. Step 8's half is needed much later but costs nothing to carry. SKILL.md keeps what each gate blocks on and what a bare approval covers; the exact shapes are here.

**One formatting rule governs both, and breaking it makes either report unreadable:** every field sits in its own paragraph with a blank line on both sides. Without that blank line CommonMark treats an indented line under a numbered item as a "lazy continuation" of the same paragraph, and every renderer reflows the number, `file:line`, quote and action into one dense wrapped block. Don't drop the blank lines to save space — a long report with breathing room beats a short one that reads as a single paragraph.

## Step 5 — the report

This is the run's **only** pre-work output and its only pre-work gate. Everything the user needs in order to say yes goes in here: what the MR is, what the reviewers said, where the ticket stands, and what a go-ahead will actually do. It is written before any project file has been opened, and that constraint shapes every part of it.

**Three zones, in this order:** the header and orientation rows, one numbered item per unresolved thread, then the closing "say go and I'll" list with a single question.

**Resolved threads never become items.** A thread GitLab has already marked resolved needs nothing from the user; rendering nine of them as nine cards is what made one real report bury its single actionable comment under settled ones, and the reader had to scroll past all nine to find the thing addressed to them. They are a count on the header line and nothing else. **And the line says they weren't re-checked, because they weren't** — you have not read the code at this point, so "I confirmed each fix is present" would be a fabrication.

**No item claims anything about the code.** Each one restates what the reviewer asked for, in the reviewer's words, and stops. **There is no "Proposed action" row in this template**, deliberately: a proposed diff is a claim about a file you have not opened, and on the page it is indistinguishable from a verified one. Step 6 reads the code; Step 7 proposes and applies.

```text
### MR !{iid} — {title}

**{needsYou} of {feedbackThreads} thread(s) need your call.** {rolledUp} more {is / are} already resolved on GitLab — I haven't re-checked those against the code, say the word if you want that. {— drop this second sentence entirely when {rolledUp} is 0, rather than writing "0 more"}

{countLine, verbatim from the counts tool} · {X} unresolved / {Y} resolved on GitLab

- **State:** {state}, {mergeable / cannot merge — from detailed_merge_status} · **Target:** `{target_branch}`
- **Ticket:** `{TICKET-KEY}` — **{exact current status}** · **Branch:** `{source_branch}` {— already checked out / — I'd switch from `{current branch}`}
- **Blockers:** {one line per blocker message} — or `none`
- **Flags:** {one line per non-blocking flag} — omit the row entirely when there are none

---

**1. ✅ Fix** · `{file}:{line}` · {🔴 blocker / 🟡 warning / 🔵 suggestion, as the reviewer framed it}

Reviewer ({author}): "{trimmed comment}"

→ **What they're asking for:** {one sentence, read off the comment}

---

**2. 💬 Question** · `{file}:{line}` · {severity}

Reviewer ({author}): "{trimmed comment}"

→ **What I need from you:** {the question, one sentence}

---

**3. ⚠️ Disagree** · _(general MR comment)_

Reviewer ({author}): "{trimmed comment}"

→ **Where I'd push back:** {one sentence}

---

**Say go and I'll:**

1. {Stay on `{source_branch}` — already checked out / Switch from `{current branch}` to `{source_branch}`}
2. Move `{TICKET-KEY}` from **{current status}** to **{exact active status}** — omit this line entirely when the ticket is already active
3. Read the file(s) those {needsYou} thread(s) point at, then apply the ✅ / 🔵 items one at a time
4. Stop again before anything is committed, pushed or replied to

Go ahead? {Say so if you'd rather leave Jira in **{current status}**, or if any classification above is wrong.}
```

**The `Ticket` row carries the status even when nothing needs moving.** It is one word, the user is deciding whether to hand over the next twenty minutes, and by this point you have actually read it. What stays out is a _separate_ mention — no "already In Progress ✓" status line, no follow-up sentence about it.

**Use the tool's `countLine` verbatim rather than typing that shape.** The `reconciles ✓` ending is only one of three it produces; the others are `MISMATCH vs user_notes_count {n}` and `not reconciled — no user_notes_count supplied`. Re-typing it from an example hardcodes the good outcome, which is exactly the case where the line carries no information — the two bad endings are the ones the user needs to see.

### The closing list is the gate, and its order is load-bearing

**One question, not two.** The Jira move is item 2 in that list, never a separate `Move it to In Progress? (yes / leave it)` further down. A user who answers "go ahead" to a list containing it has approved it; one who says "go ahead, leave Jira alone" has declined it. Asking twice spends a turn on a decision already made, and it is the specific thing that made the old two-message flow feel like an interrogation.

**Items 1 and 2 come before item 3 because that is the real order.** The ticket says work has started at the moment work starts, not after the diff is written. Rendering the list in execution order is what makes that visible and checkable, and it is the whole reason the list is numbered rather than bulleted.

**Item 4 is not optional.** It is the promise that this approval doesn't reach the remote, and it is what makes a broad go-ahead safe to give.

### The empty case

**Every feedback thread is already resolved** (`needsYou == 0`): drop the numbered items entirely — no empty heading, no "none" — and replace the header line and the closing list, because there is no code work to approve.

> **Nothing here is unresolved.** All {feedbackThreads} thread(s) are already resolved on GitLab. I haven't checked whether each fix is actually still in the code.
>
> Want me to verify them against the current code, or leave this alone?

That is a real offer rather than a formality: a thread resolved before a rebase can lose its fix silently, and this is the one moment someone might want it checked.

**A resolved thread may be promoted into the report** when its last note is an unanswered question aimed at the author — that's a live item, not a settled one. Render it as a 💬 Question, say in the item that GitLab already has it resolved, and drop `{rolledUp}` by one so the arithmetic below still holds.

### The fixed marker set

These and no others. Emoji earn their place by sorting a long list at a glance; every additional one makes the list harder to scan, which defeats the reason for having any.

| Marker | Means                                                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅     | Fix, an edit this run will make                                                                                                                |
| 🔵     | Nitpick, a trivial edit this run will make                                                                                                     |
| 💬     | Question, waiting on the user                                                                                                                  |
| ⚠️     | Disagree, pushing back                                                                                                                         |
| ✔️     | a fix that turned out to be in the code already. **A Step 6b finding and a Step 10 reply, never a Step 5 item** — it takes a file read to know |
| 🔴 🟡  | the reviewer's own severity, echoed as they framed it                                                                                          |
| 🛑     | a hard stop                                                                                                                                    |

Never decorate a heading that already reads clearly, and never put a marker on the orientation rows, the count lines, the closing list, or the closing question. Those are read in sequence rather than scanned, so a marker there is noise.

### The header's arithmetic

**Two lines, because they measure different things** (Step 2). Every number comes from `reconcile_discussion_counts`, using its field names verbatim.

**Line 1 splits the threads by what you need from the user.** `{needsYou}` counts the rendered items — the ✅ Fix, 🔵 Nitpick, 💬 Question and ⚠️ Disagree ones; `{rolledUp}` is what the resolved count reports, normally just `resolvedThreads`. **`{needsYou} + {rolledUp}` must equal `feedbackThreads`.** That equality is the only thing in the report proving every thread was accounted for rather than quietly dropped, so check it before sending. It is also the number the user reads first: "1 of 10 need your call" tells them how much of their attention this costs, which is what they actually want to know.

**Line 2 carries the fetch evidence and GitLab's resolve state.** The tool's `countLine` verbatim, then the resolve split appended: `{X}` is `unresolvedThreads` and `{Y}` is `resolvedThreads`. **`countLine` supplies the notes count and the reconciliation verdict, not the split** — appending it is why the line is written as two pieces rather than retyped as one.

**Those two sum to `resolvableThreads`, not `feedbackThreads`** — and the gap is real, not rounding. GitLab only makes _diff_ threads resolvable, so a general MR-level comment is a thread you must triage that can never be resolved or unresolved. On an MR with one of those, `unresolved + resolved` is one short of `feedbackThreads`, and that is correct. So the arithmetic to verify is `{X} + {Y} == resolvableThreads`, and when that's below `feedbackThreads`, name the reason where the split appears:

> 12 reviewer comment(s) across 19 notes — matches user_notes_count (19) ✓ · 1 unresolved / 6 resolved on GitLab, plus 1 general comment GitLab can't mark resolvable

**Resolve state and `{needsYou}` are not quite the same split, and the report should not imply they are.** `{needsYou}` is normally every unresolved thread plus every general MR comment — but a resolved thread holding an unanswered question gets promoted into the items, and then the two splits differ by one. Line 1 is your classification; line 2 is GitLab's bookkeeping. When they disagree, the item's own entry says why.

**`threadsTotal` does not appear in this header at all**, and the difference between it and `feedbackThreads` is not worth a parenthetical either. Nobody needs to be told how many "requested review from @x" entries GitLab returned; mentioning them only invites the reader to check arithmetic against a number that isn't in the report.

Never check either thread count against `{expectedNotes}` — that counts notes, not threads. The `user_notes_count` tick belongs on the second line only, and only when `reconciles` was actually `true`. Verify all of this before sending: a header whose own numbers don't add up destroys confidence in every classification under it.

A thread with no `position` (Step 2) is a general MR-level comment — use `_(general MR comment)_` in place of `` `{file}:{line}` `` for that item, and in Step 10's reply preview too.

### The Jira line inside the closing list

Item 2 of **Say go and I'll** is the only place Jira appears as a decision. Three variants, all from what Step 3 recorded:

- **Ticket already in active development** → omit the item entirely and renumber. No line, no tick, no "already In Progress ✓" — the status is already on the **Ticket** row, and a check that passed is not news twice.
- **Transition available** → the item as written, naming the exact current status and the exact target.
- **No active transition reachable** → the item becomes a choice rather than an action, and the closing question picks it up:

  > 1. Leave `{TICKET-KEY}` in **{current status}** — no transition from here reaches an active-development status. Reachable targets are {exact `to.name` list}, so tell me if you want one of those or you'd rather move it manually.

**A go-ahead that doesn't mention Jira approves item 2 along with the rest** — that's what putting it in the list means, and it is the difference between this and the two-question flow it replaced. What still needs an explicit answer is the _third_ variant, because it offers a choice rather than stating an action: if the reply doesn't address it, leave the ticket alone and say once that you did.

## Step 6b — when the picture changes

Two things arrive here, and neither passed through Step 5's report.

**An answered 💬 Question or ⚠️ Disagree** is new scope arriving mid-run. The answer resolves the _question_; it does not approve an _implementation_. This is the most common way a well-gated run turns into an ungated one: the user supplies a decision, you see the fix clearly, and you start editing — the plan and the first `str_replace` land seconds apart, with no turn boundary in between for the user to disagree.

**Or Step 6's file reads contradicted the report.** The report was written without opening a file, so some of it will not survive contact with the code: the fix is already there, the referenced line is gone, the reviewer's premise doesn't hold, two approved items collide, or verification hit the two-read cap. **Approved work that turns out not to exist is news, not a quiet no-op** — say so rather than dropping the item, and offer a thread reply in its place.

Route either back through a gate whose weight matches the change:

- **Confined to a line or two, no new file, no new dependency, no architectural choice** → treat it as an approved Fix and continue. Say in one line what you're about to change so it appears before the edit rather than after.
- **Anything larger — a new file, a new service or module, a new injection, a change in which layer owns the logic, or a fix that touches files no reviewer commented on** → 🛑 present it and wait:

  ```text
  ### {New scope from your answer / What the code says} — thread {N}

  {Your answer: "{what they told you}" / What the report said: "{the item as approved}" · What's actually there: {what you found}}

  → **What it implies:** {the change, one or two sentences}

  → **Files:** {new files marked (new)}; {existing files touched}

  → **Design choice, if any:** {the decision and the alternative you rejected, one line each}

  Go ahead with this? (yes / adjust / just reply to the thread without a code change)
  ```

**Presenting a plan is not a gate unless you stop after it.** A plan followed immediately by an edit in the same turn is narration. The turn must end on the question.

The third option matters and is easy to forget: sometimes the right response to an answered question is a thread reply and no code at all. Offer it explicitly rather than assuming every answer implies an implementation. Once the user approves, the item is a Fix for every later step — it counts in the Step 8 summary and is eligible for Step 12 lesson capture exactly as if it had been labelled ✅ from the start.

## Step 8 — the final summary

Before presenting the gate, re-read the verified Jira ticket from Step 3. With Atlassian tools, call `getTransitionsForJiraIssue`; in manual mode, ask the user to confirm the exact currently reachable review target. Identify the review status by exact name (`To Review`, `In Review`, `Review`, or the project's verified equivalent), never by status category. If no direct review transition exists, say that now and render the explicit leave-unchanged/manual form rather than inventing or promising a transition Step 11 cannot perform.

### Preconditions — do not render this gate without them

This summary is the document the user approves. Every number in it must come from a command whose output you have actually seen in this run. Before writing a single line of it, confirm all five:

1. `git diff --cached` has been run **after** the last staging and formatting operation, and its output is in front of you.
2. `git diff --cached --numstat` supplied every `+X / -Y` below. None are recalled or estimated.
3. Every hunk in that diff is attributed to an approved review comment, a formatter that reported changing that file, or an approved conflict resolution. Unattributed hunks were raised with the user and settled.
4. The self-review pass ran against that same diff.
5. If discovery in the self-review pass named a specific project resource, its offer belongs inside this card as an open bullet, not pre-resolved by you before the card exists.

**If any of these is missing, you are not at Step 8 yet — go back and do it.** Presenting the gate first and verifying afterwards inverts the whole point: the user's "yes" then applies to a description rather than to the change. Precondition 5 in particular means you never ask the checklist question as its own message and then treat it as settled — the checklist offer and the rest of this card are one gate, asked together.

### The template

```text
### Summary — ready to commit

**Fixed (N)**
- `{file}:{line}` — {what changed, one line}
- `{file}:{line}` — {what changed, one line}

**Staged — verified via `git diff --cached`**
- `{file}` ({+X / -Y})
- `{file}` ({+X / -Y})

**Deliberately unstaged**
- `{file}` — {why excluded}

**Still needs your input**
- `{file}:{line}` — {question or disagreement, one line}

**Skipped**
- `{file}:{line}` — {what, and why, one line}

**Self-review**
- Generic diff scan: {clean / caught {what}, fixed}
- Hunk attribution: {all {n} hunks trace to approved comments or the formatter / {n} unattributed — raised above}
- {Found `{path}` — its description says {what it's for}. Run it against these changes before committing? / Looked in {where you looked} — nothing describing itself as a review or pre-push check. Is there one I should know about for next time?}

**Validation evidence**
- Diagnostics/type check: {tool/command + result / unavailable + why}
- Targeted tests: {command + result / not applicable + why}
- Lint: {command + result}
- Smoke test: {result / not applicable}
- Build: {result / deferred to CI / covered by the pre-push hook — not duplicated here}

**Jira after replies**
- Ticket: `{TICKET-KEY}` — currently **{current status}**
- If a direct review transition exists:
  - Proposed: transition to **{exact review status}** after the push and approved thread replies/resolutions
  - Approve that Jira transition? (yes / leave unchanged)
- If no direct review transition exists:
  - Proposed: leave Jira unchanged in **{current status}**; no direct review transition is available
  - Confirm leave unchanged/manual? (yes / stop and inspect the available transitions)

---

**Commit message:** `{type}({TICKET-KEY}): address MR review comments`

Ready to commit and push? (yes / let me review first / adjust message)
```

Omit any section that's empty (no skipped items → drop that heading entirely, don't write "none") — **except Staged, Self-review, and Jira after replies, which always appear**. Staged proves you read the real diff; Self-review proves review happened; Jira proves ticket status was checked and makes the final shared-state decision explicit. Dropping any of the three makes the gate unfalsifiable — a summary that omits Self-review reads exactly like one where the pass came back clean.

**The Jira block is a question, not a status line.** Render one of the two branches verbatim, including its `?`. Writing _"currently TO REVIEW — no transition needed"_ and moving on is not this section; it is the section replaced by a conclusion. If Step 3 found no reachable active-development transition and the user chose to leave the ticket alone, say that and name it as their recorded choice — _"leaving Jira in **{status}** per your call at the start of the run; confirm that still holds?"_ — so Step 11 inherits a decision with a person attached to it.

**Jira approval is independent from commit approval and time logging.** If the reply doesn't clearly cover the proposed review transition, ask before Step 9 rather than inferring it. "Ready to commit" authorizes only commit and push. Retain the explicit Jira answer for Step 11 — do not ask again there unless the ticket's status or reachable transitions changed.

**Do not ask for time spent at this gate.** The worklog question belongs at the very end of Step 11. Asking here makes the user estimate work that hasn't finished yet. If they volunteer a duration anyway, treat it as a note to confirm in Step 11 — never as the logged value.

**If the Self-review section offered a discovered resource, treat the user's answer to it as part of this gate.** "Yes, run it" means run it against `git diff --cached`; if it changes anything, loop through definitive validation, stage by name, run the formatter, re-stage, show the new cached diff/evidence, and re-present this summary before committing. A plain "yes" to the commit question with no mention of the checklist means they're fine proceeding without it; don't re-ask.

### The commit message

Match the convention you saw in `git log` (Step 1), with the type and ticket key from Step 2. If the log history is inconsistent or you can't confidently read a convention from it, fall through in this order before asking:

1. Look at the commits made by the same author on this branch — the repo may be inconsistent while this contributor is not.
2. If that's still unclear, look at the **MR title itself** from Step 2. It's a commit-shaped string the reviewer already accepted, so mirroring its type and scope is the safest inference.
3. Still nothing → ask the user once. Never invent a convention.
