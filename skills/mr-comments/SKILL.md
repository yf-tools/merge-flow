---
name: mr-comments
description: End-to-end workflow for GitLab merge request review comments - fetch every thread, triage each one, fix, commit, push, reply inline, resolve the threads, and log time to Jira. Use when the user pastes a full GitLab MR URL (optionally with a #note_ fragment), or says things like "handle MR comments", "address review feedback", "fix reviewer comments", "go through the comments on this MR", "reply to the review comments", or "resolve the MR threads".
---

# MR Workflow — Addressing Review Comments

Triage and fix GitLab merge request review comments **one at a time** — each gets read, verified against the code, fixed, and confirmed before moving to the next.

Nothing in this workflow is project-specific. Host, project path, package manager, lint command, branch name, commit format, and Jira site are all **derived at runtime** (Steps 0–1), directly from the repo — never hardcoded, and never carried over from a previous session. This skill has no dependency on any other Kiro power; re-derive everything every time.

## The six rules that matter most

1. **Fetch every comment before triaging any of them.** Reconcile your count against `user_notes_count`. A single comment on a freshly-reviewed MR almost always means you under-fetched. (Step 4)
2. **Show the triage report and stop.** No code edits before the user responds. (Step 6)
3. **Show the final summary and stop.** No commit, no push, before explicit approval. (Step 8)
4. **Let the user choose how to handle a heavy pre-push hook.** Never pick `--no-verify` yourself. (Step 9)
5. **Preview thread replies and stop.** No posting or resolving before approval. (Step 10)
6. **If recurring lesson capture is offered and accepted, preview its local steering-file change and stop.** It shapes future requests in this clone. (Step 12)

Rules 2–6 are hard stops when applicable. Step 12 is optional and adds a gate only after the user opts in.

## Mistakes a user can hand you — check for these before acting

This workflow reads a URL and a local repo, then acts on both. Neither is guaranteed to match what the user actually meant. Catch the mismatch before it costs a wasted branch switch, a fix applied to someone else's code, or a reply posted to the wrong MR — not after.

- **Malformed or non-GitLab URL** (Step 0) — **stop and ask.** If the URL doesn't split cleanly on `/-/merge_requests/`, don't guess at a `project_path`/`iid` from a partial match. Say the URL doesn't look like a GitLab MR link and ask for the correct one, or — if it's clearly a GitHub/Bitbucket PR link — go straight to the host guard in Step 1 instead of attempting any GitLab API call with garbage values.
- **MR belongs to a different project than the one open in this workspace** (Step 2) — **stop and ask.** Compare the MR's project path against the workspace's own `git remote get-url origin`. If they don't match, ask before Step 3 checks out anything — proceeding means checking out a branch that may not even exist in this repo, or worse, silently operating against the wrong codebase entirely.
- **The MR isn't actually assigned to or authored by the current user** (Step 2) — **flag it, don't block.** This isn't necessarily wrong — reviewing on someone else's behalf is a legitimate ask — but it's also the single most common typo outcome (pasting `!490` when you meant `!409`). Check `author`/`assignees` against the identity `glab` is authenticated as (or ask, if that's not cheaply available). Mention it in your Step 2 recap and let the user's next reply confirm or correct course, rather than waiting on an explicit answer.
- **The MR is `merged` or `closed`** (Step 2, already covered) — stop and ask before treating it as active work.
- **The MR has zero comments** (`user_notes_count: 0`) (Step 4) — **stop and ask.** Don't manufacture a triage report from nothing. Say there's nothing to review — this is a signal the user picked the wrong MR or it hasn't been reviewed yet, not a workflow to push through anyway.
- **The local branch has unrelated in-progress work** (Step 1/3, already covered by the dirty-tree check) — but also watch for a branch that's *clean* yet clearly not related to this MR (e.g. `git log` shows commits for a different ticket entirely with no relation to `source_branch`). If the checkout would silently discard the user's mental model of "what I'm currently working on," say what branch you're switching from and to, even when the tree is clean.
- **A reviewer comment references a file or line that no longer exists** (Step 5) — **flag it, don't block.** Say the referenced code is gone (renamed, deleted, or moved) as an item in the Step 6 report, and let the user decide whether it was already handled elsewhere or needs a fresh look at the new location.

Most of these fold into the existing approval gates — the host guard, Step 2's merged/closed check, Step 6's report — rather than adding new ones. The two that genuinely need their own pause (malformed URL, wrong project) are the two where continuing could touch the wrong code before you've said anything at all; the rest are lower-risk and just need to be surfaced as part of what you're already reporting.

