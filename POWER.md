---
name: "gitlab-mr-review"
displayName: "GitLab MR Review"
description: "ACTIVATE whenever the user pastes a full GitLab merge request URL (optionally with a '#note_' fragment), asks to handle MR feedback, or asks to resolve a merge conflict on an MR. Covers both jobs behind the same gates. Opens within two turns with one complete report — state, blockers, every unresolved comment in detail, the Jira ticket and its status — and waits there for a single go-ahead covering the checkout, the Jira move, the code reads and the fixes. Then fixes, or applies an approved conflict-resolution plan, validates, commits, pushes, replies inline, resolves, returns Jira to review with approval, and optionally logs time."
keywords:
  [
    "gitlab",
    "merge-request",
    "mr-comments",
    "review-comments",
    "code-review",
    "merge-request-url",
    "reviewer-feedback",
    "resolve-threads",
    "note",
    "review-workflow",
    "merge-conflict",
    "conflict",
    "has-conflicts",
    "cannot-be-merged",
    "resolve-conflict",
  ]
author: "Youssef Fathalla"
---

# What this power does

`gitlab-mr-review` handles the review-comment loop on a merge request that
already exists: someone reviewed your code, left comments, and you need to
work through them without missing one, without guessing at project
conventions, and without moving Jira or other shared state without explicit
approval.

It has 14 primary numbered steps (0–13), plus the lane decision at Step 0b and six possible approval gates: the opening report or its conflict-lane equivalent (which also carries the Jira active-status decision), Step 6b when the code contradicts that report or an answered question turns into new scope, final staged summary plus Jira review-transition consent, pre-push choice when needed, reply preview, and lesson preview only when the user opts in. See [skills/mr-comments/SKILL.md](skills/mr-comments/SKILL.md)
for the full workflow. In short: parse the MR URL, fetch the MR, every review
comment and the local git state as one batch, then reconcile the counts and read
the Jira ticket as a second batch. Verify the ticket silently — stopping only if it's terminal,
blocked, or unidentifiable. Then **open with one complete report** — which MR,
whether it can merge, every unresolved comment quoted at full detail, the ticket
and its exact status, and a numbered list of what your go-ahead will do — and stop
there. One reply covers the branch checkout, the Jira transition, the code reads
and the fixes. Then it checks out the branch, applies the approved transition,
reads the files those comments point at, and fixes approved items one at a time
(with a self-review pass and validation adapted to the project's
tooling), reads the staged diff and accounts for every hunk in it, presents a
final summary with separate commit and Jira-review approvals, commits and pushes
(asking before a heavy pre-push hook runs), replies inline and resolves each
approved thread. Only after those publication actions succeed does it touch Jira
again: it re-reads the ticket, works out the exact approved review transition, and
then — as the last question in the run — asks how much time to log, so the status
change and the worklog go out together in one turn once you answer. Then it
optionally captures a recurring lesson, and stops — no merging, approving, or
terminal Jira transition.

## One report, then the work

The failure mode of a workflow this long is silence: the run disappears into file
reads and comes back much later with everything at once, having never confirmed it
found the right MR. The obvious fix — send a short brief early, then the real
report once triage is done — traded that for a different problem: two stops, two
waits, and a second message that repeated half the first.

So there is one report, and it's the run's first output, two turns in. MR title,
state and mergeability, the reconciled comment counts, the ticket **and its exact
status**, the branch, any blockers, every unresolved comment quoted at full detail
with its file and line — and then a numbered list of what a go-ahead authorizes,
in the order it will happen.

What makes that possible is what the report leaves out: **it makes no claim about
your code.** Reading the files each comment points at is the slow part, and none of
it is needed to tell you what the reviewers said. Quoting a comment, naming its
file and line, and reading the ticket's status are all free, so all of it arrives
at once and the code investigation waits until you've agreed to it.

**Then it stops.** No checkout, no Jira write, no file read goes out in the same
turn. That pause is the point: a report followed immediately by a burst of tool
calls gets collapsed into a progress line and disappears above the scroll.

Two things it deliberately doesn't do. It doesn't list the threads GitLab has
already resolved — they're one count, stated as not re-checked, because at that
point they haven't been. And it doesn't ask about Jira separately: the transition
is a line in the closing list, so "go ahead" approves it and "go ahead, leave Jira
alone" declines it, in one reply either way.

The whole first phase runs as four batches of parallel calls rather than one call
per turn, which is the difference between a complete report in half a minute and a
first report five minutes in.

## Two kinds of work, one set of gates

