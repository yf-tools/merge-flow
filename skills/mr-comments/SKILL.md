---
name: mr-comments
description: End-to-end workflow for GitLab merge request review comments - verify the linked Jira ticket is actively in progress, fetch every thread, triage each one, fix, commit, push, reply inline, resolve the threads, return Jira to review, and optionally log time. Use when the user pastes a full GitLab MR URL (optionally with a #note_ fragment), or says things like "handle MR comments", "address review feedback", "fix reviewer comments", "go through the comments on this MR", "reply to the review comments", or "resolve the MR threads".
---

# MR Workflow — Addressing Review Comments

Triage and fix GitLab merge request review comments **one at a time** — each gets read, verified against the code, fixed, and confirmed before moving to the next.

Nothing in this workflow is project-specific. Host, project path, package manager, lint command, branch name, commit format, Jira site, and Jira workflow statuses are all **derived at runtime** (Steps 0–2.5), directly from the repo and connected services — never hardcoded, and never carried over from a previous session. This skill has no dependency on any other Kiro power; re-derive everything every time.

## The twelve rules that matter most

1. **Verify the Jira ticket early and silently; ask about moving it later.** Identify and validate the ticket before any code work, and stop only if it's terminal, blocked, or unidentifiable. A needed status transition is not urgent — carry it to the triage report in Step 6 and apply it in Step 7. Never reclassify the current status as "active-equivalent" to avoid asking. (Steps 2.5, 6, 7)
2. **Fetch every comment before triaging any of them.** Reconcile your note count against `user_notes_count`, and keep threads, notes, and reviewer comments as three separate numbers. A single comment on a freshly-reviewed MR almost always means you under-fetched. (Step 4)
3. **Show the triage report and stop.** No code edits before the user responds. (Step 6)
4. **An answered Question is new scope, not an approval.** If it implies more than a line or two, gate it before editing. A plan and an edit in the same turn is not a gate. (Step 6b)
5. **Read `git diff --cached` and attribute every hunk before presenting Step 8.** `git add {file}` stages the whole file, including edits the user made while you worked. `git status` cannot see this; only the diff can. Report `+X / -Y` from `--numstat`, never from memory. (Step 7)
6. **Show the final summary and stop.** No commit, push, or later Jira review transition before explicit approval. (Step 8)
7. **Let the user choose how to handle a heavy pre-push hook.** Never pick `--no-verify` yourself. (Step 9)
8. **Preview thread replies and stop.** No posting or resolving before approval. (Step 10)
9. **If recurring lesson capture is offered and accepted, preview its local steering-file change and stop.** Approval covers the previewed lines only. It shapes future requests in this clone. (Step 12)
10. **A discovered self-review resource's offer is answered by the user, inside the Step 8 card — not by you.** See "Compliance claims require evidence, not description" above for the general rule; the checklist offer lives as a line in the Step 8 summary itself and only that specific gate applies to it. (Step 7's self-review pass, Step 8)
11. **Batch independent tool calls; never parallelize the actual edits.** Steps 1's profiling, 5's per-thread file reads, and 7's validation commands are read-only and independent — fire them together as plain parallel tool calls, no sub-agents needed. Step 7's fixes stay single-threaded and sequential in this process, because a concurrent edit looks identical, to the hunk-attribution check in rule 5, to an untracked edit from someone else. (Steps 1, 5, 7)
12. **The Jira review-transition result and the time-log question are one message, not two.** Don't report "Jira is now {status}" as its own message and then ask about time separately afterward — the resulting status belongs inside the same line as the time-log ask, appearing there for the first time. Same failure shape as rule 10: saying the fact once yourself and then folding it into a combined ask anyway is two messages doing the work of one. (Step 11)

Rules 1 and 3–9 are hard stops when applicable. Rules 11 and 12 are standing constraints on how you execute and how you phrase, not gates. The Jira transition, pre-push, and lesson gates are conditional; none authorizes a different remote mutation.

**Never explain a change you didn't make with a guess.** If an unexpected hunk, an unexplained line count, or a status you can't account for appears, the user is the cheapest source of truth — ask. Attributing it to a formatter, a plugin, or a config, when the tool's own output doesn't say so, converts a one-turn question into a false statement on the record. This is rule zero because it is what makes rules 1, 5, and 6 fail quietly rather than loudly.

### Compliance claims require evidence, not description

A related but distinct failure: reporting that something was checked, verified, or found clean is a claim about an action you took, not about what a resource says it does. This recurs anywhere a discovered resource — a checklist, a Step 8 precondition, a status, a count — sits between "found" and "reported done." Two shapes of it:

1. **Skipping the question and reporting a result anyway.** Naming a checklist and summarizing its *description* is not evidence you ran it. If you have not opened its full content and followed what it specifies, the only honest output is the open question — never a finding, a pass, or a count of violations attributed to it.
2. **Answering your own question.** Asking whether to run something, then substituting a generic pass or your own judgment for the reply and presenting the result as if the user had answered. "Otherwise I'll proceed" followed immediately by proceeding in the same breath is not a pause — it's rhetorical. Even correctly naming a gate as still-open (e.g. replying "no" to "did you run it?") does not license closing it yourself right then; noticing it's unresolved isn't the same as being told to resolve it.

The same standard applies to any status, count, or number reported anywhere in this skill: it comes from a command or tool call whose output you have actually seen in this run, never from memory, inference, or a resource's stated purpose. Rule 10 and Step 8's preconditions are where this has concretely gone wrong; see those for the observed failures.

## Mistakes a user can hand you — check for these before acting

This workflow reads a URL and a local repo, then acts on both. Neither is guaranteed to match what the user actually meant. Catch the mismatch before it costs a wasted branch switch, a fix applied to someone else's code, or a reply posted to the wrong MR — not after.

- **Malformed or non-GitLab URL** (Step 0) — **stop and ask.** If the URL doesn't split cleanly on `/-/merge_requests/`, don't guess at a `project_path`/`iid` from a partial match. Say the URL doesn't look like a GitLab MR link and ask for the correct one, or — if it's clearly a GitHub/Bitbucket PR link — go straight to the host guard in Step 1 instead of attempting any GitLab API call with garbage values.
- **MR belongs to a different project than the one open in this workspace** (Step 2) — **stop and ask.** Compare the MR's project path against the workspace's own `git remote get-url origin`. If they don't match, ask before Step 3 checks out anything — proceeding means checking out a branch that may not even exist in this repo, or worse, silently operating against the wrong codebase entirely.
- **The MR isn't actually assigned to or authored by the current user** (Step 2) — **flag it, don't block.** This isn't necessarily wrong — reviewing on someone else's behalf is a legitimate ask — but it's also the single most common typo outcome (pasting `!490` when you meant `!409`). Check `author`/`assignees` against the identity `glab` is authenticated as (or ask, if that's not cheaply available). Mention it in your Step 2 recap and let the user's next reply confirm or correct course, rather than waiting on an explicit answer.
- **The MR is `merged` or `closed`** (Step 2, already covered) — stop and ask before treating it as active work.
- **The MR points at no unambiguous Jira ticket** (Step 2.5) — **stop and ask.** Conflicting keys in the title, source branch, description, or linked issues can send status changes and worklogs to the wrong ticket. No key at all is a hard stop: require the actual Jira hostname and ticket key, or exit this workflow without touching the MR, branch, code, or shared Jira state.
- **The Jira ticket is `Done`, `Closed`, `Merged`, or otherwise terminal** (Step 2.5) — **stop and ask.** Never move completed work backwards merely because an MR still has comments.
- **The Jira ticket is not actively in development** (Step 2.5 → Step 6) — **don't stop for this.** Resolve the exact reachable active status quietly, then put the question in the Step 6 report footer so the user answers it next to the work it refers to. `To Do` normally moves to `In Progress`; `To Review` normally moves back to `In Progress` while review fixes are being made. Applying it happens in Step 7, after approval. `Blocked` or an unclassifiable custom status is different — that one stops immediately.
- **The MR has zero comments** (`user_notes_count: 0`) (Step 4) — **stop and ask.** Don't manufacture a triage report from nothing. Say there's nothing to review — this is a signal the user picked the wrong MR or it hasn't been reviewed yet, not a workflow to push through anyway.
- **The local branch has unrelated in-progress work** (Step 1/3, already covered by the dirty-tree check) — but also watch for a branch that's *clean* yet clearly not related to this MR (e.g. `git log` shows commits for a different ticket entirely with no relation to `source_branch`). If the checkout would silently discard the user's mental model of "what I'm currently working on," say what branch you're switching from and to, even when the tree is clean.
- **A reviewer comment references a file or line that no longer exists** (Step 5) — **flag it, don't block.** Say the referenced code is gone (renamed, deleted, or moved) as an item in the Step 6 report, and let the user decide whether it was already handled elsewhere or needs a fresh look at the new location.
- **The user edits the same files you're editing, while you work** (Step 7) — **stop and ask before committing.** They're watching the run; touching something adjacent, or carrying on with unrelated work in a file you happen to be in, is completely normal and they have no reason to announce it. `git add {file}` stages all of it, and `git status --short` shows ` M file.ts` either way, so nothing warns you. The only thing that catches it is reading `git diff --cached` and failing to attribute a hunk. Never explain an unattributable hunk with a guess about a formatter or plugin — ask whose change it is.