## Formatting every report to the user

Every blocking step below (6, 8, 9, 10, 12) presents a list of things — comments, fixes, options, replies — and every one of them risks turning into an unreadable wall of text if you free-style the layout. Follow the same three rules everywhere, not just where a step spells it out:

1. **One item, one block.** Give each item its own header line (bold or `###`), then put each field — quote, proposed action, file path — in its own paragraph with a blank line before and after. Never write a field as an indented line directly under a list number: without a blank line, CommonMark treats it as a "lazy continuation" of the same paragraph, and every renderer reflows it into one dense run-on block.
2. **Tables are for short, single-line facts only** (a file path, a status, a count). The moment a column would hold a full sentence — a reviewer quote, a proposed reply, a multi-clause explanation — stop using a table and switch to the one-block-per-item style from rule 1. A table cell doesn't wrap a paragraph; it just cuts it off or crushes it.
3. **Separate items with a horizontal rule (`---`) or a blank line**, so a report with five items reads as five distinct chunks, not one paragraph five times as long.

The templates below already follow this. When a step doesn't give you an exact template (Steps 1, 2, 4, 11), still apply these three rules to whatever you report.

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

If the user names an MR without a URL, derive host and project path from `git remote get-url origin` in Step 1.

**If the URL doesn't split cleanly on `/-/merge_requests/{iid}`, stop here — don't proceed with a partial match.** A GitHub PR link (`.../pull/123`) or a Bitbucket one (`.../pull-requests/123`) will fail this split; so will a plain typo. Do not invent a `project_path` or `iid` from a best-effort guess — that value poisons every API call downstream with no visible error until it's confusing. Instead:

- If it's recognizably a GitHub or Bitbucket PR URL, skip straight to the host guard in Step 1 and say so rather than attempting a GitLab call.
- If it's not recognizable as any of the three, show the user what you parsed and ask them to confirm or repaste the URL.

## Step 1 — Profile the Project

This step establishes the project's real conventions. This power ships no scanner and depends on no other power — derive every value yourself, directly from the repo. It's a handful of cheap reads:

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

### What you carry forward from this step

Keep these in mind as plain facts, not a structured object — there's no schema to satisfy, just answers you'll reuse:

- The git host and project path — used for the host guard below, and as a fallback source when no URL was pasted (`git remote get-url origin`).
- The package manager and its run prefix (e.g. `pnpm` → `pnpm run`) — Step 7's lint command. Leave this blank for non-JS repos rather than guessing.
- The full `scripts` map from `package.json`, if JS — monorepos often expose `lint:{project}` entries and no generic `lint` at all.
- Any monorepo tool detected (`nx`, `turborepo`, `lerna`, pnpm workspaces) — Step 7's fallback rung.
- Any framework detected — decides whether framework-specific steering (e.g. an `angular-development` rule set) applies at all. A polyglot repo may need more than one.
- The pre-commit and pre-push hook contents — Step 9, both for what runs and how slow it'll be.
- The formatter script the pre-commit hook invokes, if any — run it yourself ahead of the hook in Step 9.
- The current branch and whether the tree is dirty — Step 3's safety check before switching branches.
- The commit message convention you can see in the real `git log` output — Step 8's commit message shape.

**Host guard.** If the git host isn't a GitLab instance, stop and say so plainly:

> This repo's remote is {host}, not GitLab. This skill only covers GitLab merge requests — the review-thread API differs on other hosts. Want me to handle the review comments manually instead?

Do not improvise `gh` commands from a GitLab workflow.

Treat anything you couldn't detect as "not detected" — ask or skip the dependent step. Don't substitute a default.

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

- **Ticket key** — `[A-Z]+-\d+`. The project prefix is whatever the MR uses; never assume a specific one. **If the title has no match at all** (no ticket-shaped prefix), don't invent one and don't leave `{TICKET-KEY}` as a literal placeholder in the eventual commit message. Fall back to omitting the ticket segment from the commit message template in Step 8, and mention once that no ticket key was found in the title.
- **Commit type** — the word before the parentheses (`fix`, `feat`, `chore`, `refactor`, …). Reuse this exact type in Step 9 rather than defaulting to `fix`.

**Ticket identity for optional Jira logging** — collect all ticket-shaped evidence now: keys in the MR title, `source_branch`, Jira browse links in the MR description, and linked issues if exposed. Do not choose one yet when they disagree; Step 11 reconciles them before writing a worklog.

