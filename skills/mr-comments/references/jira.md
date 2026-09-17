# Step 11 in full — returning Jira to review and logging time

Read this when you reach Step 11. SKILL.md keeps the precondition, the ask-then-write ordering, the time question and the closing line. This file has the branch-by-branch status handling, the observed failures, and the manual-mode wording.

## Re-read before changing shared state

Call `getJiraIssue` again immediately before automated writes. Another person or automation may have changed the ticket while review fixes were in progress. In manual Jira mode, ask the user to confirm the exact current status again before giving the transition instruction; never reuse the start-of-run status as current evidence.

**Immediately before means in the same turn as the time question, not after the answer.** Pair it with `getTransitionsForJiraIssue` as one batch of two — they are independent, and the transition list is a property of the issue rather than of the status you are about to read. Then emit the question in that same turn and stop.

**Observed failure.** A run read "immediately before any automated write" the other way, since the write does follow the answer: it asked the question with no reads behind it, then spent one turn on `getJiraIssue` + `getTransitionsForJiraIssue`, then a message announcing _"Confirmed still In Progress; 'Mark for review' (id 141) reaches TO REVIEW"_, then a third turn on the writes. Two consequences, and the wasted round trip was the smaller one: the question could not carry the `timetracking` figures this file requires, because nothing had read them yet.

**This is also the whole reason Step 8 does not re-read.** Step 8 calls `getTransitionsForJiraIssue` alone, because Step 6 already confirmed the current status with evidence from this run and *this* batch is the authoritative freshness check before any write. Two re-reads separated by a few minutes of GitLab work is one re-read and one round trip.

**This applies even when no transition is needed.** A worklog is an automated write, so the re-read is required on the worklog-only path too — the path taken whenever the ticket was already in active development at Step 3 and nothing needed moving. It is easy to read "re-read before changing shared state" as being about transitions and skip it when there's no transition to make; it isn't.

**The `timetracking` figures you quote in the time-log question must come from that re-read, not from Step 3.** They are the one thing in that line the user might act on — deciding what to log while looking at "8.25h against a 6h estimate" is the whole reason to show them — and by this point Step 3's copy can be half an hour old, with someone else's worklog landing in between. Quoting the stale numbers as current is the same class of error as reporting `+X/-Y` from memory.

**Observed failure.** A real run called `getJiraIssue` exactly once, at the start, then wrote a worklog 37 minutes later and quoted that opening read's `timetracking` totals to the user as the ticket's current state. No transition was needed on that run, which is precisely why the re-read got skipped.

## What the re-read tells you — five branches

- **Already in the exact approved review status** → report it and skip the transition call.
- **Still in the active-development status** — whether it was already there at Step 3 or moved there in Step 6 → apply the review transition only if the user approved it in Step 8.
- **Still in the pre-active status because the Step 5 transition was declined or unavailable** → there is nothing to return it _to_. Report the ticket's actual status and the fact that it never entered active development this run, and leave it alone unless Step 8 explicitly approved a target from here.
- **Now terminal, blocked, or otherwise different** → do not use the old approval. Show the new status and ask what to do.
- **User declined the Step 8 transition** → leave status unchanged and report that choice.

## Working out the exact transition — before asking about time

For an approved automated transition, and only when the publication precondition passed, **work out the exact write now — and don't make it yet:**

1. Call `getTransitionsForJiraIssue` again.
2. Match the exact review target approved in Step 8 by `to.name`; never match only on `statusCategory`.
3. If that target is no longer directly reachable, report the available targets and drop the status change from this run. Do not choose an alternate review-like name or route through an intermediate status.

**Then stop and go ask about time.** The transition, the closing comment and the worklog are writes to the same ticket with no ordering between them, and one of them is waiting on a question you haven't asked — so the question goes first and all of them go out in a single turn afterward.

**This ordering is also why there's nothing to announce here.** At this point you hold an approved _target_, not a verified resulting status, so the message that used to go out here can't be written. That used to be a rule you had to remember: on a real run the agent posted _"Jira `{TICKET-KEY}` is now TO REVIEW (verified via re-read after the transition call)"_ as a complete message, then repeated the same fact a turn later inside _"Pushed, threads resolved, and Jira `{TICKET-KEY}` is now TO REVIEW… how much time should I log?"_. Asking before writing removes the opportunity instead of forbidding it.