The same MR URL arrives for two different reasons: review comments to address, or a
merge conflict to resolve. Step 0b reads the user's words — not the payload — to
decide which, and both lanes run through the identical opening stop, summary and
push discipline. Only the middle changes: the conflict lane swaps the triage
report for a **resolution plan gate** that names the merge strategy (with the
repo's own convention as evidence), lists every conflicted region with both sides
and a proposal, and carries an explicit "beyond a mechanical pick" row. It skips
the reply step and assumes no Jira review transition.

Before it proposes a local merge it checks two cheaper exits. A branch that is
merely behind — `detailed_merge_status` stuck on `checking`, no conflicts — is
rebased through the public `PUT .../merge_requests/:iid/rebase` endpoint in one
call, with nothing touched locally. And when every conflicting file meets
GitLab's published UI criteria (non-binary, under 200 KB with markers, UTF-8, no
pre-existing markers, same path on both branches), the browser path is offered as
a real option rather than a local merge being decided for you. It does not
pretend to drive that path: there is no `/api/v4/` endpoint for the web conflict
resolver, and the Commits API has no second-parent parameter, so it can't forge
the merge commit either. Those limits are written down so a run doesn't go
looking for a shortcut that isn't there.

This exists because of a run where the conflict was the stated request, the
workflow was read and judged inapplicable, and the whole thing was improvised: no
report, an unannounced branch switch, a `git merge` ninety seconds in, eight
ungated resolution edits, a `--no-verify` commit, and nothing reported for
twenty-one minutes. The fix isn't another rule inside the workflow — it's making
the workflow recognise the job at the door.

## The report is the gate before any edit

Nothing interrupts before the report except a genuine blocker, and a blocker
doesn't get its own message either — it goes on the report's Blockers row and its
question replaces the closing one.

The Jira ticket is read before the report, not after, so its exact status is one of
the facts in front of you when you decide. But if it's sitting in `To Do` or
`To Review` the workflow **still doesn't stop to ask** — it works out the exact
transition, keeps quiet, and makes it item 2 of the report's closing list, so one
reply covers the fixes and the board together.

That ordering is deliberate. A status transition is a write to shared team state
but it is never urgent: nothing between the URL and the first code edit needs the
ticket to be active, since reading comments and reading a ticket are both reads.
Asking up front spends your attention at the point of least context — before you've
seen a comment, before you know the MR is the one you meant. And when the answer
does come, the move happens **before the first file is opened**, because that is
when work actually starts; a run that edits code and then remembers the board spent
the whole diff claiming nothing had begun.

Terminal, blocked, and unidentifiable tickets still stop immediately — those mean
the premise is wrong, and continuing would waste the work.

Along the way it catches malformed/non-GitLab links, wrong-workspace MRs,
ownership mismatches, merged/closed MRs, zero-comment MRs, ambiguous Jira keys
or sites, and Jira summaries/statuses inconsistent with the MR before they can
cause a wrong checkout or shared-state write.

## Your parallel edits won't get swept into the commit

`git add path/to/file.ts` stages _everything_ uncommitted in that file, not just
the changes an agent made — and `git status` reports the file as plain `M`
(modified) either way, whether it holds one changed line or forty from three
different sources. So if you edit a file while the run is in progress, which is completely
normal when you're watching it work, a naive workflow commits your unrelated work
into the MR and reports line counts that don't match what shipped.

Step 7 handles this by reading `git diff --cached` in full before the approval
gate and mapping every hunk to a specific review comment or to a formatter that
reported changing that file. Anything left over is a stop, and the question is
"did you edit these?" — never a guess about a plugin or a prettier config. The
`+X / -Y` figures in the summary come from `--numstat`, so the diff you approve
is the diff that gets committed.

## Finding your review conventions

The self-review pass before commit doesn't look for a fixed set of filenames.
It searches wherever the project keeps agent-facing instructions — steering
files, skills, repo-root rule files, contributor docs — and decides what's
relevant by reading **what each one says it does** in its own description,
so a checklist called `pre-flight.md` or `merge-readiness.md` is found just
as reliably as one called `code-review.md`. When it finds something, it names
it and offers to run it rather than applying it silently, so you can see what
was checked and skip it when it doesn't apply.

## GitLab only

The resolve/reply API this workflow depends on (`PUT .../discussions/{id}` to
resolve, threaded replies via the discussion ID) is GitLab-specific. On a
GitHub or Bitbucket remote the equivalent operations differ enough that this
skill stops and says so rather than improvising — see Step 1's host guard.

## Tools