If `state` is `merged` or `closed`, tell the user and ask whether to proceed (e.g. as a follow-up fix on a new branch).

**Sanity-check the MR itself before going further — this is where a wrong paste surfaces:**

- **Wrong project — actually stop and wait for an answer.** Compare this response's project (from the `project_id`/`web_url` in the payload, or just the `project_path` you already parsed) against the workspace's own remote (`git remote get-url origin`, read in Step 1). If they don't match, this is higher-risk than the author check below: Step 3 is about to check out a branch, and doing that against the wrong repo can silently touch code that has nothing to do with this MR. Ask before Step 3 runs: *"This MR belongs to `{mr project}`, but this workspace's remote is `{local project}`. Wrong URL, or is this intentional (e.g. reviewing a fork)?"*
- **Not your MR — flag it, but don't block on it.** Check `author.username` (and `assignees[]`, if present) against whatever identity you can confirm — the account `glab` is authenticated as, if cheaply available, or ask the user directly if not. A mismatch isn't automatically wrong (reviewing on someone else's behalf is normal), but it's also the shape of a simple typo (`!490` vs `!409`). Mention it as a line in your Step 2 recap — *"This MR is authored by {author}, not you — flagging in case that's a typo."* — and let the user's next message confirm or correct course, rather than waiting for an explicit answer before continuing.

## Step 3 — Check Out the Right Branch (before touching any code)

**Check the dirty-tree status from Step 1 first — it gates every path below.** If dirty, stop and offer only: stay on the current branch, or create a named stash with the exact recovery command (`git stash pop`). Do not propose committing unrelated changes onto this MR branch, and never offer discard as a convenience path; if the user explicitly requests deletion, show per-file diffs and reconfirm first.

With a clean tree, compare the current branch from Step 1 against `source_branch` (Step 2).

**Already on it** — `git fetch origin {source_branch}` then `git merge --ff-only origin/{source_branch}`.

**On a different branch** — switch without creating an incidental merge commit:

```bash
git fetch origin {source_branch}
git checkout {source_branch}
git merge --ff-only origin/{source_branch}
```

**Not present locally** — fetch first, then create the local tracking branch from the refreshed remote ref:

```bash
git fetch origin {source_branch}
git checkout -b {source_branch} origin/{source_branch}
```

If fast-forward fails, stop and show ahead/behind state. Never start a merge or rebase implicitly. State which branch you ended on before continuing.

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

**If `user_notes_count` was 0 in Step 2, there's nothing to reconcile — stop here rather than continuing into Step 5 with an empty set.** Tell the user this MR has no review comments yet and ask what they want to do (wait for a review, or confirm this is the right MR). Producing a triage report with zero items in Step 6 wastes a turn on a report that says nothing.

## Step 5 — Triage Each Comment (investigation only, no edits)

One at a time. Investigate, but change nothing yet:

1. Read the referenced file at the referenced line. Use `grep_search` / `read_code` if the code moved since the comment was posted. **If the file doesn't exist at that path anymore, or the line is out of range for the current file** (renamed, deleted, or moved since the comment was posted), don't silently skip it or guess a new location. Classify it as **✔️ Already addressed** only if you can show a later commit actually moved/removed that code on purpose; otherwise flag it explicitly in the triage report as *"file/line no longer exists — needs a fresh look"* so the user decides whether it still applies.
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
7. **Check the fix against whatever project conventions apply to the file you actually edited.** Judge relevance from what each rule set says it covers, not from its filename — a steering file describing itself as "Angular component conventions" applies to a `.ts` component and not to a change in the Python service. In a polyglot repo more than one set may apply; in a polyglot repo the wrong one applying is worse than none.
8. **If this skill's own memory file (`review-feedback-patterns.md`, written by Step 12) exists in this repo, read it now and check this comment against it.** Hardcoding this one name is correct — unlike a project's own conventions, this file is created by this skill, so its name is known. It exists specifically so a recurring pattern from a *previous* MR gets caught before the reviewer has to flag it again; written once and never consulted, it does nothing. If this comment matches an existing entry, say so in the triage report (e.g. *"matches an existing rule, ×2 already — this would be ×3"*) so the user sees the pattern repeating, not just this one instance of it.

## Step 6 — Present the Triage Report (BLOCKING)

Report every comment, then stop. Do not continue until the user replies.

**Never write the reviewer quote and proposed action as indented lines directly under a numbered item.** Without a blank line between them, CommonMark treats them as a "lazy continuation" of the same paragraph — every renderer reflows the number, file:line, quote, and action into one dense wrapped block, which is unreadable. Give each field its own line with a real line break between them, and separate items with a horizontal rule so the report scans instead of reads like a wall of text:

```
### MR !{iid} — {title}

{N} comment(s) found ({X} unresolved, {Y} already resolved) — matches user_notes_count ✓

---

**1. [✅ Fix] `{file}:{line}`**

Reviewer ({author}): "{trimmed comment}"

→ **Proposed action:** {one sentence}

---

**2. [💬 Question] `{file}:{line}`**

Reviewer ({author}): "{trimmed comment}"

→ **Proposed action:** {one sentence}

---

**3. [✅ Fix] _(general MR comment)_**

Reviewer ({author}): "{trimmed comment}"

→ **Proposed action:** {one sentence}

---
```

A thread with no `position` (Step 4) is a general MR-level comment, not tied to a file or line — use `_(general MR comment)_` in place of `` `{file}:{line}` `` for that item, the same convention Step 10 uses for its own general-comment row.

Each field — the header, the quote, and the action — sits in its own paragraph with a blank line on both sides. That blank line is what forces a hard break in every markdown renderer; don't drop it to save space.

Close with a direct question:

> Want me to proceed with the "Fix" items? Let me know how to handle the "Question"/"Disagree" ones.

- **Never skip this report**, however trivial the comments look.
- **Never collapse fields onto adjacent lines** to shorten the report — a long report with breathing room beats a short one that reads as a single paragraph.
- The user may approve all, approve a subset, override a classification, or answer flagged items inline. Follow their reply.
- A bare "go ahead" approves **Fix** and **Nitpick** only. Keep holding **Question** and **Disagree** until explicitly resolved.

## Step 7 — Fix One Comment at a Time

For each approved item:

1. Read the exact code before changing it.
2. Apply the fix with `str_replace` (`fs_write` for larger rewrites).
3. Follow existing project conventions, including any framework steering identified in Step 5.
4. Lint using what you found in Step 1 — never a hardcoded package manager, and never assume a bare `lint` script exists. Resolve the command in this order:

   1. **Project-scoped script** — monorepos usually expose one script per project (`lint:mobile`, `lint:components-ui`, …) and no generic `lint` at all. Find the entry in `package.json`'s `scripts` matching the library or app you edited:
      ```
      {run prefix} lint:{project}
      ```
   2. **Monorepo runner** — if no matching script exists and the monorepo tool is `nx`, invoke the target directly:
      ```
      {package manager} nx lint {project}
      ```
   3. **Ecosystem default** — a generic `lint` script (JS) or the equivalent for the ecosystem you detected (`ruff`/`flake8` for Python, `cargo clippy` for Rust, a Makefile `lint` target, …). Mention where the command came from when reporting, so the user can see whether it's project convention or a generic fallback.
   4. **Nothing matches** — say so and skip. Don't invent a command.

   Prefer the narrowest scope that covers your change. Rung 1 beats rung 3 for exactly this reason: a repo-wide `check` script that lints and builds every app can take minutes, while linting the one affected project takes seconds. Only drop to a broader command when nothing project-scoped exists.
5. Confirm in one line what changed and which comment it addresses, then move on.

Keep fixes traceable per comment — don't merge unrelated changes to the same file into one edit.

### Definitive validation and staging (before self-review and approval)

The final approval must cover the exact bytes that will be committed. Before the self-review pass:

1. Run and record the narrowest relevant **diagnostics/type check, targeted tests, lint, and smoke test**. Run a build when required by the change; otherwise record `deferred to CI`. A skipped check must include the reason.
2. Stage only the approved MR-review files by name — never `git add .`.
3. Run the pre-commit staged formatter discovered in Step 1, then re-stage anything it changed.
4. If formatting changed behavior-relevant bytes, rerun every affected validation check.
5. Use `git diff --cached` as the definitive input to the self-review and Step 8 summary. Also show `git status --short` so excluded work is visible.

Any later mutation — including a project checklist fix — loops back through this entire phase: validate affected behavior, stage by name, format, re-stage, inspect `git diff --cached`, then re-present Step 8 and wait again. An earlier approval never authorizes changed bytes.

### Self-review pass (after all fixes, before presenting the summary)

Before Step 8, re-read the definitive staged diff (`git diff --cached`) — not from memory of what you changed — and check it against whatever review conventions this project actually has.

#### 1. Discover review resources by what they say they do, not by their filename

**Never match on a fixed list of filenames.** Every project names these differently — `self-review.md`, `pre-flight.md`, `merge-readiness.md`, `definition-of-done.md`, or something with no obvious keyword at all — and a hardcoded list misses all the ones you didn't predict. Instead, use the fact that steering files, skills, and rule files nearly always **describe themselves**, and judge from that description.

Look wherever this project keeps agent-facing instructions. Common homes, as **hints and not an exhaustive list**:

- `.kiro/steering/` — steering files, each with frontmatter that usually carries a `description` and an `inclusion` mode
- `.kiro/skills/` or a `skills/` directory — each skill's `SKILL.md` has a frontmatter `description` stating when to use it
- Repo-root agent instructions under whatever name this project uses — `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.cursor/rules/*.mdc`, `.github/copilot-instructions.md`, and equivalents
- Ordinary contributor docs that often carry the same content — `CONTRIBUTING.md`, `docs/`, a PR/MR template

For each candidate you find, **read its `description` (or its opening lines if it has no frontmatter) and decide from that whether it's about reviewing, verifying, or checking work before it ships.** A file whose description says "checklist to run before opening a PR" qualifies regardless of what it's called. A file whose description says "how to set up the local database" doesn't, no matter how many review-ish words appear in its filename.

Two things worth knowing while you look:

- A steering file with `inclusion: manual` is **not** already in your context the way an always-included one is. Reading it here is the only way you'll see it — which is exactly the case this discovery step exists for.
- If this skill's own memory file (`review-feedback-patterns.md`, written by Step 12) is present, treat it as required reading rather than a candidate to weigh. Every rule in it came from a real reviewer catching something on a past MR in this repo. If it's never read back, its `×N` counts are just numbers nobody acts on.

#### 2. Offer what you found — don't silently apply it

If discovery turns up something relevant, **say what you found and offer to run it**, rather than either ignoring it or quietly applying it. The user knows their own conventions and may have a reason to skip. Phrase it plainly:

> Found `.kiro/steering/code-review-self.md` — its description says it's a self-review checklist to run before pushing. Want me to verify the changes against it before I commit?

If they say yes, apply only the items relevant to the files you actually touched — a 40-item checklist against a 3-line diff should produce 2–3 relevant checks, not 40 lines of "N/A." If they decline, note that and move on.

**Fold this offer into the Step 8 summary rather than raising it as its own separate pause.** Step 8 is already a hard stop asking "ready to commit and push?" — asking "and should I run this checklist first?" in the same breath is one decision point instead of two and avoids adding another gate.

#### 3. Always run the generic pass regardless

Whether or not a project-specific resource was found or run, do this much yourself — it's cheap and catches the mistakes that no checklist bothers to write down:

- Compare the diff against what you *think* you changed — catch accidental leftover `console.log`, `debugger`, commented-out code, or unrelated file changes that got staged.
- Confirm every change traces to a stated reviewer comment (no scope creep).
- Scan the diff for accidentally-added secrets (API keys, tokens, passwords in string literals).

Anything this catches must be fixed, then sent back through definitive validation, staging, formatting and the Step 8 approval gate. Do not silently change an already-reviewed staged set.

#### 4. Report what happened, in the Step 8 summary

Never let this pass stay invisible. In the Step 8 summary, state:

- What you found, named, and what its description said it was for — plus whether it was run, offered, or declined.
- If discovery turned up nothing relevant, say where you looked and ask once whether there's a review step you should know about for next time.
- Anything the pass actually caught and fixed.

## Step 8 — Present the Final Summary (BLOCKING)

Once all approved fixes are validated, formatted, staged, and self-reviewed, present this shape — one line per fixed comment, not a paragraph, and every open item called out separately so nothing needing the user's attention gets buried:

```
### Summary — ready to commit

**Fixed (N)**
- `{file}:{line}` — {what changed, one line}
- `{file}:{line}` — {what changed, one line}

**Files staged**
- `{file}` ({+X / -Y})
- `{file}` ({+X / -Y})

**Deliberately unstaged**
- `{file}` — {why excluded}

**Still needs your input**
- `{file}:{line}` — {question or disagreement, one line}

**Skipped**
- `{file}:{line}` — {what, and why, one line}

**Self-review**
- Generic diff scan: {clean / caught {what}, fixed}
- {Found `{path}` — its description says {what it's for}. Run it against these changes before committing? / Looked in {where you looked} — nothing describing itself as a review or pre-push check. Is there one I should know about for next time?}

**Validation evidence**
- Diagnostics/type check: {tool/command + result / unavailable + why}
- Targeted tests: {command + result / not applicable + why}
- Lint: {command + result}
- Smoke test: {result / not applicable}
- Build: {result / deferred to CI}

---

**Commit message:** `{type}({TICKET-KEY}): address MR review comments`

Ready to commit and push? (yes / let me review first / adjust message)
**Time spent on this review pass?** (e.g. `1h`, `30m`, `2h 30m` — or skip)
```

Omit any section that's empty (no skipped items → drop that heading entirely, don't write "none") — **except Self-review, which always appears**, since it's the only place that pass surfaces to the user at all.

