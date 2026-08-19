---
name: mr-comments
description: End-to-end workflow for GitLab merge request review comments - fetch every thread, triage each one, fix, commit, push, reply inline, resolve the threads, and log time to Jira. Use when the user pastes a GitLab MR or note URL (including a bare "#note_" link), or says things like "handle MR comments", "address review feedback", "fix reviewer comments", "go through the comments on this MR", "reply to the review comments", or "resolve the MR threads".
---

# MR Workflow — Addressing Review Comments

Triage and fix GitLab merge request review comments **one at a time** — each gets read, verified against the code, fixed, and confirmed before moving to the next.

Nothing in this workflow is project-specific. Host, project path, package manager, lint command, branch name, commit format, and Jira site are all **derived at runtime** (Steps 0–1). Never hardcode them, and never carry values from a previous session — re-derive every time.

## The six rules that matter most

1. **Fetch every comment before triaging any of them.** Reconcile your count against `user_notes_count`. A single comment on a freshly-reviewed MR almost always means you under-fetched. (Step 4)
2. **Show the triage report and stop.** No code edits before the user responds. (Step 6)
3. **Show the final summary and stop.** No commit, no push, before explicit approval. (Step 8)
4. **Let the user choose how to handle a heavy pre-push hook.** Never pick `--no-verify` yourself. (Step 9)
5. **Preview thread replies and stop.** No posting or resolving before approval. (Step 10)
6. **Preview any steering-file change and stop.** It shapes every future request in the repo. (Step 12)

Rules 2–6 are hard stops even when the change looks trivial. This list is exhaustive — there are no other gates.

## Step 0 — Parse the MR URL

A GitLab MR URL has a fixed shape:

```
https://{host}/{project_path}/-/merge_requests/{iid}[#note_{note_id}]
```

Split on the `/-/` separator — it's the reliable delimiter, since `{project_path}` can be nested to any depth (`group/sub/sub/repo`):

| Part | From the example `https://git.example.net/a/b/c/repo/-/merge_requests/485#note_81047` |
|---|---|
| `host` | `git.example.net` — pass as `hostname` to every API call |
| `project_path` | `a/b/c/repo` — everything between host and `/-/` |
| `project_path_encoded` | `a%2Fb%2Fc%2Frepo` — every `/` becomes `%2F` |
| `iid` | `485` |
| `note_id` | `81047`, when the URL carries a `#note_` fragment |

**The `#note_` fragment is a starting point, never the full set.** It's the comment the user happened to click. Treat it as one entry in the list you fetch in Step 4, and verify it appears there.

If the user names an MR without a URL, derive host and project path from `vcs.remoteUrl` in Step 1.

## Step 1 — Profile the Project

This step establishes the project's real conventions. It has a **preferred path and a fallback path** — the skill must work either way, so never treat the tool as a hard requirement.

### Preferred: `get_project_profile`

If the `jira-ticket-workflow` power is installed, call its `project-scanner` tool once, passing the workspace root explicitly:

```
get_project_profile({ workspace_path: "{absolute workspace root}" })
```

### Fallback: derive it yourself

If that power isn't installed, the server isn't running, or the call errors, **don't stop and don't guess** — derive the same values directly. It's a handful of cheap reads:

