# Step 5's report — the shape, the arithmetic, and the closing gate

Read this in batch 1, with the fetch. Step 5's report is only two turns away, so a separate turn spent reading it is a round trip wasted on a local file. SKILL.md keeps what the gate blocks on and what a bare approval covers; the exact shape is here.

**Layout rules live in SKILL.md**, under "Formatting every report to the user".

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
- **Ticket:** `{TICKET-KEY}` — **{exact current status}** · **Branch:** `{source_branch}` {— already checked out / — I'd switch from `{current branch}` / — I can't tell what's checked out}
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

**The `Branch` row and closing item 1 come from `triage.flags`, never from your own comparison.** A `branch-mismatch` flag means "I'd switch from `{current}`"; its absence with nothing in `undetermined` means "already checked out"; `branch` in `undetermined` means you cannot tell, so say that. **"Already checked out" is an invariant-1 claim that has been fabricated against evidence the run held**, costing nine reads on the wrong branch because a closing list with no checkout in it was executed faithfully.

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

| Marker | Means |
| --- | --- |
| ✅ | Fix, an edit this run will make |
| 🔵 | Nitpick, a trivial edit this run will make |
| 💬 | Question, waiting on the user |
| ⚠️ | Disagree, pushing back |
| ✔️ | a fix already in the code. **A Step 6b finding or Step 10 reply, never a Step 5 item** — it takes a file read to know |
| 🔴 🟡 | the reviewer's own severity, echoed as they framed it |
| 🛑 | a hard stop |

Never decorate a heading that already reads clearly, and never put a marker on the orientation rows, the count lines, the closing list, or the closing question. Those are read in sequence rather than scanned, so a marker there is noise.

### The header's arithmetic

**Two lines, because they measure different things** (Step 2). Every number comes from `reconcile_discussion_counts`, using its field names verbatim.

**Line 1 splits the threads by what you need from the user.** `{needsYou}` counts the rendered items — the ✅ Fix, 🔵 Nitpick, 💬 Question and ⚠️ Disagree ones; `{rolledUp}` is what the resolved count reports, normally just `resolvedThreads`. **`{needsYou} + {rolledUp}` must equal `feedbackThreads`.** That equality is the only thing in the report proving every thread was accounted for rather than quietly dropped, so check it before sending. It is also the number the user reads first: "1 of 10 need your call" tells them how much of their attention this costs, which is what they actually want to know.

**Line 2 carries the fetch evidence and GitLab's resolve state.** The tool's `countLine` verbatim, then the resolve split appended: `{X}` is `unresolvedThreads` and `{Y}` is `resolvedThreads`. **`countLine` supplies the notes count and the reconciliation verdict, not the split** — appending it is why the line is written as two pieces rather than retyped as one.

**Those two sum to `resolvableThreads`, not `feedbackThreads`** — and the gap is real, not rounding. GitLab only makes _diff_ threads resolvable, so a general MR-level comment is a thread you must triage that can never be resolved or unresolved. On an MR with one of those, `unresolved + resolved` is one short of `feedbackThreads`, and that is correct. So the arithmetic to verify is `{X} + {Y} == resolvableThreads`, and when that's below `feedbackThreads`, name the reason where the split appears:

> 12 reviewer comment(s) across 19 notes — matches user_notes_count (19) ✓ · 1 unresolved / 6 resolved on GitLab, plus 1 general comment GitLab can't mark resolvable

**Resolve state and `{needsYou}` are not quite the same split, and the report should not imply they are.** `{needsYou}` is normally every unresolved thread plus every general MR comment — but a resolved thread holding an unanswered question gets promoted into the items, and then the two splits differ by one. Line 1 is your classification; line 2 is GitLab's bookkeeping. When they disagree, the item's own entry says why.

**`threadsTotal` does not appear in this header at all**, not even as a parenthetical: naming how many "requested review from @x" entries GitLab returned only invites the reader to check arithmetic against a number the report doesn't carry.

Never check either thread count against `{expectedNotes}` — that counts notes, not threads. The `user_notes_count` tick belongs on the second line only, and only when `reconciles` was actually `true`. Verify all of this before sending: a header whose own numbers don't add up destroys confidence in every classification under it.

A thread with no `position` (Step 2) is a general MR-level comment — use `_(general MR comment)_` in place of `` `{file}:{line}` `` for that item, and in Step 10's reply preview too.

### The Jira line inside the closing list

Item 2 of **Say go and I'll** is the only place Jira appears as a decision. Three variants, all from what Step 3 recorded:

- **Ticket already in active development** → omit the item entirely and renumber. No line, no tick, no "already In Progress ✓" — the status is already on the **Ticket** row, and a check that passed is not news twice.
- **Transition available** → the item as written, naming the exact current status and the exact target.
- **No active transition reachable** → the item becomes a choice rather than an action, and the closing question picks it up:

  > 1. Leave `{TICKET-KEY}` in **{current status}** — no transition from here reaches an active-development status. Reachable targets are {exact `to.name` list}, so tell me if you want one of those or you'd rather move it manually.

**A go-ahead that doesn't mention Jira approves item 2 along with the rest** — that's what putting it in the list means, and it is the difference between this and the two-question flow it replaced. What still needs an explicit answer is the _third_ variant, because it offers a choice rather than stating an action: if the reply doesn't address it, leave the ticket alone and say once that you did.
