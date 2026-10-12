---
name: mr-resolve
description: Actively triages, fixes code, and replies to threads on GitLab merge requests, including conflict-first resolution. Fetches the MR, discussions, git context and Jira status, emits one complete first report, then waits for approval before checkout, reads, edits, publication, replies and Jira writes. Use when handling MR comments or resolving a merge conflict.
license: MIT
compatibility: GitLab only - GitHub and Bitbucket pull requests are out of scope. Needs network access, git, an authenticated glab or GitLab MCP server, Node.js for the bundled scripts and Atlassian MCP tooling for Jira.
metadata:
  version: "1.5.0"
  author: Youssef Fathalla
---

# MR review router

This skill is resident when activated. **Activation establishes resident state.** A captured trace may represent that one activation-time `SKILL.md` load; treat it as activation, not a reread. Do not read `SKILL.md` again during the run. The router is the authority for the complete first-report hot path; ordinary references are loaded only when a later card or an explicitly selected exceptional route permits them.

## Five invariants. Everything else is an instance of them

1. **A claim needs evidence from this run.** Any status, count or verification claim must trace to output seen in this run.
2. **A gate closes only on the user's words.** A plan or summary is not approval.
3. **Every list here is examples, never a boundary.** An uncovered case is a stop, not permission to improvise.
4. **A fact stated in two places will drift.** Keep each rule in one owner.
5. **Open-ended work needs a stopping rule.** If verification is bounded and still inconclusive, report that and stop.

## Dry-Run / Test Mode

Activated ONLY when the user explicitly includes the flag `--dry-run` or `--test-mode` (or phrases like `simulate only`). Never trigger on generic words like "test", "testing", or "write tests":

- Execute Steps 0–4 silently to profile and fetch the MR, discussions, git state, and Jira details.
- Emit the first report in Step 5 and **MANDATORY**: invoke the `ask_question` tool with friendly choices and write-in support.
- Once the user responds to the question modal, **do not execute any mutating actions** (no git checkout, no file edits, no commits, no pushes, no GitLab replies or thread resolutions, no Jira updates).
- Output a clear `[Dry-Run Summary]` detailing what files would be modified, what replies would be posted, and stop immediately.

## Resident run state and loading protocol

At activation, establish resident state without opening this file again:

```js
const runState = {
  residentLoaded: true,
  loadedReferences: new Set(),
  failedReferenceReads: new Set(),
  conflictFirstSelectedAt: null,
  firstReportEmittedAt: null,
  closedGates: new Set(),
};
```

Read references as ordinary files relative to this skill's directory, never as steering files. A successful reference read is cached for the rest of the run; only a failed or truncated read may receive one targeted retry. Every runtime reference path is directly reachable from this router; references do not point to references.

**Normal review lane rule:** after activation, issue zero explicit rereads of `SKILL.md`, `references/reporting.md`, or `references/investigating.md`, and load no reference speculatively. Do not open discussion-referenced project files, emit progress, or perform a write before the report. The report is the first user-facing output and the turn ends immediately after it.

## Internal discovery is not a user-facing report

Steps 0–4 are investigation, and all of them run *before* the report. Run them quietly. Never narrate which power or skill activated, parsed URL fields, the project profile, tool choice, or checks that passed — **Checks that passed — host is GitLab, tree is clean** are not report content. A different current branch than `source_branch` is normal, not an alarm.

## Step 0 — Parse the MR URL

Accept only:

```text
https://{host}/{project_path}/-/merge_requests/{iid}[#note_{note_id}]
```

Split at `/-/`; preserve nested project paths and URL-encode each slash for API inputs. A `#note_` fragment is only a starting pointer; fetch every discussion and verify it. If the URL does not split cleanly, stop and ask rather than guessing. GitHub and Bitbucket links are out of scope. If no URL was supplied, derive the host and project path from the workspace remote without inventing an IID; resolve the active open MR on the current branch (`projects/{project_path_encoded}/merge_requests?source_branch={branch}&state=opened`) before proceeding.

## Step 0b — Decide what the run is for, then pick the lane

**If this file seems not to describe the task, read Step 0b before concluding that — and never improvise a run around it.** Review is the default lane. Record `conflict-first-selected` only when the user's initial words explicitly make conflict resolution the purpose, such as “resolve the conflict” or “it can't merge.” Payload fields such as `has_conflicts`, `merge_status`, and `detailed_merge_status` never select the lane. A reply can select conflict-first only after the review report turn has ended.

