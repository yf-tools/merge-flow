# gitlab-mr-review

A Kiro power for working through review comments on an existing GitLab merge
request: verify the linked Jira ticket, move it into active development when
approved, fetch every thread, triage and fix each one, validate, commit, push,
reply inline, resolve the threads, return Jira to review, and optionally log
time.

Its distinguishing feature is that **nothing project-specific is hardcoded.**
The workflow derives package management, validation, framework, monorepo and
commit conventions from the repo, then derives Jira identity and exact active/
review status names from the MR and Jira APIs. This power has no dependency on
another Kiro power and runs standalone.

**GitLab only.** The review-thread resolve/reply API is GitLab-specific, and
this skill stops and tells you rather than improvising equivalent behavior
against a GitHub or Bitbucket remote.

This power is packaged to the [Agent Plugins](https://agent-plugins.org/) 1.0
standard (`plugin.json` + `skills/`) rather than anything Kiro-specific. Kiro
is what this was built and tested against, but the same package format is
also read natively by VS Code / GitHub Copilot. Support in other clients
isn't verified here — check what a given client actually supports before
assuming it'll load.

## Safety behaviour

What it will and won't do on its own:

- Validates the pasted URL is actually a GitLab MR link before calling anything — malformed or non-GitLab URLs are caught immediately, not after a confusing API error
- Checks the MR's project against your workspace remote — different project → stops and asks before checking out a branch that doesn't belong here
- Flags when the MR is authored by or assigned to someone else — might be a typo (`!490` vs `!409`), might be intentional; surfaced either way
- Stops on a merged/closed MR, a zero-comment MR, or a dirty tree — never proceeds silently into a state that can't be productive
- Reconciles exactly one Jira hostname + key across the MR title, source branch, description, and linked issues before checkout; conflicting keys, multiple Jira hosts, absent identity, or a mismatched issue summary stops for correction
- Reads the Jira ticket before code work. `To Do`/review states require an explicitly approved move to the project's exact active-development status; blocked, unknown, and terminal statuses stop for a decision
- Re-reads Jira after a successful push and all approved replies/resolutions; only then returns it to the exact review status approved in the final summary
- Asks how much time to log **last** — after the push, the replies, the resolutions, and the status change — so you're estimating finished work, not work in progress. Commit approval, Jira approval, and the worklog stay independent
- Never edits code before showing you the triage report and getting a go-ahead
- Never commits, pushes, replies, resolves, merges, or transitions without explicit approval (six possible gates; Jira, pre-push, and lesson gates apply only when relevant)
- Never picks `--no-verify` itself; when a pre-push hook runs a full build it hands you the choice. If you select it, that remains a private execution detail and is never written to the MR description, comments, or threads
- Discovers review conventions by reading each candidate file's **description** rather than matching on filenames — a checklist called `pre-flight.md` or `merge-readiness.md` is found as reliably as one called `code-review.md`, and it's offered to you before being applied
- Reports failures as failures — a failed push, a failed resolve, or a tool that isn't available is surfaced clearly, never silently swallowed

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
- An Atlassian/Jira MCP server is recommended for automatic ticket verification,
  active-status transition, return-to-review transition, and optional worklog.
  Without it, the workflow remains stopped until the user manually supplies the
  exact Jira hostname, key, summary, and current status and confirms any required
  transition. There is no fail-open synchronization waiver.

## Usage

Paste a full GitLab merge request URL, optionally including a `#note_` fragment, or say
"handle MR comments" / "address review feedback" / "resolve the MR threads".
A fragment such as `#note_123` by itself has no host, project, or MR number, so the
skill asks for the full MR URL instead of guessing.

For what each step does, see [skills/mr-comments/SKILL.md](skills/mr-comments/SKILL.md).

## License

MIT — see [LICENSE](LICENSE).