## Manual Jira mode

In manual Jira mode, and only when publication succeeded, show the verified ticket URL and exact review target approved in Step 8 and ask the user to apply that transition — **in the same message as the time-log question**, not before it. They can hand back both the resulting status and the logged duration in a single reply; there's no dependency that forces two round trips. Do not mark the lifecycle complete from an instruction alone; if the reply confirms the transition but leaves time unanswered, treat time as still open and the transition as settled — don't ask the time question a second time just because it arrived bundled with something else.

If Atlassian tools are unavailable, show the verified ticket URL and the confirmed duration for manual entry — never suppress the worklog because status synchronization could not complete, and never claim the manual entry succeeded until the user confirms it.

## The time question's details

**Include the ticket's existing time figures in that line, from the re-read above — not from Step 3.** Step 3 fetched `timetracking` so the question could exist at all; the values you actually show come from the re-read. Append whatever of `originalEstimate`, `timeSpent`, and `remainingEstimate` came back:

> … (currently `{timeSpent}` logged against a `{originalEstimate}` estimate, `{remainingEstimate}` remaining). How much time should I log?

The user is the only one who decides the number, and they may knowingly blow past the estimate — that is normal on a bug that turned out to be a spec question. But deciding it while looking at "6.5h logged against a 4h estimate" is a different decision from deciding it blind, and showing the numbers costs nothing. Do not editorialise about overrun, and do not let the estimate influence what you record.

When there's no transition to make — declined at Step 6, unreachable, already in the target status, or publication failed — drop that clause and ask the time question on its own. Say which of those it was in the same line.

`timeSpent` accepts `30m`, `2h`, `1d`, or a combination like `2h 30m`. A range (`1-2h`) is invalid — ask for one value. **Never infer the duration** from elapsed session time, message timestamps, or your own sense of how long the work took; it comes from the user or the worklog is skipped.

If the user skips, drop it and don't re-ask. If they volunteered a duration back at Step 8, confirm that exact value here before writing rather than logging it silently.

## The closing comment

One comment on the ticket, in the same turn as the transition and the worklog, saying what was addressed. Approved back at Step 8 alongside the transition, so a "leave Jira alone" there means no comment either.

**Why it shares that gate rather than getting its own.** A third option per write turns one decision into a matrix, and nobody has wanted the transition without the note or the note without the transition. One question, two answers.

**Jira comments are flat.** The REST API has no parent-comment field, so this cannot literally reply to a reviewer's comment however much the UI's reply arrow suggests otherwise. It is a new comment on the issue. Address it to someone with a leading `@name` if that reads better, but do not tell the user it threaded under anything.

**What it may claim is exactly what Step 10's ledger observed remotely.** The ledger already holds, per thread, the approved reply body, the posted note ID and the confirmed resolution result — that is the evidence, and it is why this comment is written here rather than from the Step 5 report's intentions. A report item that turned into a Step 6b "already handled" is not a fix you made, and a thread you skipped is not a thread you resolved.

So: the count of threads actually replied to and resolved, one clause on what changed, and the MR link. Nothing else.

> Addressed the review comments on !491 — the banner now truncates with an ellipsis instead of hard-clipping, and the `[id]` went onto the four wrappers Hodei flagged. Both threads replied to and resolved. https://git.example.net/group/repo/-/merge_requests/491

**It is remote text a colleague reads, so the prose rules in SKILL.md's "Anything posted to GitLab or Jira gets written like a person wrote it" apply in full.** No emoji, no em dashes, no "Great catch!", no sign-off, and not a fixed template with the numbers swapped — a reviewer who gets the identical sentence on every ticket learns to skip it. Vary the opening the same way thread replies do.

**Two things never appear in it.** The pre-push `--no-verify` choice, which SKILL.md keeps out of every remote surface and this is one. And any local detail the ticket's readers cannot act on: branch names beyond the MR link, file paths for their own sake, validation output, timings.

**When the comment is the only Jira write** — no transition reachable, or the transition declined while the comment was approved — post it anyway and say so in the closing line. "What was addressed" is the part a reviewer actually reads, and a status that cannot move does not make it pointless.