**If the Self-review section offered a discovered resource, treat the user's answer to it as part of this gate.** "Yes, run it" means run it against `git diff --cached`; if it changes anything, loop through definitive validation, stage by name, run the formatter, re-stage, show the new cached diff/evidence, and re-present this summary before committing. A plain "yes" to the commit question with no mention of the checklist means they're fine proceeding without it; don't re-ask.

For the commit message, match the convention you saw in `git log` (Step 1), with the type and ticket key from Step 2. If the log history is inconsistent or you can't confidently read a convention from it, fall through in this order before asking:

1. Look at the commits made by the same author on this branch — the repo may be inconsistent while this contributor is not.
2. If that's still unclear, look at the **MR title itself** from Step 2. It's a commit-shaped string the reviewer already accepted, so mirroring its type and scope is the safest inference.
3. Still nothing → ask the user once. Never invent a convention.

**STOP. No commit. No push. Wait for explicit approval.**

If the user says "let me review first", wait. Re-present the summary after any further edits.

## Step 9 — Commit and Push (only after approval)

### 1. Re-check the approved staged set

Hooks were already read in Step 1, and the staged formatter already ran before Step 8. Confirm `git diff --cached` still matches the approved staged diff and `git status --short` contains no newly relevant unstaged file. If anything changed, return to definitive validation/staging and the Step 8 gate.