The lane changes the middle of the run. It never changes which gates exist. For an initial conflict-first selection, load `references/conflicts.md` only after recording the selection, inspect the two cheaper paths, and present the resolution plan gate. **Beyond a mechanical pick:** state which regions are not straight side-picks. **Never start the merge or rebase before this gate closes.** A dirty tree or branch switch is a bigger deal in this lane, not a smaller one.

## Steps 1–4 — Investigate, without touching the working tree

**None of these four steps opens a file a comment points at, checks out a branch, or writes anything.** Keep the pre-report interval silent and read-only.

| Step | Decides | Required evidence |
| --- | --- | --- |
| **1 — Profile** | GitLab host, project identity, current branch, dirty state and authenticated username | bundled git context and the bundled fetch result, which obtains GitLab identity through `glab auth status` |
| **2 — Fetch MR** | MR state, mergeability, all discussions, triage, reconciled counts and pagination | one complete bundled result |
| **3 — Verify Jira** | exactly one `(Jira hostname, ticket key)` pair, exact status and reachable active target | `getAccessibleAtlassianResources`, then direct issue/status read (`fields: ["status", "summary"]`) for the known key; transition lookup deferred to Batch 3 if needed |
| **4 — Classify** | one classification per unresolved thread from comment text alone | ✅ Fix, 🔵 Nitpick, 💬 Question or ⚠️ Disagree |

A wrong project, terminal MR state, zero comments, incomplete pagination or unreconciled counts blocks. `undetermined` is not a pass. A no-ticket result is a flag only when the resident triage rules say it is safe; **No key at all is a hard stop** when Jira identity is required. Never claim current code, a verified fix, a proposed diff or completed handling before Step 6 reads the approved files. Resolved discussions are counted only as not re-checked against project code.

**Thread review state (`replyStatus`):**

- **`unanswered`:** Fresh reviewer comment, you haven't replied yet.
- **`author_replied`:** You replied last (describing fix/explanation), no reviewer reply since. Note in report: already answered by you, awaiting reviewer verification or ready to resolve on GitLab.
- **`reopened`:** Reviewer replied *after* your reply (e.g. follow-up question or indicating a fix was incomplete). Always quote the reviewer's *latest follow-up comment* rather than the original stale comment so the report captures the current objection.
- **Related/Duplicate threads:** When multiple threads raise the exact same issue across files (e.g. repeated question), group or cross-reference them in the report so the user doesn't make duplicate redundant decisions.

### Four batches, not fifteen turns

- **Batch 1 (Concurrent):** Dispatch `{scripts["fetch-mr.mjs"].run}` and `getAccessibleAtlassianResources()` concurrently in your very first turn — do not serialize them. Always pass `--out <path>` (e.g. `--out .git/mr-{iid}.json`) to save full discussions to disk and receive a compact summary or inlined payload on stdout, keeping the workspace tree clean. With adaptive output, if discussions are under ~20KB, `fetch-mr.mjs` inlines them directly on stdout (`inlined: true`) while still writing the backup file. The bundled fetch script already obtains authenticated GitLab identity through `glab auth status` and collects git state (`branch`, `remote`, `dirty`); do not run the unsupported profile command `glab api user --jq .username`.
- **Batch 2 (Concurrent):** **Known Jira key direct-read route:** when one key is settled, call `getJiraIssue` with `fields: ["status", "summary"]`. If Batch 1 did not inline discussions (`inlined: false`), read the discussion payload from `.git/mr-{iid}.json` via `view_file` in this same turn; if discussions were already inlined on stdout in Batch 1 (`inlined: true`), skip `view_file`. Do not call `getTransitionsForJiraIssue` in Batch 2 — defer it to Batch 3 alongside checkout if a start transition is needed. Do not use `atlassian-mcp/search`, Rovo, or any discovery search for that known Jira key:
  - `cloudId`: The resource `id` from Batch 1's `getAccessibleAtlassianResources` (**never the GitLab hostname**).
  - `issueIdOrKey`: `triage.facts.ticketKey` from Batch 1.
  - **CRITICAL:** Pass `fields: ["status", "summary"]` to `getJiraIssue`. Without `fields`, Jira returns hundreds of unneeded fields that overflow into `output.txt` and cost extra read turns. If the ticket is already in active development (e.g. `In Progress`), no start transition is needed. If the ticket is pre-active (`To Do` / `Backlog` / `To Review`), propose moving to `In Progress` in the report authorization list without checking transitions yet. Emit the report immediately.
- **Emit Report:** The first report follows immediately as the first user-facing output; no introductory message, reference reads, or same-turn continuation.
- **Batch 3 (After reply):** Checkout, call `getTransitionsForJiraIssue` (if the approved start transition is needed) to execute `transitionJiraIssue`, and deferred profile reads. **This checkout is batch 3 — after the report and the reply to it, not before.**
- **Batch 4 (After checkout):** Read the approved discussion files.

