# The twelve mismatches — why each verdict is what it is

SKILL.md carries the table: the case, the step, and the binding verdict. **The verdict there is authoritative; nothing in this file overrides one.** What lives here is why each case earns its verdict, and what to say when you hit it — the part that only matters once you are actually looking at one.

Read this when a row in that table fires and the one-line verdict doesn't tell you enough to write the sentence. Reading it speculatively is a wasted turn: eleven of the twelve rows never fire on a healthy run.

## Why this catalogue exists at all

The workflow reads a URL and a local repo, then acts on both. Neither is guaranteed to match what the user actually meant, and the two most expensive outcomes — a fix applied to someone else's code, a reply posted to the wrong MR — both start with a mismatch that was visible in Step 0 or Step 2 and went unchecked.

The whole set is cheap to check because it all comes from data the run already holds. Not one of these needs a call the workflow wasn't making anyway.

## The stop-immediately cases

### Malformed or non-GitLab URL (Step 0)

If the URL doesn't split cleanly on `/-/merge_requests/`, don't guess at a `project_path`/`iid` from a partial match. Say the URL doesn't look like a GitLab MR link and ask for the correct one. If it's clearly a GitHub or Bitbucket PR link, go straight to the host guard in Step 1 rather than attempting any GitLab API call with garbage values — a 404 from a malformed path looks identical to a 404 from a private project, and diagnosing that costs a turn you didn't need to spend.

### MR belongs to a different project than the one open in this workspace (Step 2)

Compare the MR's project path against the workspace's own `git remote get-url origin`. When they don't match, ask before Step 6 checks out anything. Proceeding means checking out a branch that may not exist in this repo, or worse, operating against the wrong codebase while every command still succeeds.

### No unambiguous Jira ticket (Step 3)

Conflicting keys across the title, source branch, description and linked issues can send a status change or a worklog to the wrong ticket, and both are writes to shared state that someone else will see.

**No key at all is a hard stop, and it is the one place to ask outright rather than fold into the report.** Require the actual Jira hostname and ticket key, or exit the workflow without touching the MR, the branch, the code, or any Jira state. You genuinely cannot proceed without exactly one `(Jira hostname, ticket key)` pair, so there is nothing to fold the question into.

### Jira ticket is `Done`, `Closed`, `Merged`, or otherwise terminal (Step 3)

Never move completed work backwards merely because an MR still has comments. A terminal ticket usually means the key you resolved is not the ticket this MR is really for, so continuing may throw the whole pass away.

### MR is `merged`, `closed` or `locked` (Step 2)

Stop and ask before treating it as active work. Also covered by the state check in Step 2; it is listed here because the reflex on seeing comments is to start triaging them.

### Zero comments — `user_notes_count: 0` (Step 2)

Don't manufacture a report from nothing. Say there's nothing to review. This almost always means the user picked the wrong MR or it hasn't been reviewed yet, and neither is a workflow to push through.

## The flag-it cases

### MR isn't authored by or assigned to the current user (Step 2)

Not necessarily wrong — reviewing on someone else's behalf is a legitimate ask — but it is also the single most common typo outcome, pasting `!490` when you meant `!409`. So it goes on the report's **Flags** row in one line and the user's next reply confirms or corrects course. Waiting on an explicit answer would spend a gate on something that is usually fine.

`triage_mr_payload` decides this from the `current_user` resolved in Step 1. **Omit that input and the check lands in `undetermined` rather than passing** — a check that could not run is not a check that passed.

### Clean branch that's clearly unrelated to this MR (Step 1/6)

The dirty-tree check already covers uncommitted work. This is the other shape: a clean tree on a branch whose `git log` shows commits for an entirely different ticket. Nothing is at risk of being lost, but the checkout would silently discard the user's mental model of what they were working on, so name what you're switching from and to even when the tree is clean.

This is also the case the `branch-mismatch` flag now reports mechanically, so the comparison is never yours to compose — read it off `triage.flags` and render the variant the report template supplies.

### Reviewer comment references a file or line that no longer exists (Step 6)

You only discover this once you open the file, which is after the go-ahead, so it can never be a report item. Say the referenced code is gone — renamed, deleted, or moved — as a Step 6b finding, and let the user decide whether it was handled elsewhere or needs a fresh look at the new location.

## The two that behave differently

### MR has conflicts — `has_conflicts: true` (Step 2)

`triage_mr_payload` returns this as a **blocker**, so its question replaces the report's usual `Go ahead?`. Not because the run is doomed, but because it changes what the run is *for*: a conflict resolution can rewrite the very code the comments are about, so fixing first risks work that a merge then overwrites. Which order to take is the user's decision, not yours.

This arrives in the same payload as `user_notes_count`, so there is no separate call to forget.

### Jira ticket is not actively in development (Step 3 → Step 5)

**Don't stop for this one.** Resolve the exact reachable active status quietly, then put it in Step 5's report as one of the things the go-ahead will do, so the user answers it in the same breath as approving the work. `To Do` normally moves to `In Progress`; `To Review` normally moves back to `In Progress` while review fixes are being made. Applying it happens in Step 6, after approval.

`Blocked`, or a custom status you cannot classify, is a different case and stops immediately.

## Where the non-stopping ones go

Blockers land on the report's **Blockers** row, non-blocking flags on its **Flags** row, and the Jira transition among the things the go-ahead covers. Later ones fold into Step 6b's findings gate or Step 8's final approval. **None of them becomes an ad hoc pause of its own.**

## The rule behind the split

**Continuing wastes work or does damage → stop. A decision is merely needed → fold it into the report.**

A ticket sitting in `To Do` needs a decision, but reading comments while it sits there costs nothing and is trivially reversible, so it waits for the report. A ticket sitting in `Done` means you may have the wrong ticket entirely, so continuing might throw the whole pass away. Same subsystem, opposite urgency.

Getting this backwards produces the worst version of this workflow: a run that interrupts before showing anything, interrupts again, and buries the report the user actually asked for.

Note how cheap the report makes "fold it in." A blocker raised there is one row in a message that was already going out and was already going to wait for a reply, so it adds no pause of its own. That asymmetry is why the default is to fold rather than to stop, and why the stopping cases are enumerated rather than left to judgement.