| Value | Derive it from |
|---|---|
| Git host + project path | The pasted MR URL (Step 0). Otherwise `git remote get-url origin` |
| Package manager | Lockfile at the root: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lockb` → bun, `package-lock.json` → npm |
| Scripts | Read the `scripts` block of `package.json` |
| Monorepo tool | `nx.json` → nx, `turbo.json` → turborepo, `lerna.json` → lerna, `pnpm-workspace.yaml` → pnpm workspaces |
| Framework | Dependencies in `package.json` (`@angular/core`, `next`, `react`, `vue`, …) |
| Git hooks | Read `.husky/pre-commit` and `.husky/pre-push`; else `.git/hooks/` |
| Current branch | `git branch --show-current` |
| Dirty tree | `git status --porcelain` — any output means dirty |
| Commit convention | `git log --oneline -n 40` and read the actual subject lines |

Non-JS ecosystems have equivalents (`Cargo.toml`, `pyproject.toml`, `go.mod`, `pom.xml`); the principle is unchanged — read the real config, don't assume.

### Values used downstream

However they were obtained, these drive the rest of the workflow:

| Value | Used for |
|---|---|
| `vcs.host` | Host guard below |
| `vcs.remoteUrl` | Fallback source for host + project path when no URL was pasted |
| `packageManager.name` / `runCommandPrefix` | Lint command in Step 7 — never assume `pnpm`/`npm`/`yarn`. `null` outside JavaScript |
| `scripts` | The **full** script map. Monorepos often have `lint:{project}` entries and no generic `lint` — read it, don't assume. JavaScript only |
| `commands.lint` | Pre-resolved lint command that works on any ecosystem. Step 7's rung 3 |
| `monorepoTools` | Array. If it includes `nx`, lint targets can be invoked directly when no script matches |
| `frameworks` | Array — whether framework-specific steering (e.g. `angular-development`) applies at all. Check every entry: a polyglot repo may need two rule sets |
| `gitHooks.preCommitContent` / `prePushContent` | Step 9 — what actually runs on commit and push, and how slow it'll be |
| `stagedFormatter.scriptName` | The formatter to run ahead of the pre-commit hook |
| `git.currentBranch` | Step 3 branch comparison |
| `git.isDirty` | Step 3 safety check before switching branches |
| `git.commitConvention` | Commit message shape in Step 8 — including the `author` fallback when the repo-wide format is `null` |

**Host guard.** If `vcs.host` is not `gitlab`, stop and say so plainly:

> This repo's remote is {host}, not GitLab. This skill only covers GitLab merge requests — the review-thread API differs on other hosts. Want me to handle the review comments manually instead?

Do not improvise `gh` commands from a GitLab workflow.

Treat any `null` field as "not detected" — ask or skip the dependent step. Don't substitute a default.

## Step 2 — Fetch MR Details

```
mcp_gitlab_glab_api
  args:  ["projects/{project_path_encoded}/merge_requests/{iid}"]
  flags: { "hostname": "{host}" }
```

Single resource, so no `ndjson`. Use `mcp_gitlab_glab_api`, not `mcp_gitlab_glab_mr_view` — see Appendix.

Extract:

- `title` — e.g. `fix(PROJ-2167): fix employment status next button`
- `source_branch` — **authoritative** branch name to check out; never infer it from the title
- `target_branch`
- `state` — `opened` / `merged` / `closed`
- `user_notes_count` — the comment count you'll reconcile against in Step 4

Parse from the title:

- **Ticket key** — `[A-Z]+-\d+`. The project prefix is whatever the MR uses; never assume a specific one.
- **Commit type** — the word before the parentheses (`fix`, `feat`, `chore`, `refactor`, …). Reuse this exact type in Step 9 rather than defaulting to `fix`.

If `state` is `merged` or `closed`, tell the user and ask whether to proceed (e.g. as a follow-up fix on a new branch).

## Step 3 — Check Out the Right Branch (before touching any code)

**Check `git.isDirty` (Step 1) first — it gates every path below, not just the switch.**
A dirty tree breaks a checkout *and* a pull: `git pull` over uncommitted changes
either aborts on conflict or strands you mid-merge. If dirty, stop and ask whether
to stash, commit, or discard. Never move over uncommitted work silently.

With a clean tree, compare `git.currentBranch` (Step 1) against `source_branch` (Step 2).

**Already on it** — `git pull` to catch up, then proceed.

**On a different branch** — switch:

```bash
git fetch origin {source_branch}
git checkout {source_branch}
git pull origin {source_branch}
```

**Not present locally** — `git checkout -b {source_branch} origin/{source_branch}`

State which branch you ended on before continuing.

## Step 4 — Fetch ALL the Review Comments

Fetch the full discussion list. Never fetch a single note by ID, even when the URL pointed at one:

```
mcp_gitlab_glab_api
  args:  ["projects/{project_path_encoded}/merge_requests/{iid}/discussions?per_page=100"]
  flags: { "output": "ndjson", "paginate": true, "hostname": "{host}" }