The pre-push hook may be much heavier — a full lint-and-build `check` across every app. **Don't start it. Commit first, then present the choice in section 3 and wait.**

### 2. Commit the already-approved staged set

Do not stage or format here; doing either after approval changes what the user reviewed. Commit with the type and format established in Step 8.

Run both as terminal commands — see the note at the end of this step.

### 3. The pre-push hook decision (BLOCKING)

When the pre-push hook runs builds rather than a quick check, say what it will do and let the user pick.

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

**Never choose (c) yourself.** A hook exists because someone wanted it enforced; a tool shouldn't bypass it unilaterally. But if the user picks (c), that's a legitimate private execution choice. **Never write or disclose it** in an MR comment, general note, thread reply, MR description, Jira comment, or any other remote text. Step 10 previews only reviewer-thread replies; it never adds a disclosure row.

**Mention the timeout up front.** On a monorepo building several apps, (a) will very likely be killed mid-hook — verified on a real repo where the mobile production build alone ran past ten minutes. Saying so makes (b) and (c) informed choices rather than fallbacks.

**If the option they chose then fails, don't escalate to a more permissive one.** Choosing (a) is not consent to (c) when (a) times out. Report what failed, confirm the actual state (`git status -sb` and `git log --oneline -1` — a hook killed mid-run usually means nothing was pushed), and re-offer the remaining options.

