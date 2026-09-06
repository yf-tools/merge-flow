---
name: "gitlab-mr-review"
displayName: "GitLab MR Review"
description: "ACTIVATE whenever the user pastes a full GitLab merge request URL (optionally with a '#note_' fragment) or asks to handle MR feedback. Verifies the linked Jira ticket and active status before checkout, then triages, fixes, validates, commits, pushes, replies inline, resolves, returns Jira to review with approval, and optionally logs time."
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
    "note_",
    "review-workflow",
  ]
author: "Youssef Fathallah"
---

## What this power does

`gitlab-mr-review` handles the review-comment loop on a merge request that
already exists: someone reviewed your code, left comments, and you need to
work through them without missing one, without guessing at project
conventions, and without moving Jira or other shared state without explicit
approval.

It has 14 primary numbered steps (0–13), plus the pre-work Jira gate at Step 2.5, and six possible approval gates after investigation: Jira active-status transition, triage, final staged summary plus Jira review-transition consent, pre-push choice when needed, reply preview, and lesson preview only when the user opts in. See [skills/mr-comments/SKILL.md](skills/mr-comments/SKILL.md)
for the full workflow. In short: parse the MR URL, profile the project,
fetch the MR, reconcile and verify its Jira ticket, and ensure that ticket is
actively in development before checkout. Then fetch **every** review comment
(never a partial fetch), triage each one without editing anything yet, present
the triage report and wait, fix approved items one at a time (with a
self-review pass and validation adapted to the project's tooling), present a
final summary with separate commit and Jira-review approvals, commit and push
(asking before a heavy pre-push hook runs), reply inline and resolve each
approved thread, and only after those publication actions succeed return Jira
to the exact approved review status. Only then — as the last question in the
run — it asks how much time to log and records the confirmed duration, then
optionally captures a recurring lesson, and stops — no merging, approving, or
terminal Jira transition.

Along the way it catches malformed/non-GitLab links, wrong-workspace MRs,
ownership mismatches, merged/closed MRs, zero-comment MRs, ambiguous Jira keys
or sites, and Jira summaries/statuses inconsistent with the MR before they can
cause a wrong checkout or shared-state write.

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
GitLab access are required. Atlassian access automates the Jira gates; without
it, the workflow remains stopped until the user manually supplies the exact Jira
hostname, key, summary, and current status and confirms any required transition.
There is no fail-open synchronization waiver.

## Known gaps

- The GitHub/Bitbucket branches don't exist — this is deliberately GitLab-only
  rather than half-supporting other hosts.
- The full Jira active → review lifecycle is contract-tested but still needs a controlled real-ticket acceptance run across custom Jira workflow names.
- Step 12 (recurring-lessons capture) writes to a workspace-scoped, git-excluded
  steering file — see the step for why it's excluded from the MR rather than
  committed.
