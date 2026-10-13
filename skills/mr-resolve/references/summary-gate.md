# Step 8 — the final summary, its five preconditions, and the Jira question

Read this with Step 7's first validation batch, not in batch 1. It is only needed once the fixes are in, and carrying 7 KB of it through the whole run buys nothing. SKILL.md declares the gate and what a "yes" authorizes; the card, the preconditions that must hold before it is rendered, and the exact Jira wording are here.

**Layout rules live in SKILL.md**, under "Formatting every report to the user".

## Step 8 — the final summary

Before presenting the gate, call `getTransitionsForJiraIssue` — **that one call, not a re-read as well**, because Step 6 already confirmed the status and Step 11 re-reads before acting. In manual mode, ask the user to confirm the exact currently reachable review target. Identify the review status by exact name (`To Review`, `In Review`, `Review`, or the project's verified equivalent), never by status category. If no direct review transition exists, say that now and render the explicit leave-unchanged/manual form rather than inventing or promising a transition Step 11 cannot perform.

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
  - Proposed: transition to **{exact review status}**, and one short comment on the ticket naming what was addressed, both after the push and the approved replies/resolutions
  - Approve those Jira updates? (yes / leave Jira alone)
- If no direct review transition exists:
  - Proposed: leave the status unchanged in **{current status}** — no direct review transition is available — and post one short comment naming what was addressed
  - Confirm leave unchanged/manual? (yes / no Jira writes at all / stop and inspect the available transitions)

---

**Commit message:** `{type}({TICKET-KEY}): address MR review comments`

Ready to commit and push?
```

Ready to commit and push?

```text

🛑 **Gate: User Confirmation Required Before Committing.**
- **If `ask_question` tool is available (Antigravity, Claude Code):** Invoke `ask_question` with clean choices:
  - `(Recommended) Approve and commit`
  - `Let me review the diff first`
  - `Adjust commit message`
  (The user can also type custom instructions in the write-in text box).
- **Graceful Fallback (Kiro, Cursor, Windsurf, VS Code):** If `ask_question` is NOT available, present the choices clearly in chat markdown, end your turn, and wait for the user's reply before proceeding.

Omit any section that's empty (no skipped items → drop that heading entirely, don't write "none") — **except Staged, Self-review, and Jira after replies, which always appear**. Staged proves you read the real diff; Self-review proves review happened; Jira proves ticket status was checked and makes the final shared-state decision explicit. Dropping any of the three makes the gate unfalsifiable — a summary that omits Self-review reads exactly like one where the pass came back clean.

**The Jira block is a question, not a status line.** Render one of the two branches verbatim, including its `?`. Writing _"currently TO REVIEW — no transition needed"_ and moving on is not this section; it is the section replaced by a conclusion. If Step 3 found no reachable active-development transition and the user chose to leave the ticket alone, say that and name it as their recorded choice — _"leaving Jira in **{status}** per your call at the start of the run; confirm that still holds?"_ — so Step 11 inherits a decision with a person attached to it.

**The comment rides with the transition rather than getting its own gate.** Approve and you get both writes; decline and you get neither.

**Jira approval is independent from commit approval and time logging.** If the reply doesn't clearly cover the proposed review transition, ask before Step 9 rather than inferring it. "Ready to commit" authorizes only commit and push. Retain the explicit Jira answer for Step 11 — do not ask again there unless the ticket's status or reachable transitions changed.

**Do not ask for time spent at this gate.** The worklog question belongs at the very end of Step 11. Asking here makes the user estimate work that hasn't finished yet. If they volunteer a duration anyway, treat it as a note to confirm in Step 11 — never as the logged value.

**If the Self-review section offered a discovered resource, treat the user's answer to it as part of this gate.** "Yes, run it" means run it against `git diff --cached`; if it changes anything, loop through definitive validation, stage by name, run the formatter, re-stage, show the new cached diff/evidence, and re-present this summary before committing. A plain "yes" to the commit question with no mention of the checklist means they're fine proceeding without it; don't re-ask.

**Draft MR readiness:** When `mr.draft` is true, include an offer in the closing question: `(Draft MR — mark ready for review on GitLab upon push?)`. If approved, the draft prefix will be cleared after the push.

### The commit message

Match the convention you saw in `git log` (Step 1), with the type and ticket key from Step 2. If the log history is inconsistent or you can't confidently read a convention from it, fall through in this order before asking:

1. Look at the commits made by the same author on this branch — the repo may be inconsistent while this contributor is not.
2. If that's still unclear, look at the **MR title itself** from Step 2. It's a commit-shaped string the reviewer already accepted, so mirroring its type and scope is the safest inference.
3. Still nothing → ask the user once. Never invent a convention.