**Bundled:** the `mr-review-checks` MCP server ships with this power. It needs
`node` and nothing else — no dependencies, no filesystem access, no network. It
exposes five tools, and they exist for a specific reason: each replaces a
decision that prose could not make reliably, because each is about _noticing_
rather than judging.

The first two are also called directly by `scripts/fetch-mr.mjs`, which is the
default path: the script already holds the fetched payload, so it computes the
triage and the counts locally and prints those, instead of printing ~10 KB of JSON
for the agent to hand back as tool arguments. That round trip cost more than the
GraphQL call and was observed failing on a real run. The tools remain for the
`--raw` and `--rest` fallbacks, and a test asserts both call sites pass the same
inputs to the same functions.

| Tool                          | What it settles                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `locate_bundled_scripts`      | Returns absolute, already-quoted commands for the two bundled scripts. Added because nothing else tells a run where the power is installed — not the activation response, not the skill body — and one measured run spent 60 seconds and nine directory listings under `~/.kiro` guessing, before it had made a single GitLab call.                              |
| `triage_mr_payload`           | Reads the MR response and returns blockers (wrong project, merged/closed/locked, merge conflicts, zero comments), flags (not-your-MR, no ticket key, draft), and `undetermined` for checks an absent input made impossible. Added because a real run had `has_conflicts: true` in hand and never mentioned it until the user asked ten minutes later.            |
| `reconcile_discussion_counts` | Separates threads, notes, reviewer notes and your own replies, drops system notes, and reconciles against `user_notes_count`. Also separates the discussions GitLab returned from the ones anyone triages — "requested review from @x" arrives as a thread and is not one. Returns the count line verbatim. `reconciles: null` means unchecked, never agreement. |
| `triage_graphql_mr`           | Does both of the above in one call from a single GraphQL payload, and normalizes it to the REST shape the other tools accept — including stripping the `gid://gitlab/Note/…` prefixes, whose bare remainders are the REST ids Step 10 replies need. Surfaces `hasNextPage` for an incomplete fetch, from the discussions page _or_ any thread's notes page.      |
| `attribute_staged_hunks`      | Parses `git diff --cached` into per-hunk items with `+X / -Y` totals, flags staged files with no approval basis, and lists every hunk in a file that does have one. It deliberately does **not** claim to resolve same-file authorship — that needs judgement, and the tool's job is to make the judgement unavoidable rather than to fake it.                   |

**Not bundled:** the `glab` MCP server (or equivalent GitLab API access) comes
from the user's own config — see the project's
[MCP configuration docs](https://kiro.dev/docs/mcp/configuration/) for adding
one. `git` is a hard requirement; GitLab access is required for MR operations, and Jira uses a fail-closed manual fallback when Atlassian tooling is unavailable.

This power has no dependency on any other Kiro power. The bundled server ships
inside this package, so calling it is not a cross-power dependency. Steps 1–3 derive all
project conventions and Jira identity/status names directly from the repo,
GitLab MR, and Atlassian APIs — never from hardcoded project values. `git` and
GitLab access are required. Atlassian access automates the Jira lifecycle;
without it, identity verification falls back to asking you once for the exact
Jira hostname, key, summary, and current status, and each transition becomes a
manual instruction you confirm. There is no fail-open synchronization waiver.

## Known gaps

- The GitHub/Bitbucket branches don't exist — this is deliberately GitLab-only
  rather than half-supporting other hosts.
- The full Jira active → review lifecycle has been exercised on real tickets,
  including a `To Do → In Progress` bump and a board with no reachable
  active-development transition from `TO REVIEW`. Boards whose active and review
  states carry unusual custom names still need coverage.
- Putting the transition in the report's closing list means a run the user never
  answers leaves Jira untouched. That is the intended trade — an
  unmoved ticket is easier to fix than a board that claims work started on a
  session that never edited anything — but it does mean the board can lag reality
  by one abandoned run.
- The report is written before any project file is opened, which is what makes it
  fast, and the cost is that a few of its items won't survive contact with the
  code. Step 6b exists to surface those rather than silently dropping them, but it
  does mean an approved item can come back as "already handled" or "the line is
  gone" one turn later.
- Step 12 (recurring-lessons capture) writes to a workspace-scoped, git-excluded
  steering file — see the step for why it's excluded from the MR rather than
  committed. Because the file has no git history, a rule whose `[sources: ...]`
  list is missing cannot have its count verified; the step asks rather than
  bumping blind, but rules written before provenance was tracked stay
  unverifiable.
- The staged-hunk attribution in Step 7 relies on you answering "was this yours?"
  when something can't be traced. It catches the change; it can't tell whose it
  was without asking.
