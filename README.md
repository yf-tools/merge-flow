# MergeFlow

The GitLab MR review & conflict resolution system, built as part of the **DevFlow** suite.
MergeFlow delivers two coordinated engines:

- **`mr-resolve`**: Actively triages, fixes code, and replies to threads behind safe human approval gates.
- **`mr-reflect`**: Filters signal-vs-noise on completed MRs for post-merge continuous learning.

> 🚀 **Team Getting Started**: Follow the step-by-step [Team Setup & Installation Guide](SETUP.md) to set up Git, `glab`, and Jira MCP in under 5 minutes.

**It handles two jobs, not one.** Paste an MR URL and it addresses review
comments. Paste the same URL and say the MR has conflicts, and it resolves the
conflict instead — behind the same gates, with the triage report swapped for a
resolution plan you approve first: the merge strategy (backed by the repo's own
convention), every conflicted region with both sides shown, and an explicit list
of anything that isn't a straight side-pick. It won't start the merge to find out
what conflicts; it inspects without touching your working tree.

**One report, not two — and then it waits.** Two turns after you paste the URL,
before the branch checkout and before it reads a single file a comment points at,
you get the whole picture: the MR title, whether it can merge, the reconciled
comment counts, the Jira ticket **and its exact status**, and every unresolved
comment quoted at full detail with its file and line. Blockers arrive in that same
message rather than as a separate interruption. Then the turn ends and it waits for
your go-ahead, so the report is still on screen when you read it instead of buried
under the tool calls that follow.

What makes it that fast is what it leaves out: **it makes no claim about your
code.** Reading the files each comment points at is the slow part, and none of that
is needed to tell you what the reviewers said — so it all arrives at once, and the
code investigation waits until you've agreed to it. Two more things it doesn't do:
it won't list the threads GitLab has already resolved (they're one count, stated as
not re-checked), and it won't ask about Jira separately — moving the ticket is a
line in the closing list, so one reply covers the fixes and the board.

**The skill states rules, not stories.** `SKILL.md` says what to do and what not to
do; the runs that produced each rule — with timings and what the user actually said
— live in `skills/mr-resolve/references/failures.md`, which is never needed to
follow the workflow and is there for when a rule looks arbitrary. Eight other
reference files hold the step-by-step detail and load only when the workflow points
at them, so activation doesn't pay for Step 12 on a run that never reaches it.

**It fetches the MR in one GraphQL call, not two REST calls.** Measured on a real
merge request: 10,578 characters in one round trip against 27,984 in two — 62% less
context and one fewer call. GraphQL field selection keeps the response focused, but
connection pagination can still make a fetch incomplete; the script exposes
`hasNextPage` and the workflow refuses to report until all requested connections are
complete. That avoids the paging failure the REST path hits on any MR with more than a
handful of threads. GraphQL's
global IDs are translated back to the REST ids that thread replies need, in tested
code rather than in prose, because leaving one in place would 404 every reply at the
very end of a run. If an instance doesn't offer GraphQL, the REST path is still there.

**Two deterministic steps are scripts, not prose.** The MR fetch and the git reads
are fixed commands, and each had failed by being re-derived: `--field` instead of
`--raw-field` (GraphQL rejects the merge-request id), and a chained shell read where
a clean tree couldn't be told apart from a mangled separator. `scripts/fetch-mr.mjs`
and `scripts/git-context.mjs` make both impossible rather than forbidden — the
latter returns JSON, so "clean tree" is a boolean instead of an empty line to
interpret. Zero dependencies, Node only.

Three of its decisions don't live in prose at all. Bundled zero-dependency
modules read the MR payload for things that change the plan (merge conflicts,
wrong project, terminal state), reconcile the comment counts so the numbers in
the report can't be approximated, and enumerate every staged hunk before the
commit gate. They were moved into tested code because they're about
*noticing* rather than judging, and a rule saying "also check this" competes for
attention with everything else in a long skill file.

**The first two run inside the fetch script, not as tool calls.** The script
already holds the payload, so it prints the triage and the reconciled counts
instead of ~10 KB of JSON for the agent to hand straight back to a tool. That
round trip went out through the model and returned as generated tool arguments —
slower than the GraphQL call itself, and on a real run it failed outright, after
which the recovery started trimming note fields to "fix the size". Removing the
round trip removes all of it. The same logic is still exposed as MCP tools for
the fallback paths, and a test pins the two call sites together so they can't
give different answers for the same MR.

Its distinguishing feature is that **nothing project-specific is hardcoded.**
The workflow derives package management, validation, framework, monorepo and
commit conventions from the repo, then derives Jira identity and exact active/
review status names from the MR and Jira APIs. This plugin has no dependency on
other plugins and runs standalone.

**GitLab only.** The review-thread resolve/reply API is GitLab-specific, and
this skill stops and tells you rather than improvising equivalent behavior
against a GitHub or Bitbucket remote.

