---
name: "gitlab-mr-review"
displayName: "GitLab MR Review"
description: "ACTIVATE whenever the user pastes a full GitLab merge request URL (optionally with a '#note_' fragment) or asks to handle MR feedback. Verifies the linked Jira ticket silently, leads with the triage report rather than interrupting first, then fixes, validates, commits, pushes, replies inline, resolves, returns Jira to review with approval, and optionally logs time."
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
  ]
author: "Youssef Fathalla"
---

## What this power does

`gitlab-mr-review` handles the review-comment loop on a merge request that
already exists: someone reviewed your code, left comments, and you need to
work through them without missing one, without guessing at project
conventions, and without moving Jira or other shared state without explicit
approval.

It has 14 primary numbered steps (0–13), plus the mid-run scope gate at Step 6b, and six possible approval gates: triage (which also carries the Jira active-status question), new scope arriving from an answered question, final staged summary plus Jira review-transition consent, pre-push choice when needed, reply preview, and lesson preview only when the user opts in. See [skills/mr-comments/SKILL.md](skills/mr-comments/SKILL.md)
for the full workflow. In short: parse the MR URL, profile the project,
then fetch the MR, its review comments, and its Jira ticket together as one
batch of reads. Verify the ticket silently — stopping only if it's terminal,
blocked, or unidentifiable. Check out the branch, triage
every comment without editing anything, and present the triage report — the
first thing the user sees, carrying the Jira status question in its footer so
one reply covers both. Then apply the approved transition, fix approved items
one at a time (with a self-review pass and validation adapted to the project's
tooling), read the staged diff and account for every hunk in it, present a
final summary with separate commit and Jira-review approvals, commit and push
(asking before a heavy pre-push hook runs), reply inline and resolve each
approved thread, and only after those publication actions succeed return Jira
to the exact approved review status. Only then — as the last question in the
run — it asks how much time to log and records the confirmed duration, then
optionally captures a recurring lesson, and stops — no merging, approving, or
terminal Jira transition.

## The first thing you see is the triage report

Nothing interrupts before it except a genuine blocker. The Jira ticket is
verified in the same batch of reads as the MR, and if it's sitting in `To Do` or
`To Review` the workflow **doesn't stop to ask** — it works out the exact
transition, keeps quiet, and puts the question in the report's footer, so you
answer it in the same reply that approves the fixes.

That ordering is deliberate. A status transition is a write to shared team state
but it is never urgent: nothing between the URL and the first code edit needs the
ticket to be active, since checking out a branch is local and reading comments is
a read. Asking up front spends your attention at the point of least context —
before you've seen a comment, before you know the MR is the one you meant, and
before anyone knows whether there's any work to do. It's also frequently a write
for nothing: a ticket bumped to `In Progress` on an MR whose comments all turn
out to be already addressed moved the board for a session that changed no code.

Terminal, blocked, and unidentifiable tickets still stop immediately — those mean
the premise is wrong, and triaging first would waste the work.

Along the way it catches malformed/non-GitLab links, wrong-workspace MRs,
ownership mismatches, merged/closed MRs, zero-comment MRs, ambiguous Jira keys
or sites, and Jira summaries/statuses inconsistent with the MR before they can
cause a wrong checkout or shared-state write.

## Your parallel edits won't get swept into the commit

`git add path/to/file.ts` stages *everything* uncommitted in that file, not just
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

This power bundles no MCP server. It expects the user's own `glab` MCP server
(or equivalent) to be configured — see the project's
[MCP configuration docs](https://kiro.dev/docs/mcp/configuration/) for adding
one. `git` is a hard requirement; GitLab access is required for MR operations, and Jira uses a fail-closed manual fallback when Atlassian tooling is unavailable.

This power has no dependency on any other Kiro power. Steps 1–2.5 derive all
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
- Deferring the transition question to the triage footer means a run the user
  abandons mid-triage leaves Jira untouched. That is the intended trade — an
  unmoved ticket is easier to fix than a board that claims work started on a
  session that never edited anything — but it does mean the board can lag reality
  by one abandoned run.
- Step 12 (recurring-lessons capture) writes to a workspace-scoped, git-excluded
  steering file — see the step for why it's excluded from the MR rather than
  committed. Because the file has no git history, a rule whose `[sources: ...]`
  list is missing cannot have its count verified; the step asks rather than
  bumping blind, but rules written before provenance was tracked stay
  unverifiable.
- The staged-hunk attribution in Step 7 relies on you answering "was this yours?"
  when something can't be traced. It catches the change; it can't tell whose it
  was without asking.