### 4. Push

The branch already tracks upstream, so no `-u`:

```bash
git push              # if user chose (a), or the hook is light enough that no choice was needed
git push --no-verify  # only if the user explicitly chose (c)
```

If the remote diverged (someone else pushed to the MR branch), fetch and show ahead/behind state, then stop for an explicit reconciliation decision. A merge or rebase can change the just-approved commit and therefore requires renewed validation and Step 8 review. **Never merge, rebase, or force-push implicitly.**

### Use terminal commands, not git MCP tools

When git hooks are present (Step 1), run `git add`, `git commit` and `git push` as
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

A reply is a full sentence, so don't put it in a table cell — a cell truncates or crushes it. Use one block per thread instead:

```
### Proposed MR thread replies

---

**1. `_banner.scss:17`**

→ "Fixed — switched to the directional radius mixin. See latest commit."

---

Post these replies and resolve the threads? (yes / edit #N / skip)
```

**STOP until the user approves.** They may approve all, edit a specific reply, or skip some — don't post or resolve anything skipped.

### Reply on the thread

Use the discussion `id` captured in Step 4. Replies must be **threaded under the reviewer's comment**, never posted as a general MR comment:

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

For **✔️ Already addressed** items, reply and resolve the same as a Fix — but say what already handled it (e.g. "Already fixed in `a3bbad5b` before this review pass — no further change needed.") rather than describing a change you just made.