**A failed comment is reported, not retried silently, and it holds nothing back.** The transition and the worklog are independent of it; report each result on its own terms, exactly as the transition and worklog already are.

## Verifying the transition result

Call `transitionJiraIssue`, then re-read the issue and verify the resulting exact status — the write isn't finished until the server has told you what status it produced, and that value is what the closing line quotes. A successful API response without the expected resulting status is not sufficient evidence. Report transition failures as failures; never claim Jira is back in review when it is not.

**One exception, and it's the common case: when the transition response itself names the resulting status, that _is_ the read-back.** `transitionJiraIssue` returning `{"success": true, "statusName": "TO REVIEW"}` is the server reporting the post-write status; a follow-up `getJiraIssue` asking the same question adds a round trip and no evidence. Skip the extra call, quote `statusName`, and only issue a separate `getJiraIssue` when the response carries no status — or when it carries one that isn't the approved target, which is a failure to report rather than a value to quote.

## Reporting both results

The closing line states both separately, because the two can disagree. A worklog that landed next to a transition that failed is _"Logged 2h. The transition to TO REVIEW failed — {exact error}; the ticket is still {status}."_ Never let one success imply the other, and never report a status you didn't read back.

Ask even when earlier stages failed. Time was still spent, so a failed push, a failed reply, or a declined, blocked, or failed status transition does not remove the question — say what failed, then ask. The worklog and status transition are independent approvals: log the confirmed duration even if the transition never happened, unless the user explicitly tied them together. Report each result separately.

---

## Step 3 — Verify the Jira Ticket (silent; no writes, no gate)

Read this at Step 3, alongside the stop conditions SKILL.md keeps resident.

## Reconcile one authoritative Jira identity

Use the evidence collected in Step 2 to resolve **exactly one `(Jira hostname, ticket key)` pair**:

- **Several keys or conflicting key sources** → 🛑 show each source and ask which ticket this MR belongs to. Do not choose the title or branch by precedence.
- **One key but several Jira browse-link hostnames** → 🛑 show every `(hostname, key)` candidate and ask which Jira site owns this MR. The same key can exist on more than one tenant.
- **One key and one browse-link hostname** → use that pair as the candidate.
- **One key and no hostname** → call `getAccessibleAtlassianResources`. One accessible site becomes the candidate; several require the user to choose. Never infer the site from the ticket prefix.

**The `cloudId` is the resource's `id`, or the host out of its `url` — never its `name`.** A site comes back as `{"id":"ed899348-b201-439b-88fe-dee7a34cd13c","url":"https://acme.atlassian.net","name":"acme"}`, and three of those four fields are wrong to pass. `name` is the tempting one and it fails every call with *"Failed to fetch cloud ID for: acme. Input does not look like a valid domain or URL"*. Observed on a real run: `getJiraIssue` and `getTransitionsForJiraIssue` both failed, then both were retried with the full hostname, costing two wasted calls in the batch whose whole point is to be two calls. Prefer the `id`: it is literally the cloud ID and needs no parsing.
- **No key** → 🛑 stop and ask for the Jira ticket. This workflow does not waive Jira verification; an MR without a Jira ticket needs a different/manual review workflow.

Call `getJiraIssue` for the selected pair with at least `summary`, `status`, `assignee`, `issuetype`, and `timetracking`. Compare its key and summary with the MR title/description. A 404, permission failure, different key, or summary that does not match the MR's work is a 🛑 stop for correction — never merely flag a mismatch and continue. Retain the verified `{cloudId}`, hostname, `{TICKET-KEY}`, original status, and browse URL through Step 11.

If Atlassian tools are unavailable, ask once — here, because you genuinely cannot proceed without it — for the exact Jira hostname, ticket key, summary, and current status. That is the identity check, and it is a hard stop. But the _transition_ still defers: fold "and move it to {status} when I start?" into Step 6 exactly as in the automated path, then give the manual instruction there. This is manual verification, not a synchronization waiver; do not claim Jira was checked or changed by the workflow.

## Why the transition question defers to Step 6

Verification and transition have opposite urgency:

