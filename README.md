# gitlab-mr-review

A Kiro power for working through review comments on an existing GitLab merge
request: fetch every thread, triage each one, fix, self-review, commit, push,
reply inline, resolve the threads, and optionally log time to Jira if it's
configured.

Its distinguishing feature is that **nothing project-specific is hardcoded.**
The workflow derives the package manager, lint command, framework, monorepo
tool and commit convention from the repo itself — from the [`jira-ticket-workflow`](../jira-ticket-workflow)
power's `project-scanner` if it's installed, or by reading the repo's own
config files directly if it isn't. Neither path is required for the other:
this power runs standalone.

**GitLab only.** The review-thread resolve/reply API is GitLab-specific, and
this skill stops and tells you rather than improvising equivalent behavior
against a GitHub or Bitbucket remote.

## Requirements

- A `glab` MCP server (or equivalent GitLab API access) configured in your own
  `mcp.json` — this power doesn't bundle one. See
  [Adding MCP servers](https://kiro.dev/docs/powers/create/#adding-mcp-servers).
- `git` on PATH.
- Optional: the [`jira-ticket-workflow`](../jira-ticket-workflow) power, for
  richer project detection and Jira time logging. Falls back gracefully if
  it's not installed.

## Usage

Paste a GitLab merge request URL (a full link or a bare `#note_` link), or say
"handle MR comments" / "address review feedback" / "resolve the MR threads".

For what each step does, see [skills/mr-comments/SKILL.md](skills/mr-comments/SKILL.md).

## License

MIT — see [LICENSE](LICENSE).