### Resolve

Immediately after replying, in the same pass, resolve every thread you replied to on behalf of a **Fix**, **Nitpick**, or **Already addressed** item:

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

Before writing any worklog, reconcile ticket identity from Step 2:

- Exactly one key and title/branch/description agree → use it, preserving any Jira browse-link hostname as site evidence.
- Several keys, sources disagree, or Jira links point at different hosts → show them and ask which ticket/site receives the time.
- No unambiguous key → skip logging rather than guessing.

If the user gave a duration and identity is unambiguous, resolve and verify the Jira site:

1. A matching Jira browse URL exists → use its hostname as the `cloudId` candidate.
2. Otherwise call `getAccessibleAtlassianResources`. If several sites are accessible, do **not** infer ownership from the ticket prefix alone; ask which site, or call `getJiraIssue` on the candidate and show its summary for confirmation.
3. Verify the chosen `cloudId` + key resolves to the expected issue before writing.
4. `addWorklogToJiraIssue` with that verified `cloudId`, reconciled `issueIdOrKey`, and `timeSpent`.

`timeSpent` takes the same format as an estimate: `30m`, `2h`, `1d`, or a
combination like `2h 30m`. A range (`1-2h`) is invalid — ask for a single value.

This step depends on the Atlassian MCP server. If those tools aren't available, say so and give the user the ticket key and duration to log manually — don't treat it as a workflow failure. The code work is already complete by this point.

If the user declined in Step 8, skip without asking again.

## Step 12 — Optional Follow-Up: Capture Recurring Lessons

This is **not a default blocking gate**. After replies, resolutions and time logging are complete, say in one line whether any reusable pattern was noticed and offer lesson capture as an optional follow-up. Run the file mutation only when the user opts in; a user who says "done" or does not engage is finished with the workflow.

### What earns an entry

Not every comment does. Most don't. Apply this test to each **✅ Fix** and **🔵 Nitpick** from Step 5, **plus any 💬 Question or ⚠️ Disagree item that turned into an actual code change after the user's Step 6 answer** — the Step 5 label was your first guess before the user weighed in, and a question that resolved into "yes, change it" is exactly as eligible as something you labeled Fix from the start. Record it only if **all three** hold:

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

Add the path to `.git/info/exclude` only if it is not already present. `.git/info/exclude` is per-clone and never committed. Because this file has no git history, each rule must store compact, append-only provenance, for example `[sources: MR !123 note 456; MR !140 note 891]`. Say when the local exclusion is first created.

**Keep it workspace-scoped — don't move it to a global steering directory.** The rules
are repo-specific: an SCSS mixin convention from this project is wrong in the next one,
and a global file would inject incorrect rules into unrelated work. Workspace-scoped
plus git-excluded is the combination that gets both properties.

The tradeoff to accept knowingly: the team never sees these rules, so each person
relearns the same lesson. If one turns out to be broadly useful, propose committing the
file as its own deliberate change — never bundled into an unrelated bugfix MR.

### Handling a repeat

Before adding anything, search the file for a rule already covering it.

- **Found** → increment the count and append the new MR/note reference to the rule's `[sources: ...]` list if it is not already present. Never replace or drop earlier sources, and never add a second bullet for the same rule.
- **Count reaches 3** → move it under `## Repeat offenders` at the top of the file.

The promotion is the part that does the work. A count is decoration; **position is
what changes behavior**, because rules earlier in a steering file carry more weight
than ones buried at the bottom. A rule being violated repeatedly is evidence it's
sitting too low to be read.

Store the append-only `[sources: ...]` list beside each rule and deduplicate identical MR/note pairs. This file is intentionally git-excluded, so git cannot provide provenance and no commit records increments.

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