Most of these fold into the existing approval gates — Step 6's triage report (which also carries the Jira transition question), Step 6b's new-scope gate, and Step 8's final approval — rather than adding ad hoc pauses. Malformed URLs, wrong projects, ambiguous Jira identity, and terminal or blocked Jira tickets stop immediately, because continuing could touch the wrong code or means the premise of the whole run is wrong.

**The test for "stop now" vs "fold into a gate" is whether continuing wastes work or does damage — not whether a decision is needed.** A ticket sitting in `To Do` needs a decision, but triaging comments while it sits there costs nothing and is trivially reversible, so it waits. A ticket sitting in `Done` means you may have the wrong ticket entirely, so four minutes of triage might be four minutes thrown away. Same subsystem, opposite urgency. Getting this backwards is what produces the worst version of this workflow: a run that interrupts twice before showing anything and buries the report the user actually asked for.

## Internal discovery is not a user-facing report

Steps 0–5 are investigation. Run them quietly. Derive and retain every value you need, then say nothing about the ones that came back fine.

**Never narrate:**

- Which power or skill you activated, or that you're about to follow this workflow.
- Parsed URL fields (`host`, `project_path`, `project_path_encoded`, `iid`, whether a `#note_` fragment was present).
- The project profile (package manager, scripts, monorepo tool, framework and version, hook contents, commit convention).
- Which tool or endpoint you chose, or step numbers and step titles as progress announcements.
- Checks that passed — host is GitLab, tree is clean, MR project matches origin, branch checked out successfully.
- **That the Jira ticket is already in active development.** This is the single most tempting thing to report, because you just looked it up and it feels like progress. It isn't: the user learns nothing actionable, and it trains them to skim your status lines. Silence is the correct output for a ticket that's already `In Progress`.

**Do surface:**

- Anything that stops the workflow or needs a decision: malformed/non-GitLab URL, wrong-project MR, merged/closed MR, dirty tree, zero comments, ambiguous or missing Jira identity, terminal or blocked ticket, tool or API failures.
- The defined gates: Step 6's triage report (which carries the Jira transition question), Step 6b's new-scope gate, Step 8's summary, Step 9's pre-push choice, Step 10's reply preview, Step 12's lesson preview.
- Any staged hunk you can't trace to an approved comment or a formatter that said it changed that file (Step 7) — always ask, never explain it yourself.
- One-line flags that don't block: ownership mismatch, a branch switch that could surprise the user, a reviewer comment whose file or line is gone.

Note what is *not* on that list: a needed Jira transition. It is a decision, but it is not urgent, so it rides along with the triage report in Step 6 instead of interrupting the investigation. See Step 2.5.

### The one line before the report, and why it's the count

Triage on a real MR takes minutes — reading seven threads and their referenced files is genuinely slow, and there is no way to make it instant. What you can control is whether the user spends that time wondering if anything is happening.

Emit **exactly one line** when the fetch completes and the file-reading begins, and make it the count:

> Found 7 reviewer comments across 7 threads (9 notes, reconciles ✓). Reading the referenced files now.

That single line does three jobs no other phrasing does: it confirms the fetch worked, it tells the user how much is coming so the report's length isn't a surprise, and it sets expectations for a wait. *"Checking the MR and workspace…"* does none of them — it announces work instead of reporting a result.

Then go quiet until the report. No per-file narration, no "now reading X", no step titles. One line in, one report out. A user who wants the derived values will ask; a user who doesn't gets the decision they were waiting for instead of scrolling past a transcript.

A different current branch than `source_branch` is normal, not an alarm. With a clean tree, check it out and move on; only mention the switch when it could discard the user's mental model of what they were working on (see Step 3).

## Formatting every report to the user

Every blocking step below (2.5's terminal/blocked stop, 6, 6b, 7's hunk-attribution question, 8, 9, 10, 12) presents a decision or a list of things — status changes, comments, fixes, options, replies — and each risks becoming unreadable if you free-style the layout. Follow the same three rules everywhere, not just where a step spells it out:

1. **One item, one block.** Give each item its own header line (bold or `###`), then put each field — quote, proposed action, file path — in its own paragraph with a blank line before and after. Never write a field as an indented line directly under a list number: without a blank line, CommonMark treats it as a "lazy continuation" of the same paragraph, and every renderer reflows it into one dense run-on block.
2. **Tables are for short, single-line facts only** (a file path, a status, a count). The moment a column would hold a full sentence — a reviewer quote, a proposed reply, a multi-clause explanation — stop using a table and switch to the one-block-per-item style from rule 1. A table cell doesn't wrap a paragraph; it just cuts it off or crushes it.
3. **Separate items with a horizontal rule (`---`) or a blank line**, so a report with five items reads as five distinct chunks, not one paragraph five times as long.

The templates below already follow this. When a step doesn't give you an exact template (Steps 1, 2, 4, 11), still apply these three rules to whatever you actually surface — which, per the section above, is usually only a blocker, a flag, or a gate.

## Anything posted to GitLab or Jira gets written like a person wrote it

The formatting rules above are for the report you show in chat. Thread replies (Step 10) are different: they land on a real reviewer's screen as a GitLab notification, sitting next to whatever a human teammate would have typed. A templated-sounding reply is the fastest way to make a reviewer feel like their comment got a form response instead of an answer.

The single most common tell is opening every reply the same way — a short word, a dash, then the fix (`Fixed — did X.`, `Renamed — did Y.`, `Added — did Z.`). Six replies posted in the same batch with that same shape read as generated, even if each one is individually accurate. Write plain sentences instead: state what changed, skip the dash-led fragment, and vary how each one opens. Step 10 has the worked examples — read them before posting a batch of replies, not just the first time.

This applies to Jira text too, wherever this skill writes any (worklog comments, manual-mode instructions) — same principle, same fix: write it the way you'd actually say it, not as a template with the blanks filled in.

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

**Issue these as parallel tool calls in one turn, not one at a time.** None of these reads depend on another's result — the package manager doesn't need the framework detected first, and the hook contents don't need the commit convention. Reading them serially just adds latency for no benefit. The only sequencing constraint in this step is that it all finishes before Step 2.

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

Self-review resource discovery (Step 7) happens later, once there's a real diff to check something against — don't do it here. It's a handful of cheap reads when it does run; no need to front-load it.

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

**Ticket identity for Jira lifecycle synchronization** — collect all ticket-shaped evidence now: keys in the MR title, `source_branch`, Jira browse links in the MR description, and linked issues if exposed. Step 2.5 reconciles this evidence before any checkout or code work; do not postpone disagreement until worklog time.

If `state` is `merged` or `closed`, tell the user and ask whether to proceed (e.g. as a follow-up fix on a new branch).

**Sanity-check the MR itself before going further — this is where a wrong paste surfaces:**