This plugin is packaged to the [Agent Plugins](https://agent-plugins.org/) 1.0
standard (`plugin.json` + `skills/`) rather than anything IDE-specific. Built
and tested across Antigravity, Kiro, Claude Code, Cursor, Windsurf, and VS Code
on Windows, Linux, and macOS. Detailed setup instructions for each IDE are in
[SETUP.md](SETUP.md).

## Safety behaviour

What it will and won't do on its own:

- Reports the MR's state, mergeability, comment counts, ticket status and every unresolved comment in one report before it opens a single project file — no silent stretch where you can't tell whether it found the right MR, and no second message repeating the first
- Validates the pasted URL is actually a GitLab MR link before calling anything — malformed or non-GitLab URLs are caught immediately, not after a confusing API error
- Checks the MR's project against your workspace remote — different project → stops and asks before checking out a branch that doesn't belong here
- Flags when the MR is authored by or assigned to someone else — might be a typo (`!490` vs `!409`), might be intentional; surfaced either way
- Stops on a merged/closed MR, a zero-comment MR, or a dirty tree — never proceeds silently into a state that can't be productive
- Reconciles exactly one Jira hostname + key across the MR title, source branch, description, and linked issues before checkout; conflicting keys, multiple Jira hosts, absent identity, or a mismatched issue summary stops for correction
- Reads the Jira ticket before code work. `To Do`/review states require an explicitly approved move to the project's exact active-development status; blocked, unknown, and terminal statuses stop for a decision
- Re-reads Jira after a successful push and all approved replies/resolutions; only then returns it to the exact review status approved in the final summary, and never claims a status it hasn't read back
- Leaves one comment on the ticket saying what was addressed, approved in the same breath as the status change rather than at a gate of its own. It claims only the threads it actually replied to and resolved, carries the MR link, and is written like a person wrote it — Jira comments are flat, so it doesn't pretend to thread under a reviewer's comment
- Asks how much time to log **last** — after the push, the replies and the resolutions — so you're estimating finished work, not work in progress. It's the last question, not the last write: the review transition waits behind it so the status change, a short comment on the ticket naming what was addressed, and the worklog all go out in one turn, and the resulting status is reported once, after it's been read back. Commit approval, Jira approval, and the worklog stay independent
- Never checks out a branch, moves the Jira ticket, or opens a referenced file before the report has been answered — the report ends its turn, so you see it before the slow part starts
- Checks the two cheap ways out of a conflict before proposing a local merge: a branch that's merely behind gets rebased through GitLab's API in one call and never touches your working tree, and when every conflicting file meets GitLab's own UI criteria you're offered the browser path (interactive mode, inline editor, or Resolve with GitLab Duo) instead of having a local merge decided for you. It won't pretend to drive either one — there's no REST endpoint for the web resolver, and it says so rather than improvising with the Commits API
- Never edits code before showing you the report and getting a go-ahead, and comes back rather than improvising when the code turns out not to match what the report promised
- Never commits, pushes, replies, resolves, merges, or transitions without explicit approval (six possible gates; Jira, pre-push, and lesson gates apply only when relevant)
- Never picks `--no-verify` itself; when a pre-push hook runs a full build it hands you the choice. If you select it, that remains a private execution detail and is never written to the MR description, comments, or threads
- Discovers review conventions by reading each candidate file's **description** rather than matching on filenames — a checklist called `pre-flight.md` or `merge-readiness.md` is found as reliably as one called `code-review.md`, and it's offered to you before being applied
- Reports failures as failures — a failed push, a failed resolve, or a tool that isn't available is surfaced clearly, never silently swallowed

## Install

See the comprehensive [Team Setup & Installation Guide](SETUP.md) for step-by-step installation instructions across **Antigravity**, **Claude Code**, **Kiro**, **Cursor**, **Windsurf**, and **VS Code**.

### Quick start by IDE

- **Antigravity**: Copy to `%USERPROFILE%\.gemini\config\plugins\merge-flow` (Windows) or `~/.gemini/config/plugins/merge-flow` (macOS / Linux), or use the Plugins Manager UI.
- **Claude Code**: Load with `claude --plugin-dir <path-to-merge-flow>`, or run `claude mcp add mr-review-checks node "<path>/server/server.js"` and copy skills to `.claude/skills/`.
- **Kiro**: Powers panel → **Add power from Local Path** → select this directory.
- **Cursor / Windsurf / VS Code**: Place in project root or global prompt folder.

This plugin bundles one MCP server, `mr-review-checks`. After installing — and
after changing anything under `server/` — reconnect it from your IDE's **MCP Servers**
settings, or the running process keeps serving the old code and the old tool list. You should see
`mr-review-checks` with 5 tools.

**Its five tools each prompt for approval the first time they run.** They're
pure functions over data already fetched — no filesystem, no network — so
choosing **Always allow** is safe and saves the run waiting on you mid-flow.
On a first run, those prompts are most of the delay before the report appears.

### Bundled MCP Tools

| Tool | Purpose |
| :--- | :--- |
| `locate_bundled_scripts` | Returns absolute commands for the bundled helper scripts. |
| `triage_mr_payload` | Reads the MR response and flags blockers (wrong project, merged/closed/locked, conflicts, zero comments). |
| `reconcile_discussion_counts` | Reconciles threads, notes, and reviewer comments against `user_notes_count`. |
| `triage_graphql_mr` | Triages the single GraphQL MR response into the normalized REST schema. |
| `attribute_staged_hunks` | Parses `git diff --cached` into per-hunk items to verify every staged hunk has an approved review basis. |

## Check your setup before the first MR

```bash
node preflight.mjs --repo /path/to/your/project
```

Every prerequisite below fails quietly and plausibly, and each one looks like a bug in
the plugin rather than a gap in the setup. A stale MCP server keeps serving the previous
tool list, so a fix appears not to have landed. `glab` installed but not authenticated
fails at the first API call, several steps into a run. No Atlassian server means the
workflow correctly refuses to fake a Jira check and stops to ask by hand, which reads as
broken. Preflight turns each of those into a named finding with the cost spelled out.

It writes nothing, mutates no git state, and makes no network call beyond
`glab auth status`. It exits 0 when nothing is blocking and 1 otherwise, and `--json`
gives the same report as structured data.

### Sharing the output

```bash
node preflight.mjs --repo /path/to/your/project --redact
```

The normal output identifies you: your home path carries your name, and it prints your
GitLab username, your GitLab host, your repo path and your branch name. None of that is a
credential, all of it is company information, and it matters the moment someone pastes it
into an issue. `--redact` replaces those five with `<home>`, `<user>`, `<gitlab-host>`,
`<repo>` and `<branch>`, so the output can be attached without being read first. Every
diagnostic fact survives it, and a test asserts no verdict changes.

Credential scrubbing is a separate layer and is **always on**, in both this script and the
two bundled ones. Three places pass another program's output straight through, and one of
them matters more than it looks: `git remote get-url origin` returns whatever is
configured, and `https://oauth2:TOKEN@host/group/repo.git` is a form people really use.
Any URL's userinfo half is stripped, along with GitLab, GitHub, Atlassian and Slack token
shapes, bearer headers, JWTs, and `token=`/`secret=`/`password=` values. Git SHAs are
deliberately left alone, since a 40-character hex string is far more often a commit than a
secret. Echoed output is also length-bounded.

Two things it deliberately does not claim to check, because they live in the editor
rather than on disk: whether your IDE has actually connected to the bundled server, and
whether you have accepted the tool prompts. Both are printed as reminders instead.

## Automated Tests

Run the test suite using Node's native test runner (zero external dependencies):

```bash
npm test
```

This validates:
- **Server Initialization**: Proves the bundled `mr-review-checks` MCP server boots over stdio and responds to JSON-RPC handshakes with all 5 tools.
- **Decision Modules**: Tests Jira ticket key parsing from conventional titles, path normalization across remote styles, discussion thread reconciliation, and git hunk attribution.
- **Script Resolution**: Verifies that `locate_bundled_scripts` returns executable paths to `fetch-mr.mjs` and `git-context.mjs`.
- **Preflight Diagnostics**: Validates that `preflight.mjs` executes and emits structured health checks.

## Requirements

- Windows, macOS or Linux. No prescribed command is tied to one shell: the workflow
  names no terminal tool (it states the two properties it needs from one, streaming
  output and a settable timeout, and lets you use whichever your environment exposes),
  response filtering goes through `node` rather than a shell's own JSON support, and
  the one recipe with no cross-shell equivalent — reading `git merge-tree` output —
  ships in both POSIX and PowerShell form.
- `node` — for the bundled `mr-review-checks` server. Zero dependencies, nothing
  to install.
- A `glab` MCP server (or equivalent GitLab API access) configured in your IDE's
  `mcp.json` — this plugin bundles `mr-review-checks` and communicates with GitLab
  directly via `glab` CLI or configured GitLab MCP servers. See [SETUP.md](SETUP.md).
- `git` and the `glab` CLI reachable from an **absolute** `PATH` entry. The bundled
  scripts resolve both to an absolute path themselves rather than letting the OS do
  it at spawn time, and they skip relative `PATH` entries — including the empty one
  that means the current directory — so a writable directory can't shadow either
  binary. If a resolution fails they say so and stop; they never retry with a bare
  command name. To pin a binary explicitly, set `GIT_PATH` or `GLAB_PATH` to its
  absolute path and the search is skipped.
- An Atlassian/Jira MCP server is recommended for automatic ticket verification,
  active-status transition, return-to-review transition, the closing comment, and
  optional worklog.
  Without it, the workflow remains stopped until the user manually supplies the
  exact Jira hostname, key, summary, and current status and confirms any required
  transition. There is no fail-open synchronization waiver.

## Usage

Paste a full GitLab merge request URL, optionally including a `#note_` fragment, or say
"handle MR comments" / "address review feedback" / "resolve the MR threads".
A fragment such as `#note_123` by itself has no host, project, or MR number, so the
skill asks for the full MR URL instead of guessing.

For what each step does, see [skills/mr-resolve/SKILL.md](skills/mr-resolve/SKILL.md) and [skills/mr-reflect/SKILL.md](skills/mr-reflect/SKILL.md).

## License

MIT — see [LICENSE](LICENSE).