```

Three parts, all required:

- `ndjson` — this is a list endpoint, so the default output fails schema validation (see Appendix).
- `per_page=100` — **the endpoint defaults to 20 discussions per page.** Without this you silently get page one and every count downstream is wrong.
- `paginate: true` — follows the `Link` headers past page one when there are more than 100.

Each line is one discussion with its `id` (needed in Step 10) and `notes[]`.

### Reconcile the count before going further

1. Drop activity-log noise: keep only notes where `system == false`. Entries like `"assigned to @x"` and `"requested review from @y"` are `system: true` and are not feedback.
2. Compare your remaining comment count against `user_notes_count` from Step 2.
3. **Mismatch → stop and re-fetch.** Never triage a partial set. Check pagination first — a count that's short by a round number (exactly 20, or exactly 100) is a paging artifact, not a missing comment. Re-issuing the same request without `per_page`/`paginate` returns the same truncated page.
4. If the URL had a `#note_` fragment, confirm that note is in your set.

Reviewers typically leave several comments in one pass. Finding exactly one is a signal to re-check, not a finding.

Capture per thread: discussion `id`, note `id`, `notes[0].position.new_path` and `new_line` (a `line_range` means it spans multiple lines), body, author, resolved state, and any existing replies — someone may have already answered or pushed a fix.

A thread with no `position` is a general MR-level comment; triage it as a general item, not a code comment.

If the user wants only open items, filter to `resolved: false` **after** fetching everything, so the counts still reconcile.

## Step 5 — Triage Each Comment (investigation only, no edits)

One at a time. Investigate, but change nothing yet:

1. Read the referenced file at the referenced line. Use `grep_search` / `read_code` if the code moved since the comment was posted.
2. Check whether a later commit already resolved it.
3. **If the reviewer names an API, mixin, or helper, confirm it exists before judging the comment.** Search the dependency tree, not just project source — a project-wide `grep_search` returning nothing usually means the symbol lives in `node_modules` (or the language's vendor directory), not that the reviewer is wrong. Read the real definition so your fix uses the real signature. Only push back after confirming it genuinely doesn't exist.
4. Classify:
   - **✅ Fix** — valid, actionable
   - **💬 Question** — needs an answer you don't have. Never guess; flag it.
   - **🔵 Nitpick** — style preference, low risk
   - **⚠️ Disagree** — you'd push back; record your reasoning
   - **✔️ Already addressed** — note what resolved it
5. Work out the concrete fix (file, change, one sentence) without applying it.
6. **Check whether comments interact.** Two comments on one file often imply a single combined fix, or one sets a convention the other must follow. Settle that here so you don't rewrite the same line twice.
7. If any entry in `frameworks` from Step 1 matches a steering rule set (e.g. `angular` → `angular-development`), check the fix against it now. Match against the file you actually edited — in a polyglot repo the Angular rules don't apply to a change in the Python service.

## Step 6 — Present the Triage Report (BLOCKING)

Report every comment, then stop. Do not continue until the user replies.

```
### MR !{iid} — {title}
{N} comment(s) found ({X} unresolved, {Y} already resolved) — matches user_notes_count ✓

1. [✅ Fix] {file}:{line}
   Reviewer ({author}): "{trimmed comment}"
   → Proposed action: {one sentence}

2. [...]
```

Close with a direct question:

> Want me to proceed with the "Fix" items? Let me know how to handle the "Question"/"Disagree" ones.

- **Never skip this report**, however trivial the comments look.
- The user may approve all, approve a subset, override a classification, or answer flagged items inline. Follow their reply.
- A bare "go ahead" approves **Fix** and **Nitpick** only. Keep holding **Question** and **Disagree** until explicitly resolved.

## Step 7 — Fix One Comment at a Time

For each approved item:

1. Read the exact code before changing it.
2. Apply the fix with `str_replace` (`fs_write` for larger rewrites).
3. Follow existing project conventions, including any framework steering identified in Step 5.
4. Lint using the profile from Step 1 — never a hardcoded package manager, and never assume a bare `lint` script exists. Resolve the command in this order:

   1. **Project-scoped script** — monorepos usually expose one script per project (`lint:mobile`, `lint:components-ui`, …) and no generic `lint` at all. Find the entry in `scripts` matching the library or app you edited:
      ```
      {packageManager.runCommandPrefix} lint:{project}
      ```
   2. **Monorepo runner** — if no matching script exists and `monorepoTools` includes `nx`, invoke the target directly:
      ```
      {packageManager.name} nx lint {project}
      ```
   3. **`commands.lint` from the profile** — already resolved with the right precedence (task-runner target → package script → ecosystem default), and it's the only rung that works outside JavaScript:
      ```
      {commands.lint.command}
      ```
      This is what makes the step function on a Python or Rust repo, where `runCommandPrefix` is `null` and `scripts` is empty. Mention `commands.lint.source` when reporting, so the user can see whether it came from their Makefile or a generic default.
   4. **Nothing matches** — say so and skip. Don't invent a command.

   Prefer the narrowest scope that covers your change. Rung 1 beats rung 3 for exactly this reason: a repo-wide `check` script that lints and builds every app can take minutes, while linting the one affected project takes seconds. Only drop to `commands.lint` when nothing project-scoped exists.
5. Confirm in one line what changed and which comment it addresses, then move on.

Keep fixes traceable per comment — don't merge unrelated changes to the same file into one edit.

### Self-review pass (after all fixes, before presenting the summary)

When `reviewChecklist` from Step 1 has `checklistContent` (a review checklist was detected in the project's AI-instruction files), **apply it now** against the actual staged diff — not from memory of what you changed, but from `git diff --cached` or `git diff` output.

Only apply checklist items relevant to the files you touched. A 40-item checklist against a 3-line diff should produce 2–3 relevant checks, not 40 lines of "N/A."

If the checklist catches something:
- Fix it silently (same as a lint fix — no separate approval round).
- Mention it in the Step 8 summary as "caught by self-review checklist" so the user knows the checklist earned its keep.

**Three-tier degradation:**

1. `checklistContent` is non-null → apply it directly. Content is already inlined from Step 1.
2. `checklistContent` is null but `found` is true → instruction files exist but none matched the review keyword pattern. Scan `allSources` file names; if one looks relevant (e.g. a file named `conventions.md` or `standards.md`), read it and apply any review-shaped rules. If nothing fits, skip.
3. `found` is false → no AI instruction files at all. Run a **generic built-in pass** instead:
   - Re-read the actual diff (`git diff` for unstaged or `git diff --cached` for staged). Compare what's there against what you *think* you changed — catch accidental leftover `console.log`, `debugger`, commented-out code, or unrelated file changes that got staged.
   - Confirm every change traces to a stated reviewer comment (no scope creep).
   - Scan the diff for accidentally-added secrets (API keys, tokens, passwords in string literals).

This pass is silent when it finds nothing. It never blocks or asks questions — it either fixes inline or reports in Step 8. The user doesn't interact with it directly.

## Step 8 — Present the Final Summary (BLOCKING)

Once all approved fixes are in and lint passes:

1. Summarize:
   - Each comment fixed, one line apiece
   - Files modified (`git status --short`)
   - Items still needing user input (questions, disagreements)
   - Anything skipped, and why
   - The commit message you intend to use, built from `git.commitConvention.suggestedFormat` with the type and ticket key from Step 2:
     ```
     {type}({TICKET-KEY}): address MR review comments
     ```
     When `suggestedFormat` is `null` (a `mixed-or-freeform` repo), fall through in this order before asking:
     1. `git.commitConvention.author.suggestedFormat` — the repo may be inconsistent while this contributor is not.
     2. If that's `null` too because `author.lowConfidence` is set, look at the **MR title itself** from Step 2. It's a commit-shaped string the reviewer already accepted, so mirroring its type and scope is the safest inference.
     3. Still nothing → ask the user once. Never invent a convention.

2. Ask:
   > All fixes are applied and lint passes. Ready to commit and push?
   >
   > - **Commit message:** `{type}({TICKET-KEY}): address MR review comments`
   > - **Time spent on this review pass?** (e.g. `1h`, `30m`, `2h 30m` — or skip)
   >
   > (yes / let me review first / adjust message / skip time)

3. **STOP. No commit. No push. Wait for explicit approval.**

If the user says "let me review first", wait. Re-present the summary after any further edits.

## Step 9 — Commit and Push (only after approval)

### 1. Read the hooks before running anything

Neither hook should be a surprise:

- `gitHooks.preCommitContent` typically runs a staged-file formatter. Run that command yourself first (`stagedFormatter.scriptName`) so the hook becomes a fast no-op. On the Step 1 fallback path this field won't exist — read `.husky/pre-commit` directly and use whatever script it invokes.
- `gitHooks.prePushContent` is often much heavier — a full lint-and-build `check` across every app. **Don't start it. Commit first, then present the choice in section 3 and wait.**

### 2. Stage and commit

1. `git status` — stage specific files **by name**. Never `git add .`; the tree may hold unrelated work.
2. Commit with the type and format established in Step 8.

Run both as terminal commands — see the note at the end of this step.

### 3. The pre-push hook decision (BLOCKING)

When `prePushContent` runs builds rather than a quick check, say what it will do and let the user pick.

**Format the options as a real markdown list, each on its own line.** Do not put them in a blockquote and do not run them together in a paragraph — consecutive lines inside a blockquote collapse into one line when rendered, which makes a three-way choice unreadable at exactly the moment the user has to decide something.

Emit this shape:

---

Committed. Now the push — this repo's pre-push hook runs `{command}`, which lints and builds all {n} projects ({list them}). That takes several minutes and will probably exceed my command timeout.

**How do you want to handle it?**

- **(a) Run it here** — safest, identical to CI, but likely to hit my timeout
- **(b) Give me the command** — you run it in your own terminal, where a long task is fine
- **(c) Skip with `--no-verify`** — reasonable if CI runs the same checks

---

Then wait for the answer.

**Never choose (c) yourself.** A hook exists because someone wanted it enforced; a tool shouldn't bypass it unilaterally. But if the user picks (c), that's a legitimate choice — carry it out in section 4 without arguing.

When (c) is used, **say so in the MR** so review isn't misled. Reviewers assume the hook ran unless told otherwise.

This is the one legitimate exception to Step 10's threaded-reply rule: the disclosure doesn't belong to any reviewer's thread, so it goes up as a **general MR comment**. Include it in the Step 10 preview table as its own row so the user approves the wording, then post it with:

```
mcp_gitlab_glab_api
  args:  ["projects/{project_path_encoded}/merge_requests/{iid}/notes"]
  flags: {
    "method": "POST",
    "field": ["body=Pushed with `--no-verify` — pre-push lint/build skipped, relying on CI."],
    "hostname": "{host}"
  }
```

Note the endpoint is `/notes`, not `/discussions/{id}/notes`.

**Mention the timeout up front.** On a monorepo building several apps, (a) will very likely be killed mid-hook — verified on a real repo where the mobile production build alone ran past ten minutes. Saying so makes (b) and (c) informed choices rather than fallbacks.

**If the option they chose then fails, don't escalate to a more permissive one.** Choosing (a) is not consent to (c) when (a) times out. Report what failed, confirm the actual state (`git status -sb` and `git log --oneline -1` — a hook killed mid-run usually means nothing was pushed), and re-offer the remaining options.

### 4. Push

The branch already tracks upstream, so no `-u`:

```bash
git push              # if user chose (a), or the hook is light enough that no choice was needed
git push --no-verify  # only if the user explicitly chose (c)
```

If the remote diverged (someone else pushed to the MR branch), pull or rebase first. **Never force-push without explicit confirmation.**

### Use terminal commands, not git MCP tools

When `gitHooks.manager` is set, run `git add`, `git commit` and `git push` as
**terminal commands** (`execute_pwsh`). Do not use `mcp_git_git_add` /
`mcp_git_git_commit` — hooks execute either way, but through an MCP tool you get
no visible output, no timeout, and no TTY. A stalled hook (e.g. `pretty-quick`
waiting on a full pipe) is indistinguishable from a crash.

Verified on a real repo: `git_commit` hung indefinitely while the pre-commit hook
ran the staged formatter, with no output visible. A terminal command streams hook
output live and fails on a timeout you can act on.

## Step 10 — Reply Inline and Resolve Each Thread

After the push, prepare replies — but post nothing yet.

### Preview (BLOCKING)

```
### Proposed MR thread replies

| # | Thread (file:line) | Proposed reply |
|---|---|---|
| 1 | _banner.scss:17 | "Fixed — switched to the directional radius mixin. See latest commit." |
| 2 | _(general MR comment)_ | "Pushed with `--no-verify` — pre-push lint/build skipped, relying on CI." |

Post these replies and resolve the threads? (yes / edit #N / skip)
```

Row 2 only appears if the user chose `--no-verify` in Step 9.

**STOP until the user approves.** They may approve all, edit a specific reply, or skip some — don't post or resolve anything skipped.

### Reply on the thread

Use the discussion `id` captured in Step 4. Replies must be **threaded under the reviewer's comment**, never posted as a general MR comment — the sole exception is the `--no-verify` disclosure from Step 9, which has no parent thread:

```
mcp_gitlab_glab_api
  args:  ["projects/{project_path_encoded}/merge_requests/{iid}/discussions/{discussion_id}/notes"]
  flags: {
    "method": "POST",
    "field": ["body=Fixed — {what changed}. See latest commit."],
    "hostname": "{host}"
  }
```

For **Question** or **Disagree** items, never reply with a fix confirmation. Post the user's answer or approved reasoning instead.

### Resolve

Immediately after replying, in the same pass:

```
mcp_gitlab_glab_api
  args:  ["projects/{project_path_encoded}/merge_requests/{iid}/discussions/{discussion_id}"]
  flags: {
    "method": "PUT",
    "field": ["resolved=true"],
    "hostname": "{host}"
  }
```

Never leave a fixed comment unresolved, and never resolve without a reply explaining what changed. For questions and disagreements, resolve only after the user confirms.

## Step 11 — Log Time Spent

Use the duration gathered in Step 8 — **don't ask again.**

If the user gave a duration, resolve the Jira site rather than assuming one:

1. `getAccessibleAtlassianResources` → `cloudId`. With several sites, match against the ticket prefix or ask.
2. `addWorklogToJiraIssue` with that `cloudId`, `issueIdOrKey` = the ticket key from Step 2, and `timeSpent`.

`timeSpent` takes the same format as an estimate: `30m`, `2h`, `1d`, or a
combination like `2h 30m`. A range (`1-2h`) is invalid — ask for a single value.

This step depends on the Atlassian MCP server. If those tools aren't available, say so and give the user the ticket key and duration to log manually — don't treat it as a workflow failure. The code work is already complete by this point.

If the user declined in Step 8, skip without asking again.

## Step 12 — Capture Recurring Lessons (BLOCKING, and often skipped)

The point of this step is that the *next* feature avoids the mistake this MR caught.
It runs here, not in a hook, because the reasoning behind each fix is still in
context — a hook firing after the push would only see the diff and would have to
guess why the change was made.

### What earns an entry

Not every comment does. Most don't. Apply this test to each **✅ Fix** and **🔵 Nitpick** from Step 5 — record it only if **all three** hold:

1. It's a **convention or pattern**, not a one-off. ("Use the directional radius mixin" qualifies; "typo in a variable name" doesn't.)
2. It can be phrased as an **instruction followable before writing code**, not a description of what went wrong.
3. It would **apply again** in a different file in this repo.

Skip, without asking:

- Typos, one-off logic bugs, business-requirement corrections
- **Anything lint or the formatter already catches.** The tool already enforces it; a steering rule adds weight for no behavior change. Steering is for what tooling *can't* catch.
- Anything you can only phrase vaguely. "Be careful with naming" is not a rule. If you can't make it specific, it isn't one.

**If nothing passes, say so in one line and go to Step 13.** Do not manufacture a rule to make the step feel productive — a file of weak rules is worse than a short file of sharp ones.

### The file

Target `.kiro/steering/review-feedback-patterns.md`.

**The file must explain its own notation.** The session that reads it is working on a
new feature and has never seen this skill — `×3` with no legend gets ignored or
misread as a priority label. A count with no attached instruction changes nothing.
When creating the file, open it with this header verbatim:

````markdown
# Review Feedback Patterns

Rules recovered from real merge-request review comments on this repo.
`×N` is how many times review has flagged the same thing.

- **×1** — Established convention. Follow it.
- **×2–×3** — Recurring. Follow it, then verify the change against it before presenting work.
- **×4 and above** — Persistent failure. State explicitly that you checked this rule.
  A rule violated this often *while already in context* is usually worded too vaguely
  to act on — say so and propose a sharper wording rather than just complying harder.

Counts are maintained by the `mr-comments` skill. Don't edit them by hand.

## Repeat offenders

- Prefer `inject()` over constructor injection in new services. ×3

## SCSS

- Use the directional radius mixin, never `border-radius` shorthand — RTL breaks otherwise. ×1
````

Use `×` (U+00D7), not `*` — an asterisk is markdown emphasis and will italicise the
line or vanish.

### Keep it out of the MR

This file is AI scaffolding, not part of the change under review. A reviewer seeing it
in a bugfix diff will reasonably ask what it's doing there.

Exclude it **locally**. Don't use `.gitignore` — editing that is itself a committed
change, which announces the file you're trying to keep out:

```bash
echo ".kiro/steering/review-feedback-patterns.md" >> .git/info/exclude
```

`.git/info/exclude` is per-clone and never committed. Do this once, on the run that
first creates the file, and say you've done it.

**Keep it workspace-scoped — don't move it to a global steering directory.** The rules
are repo-specific: an SCSS mixin convention from this project is wrong in the next one,
and a global file would inject incorrect rules into unrelated work. Workspace-scoped
plus git-excluded is the combination that gets both properties.

The tradeoff to accept knowingly: the team never sees these rules, so each person
relearns the same lesson. If one turns out to be broadly useful, propose committing the
file as its own deliberate change — never bundled into an unrelated bugfix MR.

### Handling a repeat

Before adding anything, search the file for a rule already covering it.

- **Found** → increment the count. Never add a second bullet for the same rule.
- **Count reaches 3** → move it under `## Repeat offenders` at the top of the file.

The promotion is the part that does the work. A count is decoration; **position is
what changes behavior**, because rules earlier in a steering file carry more weight
than ones buried at the bottom. A rule being violated repeatedly is evidence it's
sitting too low to be read.

Don't log MR numbers or dates. The file is in git — provenance is already recorded,
and every increment has a commit explaining it.

### Present and stop

```
Proposed changes to .kiro/steering/review-feedback-patterns.md:

  NEW    [SCSS] Use the directional radius mixin, never shorthand — RTL breaks. ×1
  BUMP   [DI] Prefer inject() over constructor injection.  ×2 → ×3
         └ reaches 3, promoting to "Repeat offenders"

Skipped 4 comments as one-offs (2 typos, 1 lint-enforced, 1 business rule).

Add these? (yes / edit / skip)
```

**STOP until the user approves.** This file is injected into every future request in
this repo, so it shapes behavior far beyond this MR. It's the highest-leverage write
in the whole workflow and the one that least belongs on autopilot.

If the user skips, drop it — don't re-raise it next run.

### Keep it small

- One line per rule, imperative mood.
- **Never rewrite or delete an existing rule here.** If one looks wrong or contradicts a new finding, say so and let the user decide. This step appends and increments; nothing else.
- Past roughly 40 rules the file stops being read and starts being skimmed. At that point propose splitting it by domain into separate files with `inclusion: fileMatch`, so SCSS rules load for SCSS work instead of on every request.

## Step 13 — Where this skill ends

The threads are resolved, the worklog is logged. **Stop here.** Do not:

- ❌ Merge or approve the MR
- ❌ Delete the source branch
- ❌ Transition the ticket to Done / Merged / Closed
- ❌ Start on another set of review comments

Merging is the reviewer's call. The push you just made appears in the existing MR;
they'll see it and re-review. Transitioning the ticket to Done before they approve
tells the board the work is accepted when it hasn't been.

If the user explicitly asks you to do one of these, say what will happen and get
confirmation, rather than treating the request as blanket permission.

## Appendix — `glab` MCP Tooling Constraints

Two reproducible failure modes in the `glab` MCP server. Both cost turns if rediscovered.

### 1. Repo-scoped `glab` tools always fail

`glab mcp serve` runs with a working directory outside the repo, so repo-scoped subcommands die on a git check before doing anything:

```
Fatal: not a git repository (or any of the parent directories): .git
git: exit status 128.
```

This hits `mcp_gitlab_glab_mr_view`, `mcp_gitlab_glab_mr_note`, `mcp_gitlab_glab_mr_diff`, and siblings. **`--repo` does not help**, not even host-qualified — the git check runs first.

**Use `mcp_gitlab_glab_api` with an explicit encoded project path.** It needs no git context and covers every endpoint including POST and PUT.

A root-cause fix exists but is deliberately not used here: setting `GITLAB_HOST` and `GITLAB_REPO` under `env` in a workspace-level `.kiro/settings/mcp.json` makes the repo-scoped tools work (verified). It's rejected because it pins one repo per config file, which defeats the point of a portable skill. `mcp_gitlab_glab_api` needs no setup anywhere. (`cwd` is not a supported `mcp.json` field, so that route doesn't exist.)

