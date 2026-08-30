---
name: "gitlab-mr-review"
displayName: "GitLab MR Review"
description: "ACTIVATE whenever the user pastes a full GitLab merge request URL (optionally with a '#note_' fragment) or says things like 'handle MR comments', 'address review feedback', 'fix reviewer comments', or 'resolve the MR threads'. Works through an existing MR's review comments end to end: fetch every thread, triage, fix, self-review, commit, push, reply inline, resolve, log time."
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

It has 14 numbered steps (0–13) and five approval gates after investigation: triage, final staged summary, pre-push choice when needed, reply preview, and lesson preview only when the user opts in. See [skills/mr-comments/SKILL.md](skills/mr-comments/SKILL.md)
for the full workflow. In short: parse the MR URL, profile the project,
fetch the MR and **every** review comment (never a partial fetch), triage
each one without editing anything yet, present the triage report and wait,
fix approved items one at a time (with a self-review pass and a lint check
that adapts to the project's real tooling), present a final summary and
wait, commit and push (asking before a heavy pre-push hook runs), reply
inline and resolve each thread, log time if the user gives a duration,
optionally capture a recurring lesson as a steering-file entry, and stop —
no merging, no approving, no ticket transitions.

Along the way it checks the things a pasted URL can get wrong — a malformed
or non-GitLab link, an MR from a different project than the open workspace,
an MR that isn't yours, one already merged or closed, one with no comments
at all — and surfaces the mismatch before it costs a wrong branch checkout
or a reply on the wrong MR.

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
one. `git` is a hard requirement; everything else degrades gracefully.

This power has no dependency on any other Kiro power. Step 1 derives all
project conventions (package manager, lint command, framework, monorepo
tool, git hooks, commit convention) directly from the repo itself —
lockfiles, `package.json`, git hooks, and `git log` — so it works standalone
whether or not anything else is installed.

## Known gaps

- The GitHub/Bitbucket branches don't exist — this is deliberately GitLab-only
  rather than half-supporting other hosts.
- The `--reviewer` pass-through and the `#note_`-fragment-only entry path have
  not been exercised on a real run.
- Step 12 (recurring-lessons capture) writes to a workspace-scoped, git-excluded
  steering file — see the step for why it's excluded from the MR rather than
  committed.
