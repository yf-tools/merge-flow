# `glab` MCP tooling constraints

Read this when a `glab` MCP call fails in a way you don't recognise, or before reaching for a `glab_mr_*` tool. Two reproducible failure modes, both of which cost turns every time they're rediscovered.

The standing rules that come out of this — use `glab_api` rather than repo-scoped `glab_mr_*` tools, and pass `output: "ndjson"` on collection endpoints — are stated in SKILL.md's Quick Reference. This file is the reasoning and the exact error text.

## 1. Repo-scoped `glab` tools always fail

`glab mcp serve` runs with a working directory outside the repo, so repo-scoped subcommands die on a git check before doing anything:

```text
Fatal: not a git repository (or any of the parent directories): .git
git: exit status 128.
```

**This is not a short list of exceptions — it's every `mcp_gitlab_glab_mr_*` tool that acts on one specific MR.** Confirmed failing this way: `mr_view`, `mr_note`, `mr_diff`, `mr_approve`, `mr_issues`. Don't treat an unlisted name as safe just because it hasn't been hit yet — assume any `glab_mr_*` tool taking an MR id/branch fails the same git check, and reach for `glab_api` first rather than trying the dedicated tool and discovering the failure live. **`--repo` does not help**, not even host-qualified — the git check runs first.

**Use `mcp_gitlab_glab_api` with an explicit encoded project path.** It needs no git context and covers every endpoint including POST and PUT.

A root-cause fix exists but is deliberately not used here: setting `GITLAB_HOST` and `GITLAB_REPO` under `env` in a workspace-level `.kiro/settings/mcp.json` makes the repo-scoped tools work (verified). It's rejected because it pins one repo per config file, which defeats the point of a portable skill. `mcp_gitlab_glab_api` needs no setup anywhere. (`cwd` is not a supported `mcp.json` field, so that route doesn't exist.)

Don't reach for a terminal `glab` call as a first move either. It works, since the shell does run in the repo, but it throws away structured output and forces manual JSON parsing. Use it only when `glab_api` genuinely can't express the call.

**If the failure looks like setup rather than tooling — no `glab` on PATH, an authentication error, no GitLab MCP server configured — say so and point the user at `node preflight.mjs --repo .` from the power's install directory, rather than diagnosing it a call at a time.** It checks `git`, `glab`, `glab auth status`, the bundled server and both scripts in one pass, and names what each missing piece will cost. Two things it deliberately cannot check are whether Kiro has connected to the bundled server and whether the tool prompts were accepted, so it prints those as reminders instead of claiming them.

## 2. The MCP `jq` flag is silently ignored — filtering needs the shell

`mcp_gitlab_glab_api` accepts a `jq` flag and **does nothing with it.** Verified twice against a real MR: both `jq: ".iid"` and `jq: "{iid, state, user_notes_count}"` returned the complete 4,604-character payload. No error, no warning — it just doesn't filter.

`glab api` has no `--jq` flag either (that's `gh`), so there's no CLI equivalent to reach for.

**Consequence:** every MCP `glab_api` call pays for the whole response in context, and a merge-request payload is ~4.6 KB of which about 300 bytes matter. That cost compounds, because every later turn in the run carries it.

**When a response is large and you only need a few fields, take it through the shell instead**, which *can* filter:

**Filter through `node`, not through the shell's own JSON support.** `node` is already a
hard requirement of this power, so it is present on every machine this runs on, which
neither `jq` nor a given shell's cmdlets can claim. The pipeline below is also
shell-agnostic: it carries no `$` for a POSIX shell to expand and no backtick for
PowerShell to treat as an escape, so the same line works in both.

```bash
glab api "projects/{project_path_encoded}/merge_requests/{iid}" --hostname {host} |
  node -e "const keep='iid state title source_branch target_branch user_notes_count has_conflicts merge_status detailed_merge_status'.split(' ');let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log(JSON.stringify(Object.fromEntries(keep.map(k=>[k,o[k]]))))})"
```

Measured: 4,604 → 281 characters, a 94% reduction, for the same information the workflow actually uses.

**The tradeoff, so you can choose deliberately:** the MCP server is a persistent process, so it pays no per-call startup; a terminal `glab` invocation costs about 276 ms of process spawn and config load (measured), on top of ~1.1–1.3 s for the request itself. So MCP is marginally faster per call and the shell is dramatically cheaper in context. **For anything you'll carry through the rest of the run, context wins.** For a one-off call whose result you use immediately and never reference again, either is fine.

Note that the GraphQL path in the section below sidesteps this entirely — field selection happens server-side, so nothing needs filtering afterwards.

## 3. List endpoints need `output: "ndjson"`

The MCP wrapper declares its response schema as a JSON object, so any endpoint returning a top-level **array** fails validation before the data is visible:

```text
MCP tool call failed: expected record, received array
```

This affects `/discussions`, `/notes`, `/projects`, and every other collection. `output: "ndjson"` emits one object per line instead of one array.

**Rule of thumb: single resource → default output; collection → `ndjson`.**
