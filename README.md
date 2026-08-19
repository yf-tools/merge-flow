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

This power is packaged to the [Agent Plugins](https://agent-plugins.org/) 1.0
standard (`plugin.json` + `skills/`) rather than anything Kiro-specific. Kiro
is what this was built and tested against, but the same package format is
also read natively by VS Code / GitHub Copilot. Support in other clients
isn't verified here — check what a given client actually supports before
assuming it'll load.

## Install

**From a GitHub URL** (Kiro's Powers panel → **Add power from GitHub** →
paste the repository URL). For a private repo, whoever you paste it as needs
read access — see the repo's own access settings.

**From a local checkout** — this also works for a private repo you don't
have push access to, once someone's given you read and you've cloned it:

```bash
git clone <repository-url>
```

Then in Kiro: Powers panel → **Add power from Local Path** → select the
cloned directory.

**Do not develop against `~/.kiro/powers/<name>/` directly.** That path is
Kiro's managed slot for the *installed* copy, and it can be overwritten by
Kiro's own install/sync process — clone and edit this repo somewhere else
(e.g. `~/dev/`), then install from that path or from GitHub.

This power bundles no MCP server, so there's nothing to reconnect after
install — see Requirements below for what to configure yourself.

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