### Authoritative retrieval and forbidden callable family

The normal route is immediately beside its deny rule:

```text
ROUTE: {scripts["fetch-mr.mjs"].run} --project {project_path} --iid {iid} --instance {host} --out {scratch_path}
ROUTE: {scripts["git-context.mjs"].run}
DENY: never call or invoke any callable whose normalized name begins with glab_mr_
```

Locate the bundled script path from this skill's own directory; never hardcode a user path, `list_directory` the scripts folder, or hand-roll git reads. The script's complete result supplies MR, discussions, git context, triage, counts and pagination state. Do not call `glab_mr_view` or any `glab_mr_*` MCP tools. The normal path is repository-independent and must not be repeated after a complete result.

Only after the normal result is incomplete and an explicit fallback is selected may the run use the existing repository-independent raw/REST route. Preserve its completeness, pagination, field-preservation, triage and reconciliation checks. A fallback never weakens the deny rule. A check that didn't run is not a check that passed. On fallback, use `--raw-field`, never `--field`; pass `discussions_text` unchanged, do not rebuild payload objects, and treat `reconciles: null` as unknown.

## Step 5 — Present the Report (BLOCKING)

**The report is mandatory, it is the first user-facing text of the run, and it is a stop — end the turn on it and wait for a reply.** No tool call goes out in the same turn that emits it. **No claim about the code belongs in this report.** Follow the resident template below; the detailed historical reference is not a normal pre-report dependency, and `references/reporting.md` is read only if a later exceptional procedure explicitly requires it.

```text
### MR !{mr.iid} — {mr.title}

**{counts.needsYou} of {counts.feedbackThreads} thread(s) need your call.** {counts.resolved} more are already resolved on GitLab — I haven't re-checked those against the code, say the word if you want that.

{counts.countLine} · {counts.unresolved} unresolved / {counts.resolved} resolved on GitLab

- **State:** {mr.state}, {mr.mergeability} · **Target:** `{mr.targetBranch}` · **Pipeline:** {mr.pipeline}
- **Ticket:** `{jira.key}` — **{jira.currentStatus}**
- **Branch:** `{mr.sourceBranch}`
- **Blockers:** {triage.blockers} — or `none`
- **Flags:** {triage.flags} — omit when none

---

**1. {discussion.classification}** · `{discussion.path}:{discussion.line}`

Reviewer ({discussion.author}):

> {discussion.quote}

→ **What they're asking for:** {discussion.request}

{repeat the complete item for every unresolved discussion; do not itemize resolved discussions}

**Say go and I'll:**

1. {approval.checkout} — check out the MR source branch `{mr.sourceBranch}`.
2. {approval.reassign} — if flagged as not assigned to you, reassign MR !{mr.iid} and Jira `{jira.key}` to you.
3. {approval.jiraStart}
4. {approval.postCheckoutReads} — implement only approved ✅ Fix / 🔵 Nitpick items; leave 💬 Question / ⚠️ Disagree items unresolved and outside this authorization.
5. {approval.laterStop}

{closing.defaultQuestion}
{closing.blockerReplacement}
```

When `mr.draft` is true, render this visible non-blocking flag: `Draft MR — review may proceed, but it is not ready for merge completion.`

🛑 **Gate: User Confirmation Required Before Proceeding.**

- **If `ask_question` tool is available in your environment (Antigravity, Claude Code):** You MUST invoke `ask_question` with the question structure below.
- **Graceful Fallback (Kiro, Cursor, Windsurf, VS Code):** If `ask_question` is NOT registered in your active tools, format the questions clearly in chat markdown with numbered options, end your turn, and wait for the user's reply before proceeding.

**Question Structure (Modal Carousel or Chat Fallback):**
Provide distinct questions (`1 of 2` or `1 of 3`):

1. **Question 1 (Action & Scope):**
   - **Recommended option:** `(Recommended) Proceed with fixing approved comments and checkout branch`
   - Alternate options: `Resolve merge conflicts first`, `I will review comments manually`, or `Cancel`.
2. **Question 2 (Jira Status & Assignment):**
   - **Recommended option:** `(Recommended) Move ticket to In Progress and ensure assigned to me`
   - Alternate options: `Leave Jira status unchanged`.

