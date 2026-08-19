---
name: "gitlab-mr-review"
displayName: "GitLab MR Review"
description: "ACTIVATE whenever the user pastes a GitLab merge request URL (including a bare '#note_' link) or says things like 'handle MR comments', 'address review feedback', 'fix reviewer comments', or 'resolve the MR threads'. Works through an existing MR's review comments end to end: fetch every thread, triage, fix, self-review, commit, push, reply inline, resolve, log time."
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
conventions, and without merging or transitioning tickets on your own
authority.

It has 13 steps (0–13) with 6 hard stops — see [skills/mr-comments/SKILL.md](skills/mr-comments/SKILL.md)
for the full workflow. In short: parse the MR URL, profile the project,
fetch the MR and **every** review comment (never a partial fetch), triage
each one without editing anything yet, present the triage report and wait,
fix approved items one at a time (with a self-review pass and a lint check
that adapts to the project's real tooling), present a final summary and
wait, commit and push (asking before a heavy pre-push hook runs), reply
inline and resolve each thread, log time if the user gives a duration,
optionally capture a recurring lesson as a steering-file entry, and stop —
no merging, no approving, no ticket transitions.

## GitLab only

The resolve/reply API this workflow depends on (`PUT .../discussions/{id}` to
resolve, threaded replies via the discussion ID) is GitLab-specific. On a
GitHub or Bitbucket remote the equivalent operations differ enough that this
skill stops and says so rather than improvising — see Step 1's host guard.

## Tools

This power bundles no MCP server. It expects the user's own `glab` MCP server
(or equivalent) to be configured — see the project's
[MCP configuration docs](https://kiro.dev/docs/mcp/configuration/) for adding
one. `git` is a hard requirement; everything else degrades gracefully.

If [`jira-ticket-workflow`](https://github.com/yf-tools/jira-ticket-workflow) is also installed, this
skill calls its `get_project_profile` tool for richer detection (multi-
ecosystem package managers, task runners, linters, review-checklist
location). If it isn't installed, Step 1 derives the same values directly
from lockfiles, `package.json`, git hooks, and `git log` — never a hard
dependency in either direction.

## Known gaps

- The GitHub/Bitbucket branches don't exist — this is deliberately GitLab-only
  rather than half-supporting other hosts.
- The `--reviewer` pass-through and the `#note_`-fragment-only entry path have
  not been exercised on a real run.
- Step 12 (recurring-lessons capture) writes to a workspace-scoped, git-excluded
  steering file — see the step for why it's excluded from the MR rather than
  committed.