The threads are resolved, the worklog is logged. Say what happened in Step 12 too — even a one-line "no recurring patterns worth recording this time" closes the loop, since a summary that mentions everything except the step most likely to be silently skipped reads as incomplete. **Stop here.** Do not:

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
| Parse URL | Split on `/-/` → `host`, `project_path` (encode `/` → `%2F`), `iid`, optional `note_id`. Malformed/non-GitLab URL → stop and ask, don't guess |
| Profile | Derive directly from lockfile, `package.json`, `.husky/`, `git log`, `git status` — no external tool, no other power |
| Host guard | Git host isn't GitLab → stop, tell the user, don't improvise `gh` |
| Fetch MR | `glab_api` → `.../merge_requests/{iid}` → `source_branch`, title, type, `user_notes_count`. No ticket key in title → drop that segment, don't leave a literal placeholder |
| **Sanity check** | Compare the MR's project against the workspace's own remote; compare `author`/`assignees` against the current user. Flag a mismatch, don't block on it — let the user's next reply confirm or correct course |
| Branch | Compare to the current branch from Step 1; check the dirty-tree status before switching |
| Fetch comments | `glab_api` → `.../discussions` with `output: ndjson`; drop `system: true`; **reconcile vs `user_notes_count`**. Zero comments → stop, ask, don't produce an empty triage report |
| Triage | Classify each, verify reviewer-named APIs in `node_modules`, check cross-comment interactions, check against conventions relevant to the file actually edited, cross-check against this skill's own `review-feedback-patterns.md` if it exists — no edits. Referenced file/line no longer exists → flag explicitly, don't skip silently |
| **Report** | **Full triage report (including general MR-level comments), wait for go-ahead — hard stop** |
| Fix | One at a time; lint via `lint:{project}` script → `nx lint {project}` → generic `lint`, narrowest scope that covers the change. Self-review pass at the end: discover review resources by reading their **descriptions**, never by matching filenames; offer what you found rather than silently applying it; always run the generic diff scan regardless. Disclosed in the Step 8 summary, with the offer folded into that same gate |
| **Summary** | **Validate, stage by name, run formatter, re-stage, self-review `git diff --cached`, then show summary + evidence + commit message and wait — hard stop. Any later mutation loops back through this gate** |
| Commit | Re-check that `git diff --cached` matches the approved set, then commit — no staging or formatting after approval; terminal git, not MCP tools |
| **Pre-push** | **If the hook runs builds, present (a)/(b)/(c) and wait — hard stop. Never pick `--no-verify` yourself** |
| Push | `git push`, or `git push --no-verify` per the user's answer. Divergence → fetch, show ahead/behind, stop for an explicit reconciliation choice and renewed review; never merge/rebase/force implicitly |
| **Replies** | **Preview replies, wait for approval — hard stop.** Then reply inline per thread (Already-addressed items too), resolve every thread replied to |
| Log time | Use the duration from Step 8 — don't ask again. Reconcile key + Jira hostname evidence, verify the issue on the selected `cloudId`, then `addWorklogToJiraIssue` |
| **Lessons** | **Optional follow-up only. Patterns that would apply again; skip one-offs and lint-enforced items. Eligible items include Question/Disagree that became real fixes. `×N` count, append/deduplicate `[sources: MR !N note M; ...]`, promote to top at ×3. If accepted, preview and wait — hard stop** |
| **Stop** | **Do not merge, approve, delete branch, or set Done. The reviewer decides.** |
| Never (process) | Commit or push without approval, post replies without previewing, skip the report, edit before approval, guess answers to reviewer questions, reply as a general MR comment instead of inline, resolve silently, force-push without asking, merge or approve the MR, escalate to `--no-verify` when the user's chosen option fails |
| Never (tooling) | Use `glab_mr_view`/`glab_mr_note` (always fail — use `glab_api`), omit `ndjson` on list endpoints, triage only the URL's `note_id`, use git MCP tools (`git_add`/`git_commit`) when hooks exist — use terminal commands, or dispute a reviewer-named API without searching the dependency tree |
| Never (hardcode) | Host, project path, package manager, lint command, branch name, commit format, Jira site, ticket prefix — all derived in Steps 0–2 |
| Never (external dependency) | Call a tool or power that isn't installed. This skill relies only on `git` and the `glab` MCP server — no other Kiro power is ever required, and the Atlassian step (11) is purely optional |
| Never (silent assumptions) | Proceed on a malformed URL, an MR from a different project, an unassigned/not-yours MR, or a zero-comment MR without surfacing it first — see "Mistakes a user can hand you" |
| Never (brittle discovery) | Decide what a project's review resources are from a hardcoded filename list. Read each candidate's own `description` and judge from what it says it does — projects name these anything, and a fixed list misses whatever you didn't predict |