- Keep phrasing friendly and conversational. Avoid robotic AI markers like brackets, em dashes, or artificial formulaic tags.
- Note: When using `ask_question`, it automatically provides a write-in text field by default on every question. In chat fallback, mention that the user can pick a number or type custom feedback/instructions (such as approving only specific comment IDs).
- Do not proceed to Step 6 or subsequent steps until the user answers the modal or replies in chat.

**What a bare “go ahead” covers: batches 3 and 4, checkout, the Jira transition the report named (moving To Do or To Review to In Progress), reassigning MR and Jira ticket if not assigned to you, and implementation of the ✅ Fix / 🔵 Nitpick items.** 💬 Question / ⚠️ Disagree items remain unresolved and outside that authorization. Commits, pushes, replies, resolutions, Jira finish writes, worklogs and lesson writes remain gated. The Jira move is a line in that list, not a second question.

## Post-report index

The following cards are the only routes after Step 5. Each card states its boundary and points directly to its unique existing owner; procedure is loaded only after the card is eligible.

### Step 6 — Start Work: Checkout, Jira, Then the Code

**Eligible after:** Step 5 approval. **Allowed scope:** approved checkout of the MR source branch, listed Jira start transition, deferred profile reads and approved code reads; no commit or push. **Stop:** failed MR source-branch checkout, failed transition confirmation, or changed scope. **Procedure:** `references/checkout.md`.

### Step 6b — When the picture changes (BLOCKING)

**Eligible after:** Step 6 reads or an answered Question/Disagree changes the approved picture. **Allowed scope:** present the changed scope only. **Stop:** wait for approval; always offer reply to the thread without a code change. **Procedure:** `references/scope-gate.md`.

### Step 7 — Fix One Comment at a Time

**Eligible after:** Step 6/6b scope is settled. **Allowed scope:** sequential approved edits, validation and attribution. **Stop:** unexplained hunk or unverified result. **Procedure:** `references/fixing.md`.

### Step 8 — Present the Final Summary (BLOCKING)

**Eligible after:** exact staged bytes are validated and self-reviewed. **Allowed scope:** present the final summary. **Stop:** no commit or push until approval. **Procedure:** `references/summary-gate.md`.

### Step 9 — Commit and Push (only after approval)

**Eligible after:** Step 8 approval. **Allowed scope:** commit and push, with the user's heavy-hook choice. **Stop:** hook choice, divergence or remote conflict. **Procedure:** `references/publishing.md`.

**Conflict boundary:** never load `references/conflicts.md` from payload conflict state alone. It is eligible here only when this run already recorded an explicit conflict-first selection in the initial request or in a reply after the report turn; otherwise remain in the review lane and use the resident blocker question.

### Step 10 — Reply Inline and Resolve Each Thread

**Eligible after:** push and applicable conflict check. **Allowed scope:** preview, then approved replies and resolutions. **Stop:** preview before posting. **Procedure:** `references/publishing.md`.

### Step 11 — Return Jira to Review and Log Time

**Eligible after:** publication ledger is complete. **Allowed scope:** ask for time, then approved Jira writes. **Stop:** time question before writes. **Procedure:** `references/jira.md`.

### Step 12 — Optional Follow-Up: Capture Recurring Lessons

**Eligible after:** explicit lesson opt-in. **Allowed scope:** exact previewed local steering append. **Stop:** preview before mutation. **Procedure:** `references/lessons.md`.

## Step 13 — Where this skill ends

**Eligible after:** Step 12 completed, skipped or inapplicable. **Allowed scope:** final status only. **Stop:** terminal. Do not merge or approve the MR, delete the source branch, transition Jira to Done/Merged/Closed, or start another review set.

## Reference files — load these when the pointer says to

Read references with the ordinary file-read tool, resolving `references/…` against this skill's own folder. They are not steering files. Every existing reference is directly indexed here: `references/batching.md`, `references/checkout.md`, `references/conflicts.md`, `references/failures.md`, `references/fixing.md`, `references/glab-tooling.md`, `references/investigating.md`, `references/jira-identity.md`, `references/jira.md`, `references/lessons.md`, `references/publishing.md`, `references/reporting.md`, `references/scope-gate.md`, `references/summary-gate.md`, and `references/user-mistakes.md`.

## Anything posted to GitLab or Jira gets written like a person wrote it

**The report's own prose is not exempt.** Avoid no escalating agreement, em dashes, emoji in remote prose, passive voice and canned replies. A reply three sentences longer than the comment it answers is usually too long. This applies to GitLab replies, commit messages and Jira worklogs. The write batch remains after the time question: **issue every Jira write in one turn:** transition, `addCommentToJiraIssue`, and `addWorklogToJiraIssue`; **Then one closing line, with each result stated separately.**