- **Wrong project — actually stop and wait for an answer.** Compare this response's project (from the `project_id`/`web_url` in the payload, or just the `project_path` you already parsed) against the workspace's own remote (`git remote get-url origin`, read in Step 1). If they don't match, this is higher-risk than the author check below: Step 3 is about to check out a branch, and doing that against the wrong repo can silently touch code that has nothing to do with this MR. Ask before Step 3 runs: *"This MR belongs to `{mr project}`, but this workspace's remote is `{local project}`. Wrong URL, or is this intentional (e.g. reviewing a fork)?"*
- **Not your MR — flag it, but don't block on it.** Check `author.username` (and `assignees[]`, if present) against whatever identity you can confirm — the account `glab` is authenticated as, if cheaply available, or ask the user directly if not. A mismatch isn't automatically wrong (reviewing on someone else's behalf is normal), but it's also the shape of a simple typo (`!490` vs `!409`). Mention it as a line in your Step 2 recap — *"This MR is authored by {author}, not you — flagging in case that's a typo."* — and let the user's next message confirm or correct course, rather than waiting for an explicit answer before continuing.

## Step 2.5 — Verify the Jira Ticket (silent; no writes, no gate)

Identify and validate the ticket now. **Do not transition it here, and do not ask about transitioning it here** — that question belongs in Step 6, attached to the triage report. Jira status is shared team state; identify the exact ticket first and never transition on a guessed key.

Run this quietly alongside Step 2's MR fetch. The two are independent reads, so issue them together rather than waiting on one to start the other — the whole point of this phase is to reach the triage report fast. Concretely: `iid` came from the URL in Step 0, not from Step 2's response, so Step 2's MR fetch and Step 4's discussions fetch don't actually depend on each other — fire both of those and the Jira identity resolution (`getAccessibleAtlassianResources` / `getJiraIssue`, once you have a key to check) as parallel tool calls in one batch rather than waiting on each in turn. The one real dependency is Jira identity resolution on *evidence from* Step 2's title/description when the URL alone didn't carry a ticket key — in that specific case, issue Step 2 first, then Jira identity and Step 4 together once the title is in hand.

### Reconcile one authoritative Jira identity

Use the evidence collected in Step 2 to resolve **exactly one `(Jira hostname, ticket key)` pair**:

- **Several keys or conflicting key sources** → 🛑 show each source and ask which ticket this MR belongs to. Do not choose the title or branch by precedence.
- **One key but several Jira browse-link hostnames** → 🛑 show every `(hostname, key)` candidate and ask which Jira site owns this MR. The same key can exist on more than one tenant.
- **One key and one browse-link hostname** → use that pair as the candidate.
- **One key and no hostname** → call `getAccessibleAtlassianResources`. One accessible site becomes the candidate; several require the user to choose. Never infer the site from the ticket prefix.
- **No key** → 🛑 stop and ask for the Jira ticket. This workflow does not waive Jira verification; an MR without a Jira ticket needs a different/manual review workflow.

Call `getJiraIssue` for the selected pair with at least `summary`, `status`, `assignee`, `issuetype`, and `timetracking`. Compare its key and summary with the MR title/description. A 404, permission failure, different key, or summary that does not match the MR's work is a 🛑 stop for correction — never merely flag a mismatch and continue. Retain the verified `{cloudId}`, hostname, `{TICKET-KEY}`, original status, and browse URL through Step 11.

If Atlassian tools are unavailable, ask once — here, because you genuinely cannot proceed without it — for the exact Jira hostname, ticket key, summary, and current status. That is the identity check, and it is a hard stop. But the *transition* still defers: fold "and move it to {status} when I start?" into Step 6 exactly as in the automated path, then give the manual instruction there. This is manual verification, not a synchronization waiver; do not claim Jira was checked or changed by the workflow.

### Classify the status now — but ask about a transition later

This step **verifies**. It does not write, and with one narrow exception it does not interrupt.

Splitting those two things apart is deliberate, because they have opposite urgency:

- **Verification is urgent and free.** If the ticket doesn't exist, doesn't match the MR, or is already `Done`, everything downstream is wasted or wrong. Check it now, silently.
- **A transition is a write to shared team state, and it is never urgent.** Nothing between here and the first code edit needs the ticket to be active. `git checkout` is a local operation. Reading comments is a read. The board only needs to say "work is happening" from the moment work actually happens.

**So do not ask for a transition here.** Asking at this point costs the user a decision at the moment of *minimum* context: 45 seconds into a run, before they have seen a single review comment, before they know the MR is even the one they meant, and before anyone knows whether there is any work to do at all. Measured on a real run: the transition question landed at 49 seconds, the user answered at 1m25s, and the triage report — the thing they actually asked for — did not appear until 5m48s. The one interruption in the whole first phase was for the least informative decision in it.

It is also frequently a write for nothing. A ticket bumped `To Do → In Progress` here, on an MR whose comments then all turn out to be already addressed, moved the board for a session that changed no code. Deferring costs nothing and avoids that entirely.

Record the classification, keep going, and let the question ride along with the triage report in Step 6, where the user can answer it while looking at the work it refers to.

Use the exact `status.name` plus category; never treat `statusCategory.name === "In Progress"` as proof of the literal status. Jira's broad `indeterminate` category also contains review and blocked states.

**"Active-development-equivalent" is not a category you may assign.** A status counts as active development only if its exact `status.name` matches an active-development name, or the user confirmed that exact name is this project's active state. Observing `statusCategory.name === "In Progress"` on a `TO REVIEW` ticket and concluding "TO REVIEW is already active-development-equivalent here, so no transition is needed" is the exact failure this rule exists to stop — it silently converts a blocking gate into a no-op. If you catch yourself writing the words *equivalent*, *effectively active*, or *close enough* about a status name, you owe the user a question, not a conclusion.

Sort the status into one of two buckets — **stop now**, or **carry it to Step 6**:

#### 🛑 Stop here (rare, and continuing would be wrong)

- **Terminal/done** (`Done`, `Closed`, `Merged`, `Resolved`, `Rejected`) → stop. Ask whether this is the wrong ticket or whether it must be reopened through a separate, explicitly approved workflow. Never move completed work backwards because an MR still has comments.
- **Blocked, or a custom status you cannot classify** → stop. Show the exact status name and ask what it means for this work. Never clear a blocker or guess at a custom state's intent.

These stop immediately because they mean *the premise is wrong* — either you have the wrong ticket, or someone has deliberately parked this work. Spending four minutes triaging comments first would waste that work, and the answer may well be "wrong MR."

#### ➡️ Carry to Step 6 (the common case — say nothing now)

- **Active development** (`In Progress`, `In Development`, `Doing`, or the project's verified equivalent) → nothing to do, ever. No write, no question, and **no mention of it** — this is a check that passed, and per the output-discipline section those stay silent. Do not write "Jira is already In Progress ✓" as reassurance; it costs the user a line to read and tells them nothing they needed.
- **New/backlog** (`To Do`, `Backlog`, `Open`) → a transition to active development will be needed. Resolve the exact target now so Step 6 can name it, then move on quietly.
- **Review state** (`To Review`, `In Review`, `Review`, or verified equivalent) → review feedback means implementation has resumed, so the same applies: resolve the exact target, stay quiet, ask in Step 6.

For both of the last two, do the read-only preparation now so the Step 6 question is concrete and needs no follow-up:

1. Call `getTransitionsForJiraIssue`. Find a transition whose exact `to.name` is a genuine active-development status. Never match on `to.statusCategory` alone.
2. **Record `{current status}`, `{exact target status}`, and `{transition name}`.** Step 6 needs all three to render a question the user can answer in one word.
3. **If no transition reaches an active-development status, that is not a licence to continue silently — but it is also not a reason to interrupt now.** Many real boards genuinely cannot go `TO REVIEW → In Progress`; one whose only outbound targets are `Merged`, `Blocked`, `Rejected`, `To Do` and a self-loop is entirely normal. Record the full reachable `to.name` set and carry *that* to Step 6 instead, where it becomes the "no active transition available" form of the question. Do not resolve it by redefining the current status as active, and do not route through an intermediate status.

Nothing is written in this step. The transition itself happens in Step 7, after the user has approved it alongside the fixes.

Also record whether Step 11 should return the ticket to review. A move from `To Do` or `To Review` into active development normally means **yes**, but that final transition is a separate explicit approval in Step 8.

## Step 3 — Check Out the Right Branch (before touching any code)

**Do Step 4's discussion fetch before this checkout.** It's an independent read that needs no local state, and it decides whether this step should run at all: a zero-comment MR stops the workflow, and stopping *after* switching the user's branch means you changed their working tree for a run that ended immediately. Batch the MR fetch, the discussions fetch, and the Jira reads together, then check out once you know there is something to triage. The step numbering reflects logical dependency, not a required serial order — Step 5 needs the branch checked out, so the checkout must land before triage, and that is the only ordering constraint here.

**Check the dirty-tree status from Step 1 first — it gates every path below.** If dirty, stop and offer only: stay on the current branch, or create a named stash with the exact recovery command (`git stash pop`). Do not propose committing unrelated changes onto this MR branch, and never offer discard as a convenience path; if the user explicitly requests deletion, show per-file diffs and reconfirm first.

**A clean tree isn't automatically safe to switch away from.** Before checking out, if the current branch differs from `source_branch`, glance at `git log --oneline -5` on the branch you're about to leave. A clean tree with no commits ahead of its own upstream is the common, silent case — just switch. A clean tree that's ahead of its upstream, or whose recent commits reference a different ticket key with no relation to this MR's `source_branch`, means the user has real work sitting on that branch that a silent switch would bury from view (it's not lost, just no longer what's in front of them). Name both branches when you switch in that case: *"Switching from `{old-branch}` (ahead of its upstream, ticket `{OLD-KEY}`) to `{source_branch}` for this MR."* One line, not a question — the switch still happens, the user just isn't surprised by it later.

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
2. Compare your remaining **note** count against `user_notes_count` from Step 2. This is a note-for-note check, not a thread check.
3. **Mismatch → stop and re-fetch.** Never triage a partial set. Check pagination first — a count that's short by a round number (exactly 20, or exactly 100) is a paging artifact, not a missing comment. Re-issuing the same request without `per_page`/`paginate` returns the same truncated page.
4. If the URL had a `#note_` fragment, confirm that note is in your set.

### Three counts, not one — keep them apart

`user_notes_count` counts **notes**. A triage report counts **threads**. And only some notes are reviewer feedback: your own earlier replies in a thread are non-system notes too, so they inflate the note count without adding anything to triage. Collapsing these into one number produces a report line that contradicts itself — *"10 comments found (1 unresolved, 4 already resolved)"* is a 10 that can never equal 1 + 4, and it invites a second wrong number next turn.

Derive and carry all three separately:

| Count | How | Used for |
|---|---|---|
| `notes_total` | all `system == false` notes across all discussions | the `user_notes_count` reconciliation only |
| `threads_total` | discussions containing at least one `system == false` note | the triage report body — one item per thread |
| `reviewer_notes` | `notes_total` minus notes authored by the MR author / the `glab` identity | describing how much feedback there actually is |

A worked example, so the shapes are unmistakable. Eight discussions come back: three carry only `system: true` notes, five carry reviewer comments, and each of those five already has one reply from you. That is `notes_total: 10` (reconciles against `user_notes_count: 10` ✓), `threads_total: 5`, `reviewer_notes: 5`. The report shows **5 items**, and says so.

Reviewers typically leave several comments in one pass. Finding exactly one is a signal to re-check, not a finding.

Capture per thread: discussion `id`, note `id`, `notes[0].position.new_path` and `new_line` (a `line_range` means it spans multiple lines), body, author, resolved state, and any existing replies — someone may have already answered or pushed a fix.

A thread with no `position` is a general MR-level comment; triage it as a general item, not a code comment.

If the user wants only open items, filter to `resolved: false` **after** fetching everything, so the counts still reconcile.

**If `user_notes_count` was 0 in Step 2, there's nothing to reconcile — stop here rather than continuing into Step 5 with an empty set.** Tell the user this MR has no review comments yet and ask what they want to do (wait for a review, or confirm this is the right MR). Producing a triage report with zero items in Step 6 wastes a turn on a report that says nothing.

## Step 5 — Triage Each Comment (investigation only, no edits)

Investigate, but change nothing yet. "One at a time" below describes the *investigation checklist per thread*, not a mandate to process threads in serial turns — nothing in this step writes anything, so read as many referenced files as you have threads for in one batch of parallel tool calls, rather than one file per turn. Only serialize when two threads name the same file — read it once, reuse it for both.

Do this yourself, directly, with plain tool calls. Don't dispatch sub-agents for this: reading five or ten files and judging each against the checklist below is exactly the kind of task where a batch of parallel `read_code`/`grep_search` calls already gets you the speed, and a sub-agent adds a coordination step (writing each one a prompt, waiting on it, reading back a summary) without doing the work any faster.

**Speed comes from running the same checks concurrently, not from running fewer of them.** Every item below still applies to every thread.

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

{threads_total} thread(s) to triage — {X} unresolved, {Y} already resolved
{reviewer_notes} reviewer comment(s) across {notes_total} notes — matches user_notes_count ({notes_total}) ✓

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

**Jira** — `{TICKET-KEY}` is **{current status}**. Move it to **{exact active status}** when I start on these? (yes / leave it)

---
```

### The Jira line — only when there's something to decide

Append the **Jira** row above only when Step 2.5 recorded a needed transition. Its three variants:

- **Ticket already in active development** → omit the row entirely. No line, no tick, no "already In Progress ✓". A check that passed is not news.
- **Transition available** → the row as written, naming the exact current status and exact target from Step 2.5.
- **No active transition reachable** → the same slot, different question:

  > **Jira** — `{TICKET-KEY}` is **{current status}**, and no transition from here reaches an active-development status. Available targets: {exact `to.name` list}. Leave it as is for this pass, move it to one of those, or you change it manually and tell me? (leave / {target} / manual)

This is the whole point of deferring: the user answers a shared-state question **while looking at the work it refers to**, in the same turn they approve the fixes. One decision point, full context, no extra round trip. If they reply "go ahead" without addressing the Jira row, treat the transition as unapproved and ask once before Step 7's first edit — a bare approval covers code, not the board.

Put the row **last, after the horizontal rule following the final comment**, so it reads as a footnote to the report rather than competing with the comments for attention. It is the least important thing on the screen and should look like it.

**The header is two lines because the numbers measure different things** (Step 4). `{X} + {Y}` must equal `{threads_total}` and must never be checked against `{notes_total}`. The `user_notes_count` tick belongs on the second line only. Before sending the report, verify that arithmetic — a header whose own numbers don't add up destroys confidence in every classification under it, and it is the one line the user checks first.

A thread with no `position` (Step 4) is a general MR-level comment, not tied to a file or line — use `_(general MR comment)_` in place of `` `{file}:{line}` `` for that item, the same convention Step 10 uses for its own general-comment row.

Each field — the header, the quote, and the action — sits in its own paragraph with a blank line on both sides. That blank line is what forces a hard break in every markdown renderer; don't drop it to save space.

Close with a direct question:

> Want me to proceed with the "Fix" items? Let me know how to handle the "Question"/"Disagree" ones.

- **Never skip this report**, however trivial the comments look.
- **Never collapse fields onto adjacent lines** to shorten the report — a long report with breathing room beats a short one that reads as a single paragraph.
- The user may approve all, approve a subset, override a classification, or answer flagged items inline. Follow their reply.
- A bare "go ahead" approves **Fix** and **Nitpick** only. Keep holding **Question** and **Disagree** until explicitly resolved.

### Step 6b — When a held item becomes real work (BLOCKING)

A 💬 **Question** or ⚠️ **Disagree** that the user later answers is **new scope arriving mid-run**, and it did not pass through the report above. The answer resolves the *question*; it does not approve an *implementation*. This is the most common way a well-gated run turns into an ungated one: the user supplies a decision, you see the fix clearly, and you start editing — the plan and the first `str_replace` land seconds apart, with no turn boundary in between for the user to disagree.

Route it back through a gate whose weight matches the change:

- **Confined to a line or two, no new file, no new dependency, no architectural choice** → treat it as an approved Fix and continue. Say in one line what you're about to change so it appears before the edit rather than after.
- **Anything larger — a new file, a new service or module, a new injection, a change in which layer owns the logic, or a fix that touches files no reviewer commented on** → 🛑 present it and wait. Use the same one-block-per-item shape as Step 6:

  ```
  ### New scope from your answer — thread {N}

  Your answer: "{what they told you}"

  → **What it implies:** {the change, one or two sentences}

  → **Files:** {new files marked (new)}; {existing files touched}

  → **Design choice, if any:** {the decision and the alternative you rejected, one line each}

  Go ahead with this? (yes / adjust / just reply to the thread without a code change)
  ```

**Presenting a plan is not a gate unless you stop after it.** A plan followed immediately by an edit in the same turn is narration. The turn must end on the question.

The third option matters and is easy to forget: sometimes the right response to an answered question is a thread reply and no code at all. Offer it explicitly rather than assuming every answer implies an implementation. And once the user approves, the item is a Fix for every later step — it counts in the Step 8 summary, and it is eligible for Step 12 lesson capture exactly as if it had been labelled ✅ from the start.

## Step 7 — Fix One Comment at a Time

### First: apply the Jira transition, if it was approved

This is the moment the board's claim becomes true — work is starting now, so the status changes now. Do it before the first edit, not after, and only if the user answered the Step 6 Jira row affirmatively.

1. Call `transitionJiraIssue` with the exact transition recorded in Step 2.5.
2. Re-read the issue and confirm the resulting `status.name` is exactly the approved target. A successful API response is not evidence; the re-read is.
3. **If the transition or the verification fails, stop.** Report the exact error, and wait for the user to either apply it manually and confirm the resulting status, or tell you to proceed without it. Do not start editing on the assumption it worked, and do not retry through a different transition. There is no fail-open synchronization waiver.
4. If the user declined, or chose "leave it", record that and move on. Say nothing further about it — they already decided.

Then say nothing more about Jira until Step 8. One line confirming the move is acceptable if it happened; a paragraph is not.

### Then the fixes

**This is the one place in the workflow not to parallelize or delegate, even though Step 5's investigation just was.** Investigation is read-only and forgiving of speed; writing isn't. A sub-agent editing a file at the same time you edit a different one is indistinguishable, from `git diff --cached`'s point of view, from the user editing that file while you work — and the entire hunk-attribution mechanism later in this step exists to catch exactly that shape of problem. Parallel edits from your own dispatched agents would trip your own trap. Apply fixes one at a time, in this process, even when several are independent enough that they *could* run concurrently.

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

1. Run and record the narrowest relevant **diagnostics/type check, targeted tests, lint, and smoke test**. Run a build when required by the change; otherwise record `deferred to CI`. A skipped check must include the reason. **These are independent commands against the same already-written tree — run them as parallel background processes rather than waiting for each to finish before starting the next.** Diagnostics, tests, and lint don't write files, so nothing about running them concurrently changes what they report. A smoke test that needs a running dev server is the one exception worth a moment's thought — start the server once, then let it serve the others rather than spinning up a second instance.

   **Weigh a full build against what Step 1 already told you about the pre-push hook.** If `gitHooks.prePushContent` runs `nx build`/`ng build` (or an equivalent full build) for the exact project(s) you touched, that build is going to happen again in Step 9 regardless of what you do here — Step 9 can't skip it, only defer *when* it runs. Running the same full production build here too, on top of the one Step 9 is about to run, buys you nothing the second run doesn't already tell you, and it's the difference between one multi-minute build and two on a change that hasn't grown since the first. Prefer the type-check/diagnostics you already ran over a duplicate full build in that case, and say so plainly in the evidence block: `Build: covered by the pre-push hook (runs {command}) — not duplicated here`. Still run your own build here when either is true: no pre-push hook exists, the hook doesn't cover the project(s) you changed, or this is the *first* validation pass for a set of edits that haven't been build-checked at all yet — the point is skipping a redundant *second* full build of the same untouched-since code, not skipping validation.
2. Stage only the approved MR-review files by name — never `git add .`.
3. Run the pre-commit staged formatter discovered in Step 1, then re-stage anything it changed.
4. If formatting changed behavior-relevant bytes, rerun every affected validation check.
5. Use `git diff --cached` as the definitive input to the self-review and Step 8 summary. Also show `git status --short` so excluded work is visible.

Any later mutation — including a project checklist fix — loops back through this entire phase: validate affected behavior, stage by name, format, re-stage, inspect `git diff --cached`, then re-present Step 8 and wait again. An earlier approval never authorizes changed bytes.

#### `git add {file}` stages the file, not your edits

This is the step's whole reason for existing, and it is counter-intuitive enough to state outright: **`git add path/to/file.ts` stages every uncommitted change in that file — including changes you did not make.** Between your first edit and your `git add` there may be many minutes of wall-clock time, and in that window the file can acquire content from at least three sources other than you:

- **The user, editing in the same editor.** They are watching you work. Fixing something adjacent, or continuing unrelated work in the same file, is entirely normal and they have no reason to mention it.
- **Editor-side actions on save** — organize-imports, an ESLint autofix, a format-on-save rule. These fire when your write tool touches the file, so they are indistinguishable from your own edit unless you look.
- **A branch operation or another tool** that rewrote the file after you read it.

`git status --short` cannot tell you about any of this. It prints ` M file.ts` whether the file holds one line of your change or forty lines from three sources. Running `git status` and then committing is not verification — it confirms *which files* changed and tells you nothing about *what* changed in them.

#### Attribute every staged hunk before presenting Step 8

After staging and formatting, read `git diff --cached` in full and account for every hunk:

1. **Read the actual diff.** Not `git status`, not `--stat`, and never your memory of the `str_replace` calls you made. Your recollection of your own edits is not evidence about the file's current contents.
2. **Map each hunk to a stated fix.** Every hunk must trace to a specific approved review comment or to the formatter you just ran.
3. **Any hunk you cannot attribute is a 🛑 stop.** Do not rationalise it, and in particular do not attribute it to the formatter unless the formatter's own output says it changed that file. A formatter that printed *"no files changed"* or *"everything is awesome"* did not silently edit anything — if unexplained hunks exist after that output, the formatter is ruled out, not the explanation. Ask:

   > `git diff --cached` includes changes I can't trace to any review comment: {list the hunks, file by file, one line each}. Did you edit these files while I was working, or should they not be in this commit? I've left everything staged and haven't committed.

4. **Never guess at the origin of a change you didn't make.** "The prettier config must strip this" and "some plugin probably did it" are inventions. The user is the cheapest and most reliable source of truth about their own working tree, and asking costs one turn while committing their unrelated work into your MR costs them a dirty diff a reviewer will ask about.
5. **Unstage rather than include.** If the user confirms an unrelated hunk, `git restore --staged {file}` is wrong — it would drop your change too. Offer instead to keep their work in the tree and commit only your files, or to let them commit theirs separately first. Never resolve this by discarding anything.

#### Report line counts from the diff, never from memory

Every `+X / -Y` in the Step 8 summary comes from `git diff --cached --numstat`. Numbers you inferred from your own edits will be wrong the moment anything else touched the file — and being wrong here is uniquely damaging, because the user reads those counts as a description of what they are approving. A summary claiming `+2/-1` on a file that will commit `+6/-3` is not an approximation; it is a gate that asked about different bytes than the ones that shipped.

### Self-review pass (after all fixes, before presenting the summary)

Before Step 8, re-read the definitive staged diff (`git diff --cached`) — not from memory of what you changed — and check it against whatever review conventions this project actually has.

**This pass is not optional and it is not deferrable to after the push.** It is the only step that reads the real diff with fresh eyes, so it is the only step positioned to catch a hunk you didn't write — which makes it the step whose absence is least visible and most expensive. A run that skips it and pushes cleanly looks identical to a run that did it properly, right up until a reviewer asks why an unrelated file moved. If the user has to ask *"can you run the self-review?"* after the commit is already on the remote, this step failed, however good the eventual report is.

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

**Fold this offer into the Step 8 summary rather than raising it as its own separate pause.** Step 8 is already a hard stop asking "ready to commit and push?" — asking "and should I run this checklist first?" in the same breath is one decision point instead of two and avoids adding another gate. The offer belongs **as the Self-review bullet inside the Step 8 card itself** (see the template below) — not as a free-standing question asked on its own before the card exists, and not something you answer yourself. See "Compliance claims require evidence, not description" near the top of this skill for the general rule this offer must follow.

Two observed failures of this, both real and both worth naming so they're recognizable:

- **Asked the question, then answered it themselves.** The agent asked *"want me to run it against this diff?"* as its own message, then immediately answered with *"I did a quick pass myself"* — the item-3 generic checks below, not the named resource — followed by *"otherwise I'll proceed to the summary,"* and rendered the complete `Summary — ready to commit` card in that same turn. The named checklist never ran; the question was treated as settled without the user ever answering it.
- **Skipped the question and reported a result outright.** After naming `code-review-self.md` and summarizing what its *description* covers (Angular/SCSS conventions), the same message went straight to *"I checked it against those standards: no BEM violations, no hardcoded colors, no `::ng-deep`, no `!important`... No new issues found"* — never posing the question, never opening the checklist's actual content. Asked directly *"did u run it?"*, the honest answer was no: what ran was the item-3 generic pass, reported in vocabulary borrowed from the checklist's description and presented as if the named file had been read.

The fix in both cases is the same: the offer appears **as an unresolved line inside the Step 8 card** (per the template's Self-review section below), phrased as an open question, with the card's own single closing question ("Ready to commit and push?") left to cover it. The item-3 generic pass is a baseline you always run regardless of what discovery finds — it is never a substitute for running a *named, discovered* resource, and running it does not let you mark that resource's offer as closed.

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

Before presenting the gate, re-read the verified Jira ticket from Step 2.5. With Atlassian tools, call `getTransitionsForJiraIssue`; in manual mode, ask the user to confirm the exact currently reachable review target. Identify the review status by exact name (`To Review`, `In Review`, `Review`, or the project's verified equivalent), never by status category. If no direct review transition exists, say that now and render the explicit leave-unchanged/manual form below rather than inventing or promising a transition Step 11 cannot perform.

### Preconditions — do not render this gate without them

This summary is the document the user approves. Every number in it must come from a command whose output you have actually seen in this run. Before writing a single line of it, confirm all five:

1. `git diff --cached` has been run **after** the last staging and formatting operation, and its output is in front of you.
2. `git diff --cached --numstat` supplied every `+X / -Y` below. None are recalled or estimated.
3. Every hunk in that diff is attributed to an approved review comment or to a formatter that reported changing that file. Unattributed hunks were raised with the user and settled.
4. The self-review pass ran against that same diff.
5. If discovery in the self-review pass named a specific project resource, its offer follows "Compliance claims require evidence, not description" near the top of this skill: it belongs inside this card as an open bullet, not pre-resolved by you before the card exists.

**If any of these is missing, you are not at Step 8 yet — go back and do it.** Presenting the gate first and verifying afterwards inverts the whole point: the user's "yes" then applies to a description rather than to the change. Precondition 5 in particular means you never ask the checklist question as its own message and then treat it as settled — the checklist offer and the rest of this card are one gate, asked together, exactly as the template below renders it.

Once all approved fixes are validated, formatted, staged, and self-reviewed, present this shape — one line per fixed comment, not a paragraph, and every open item called out separately so nothing needing the user's attention gets buried:

```
### Summary — ready to commit

**Fixed (N)**
- `{file}:{line}` — {what changed, one line}
- `{file}:{line}` — {what changed, one line}

**Staged — verified via `git diff --cached`**
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
- Hunk attribution: {all {n} hunks trace to approved comments or the formatter / {n} unattributed — raised above}
- {Found `{path}` — its description says {what it's for}. Run it against these changes before committing? / Looked in {where you looked} — nothing describing itself as a review or pre-push check. Is there one I should know about for next time?}

**Validation evidence**
- Diagnostics/type check: {tool/command + result / unavailable + why}
- Targeted tests: {command + result / not applicable + why}
- Lint: {command + result}
- Smoke test: {result / not applicable}
- Build: {result / deferred to CI / covered by the pre-push hook — not duplicated here}

**Jira after replies**
- Ticket: `{TICKET-KEY}` — currently **{current status}**
- If a direct review transition exists:
  - Proposed: transition to **{exact review status}** after the push and approved thread replies/resolutions
  - Approve that Jira transition? (yes / leave unchanged)
- If no direct review transition exists:
  - Proposed: leave Jira unchanged in **{current status}**; no direct review transition is available
  - Confirm leave unchanged/manual? (yes / stop and inspect the available transitions)

---

**Commit message:** `{type}({TICKET-KEY}): address MR review comments`

Ready to commit and push? (yes / let me review first / adjust message)
```

Omit any section that's empty (no skipped items → drop that heading entirely, don't write "none") — **except Staged, Self-review, and Jira after replies, which always appear**. Staged proves you read the real diff; Self-review proves review happened; Jira proves ticket status was checked and makes the final shared-state decision explicit. Dropping any of the three makes the gate unfalsifiable — a summary that omits Self-review reads exactly like one where the pass came back clean.

**The Jira block is a question, not a status line.** Render one of the two branches verbatim, including its `?`. Writing *"currently TO REVIEW — no transition needed"* and moving on is not this section; it is the section replaced by a conclusion. If Step 2.5 found no reachable active-development transition and the user chose to leave the ticket alone, say that and name it as their recorded choice — *"leaving Jira in **{status}** per your call at the start of the run; confirm that still holds?"* — so Step 11 inherits a decision with a person attached to it.

**Jira approval is independent from commit approval and time logging.** If the reply doesn't clearly cover the proposed review transition, ask before Step 9 rather than inferring it. "Ready to commit" authorizes only commit and push. Retain the explicit Jira answer for Step 11 — do not ask again there unless the ticket's status or reachable transitions changed.

**Do not ask for time spent at this gate.** The worklog question belongs at the very end of Step 11, after the push, after every approved reply and resolution, and after the review transition is applied or explicitly left unchanged. Asking here makes the user estimate work that hasn't finished yet. If they volunteer a duration anyway, treat it as a note to confirm in Step 11 — never as the logged value.

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

#### Verify what the commit actually contains

The pre-commit hook runs between your `git commit` and the commit object existing, and it can rewrite staged content. **Read its output, then verify the result against the approved set** — the two are independent, and the mismatch is the interesting case:

1. **Read the hook's own output.** A staged formatter that reports *"no files changed"* / *"everything is awesome"* changed nothing, and you may not later attribute any unexpected hunk to it. One reporting *"reformatted 2 files"* did, and those files need re-checking.
2. **Compare `git show --numstat HEAD` against the `+X / -Y` figures the user approved in Step 8.** Not the file list — the numbers. A file list matches whether the commit holds your three lines or thirty from elsewhere.
3. **Any divergence is a 🛑 stop, before the push.** Report the exact difference between approved and committed, say what the hook's output does and does not explain, and ask. This is the last point where the change is still local and a fix costs nothing; after the push it costs an extra commit on a branch a reviewer is already reading.

Do not treat `Exit Code: 0` as confirmation of content. The commit succeeding tells you git wrote an object, not that the object matches what was approved.

### 3. The pre-push hook decision (BLOCKING)

When the pre-push hook runs builds rather than a quick check, say what it will do and let the user pick.

**Format the options as a real markdown list, each on its own line.** Do not put them in a blockquote and do not run them together in a paragraph — consecutive lines inside a blockquote collapse into one line when rendered, which makes a three-way choice unreadable at exactly the moment the user has to decide something.

Emit this shape:

---

Committed. Now the push — this repo's pre-push hook runs `{command}`, which lints and builds all {n} projects ({list them}). Expect several minutes.

**How do you want to handle it?**

- **(a) Run it here** — safest, identical to CI; I'll set a 30-minute timeout
- **(b) Give me the command** — you run it in your own terminal, useful if you want the machine back
- **(c) Skip with `--no-verify`** — reasonable if CI runs the same checks

---

Then wait for the answer.

**Never choose (c) yourself.** A hook exists because someone wanted it enforced; a tool shouldn't bypass it unilaterally. But if the user picks (c), that's a legitimate private execution choice. **Never write or disclose it** in an MR comment, general note, thread reply, MR description, Jira comment, or any other remote text. Step 10 previews only reviewer-thread replies; it never adds a disclosure row.

**Present (a) as the default it is, and raise your timeout to fit it.** Pass an explicit `timeout` of 30 minutes on the push command rather than relying on the default. Measured on a 6-project Angular monorepo, the full hook — six lints plus six production builds — finished in about nine minutes and pushed cleanly. Do not tell the user (a) "will probably time out": it is a guess, it is usually wrong, and it pushes them toward `--no-verify` on a false premise. Give a duration estimate, note that you have set a long timeout, and let them weigh it.

**If (a) does time out, that is information, not a verdict.** Report where the hook got to, confirm the real state (`git status -sb`, `git log --oneline -1`), and re-offer (b) and (c). Never escalate on your own.

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

→ "Switched to the directional radius mixin. See the latest commit."

---

Post these replies and resolve the threads? (yes / edit #N / skip)
```

**STOP until the user approves.** They may approve all, edit a specific reply, or skip some — don't post or resolve anything skipped.

### Write replies like a person, not a template

**A reviewer reading six replies in a row will notice if all six open the same way.** The most common tell is starting every reply with a word or two, a dash, and the fix (`Fixed — did X`, `Renamed — did Y`, `Added — did Z`). One reply like that reads fine; six in the same thread read like a script, and a human reviewer clocks it immediately as generated text rather than someone actually addressing their comment.

Write each reply as an ordinary sentence someone would type after actually making the change — plain punctuation, no dash-led fragment, varied openings:

- "Switched to `canOpenExternally()` so a missing or malformed URL both fall through to the modal now."
- "Good catch. This was already in `biometric.service.ts`, so I reused the same constants."
- "Renamed to `onCampaignClick`, matching what you suggested in the comment."
- "This one's already handled: `a3bbad5b` fixed it before this review pass, no further change needed here."

Vary the opening across replies in the same batch — not every one needs "Fixed," and not every one needs to restate what the comment asked for before answering it. If a reply genuinely has two distinct clauses that need separating, use a comma or a period and a new sentence, not a dash. Say what changed in plain terms; skip "See latest commit" as a fixed sign-off on every single one — it's fine occasionally, redundant when it's the last line of all six.

### Reply on the thread

**Post replies to independent threads as parallel tool calls, not one per turn.** Each `POST` targets a different `discussion_id` and none of them depend on another thread's reply landing first, so there's no correctness reason to serialize them. Keep the publication ledger updated per call regardless of whether they ran in parallel or in sequence — the ledger is what makes partial failure recoverable, not the ordering of the calls.

Use the discussion `id` captured in Step 4. Replies must be **threaded under the reviewer's comment**, never posted as a general MR comment:

```
mcp_gitlab_glab_api
  args:  ["projects/{project_path_encoded}/merge_requests/{iid}/discussions/{discussion_id}/notes"]
  flags: {
    "method": "POST",
    "field": ["body={the reply, written per the section above}"],
    "hostname": "{host}"
  }
```

For **Question** or **Disagree** items, never reply with a fix confirmation. Post the user's answer or approved reasoning instead.

For **✔️ Already addressed** items, reply and resolve the same as a Fix — but say what already handled it (e.g. "This was already fixed in `a3bbad5b` before this review pass, so nothing further is needed here.") rather than describing a change you just made.

### Resolve

Immediately after replying, in the same pass, resolve every thread you replied to on behalf of a **Fix**, **Nitpick**, or **Already addressed** item. **The resolve for a given thread must wait for that thread's own reply to succeed first** — resolving before the reply lands would close a thread with no explanation attached. Across *different* threads there's no such dependency, so once each thread's reply has landed, its resolve call can run in parallel with every other thread's resolve call:

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

### Recover safely from partial publication

Keep a per-discussion publication ledger containing the approved reply body, posted reply note ID (when successful), required resolution state, and confirmed resolution result. If any reply or resolution fails, stop the pass, re-fetch all affected discussions from GitLab, and reconcile the ledger against the remote notes and `resolved` state. Retry only the missing action: never repost an approved reply already present, never resolve a thread whose approved reply is absent, and never treat a locally recorded API success as sufficient when the re-fetch disagrees. Resume Step 11 only after every approved action is observed remotely; otherwise report the remaining failures and leave Jira active.

## Step 11 — Return Jira to Review and Log Time

Use the verified Jira hostname and `{TICKET-KEY}` retained from Step 2.5, plus its `{cloudId}` when tools are available. Do not re-infer identity from the MR title at the end. If the MR's ticket evidence changed during the run, stop and reconcile it again before any Jira write.

### Publication success is a hard precondition for review status

Return Jira to review only after recording all of these as successful:

- The approved commit was pushed to the MR source branch.
- Every thread reply the user approved was posted.
- Every approved resolvable thread was resolved.

Intentionally skipped replies are not failures, but a failed push, failed approved reply, or failed approved resolution leaves Jira in active development. Report the exact GitLab failure and **do not run the Jira review transition**. The closing time-log question below still runs, because time was spent even when publication failed.

### Re-read before changing shared state

Call `getJiraIssue` again immediately before automated writes. Another person or automation may have changed the ticket while review fixes were in progress. In manual Jira mode, ask the user to confirm the exact current status again before giving the transition instruction; never reuse the start-of-run status as current evidence.

- **Already in the exact approved review status** → report it and skip the transition call.
- **Still in the active-development status** — whether it was already there at Step 2.5 or moved there in Step 7 → apply the review transition only if the user approved it in Step 8.
- **Still in the pre-active status because the Step 6 transition was declined or unavailable** → there is nothing to return it *to*. Report the ticket's actual status and the fact that it never entered active development this run, and leave it alone unless Step 8 explicitly approved a target from here.
- **Now terminal, blocked, or otherwise different** → do not use the old approval. Show the new status and ask what to do.
- **User declined the Step 8 transition** → leave status unchanged and report that choice.

For an approved automated transition, and only when the publication precondition passed:

1. Call `getTransitionsForJiraIssue` again.
2. Match the exact review target approved in Step 8 by `to.name`; never match only on `statusCategory`.
3. If that target is no longer directly reachable, report the available targets and stop the status change. Do not choose an alternate review-like name or route through an intermediate status.
4. Call `transitionJiraIssue`, then re-read the issue and verify the resulting exact status. A successful API response without the expected resulting status is not sufficient evidence.
5. Report transition failures as failures; never claim Jira is back in review when it is not.

**Do not report this success as its own message.** Hold the confirmed resulting status and say it for the first time in the combined time-log line below — that's the whole reason the template folds them together. Observed failure: the agent said *"Jira `{TICKET-KEY}` is now TO REVIEW (verified via re-read after the transition call)"* as a complete message on its own, then followed up afterward with *"Pushed, threads resolved, and Jira `{TICKET-KEY}` is now TO REVIEW... how much time should I log?"* — the same fact stated twice, in two turns, for a decision the template already says fits in one. A successful transition isn't a stop; it's a fact you're carrying forward one line, not a milestone worth announcing on its own.

In manual Jira mode, and only when publication succeeded, show the verified ticket URL and exact review target approved in Step 8 and ask the user to apply that transition — **in the same message as the time-log question**, not before it. They can hand back both the resulting status and the logged duration in a single reply; there's no dependency that forces two round trips. Do not mark the lifecycle complete from an instruction alone; if the reply confirms the transition but leaves time unanswered, treat time as still open and the transition as settled — don't ask the time question a second time just because it arrived bundled with something else.

### Ask for time spent last, then log it

**This is the final question in the workflow.** It comes after the commit was pushed, after every approved reply and resolution was published, and after the review transition was applied or explicitly left unchanged — the point where the user can actually see what the pass cost. Never ask earlier in the run.

Ask once, in one line, with the outcome as context, then 🛑 wait. **This line is the first time the resulting Jira status appears anywhere in the conversation** — not a recap of something you already told the user a message ago:

> Pushed, threads resolved, and Jira `{TICKET-KEY}` is now **{resulting status}**. How much time should I log against it? (`1h`, `30m`, `2h 30m` — or skip)

**Include the ticket's existing time figures in that line.** Step 2.5 already fetched `timetracking`; this is the one place it is used, and a value fetched and never surfaced is just latency. Append whatever of `originalEstimate`, `timeSpent`, and `remainingEstimate` came back:

> … (currently `{timeSpent}` logged against a `{originalEstimate}` estimate, `{remainingEstimate}` remaining). How much time should I log?

The user is the only one who decides the number, and they may knowingly blow past the estimate — that is normal on a bug that turned out to be a spec question. But deciding it while looking at "6.5h logged against a 4h estimate" is a different decision from deciding it blind, and showing the numbers costs nothing. Do not editorialise about overrun, and do not let the estimate influence what you record.

Then write it:

```
addWorklogToJiraIssue → cloudId: {verified}, issueIdOrKey: {verified key}, timeSpent: "{duration}"
```

`timeSpent` accepts `30m`, `2h`, `1d`, or a combination like `2h 30m`. A range (`1-2h`) is invalid — ask for one value. **Never infer the duration** from elapsed session time, message timestamps, or your own sense of how long the work took; it comes from the user or the worklog is skipped.

Ask even when earlier stages failed. Time was still spent, so a failed push, a failed reply, or a declined, blocked, or failed status transition does not remove the question — say what failed, then ask. The worklog and status transition are independent approvals: log the confirmed duration even if the transition never happened, unless the user explicitly tied them together. Report each result separately.

If the user skips, drop it and don't re-ask. If they volunteered a duration back at Step 8, confirm that exact value here before writing rather than logging it silently. If Atlassian tools are unavailable, show the verified ticket URL and the confirmed duration for manual entry — never suppress the worklog because status synchronization could not complete, and never claim the manual entry succeeded until the user confirms it.

## Step 12 — Optional Follow-Up: Capture Recurring Lessons

This is **not a default blocking gate**. After replies, resolutions, Jira status synchronization, and time logging are complete, say in one line whether any reusable pattern was noticed and offer lesson capture as an optional follow-up. Run the file mutation only when the user opts in; a user who says "done" or does not engage is finished with the workflow.

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
- **Already listed in `[sources: ...]`** → this MR/note is already counted. Leave the count alone and say so. Re-encountering a comment you have already recorded is the normal case when an MR gets a second review pass.
- **Count reaches 3** → move it under `## Repeat offenders` at the top of the file.

#### A rule with no `[sources: ...]` cannot be bumped

The whole dedup mechanism is the sources list. A rule reading `… ×2` with no sources is a count you cannot verify and therefore **must not increment** — you have no way to tell whether the MR in front of you is already one of those two. Getting this wrong is not hypothetical: a rule about duplicated view logic, at ×2, on an MR whose duplication comments were triaged in an earlier session of the *same* MR, will bump to ×3 and promote itself to Repeat offenders on the strength of counting one MR twice. The promotion then looks like evidence.

When the matching rule has no sources, do not bump silently. Say what you found and offer the two honest options:

```
Matched an existing rule with no recorded sources:

  "{rule text}"  ×2   [no sources]

This MR (!{iid}, notes {ids}) may already be one of those 2 — I can't tell. Either:
  (a) backfill this MR as a source and leave the count at ×2
  (b) count it as new: ×2 → ×3   [sources: MR !{iid} notes {ids}]

Which is right? (a / b / skip)
```

Backfilling is usually correct for the MR you are currently working on, since it is the likeliest origin of an untracked count. But it is the user's history, so let them say.

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

**Approval covers exactly the previewed lines.** A "yes" to two count bumps authorises two count bumps. It does not authorise touching anything else in the file while you happen to have it open. In particular, do not bundle in an unpreviewed edit and explain it afterwards — an approval gate that ships changes the user never saw is the same failure as Step 8 committing unattributed hunks, in the file with the longest blast radius.

#### Frontmatter and inclusion mode get their own gate

Changing the file's `inclusion` mode is not a rule edit — it changes **whether these rules load at all**, which outranks every individual rule in it. It also cuts against the file's purpose: the rules exist to be present *while new code is being written*, and `inclusion: auto` means they only load when a request already looks review-shaped, which is the case where you'd have caught the problem anyway.

So: never fold a frontmatter change into a count-bump preview. If you think the mode is wrong, finish the approved bumps, then raise it separately as its own question with the tradeoff stated in one line each way:

> Separate from the bumps: this file's frontmatter has `description:` but no `inclusion:`, so it defaults to always-included — loaded on every request in this repo. Options: leave it always-on (rules present while writing new code, costs context every turn), or `inclusion: auto` (loads only for review-shaped requests, cheaper but absent exactly when a rule would prevent the mistake). Want to change it, or leave as is?

Note that omitting `inclusion:` **is** always-included; the absence of the key is not a bug to fix. Present the current behavior accurately rather than as an oversight, and let the user decide. If they don't engage, leave it alone.

### Keep it small

- One line per rule, imperative mood.
- **Never rewrite or delete an existing rule here.** If one looks wrong or contradicts a new finding, say so and let the user decide. This step appends and increments; nothing else.
- Past roughly 40 rules the file stops being read and starts being skimmed. At that point propose splitting it by domain into separate files with `inclusion: fileMatch`, so SCSS rules load for SCSS work instead of on every request.

## Step 13 — Where this skill ends

The threads are resolved, the Jira ticket has either returned to its approved review status or its unchanged/manual state is explicit, and the approved worklog is recorded or reported as skipped/failed. Say what happened in Step 12 too — even a one-line "no recurring patterns worth recording this time" closes the loop, since a summary that mentions everything except the step most likely to be silently skipped reads as incomplete. **Stop here.** Do not:

- ❌ Merge or approve the MR
- ❌ Delete the source branch
- ❌ Transition the ticket to Done / Merged / Closed
- ❌ Start on another set of review comments

Merging is the reviewer's call. The push you just made appears in the existing MR; they'll see it and re-review. Step 11 may return Jira to the approved review status, but transitioning it to Done before merge still tells the board the work is accepted when it hasn't been.

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

**This is not a short list of exceptions — it's every `mcp_gitlab_glab_mr_*` tool that acts on one specific MR.** Confirmed failing this way: `mr_view`, `mr_note`, `mr_diff`, `mr_approve`, `mr_issues`. Don't treat an unlisted name as safe just because it hasn't been hit yet — assume any `glab_mr_*` tool taking an MR id/branch fails the same git check, and reach for `glab_api` first rather than trying the dedicated tool and discovering the failure live. **`--repo` does not help**, not even host-qualified — the git check runs first.

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
| **Output discipline** | **Steps 0–5 run quietly, with no gate and no interruption. Never narrate power activation, parsed URL fields, the project profile, tool choice, step numbers, or checks that passed — including "Jira is already In Progress". Surface only blockers, one-line flags, and the defined gates. Exactly one line before the report, and make it the count: *"Found {N} reviewer comments across {M} threads ({notes} notes, reconciles ✓). Reading the referenced files now."*** |
| **Batch the reads** | Step 1's profiling reads are all independent — issue as parallel tool calls. `iid` comes from the URL (Step 0), so Steps 2 and 4 don't depend on each other either — fire the MR fetch, Jira identity resolution, and discussions fetch together, serializing only when Jira identity genuinely needs the MR title first (no ticket key in the URL). Check out the branch (Step 3) only after the zero-comment check, so a dead-end run never touches the working tree. First user-facing output is the triage report |
| Parse URL | Split on `/-/` → `host`, `project_path` (encode `/` → `%2F`), `iid`, optional `note_id`. Malformed/non-GitLab URL → stop and ask, don't guess |
| Profile | Derive directly from lockfile, `package.json`, `.husky/`, `git log`, `git status` — no external tool, no other power |
| Host guard | Git host isn't GitLab → stop, tell the user, don't improvise `gh` |
| Fetch MR | `glab_api` → `.../merge_requests/{iid}` → `source_branch`, title, type, `user_notes_count`, Jira-key/link evidence. No ticket key in title → do not guess; Step 2.5 reconciles all sources |
| **Sanity check** | Compare the MR's project against the workspace remote and author/assignees against the current user. Wrong project stops; ownership mismatch is flagged |
| **Jira verify (silent)** | **Reconcile one key + site and verify the issue quietly, batched with the MR fetch. Terminal/blocked/unidentifiable → stop now. `To Do`/`To Review` → resolve the exact target and carry it to Step 6; say nothing. Already active → say nothing at all. No active transition reachable → record the reachable `to.name` set for Step 6. Never call the current status "active-equivalent" to skip the question. No writes in this step** |
| Branch | Compare to the current branch from Step 1; check the dirty-tree status before switching. Clean but ahead of its upstream, or on an unrelated ticket → name both branches when switching, don't switch silently |
| Fetch comments | `glab_api` → `.../discussions` with `output: ndjson`; drop `system: true`; **reconcile `notes_total` vs `user_notes_count`**. Carry `threads_total` and `reviewer_notes` separately — the report counts threads, the reconciliation counts notes, and your own prior replies are neither. Zero comments → stop, ask, don't produce an empty triage report |
| Triage | Classify each, verify reviewer-named APIs in `node_modules`, check cross-comment interactions, check against conventions relevant to the file actually edited, cross-check against this skill's own `review-feedback-patterns.md` if it exists — no edits. Referenced file/line no longer exists → flag explicitly, don't skip silently |
| **Speed** | **Read-only steps (1's profiling, 5's per-thread file reads) parallelize freely as plain batched tool calls — no sub-agents needed for this. Validation commands in Step 7 (diagnostics/tests/lint/smoke) run concurrently too, but skip a full build there when the pre-push hook is about to build the same project(s) anyway — one duplicate multi-minute build buys nothing. Step 7's actual edits stay single-threaded, one at a time, in this process — a concurrent edit is indistinguishable from the untracked parallel-edit problem the hunk-attribution check exists to catch** |
| **Report** | **Full triage report (including general MR-level comments), wait for go-ahead — hard stop.** Header is two lines: `{X}+{Y}` must equal `threads_total`, and the `user_notes_count` tick sits on the notes line. Footer carries the Jira transition question when one is needed — omit it entirely when the ticket is already active. A bare "go ahead" approves code, not the board |
| **Jira apply** | Step 7, before the first edit: apply the approved transition, re-read to verify the exact resulting status, stop on failure. Declined or unavailable → record it and stay quiet |
| **New scope (6b)** | **A 💬/⚠️ item the user answers is new scope. Line-or-two → proceed, saying what you'll change. New file, new service, new injection, layer change, or files no reviewer touched → present and wait. Offer "reply without a code change" as a real option. A plan followed by an edit in the same turn is not a gate** |
| Fix | One at a time; lint via `lint:{project}` script → `nx lint {project}` → generic `lint`, narrowest scope that covers the change. Self-review pass at the end: discover review resources by reading their **descriptions**, never by matching filenames; offer what you found rather than silently applying it; always run the generic diff scan regardless. Disclosed in the Step 8 summary, with the offer folded into that same gate |
| **Attribute the diff** | **`git add {file}` stages the whole file, including the user's parallel edits — `git status` cannot see this. After staging and formatting, read `git diff --cached` in full and map every hunk to an approved comment or to a formatter that reported changing that file. Unattributable hunk → stop and ask whose it is. Never guess a formatter/plugin as the cause** |
| **Summary** | **Validate, stage by name, format, re-stage, self-review `git diff --cached`, then show summary + evidence + commit message + exact Jira review target. Do not render the gate without the diff, `--numstat` counts, hunk attribution, the self-review pass, and a still-open discovered-checklist offer never pre-answered by you — all five. `+X/-Y` from `--numstat`, never from memory. Staged / Self-review / Jira always appear; Jira is a question, not a status line. Wait for independent commit and Jira approvals; later mutations loop back** |
| Commit | Re-check that `git diff --cached` matches the approved set, then commit — no staging or formatting after approval; terminal git, not MCP tools. After committing, read the hook's output **and** compare `git show --numstat HEAD` against the approved counts; divergence stops the push |
| **Pre-push** | **If the hook runs builds, present (a)/(b)/(c) and wait — hard stop. Never pick `--no-verify` yourself.** Present (a) as the default with an explicit 30-min timeout and a duration estimate; don't predict a timeout |
| Push | `git push`, or `git push --no-verify` per the user's answer. Divergence → fetch, show ahead/behind, stop for an explicit reconciliation choice and renewed review; never merge/rebase/force implicitly |
| **Replies** | **Preview replies, wait for approval — hard stop.** Then reply inline and resolve per approved thread. Track reply note IDs and resolution state; on partial failure re-fetch discussions, reconcile remote state, and retry only missing actions — never repost an existing reply |
| **Write like a person** | **Plain sentences for anything posted to GitLab or Jira — no `Fixed — did X` dash-led template repeated across a batch of replies. Vary how each reply opens; a reviewer reading six in a row notices a script** |
| **Jira after replies** | Only after a successful push plus every approved reply/resolution: re-read the verified ticket. If separately approved and still active, transition by exact `to.name` to the Step 8 review target and verify. Publication failure leaves Jira active |
| **Time log (last)** | **Ask for time spent only here — after push, replies, resolutions, and the status change — then log the confirmed duration. Include the ticket's `timetracking` figures (estimate / logged / remaining) in the ask; this is the one place Step 2.5 fetched them for. Never ask at Step 8, never infer it, and still ask when earlier stages failed. Don't announce the resulting Jira status as its own message first — this line is its first appearance, folded in with the time question, not a recap** |
| **Lessons** | **Optional follow-up only. Patterns that would apply again; skip one-offs and lint-enforced items. Eligible items include Question/Disagree that became real fixes. `×N` count, append/deduplicate `[sources: MR !N note M; ...]`, promote to top at ×3. A rule with no `[sources:]` cannot be bumped — offer backfill vs count-as-new and ask. Approval covers the previewed lines only; frontmatter/`inclusion` changes need their own separate question. If accepted, preview and wait — hard stop** |
| **Stop** | **Do not merge, approve, delete branch, or set Jira Done. The reviewer decides.** |
| Never (process) | Commit or push without approval, post replies without previewing, skip the report, skip the self-review pass, edit before approval, start implementing an answered Question in the same turn you plan it, guess answers to reviewer questions, reply as a general MR comment instead of inline, resolve silently, force-push without asking, merge or approve the MR, escalate to `--no-verify` when the user's chosen option fails, dispatch a sub-agent (or otherwise parallelize) to make an actual code edit in Step 7 |
| Never (unverified claims) | Report `+X/-Y` from memory instead of `--numstat`; treat `git status --short` or `Exit Code: 0` as evidence about file contents; commit a file you haven't diffed; attribute a hunk to a formatter whose output says it changed nothing; call a status "active-equivalent" on the strength of `statusCategory`; bump a `×N` you cannot verify from `[sources:]`. When you can't account for something, ask — the user is the cheapest source of truth about their own tree |
| Never (tooling) | Use any `glab_mr_*` tool that targets one specific MR (`mr_view`, `mr_note`, `mr_diff`, `mr_approve`, `mr_issues`, and unlisted siblings — always fail, use `glab_api`), omit `ndjson` on list endpoints, triage only the URL's `note_id`, use git MCP tools (`git_add`/`git_commit`) when hooks exist — use terminal commands, or dispute a reviewer-named API without searching the dependency tree |
| Never (hardcode) | Host, project path, package manager, lint command, branch name, commit format, Jira site, Jira active/review status names, ticket prefix — all derived in Steps 0–2.5 |
| Never (external dependency) | Call another Kiro power. This skill relies on `git` and GitLab access; Atlassian access automates Steps 2.5/11. When Jira tooling is unavailable, require manual verification of the exact Jira hostname, ticket key, summary, and current status, plus confirmation of each required exact transition and its resulting status; otherwise stop |
| Never (silent assumptions) | Proceed on a malformed URL, wrong-project MR, ambiguous/missing Jira identity, terminal/blocked Jira ticket, unassigned/not-yours MR, zero-comment MR, or an unattributable staged hunk without surfacing it first |
| Never (brittle discovery) | Decide what a project's review resources are from a hardcoded filename list. Read each candidate's own `description` and judge from what it says it does — projects name these anything, and a fixed list misses whatever you didn't predict |