- **Verification is urgent and free.** If the ticket doesn't exist, doesn't match the MR, or is already `Done`, everything downstream is wasted or wrong. Check it now, silently.
- **A transition is a write to shared team state, and it is never urgent.** Nothing between here and the first code edit needs the ticket to be active. `git checkout` is a local operation. Reading comments is a read. The board only needs to say "work is happening" from the moment work actually happens.

**So do not ask for a transition here.** Asking at this point costs the user a decision at the moment of _minimum_ context: 45 seconds into a run, before they have seen a single review comment, before they know the MR is even the one they meant, and before anyone knows whether there is any work to do at all. Measured on a real run: the transition question landed at 49 seconds, the user answered at 1m25s, and the triage report — the thing they actually asked for — did not appear until 5m48s. The one interruption in the whole first phase was for the least informative decision in it.

It is also frequently a write for nothing. A ticket bumped `To Do → In Progress` here, on an MR whose comments then all turn out to be already addressed, moved the board for a session that changed no code. Deferring costs nothing and avoids that entirely.

## Classifying the status

Use the exact `status.name` plus category; never treat `statusCategory.name === "In Progress"` as proof of the literal status. Jira's broad `indeterminate` category also contains review and blocked states.

**"Active-development-equivalent" is not a category you may assign.** A status counts as active development only if its exact `status.name` matches an active-development name, or the user confirmed that exact name is this project's active state. Observing `statusCategory.name === "In Progress"` on a `TO REVIEW` ticket and concluding "TO REVIEW is already active-development-equivalent here, so no transition is needed" is the exact failure this rule exists to stop — it silently converts a blocking gate into a no-op. If you catch yourself writing the words _equivalent_, _effectively active_, or _close enough_ about a status name, you owe the user a question, not a conclusion.

### 🛑 Stop here (rare, and continuing would be wrong)

- **Terminal/done** (`Done`, `Closed`, `Merged`, `Resolved`, `Rejected`) → stop. Ask whether this is the wrong ticket or whether it must be reopened through a separate, explicitly approved workflow. Never move completed work backwards because an MR still has comments.
- **Blocked, or a custom status you cannot classify** → stop. Show the exact status name and ask what it means for this work. Never clear a blocker or guess at a custom state's intent.

These stop immediately because they mean _the premise is wrong_ — either you have the wrong ticket, or someone has deliberately parked this work. Spending four minutes triaging comments first would waste that work, and the answer may well be "wrong MR."

### ➡️ Carry to Step 6 (the common case — say nothing now)

- **Active development** (`In Progress`, `In Development`, `Doing`, or the project's verified equivalent) → nothing to do, ever. No write, no question, and **no mention of it** — this is a check that passed, and per the output-discipline section those stay silent. Do not write "Jira is already In Progress ✓" as reassurance; it costs the user a line to read and tells them nothing they needed.
- **New/backlog** (`To Do`, `Backlog`, `Open`) → a transition to active development will be needed. Resolve the exact target now so Step 6 can name it, then move on quietly.
- **Review state** (`To Review`, `In Review`, `Review`, or verified equivalent) → review feedback means implementation has resumed, so the same applies: resolve the exact target, stay quiet, ask in Step 6.

For both of the last two, do the read-only preparation now so the Step 6 question is concrete and needs no follow-up:

1. Call `getTransitionsForJiraIssue`. Find a transition whose exact `to.name` is a genuine active-development status. Never match on `to.statusCategory` alone.
2. **Record `{current status}`, `{exact target status}`, and `{transition name}`.** Step 6 needs all three to render a question the user can answer in one word.
3. **If no transition reaches an active-development status, that is not a licence to continue silently — but it is also not a reason to interrupt now.** Many real boards genuinely cannot go `TO REVIEW → In Progress`; one whose only outbound targets are `Merged`, `Blocked`, `Rejected`, `To Do` and a self-loop is entirely normal. Record the full reachable `to.name` set and carry _that_ to Step 6 instead, where it becomes the "no active transition available" form of the question. Do not resolve it by redefining the current status as active, and do not route through an intermediate status.

Nothing is written in this step. The transition itself happens in Step 7, after the user has approved it alongside the fixes.

Also record whether Step 11 should return the ticket to review. A move from `To Do` or `To Review` into active development normally means **yes**, but that final transition is a separate explicit approval in Step 8.