Don't reach for `execute_pwsh` + raw `glab` as a first move either. It works, since the shell does run in the repo, but it throws away structured output and forces manual JSON parsing. Use it only when `glab_api` genuinely can't express the call.

### 2. List endpoints need `output: "ndjson"`

The MCP wrapper declares its response schema as a JSON object, so any endpoint returning a top-level **array** fails validation before the data is visible:

```
MCP tool call failed: expected record, received array
```

This affects `/discussions`, `/notes`, `/projects`, and every other collection. `output: "ndjson"` emits one object per line instead of one array.

**Rule of thumb: single resource → default output; collection → `ndjson`.**

## Quick Reference

| Step | Action |
| --- | --- |
| Parse URL | Split on `/-/` → `host`, `project_path` (encode `/` → `%2F`), `iid`, optional `note_id` |
| Profile | `get_project_profile` if available; else derive from lockfile, `package.json`, `.husky/`, `git log` — never a hard dependency |
| Host guard | `vcs.host != gitlab` → stop, tell the user, don't improvise `gh` |
| Fetch MR | `glab_api` → `.../merge_requests/{iid}` → `source_branch`, title, type, `user_notes_count` |
| Branch | Compare to `git.currentBranch`; check `git.isDirty` before switching |
| Fetch comments | `glab_api` → `.../discussions` with `output: ndjson`; drop `system: true`; **reconcile vs `user_notes_count`** |
| Triage | Classify each, verify reviewer-named APIs in `node_modules`, check cross-comment interactions — no edits |
| **Report** | **Full triage report, wait for go-ahead — hard stop** |
| Fix | One at a time; lint via `lint:{project}` script → `nx lint {project}` → generic `lint`, narrowest scope that covers the change. Self-review pass at the end (checklist if detected, generic diff scan if not) |
| **Summary** | **Summary + commit message, wait for approval — hard stop** |
| Commit | Run staged formatter first, stage by name, commit — terminal git, not MCP tools |
| **Pre-push** | **If the hook runs builds, present (a)/(b)/(c) and wait — hard stop. Never pick `--no-verify` yourself; disclose it in the MR if the user does** |
| Push | `git push`, or `git push --no-verify` per the user's answer. Never force-push without asking |
| **Replies** | **Preview replies, wait for approval — hard stop.** Then reply inline per thread, then resolve |
| Log time | Use the duration from Step 8 — don't ask again. Resolve `cloudId` via `getAccessibleAtlassianResources`, `addWorklogToJiraIssue` |
| **Lessons** | **Only patterns that would apply again — skip one-offs and anything lint catches. `×N` count, promote to top at ×3. Preview and wait — hard stop. Often correctly skipped entirely** |
| **Stop** | **Do not merge, approve, delete branch, or set Done. The reviewer decides.** |
| Never (process) | Commit or push without approval, post replies without previewing, skip the report, edit before approval, guess answers to reviewer questions, reply as a general MR comment instead of inline, resolve silently, force-push without asking, merge or approve the MR, escalate to `--no-verify` when the user's chosen option fails |
| Never (tooling) | Use `glab_mr_view`/`glab_mr_note` (always fail — use `glab_api`), omit `ndjson` on list endpoints, triage only the URL's `note_id`, use git MCP tools (`git_add`/`git_commit`) when hooks exist — use terminal commands, or dispute a reviewer-named API without searching the dependency tree |
| Never (hardcode) | Host, project path, package manager, lint command, branch name, commit format, Jira site, ticket prefix — all derived in Steps 0–2 |
| Never (assume tooling) | Abort because `get_project_profile` or the Atlassian tools are missing. Only `git` and the `glab` MCP server are truly required; everything else has a fallback |




