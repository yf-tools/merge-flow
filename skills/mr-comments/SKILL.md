---
name: mr-comments
description: End-to-end gated workflow for working on an existing GitLab merge request - covers BOTH addressing review comments AND resolving a merge conflict, whichever the user came for (Step 0b picks the lane; the gates are the same either way). Fetch the MR, every comment and the Jira ticket, then open with ONE complete report - state, blockers, every unresolved thread in detail, ticket status - and stop for a single go-ahead covering the checkout, the Jira move, the code reads and the fixes. Then fix each thread, or apply an approved conflict-resolution plan - then commit, push, reply inline, resolve, return Jira to review, and optionally log time. Use when the user pastes a full GitLab MR URL (optionally with a '#note_' fragment), or says things like "handle MR comments", "address review feedback", "fix reviewer comments", "go through the comments on this MR", "reply to the review comments", "resolve the MR threads", "this MR has conflicts", "fix the conflict on this MR", or "it can't merge".
license: MIT
compatibility: GitLab only - GitHub and Bitbucket pull requests are out of scope and the workflow stops rather than improvising. Needs network access, git, an authenticated glab (CLI on PATH or the glab MCP server), and Node.js for the bundled mr-review-checks server and scripts/. GraphQL is the default fetch path with a REST fallback. Jira transitions, comments and worklogs need Atlassian MCP tooling; without it the workflow asks for manual confirmation instead of skipping the check.
metadata:
  version: "1.5.0"
  author: Youssef Fathalla
---

# MR Workflow — Working an Existing Merge Request

Two kinds of work arrive at the same URL: **review comments to address**, and **a merge conflict to resolve**. This file covers both. Step 0b decides which one the user came for; the gates, the opening report, the Jira handling and the commit/push discipline are identical either way, and only the middle of the run differs.

Whichever lane you're in, work proceeds **one item at a time** — each comment, or each conflicted region, gets read, verified against the code, resolved, and confirmed before moving to the next.

**If this file seems not to describe the task, read Step 0b before concluding that — and never improvise a run around it.** A conflict-fix request on an MR URL is in scope; so is anything else that arrives at one. Setting this file aside once cost a real run every gate in the workflow: no report, an unannounced branch switch, an implicit `git merge`, eight ungated edits, a `--no-verify` commit, and nothing reported for 21 minutes. `references/failures.md` has it.

Nothing in this workflow is project-specific. Host, project path, package manager, lint command, branch name, commit format, Jira site, and Jira workflow statuses are all **derived at runtime** (Steps 0–3), directly from the repo and connected services — never hardcoded, and never carried over from a previous session. This skill has no dependency on any other Kiro power; re-derive everything every time.

Three decisions do not live in this file: reading the MR payload for things that change the plan and reconciling the comment counts (both Step 2), and enumerating staged hunks (Step 7). Those go through the **`mr-review-checks`** modules bundled with this power — pure functions over data you already fetched, covered by tests. They are not a cross-power dependency and they scan nothing; they exist because those three are about *noticing*, and a rule saying "also check this" loses to the length of this file. **Step 2's two run inside `scripts/fetch-mr.mjs` rather than as tool calls** — it holds the payload already, so it prints `triage` and `counts` instead of handing 10 KB back out through you (which was slower than the fetch and observed failing). The equivalent tools remain for the `--raw`/`--rest` fallbacks; `attribute_staged_hunks` stays a tool call, because its input is a diff you generate at Step 7.

## Five invariants. Everything else is an instance of them.

This file is long because it records specific failures. Don't read it as a lookup table of cases — read these five as the actual rules, and treat the rest as evidence that they matter and worked examples of applying them.

1. **A claim needs evidence from this run.** Any number, status, count, or "I checked X" must trace to a command or tool call whose output you have seen in *this* session. Not memory, not inference, not what a file's description says it does, not a value fetched half an hour ago.
2. **A gate closes only on the user's words.** If you wrote it, it isn't an answer — not your summary, and not a question that merely mentions the gate. ("Compliance claims" below has the concrete shapes.)
3. **Every list here is examples, never a boundary.** Tool names, status names, filenames, failure modes — all illustrative. Absence from a list is never evidence that something is safe or absent. When a list doesn't match what you're seeing, that's the uncovered case, not permission.
4. **A fact stated in two places will drift.** If you're about to restate a rule, reference it instead. If two files must agree, a test should assert they do.
5. **Open-ended work needs a stopping rule.** Investigation, verification, retries — all bounded. "Unverified, here's what I checked and what's still open" is a legitimate result and usually a better one than a delayed answer.

When something isn't covered, reason from these and follow the protocol in "When this skill doesn't cover what you're looking at" below. Do not go hunting for the closest paragraph and stretch it to fit.

## The thirteen rules that matter most

1. **Verify the Jira ticket before the report, silently; ask about moving it inside the report.** Identify and validate the ticket in Step 3, and stop there only if it's terminal, blocked, or unidentifiable. A needed transition is not urgent and never gets a message of its own — it becomes one line in Step 5's report, and it is applied in Step 6 as work actually starts. Never reclassify the current status as "active-equivalent" to avoid asking. (Steps 3, 5, 6)

2. **Fetch every comment before triaging any of them.** `reconcile_discussion_counts` checks the fetch against `user_notes_count` and keeps threads, notes, and reviewer comments as three separate numbers — don't count them yourself. A single comment on a freshly-reviewed MR almost always means you under-fetched. (Step 2)

3. **One report reaches the user before any code changes. It is the run's first output and its only pre-work stop.** Everything needed to decide with — which MR this is, whether it can merge, every unresolved thread in full, the ticket's real status, what happens next — is known after two batches of reads, because none of it requires opening a project file. So it all goes out in one message and **the turn ends there**. No orientation message ahead of it, no separate Jira question, no checkout and no file read before it. (Step 5 → "One report, then the work")

4. **An answered Question is new scope, not an approval — and so is anything the investigation turns up.** If it implies more than a line or two, gate it before editing. A plan and an edit in the same turn is not a gate. (Step 6b)

5. **Read `git diff --cached` and attribute every hunk before presenting Step 8.** Staging a file stages *everything* uncommitted in it, and `git status` cannot show you that — only the diff can. Report line counts from the tool, never from memory. Step 7's "Attribute every staged hunk" section explains the mechanism and the three sources of foreign content. (Step 7)

6. **Show the final summary and stop.** No commit, push, or later Jira review transition before explicit approval. (Step 8)

7. **Let the user choose how to handle a heavy pre-push hook.** Never pick `--no-verify` yourself. (Step 9)

8. **Preview thread replies and stop.** No posting or resolving before approval. (Step 10)

9. **If recurring lesson capture is offered and accepted, preview its local steering-file change and stop.** Approval covers the previewed lines only. It shapes future requests in this clone. (Step 12)

10. **A discovered self-review resource's offer is answered by the user, inside the Step 8 card — not by you.** See "Compliance claims require evidence, not description" below for the general rule; the checklist offer lives as a line in the Step 8 summary itself and only that specific gate applies to it. (Step 7's self-review pass, Step 8)

11. **Batch independent tool calls; never parallelize the actual edits.** The whole first phase is four batches, listed in "Four batches, not fifteen turns" below — read that as the execution plan, not as a suggestion to parallelize where convenient. Step 7's validation commands batch the same way. Step 7's fixes stay single-threaded and sequential in this process, because a concurrent edit looks identical, to the hunk-attribution check in rule 5, to an untracked edit from someone else. (Steps 1–4, 6, 7)

12. **Ask for the time before the Jira writes, then make them all in one turn.** The review transition, the closing comment and the worklog are writes to the same ticket with no ordering between them, and one of them is waiting on a question — so the question goes first and all of them go out together once it's answered. Name the target as *pending* in that question; the verified status appears exactly once, in the closing line, after the write returns. The ordering is the point: it makes the old failure impossible rather than forbidden — announcing "Jira is now {status}" as its own message and then repeating the same fact inside the time-log ask a turn later. (Step 11)

13. **Decide what the run is for before planning it, and don't set this file aside.** An MR URL arrives with a purpose attached: review comments, or a merge conflict. Step 0b picks the lane, and both lanes run through the same gates — only the middle differs. A conflict named by the user is the *subject* of the run, not a blocker on a review pass. If this file looks like it doesn't describe the task, that is the signal to read Step 0b, not to improvise: doing the latter cost MR !508 every gate in the workflow. (Step 0b)

Rules 1 and 3–9 are hard stops when applicable. In the conflict-first lane rule 3's report is the resolution plan gate rather than the triage report; it is the same stop with different contents. Rules 11, 12 and 13 are standing constraints on how you execute and how you phrase, not gates. The Jira transition, pre-push, and lesson gates are conditional; none authorizes a different remote mutation.

**Never explain a change you didn't make with a guess.** If an unexpected hunk, an unexplained line count, or a status you can't account for appears, the user is the cheapest source of truth — ask. Attributing it to a formatter, a plugin, or a config, when the tool's own output doesn't say so, converts a one-turn question into a false statement on the record. This is rule zero because it is what makes rules 1, 5, and 6 fail quietly rather than loudly. The same instinct applied to a *failure* rather than a diff is the last item under "When this skill doesn't cover what you're looking at" below.

### Compliance claims require evidence, not description

A related but distinct failure: reporting that something was checked, verified, or found clean is a claim about an action you took, not about what a resource says it does. This recurs anywhere a discovered resource — a checklist, a Step 8 precondition, a status, a count — sits between "found" and "reported done." Two shapes of it:

1. **Skipping the question and reporting a result anyway.** Naming a checklist and summarizing its *description* is not evidence you ran it. If you have not opened its full content and followed what it specifies, the only honest output is the open question — never a finding, a pass, or a count of violations attributed to it.
2. **Answering your own question.** Asking whether to run something, then substituting a generic pass or your own judgment for the reply and presenting the result as if the user had answered. "Otherwise I'll proceed" followed immediately by proceeding in the same breath is not a pause — it's rhetorical. Even correctly naming a gate as still-open (e.g. replying "no" to "did you run it?") does not license closing it yourself right then; noticing it's unresolved isn't the same as being told to resolve it.

Both shapes are invariant 1 applied to compliance specifically. Rule 10 and Step 8's preconditions are where this has concretely gone wrong; `references/failures.md` has both runs.

## When this skill doesn't cover what you're looking at

This workflow runs against other people's repos, other people's boards, and MCP servers that change underneath it. **You will hit situations described nowhere in this file.** That is expected, and it is not the failure.

The failure is what tends to happen next: treating the nearest documented case as though it were the same case, reporting what you could determine as though it were everything you were asked to determine, or supplying a plausible cause for something you never diagnosed. All three read as competence. All three are worse than saying "this isn't what I expected."

**When reality doesn't match this skill, report it in this shape and stop:**

1. **What you expected, and what you actually got** — with the real value, not a summary of it. `detailed_merge_status` came back `conflict`; the endpoint returned 404; the transition list was empty; the hook printed nothing for six minutes.
2. **Which decision it blocks** — name the step. *"I can't tell whether it's safe to check out the branch"* is actionable. *"Something went wrong"* is not.
3. **The options you can see, and which one you'd take** — with the tradeoff, and say plainly when you can't tell. An uncovered case usually has two or three plausible moves, and a user picks from a list far faster than from an open question.
4. **Then wait.** An uncovered case is a gate, whether or not this file declared one there.

**Never resolve an uncovered case by:**

* **Mapping it onto the closest documented case** and proceeding as if the mapping were verified. Similar is not the same, and the difference is exactly what you don't understand yet.
* **Retrying the same call unchanged**, hoping for different output. Once is a retry, twice is diagnosis, a third time is stalling.
* **Reporting a partial result as a complete one.** If you determined three of five things, say which two you didn't.
* **Naming a cause you haven't confirmed.** *"I don't know why this failed"* is a complete and useful answer. A confident wrong cause sends the user to the wrong place, and costs more than the silence would have.

**Uncovered does not mean unbounded.** Investigating an anomaly is fine; disappearing into it is not — see "The report is the deadline" below. If two or three attempts don't produce a diagnosis, then the anomaly *is* the finding: report it as one and let the user decide whether it's worth more time.

Everything in this file is an instance of the invariants above. When no instance matches, reason from the invariants and use this protocol — do not go looking for the closest paragraph and stretch it to fit.

## Mistakes a user can hand you — check for these before acting

Twelve mismatches between what the user meant and what the run is about to act on. Every one is decidable from data already in hand, so check them before acting rather than after.

**The verdict column is binding. `references/user-mistakes.md` has why each is what it is, and what to say — read it when a row fires, not before.**

| Mismatch | Step | Verdict |
| --- | --- | --- |
| Malformed or non-GitLab URL | 0 | **stop and ask** — never guess `project_path`/`iid` off a partial match |
| MR belongs to a different project than this workspace | 2 | **stop and ask**, before Step 6 checks anything out |
| MR not authored by or assigned to the current user | 2 | **flag, don't block** — one line on the **Flags** row. `undetermined` when `current_user` was omitted, never "passed" |
| MR is `merged`, `closed` or `locked` | 2 | **stop and ask** before treating it as active work |
| MR has conflicts (`has_conflicts: true`) | 2 | **blocker from `triage_mr_payload`** — its question replaces the report's `Go ahead?`, because it changes what the run is for |
| No unambiguous Jira ticket | 3 | **stop and ask.** No key at all is a hard stop — exit rather than touch MR, branch, code or Jira |
| Jira ticket terminal (`Done`, `Closed`, `Merged`) | 3 | **stop and ask** — never move completed work backwards over leftover comments |
| Jira ticket not actively in development | 3 → 5 | **don't stop** — resolve the reachable active status quietly, put it in the report's go-ahead list. `Blocked` or unclassifiable stops immediately |
| Zero comments (`user_notes_count: 0`) | 2 | **stop and ask** — never manufacture a report from nothing |
| Clean branch, unrelated to this MR | 1/6 | **say what you're switching from and to**, even when the tree is clean |
| Reviewer comment points at a file or line that's gone | 6 | **flag, don't block** — a Step 6b finding, never a report item |
| User edits the files you're editing | 7 | **stop and ask before committing** — only `git diff --cached` catches it, and never explain a hunk with a guessed formatter |

Blockers land on the report's **Blockers** row, non-blocking flags on its **Flags** row, the Jira transition among the things the go-ahead covers, and later ones fold into Step 6b or Step 8. **None becomes an ad hoc pause of its own.**

**The test for "stop now" vs "fold into the report" is whether continuing wastes work or does damage — not whether a decision is needed.** A ticket sitting in `To Do` needs a decision, but reading comments while it sits there costs nothing and is trivially reversible, so it waits for the report. A ticket sitting in `Done` means you may have the wrong ticket entirely, so continuing might throw the whole pass away. Same subsystem, opposite urgency.

## Internal discovery is not a user-facing report

Steps 0–4 are investigation, and all of them run *before* the report. Run them quietly. Derive and retain every value you need, then say nothing about the ones that came back fine — the report is where findings go, and it is the only thing that goes out.

**Never narrate:**

* Which power or skill you activated, or that you're about to follow this workflow.
* Parsed URL fields (`host`, `project_path`, `project_path_encoded`, `iid`, whether a `#note_` fragment was present).
* The project profile (package manager, scripts, monorepo tool, framework and version, hook contents, commit convention).
* Which tool or endpoint you chose, or step numbers and step titles as progress announcements.
* Checks that passed — host is GitLab, tree is clean, MR project matches origin, branch checked out successfully.
* **That the Jira ticket is already in active development.** This is the single most tempting thing to report, because you just looked it up and it feels like progress. It isn't: the user learns nothing actionable, and it trains them to skim your status lines. An already-active ticket earns its status on the report's **Ticket** row and no other mention anywhere.

**Do surface:**

* **The report** (next section), as the run's first user-facing output *and* its only gate before any work starts.
* Anything that makes the report unwritable or wrong to write: malformed/non-GitLab URL, wrong-project MR, merged/closed MR, dirty tree, zero comments, ambiguous or missing Jira identity, terminal or blocked ticket, tool or API failures. Everything else — including **an MR that can't merge** (`has_conflicts: true`) — is a row *inside* the report rather than a message ahead of it.
* The defined gates: Step 5's report — or Step 0b's resolution plan gate in its place, in the conflict-first lane — Step 6b's findings gate, Step 8's summary, Step 9's pre-push choice, Step 10's reply preview, Step 12's lesson preview.
* Any staged hunk you can't trace to an approved comment or a formatter that said it changed that file (Step 7) — always ask, never explain it yourself.
* One-line flags that don't block: ownership mismatch, a branch switch that could surprise the user, a check that came back `undetermined`. They all belong on the report's **Flags** row, in the message the user is already reading, not scattered across the next few turns as they occur to you.
* One line per fix as you make it in Step 7, naming what you're changing. Not a plan and not a question — the report already carried that decision. It exists so an edit arrives with a name attached instead of as a silent `str_replace`.

Note what is *not* a message of its own: a needed Jira transition. It is a decision, but it is not urgent, so it appears in Step 5's report among the things the go-ahead covers. See Step 3.

### One report, then the work

There used to be two messages before any code changed: a short brief, then the triage report minutes later. Two stops, two waits, the second repeating half the first, and the questions asked in the wrong order — a go-ahead collected before Jira had even been read, so the board question arrived later, bolted onto a different message.

**There is one report now, and it is the run's first output.** Everything in it comes from batches 1 and 2 of the next section — the MR, every discussion, the git state, the Jira ticket — which is two turns of tool calls and not one project file. That is the whole trick: **what made the old run slow was reading the code each comment pointed at, and none of that is needed to tell the user what the reviewers said.** Quoting a comment, naming its file and line, and reading the ticket's status are all free. So the report carries all of it at full detail, and the code investigation waits for the go-ahead.

**The orientation rows, all from batches 1–2:** state and mergeability, target branch, the ticket key **and its status**, source branch, blockers, non-blocking flags, and the reconciled `countLine`. `references/reporting.md` has the exact shape. What matters here is that the Jira status is among them now — the ticket has been read by the time this is written, so leaving its status out would withhold a fact the user needs in order to answer the question at the bottom.

**No claim about the code belongs in this report.** You have not opened a project file yet, so there is no verified fix, no "already handled in the current code", and no proposed diff. Each item says what the reviewer asked for, in the reviewer's own words, and stops. Writing *"→ Proposed action: add a static `[id]` to the four wrappers"* before reading the template is exactly the failure invariant 1 exists to prevent, and on the page it is indistinguishable from a verified one.

**Resolved threads are a number, never a list.** A thread GitLab has already marked resolved needs nothing from the user, and rendering nine of them as nine cards is how one real report buried its single actionable item below the settled ones. They get counted on the header line, and the line says plainly that they were not re-checked — because they weren't. A user who wants them verified will ask, and that is a reasonable thing to do in Step 6.

**One question, and it covers everything the run does next.** The report closes with a numbered list of what a go-ahead authorizes — the checkout, the Jira transition, the file reads, the fixes — in the order they will actually happen, then a single question. **The Jira move is a line in that list, not a second question.** A user who says "go ahead" to a list containing *"move `ABC-123` from To Do to In Progress"* has approved it; one who replies "go ahead, but leave Jira alone" has declined it just as clearly. And **the order in that list is not cosmetic**: the ticket moves to active development *before* the first file is read, because that is the moment work starts. A run that edits code and then remembers the board is a run whose ticket said `To Do` while the diff was being written.

**The report is mandatory, it is the first user-facing text of the run, and it is a stop — end the turn on it and wait for a reply.** No tool call goes out in the same turn that emits it: not the checkout, not the transition, not a deferred `package.json`. That last part isn't about information; it's about the report still being on screen when the user reads it. A report followed immediately by six more tool calls has been *delivered* and not *read* — by the time the user looks, the client has collapsed the calls into a progress line and the report is above the scroll. Batch 3 exists to be the thing that resumes after the reply. If a field genuinely isn't available (no Atlassian tooling, so no verified ticket status), say that in the row rather than dropping the row. **The stop is ending the turn, not announcing that you are about to.** Writing the report *is* the signal; a session-status or progress tool cannot substitute for it, and setting the same status two or three times over is not a stronger stop, just a slower one. One run spent thirty-eight seconds and five calls doing that before it wrote a single word the user could read.

**What a bare "go ahead" covers: batches 3 and 4, the Jira transition the report named, and the ✅ Fix / 🔵 Nitpick items.** It does not cover 💬 Question or ⚠️ Disagree items, which stay held until answered. It does not cover anything the investigation then turns up that changes the shape of the work — that is Step 6b. And it never reaches a commit, a push, a reply or a resolve; each of those has its own gate further down.

**When `triage_mr_payload` returned blockers, the blocker's question replaces the closing one.** The report renders as normal; each blocker's message goes on the Blockers row, and the closing question becomes that blocker's instead of the default. A conflicted MR is the common case (Step 2): the report names the conflict and asks whether to resolve it first. **That answer is also the go-ahead** — it releases batches 3 and 4 as well, so don't ask twice for the same permission. Either way the report ends in exactly one question.

**Non-blocking flags belong in the same message, on the Flags row** — not scattered across the next few turns as they occur to you. `not-yours`, `no-ticket-key`, `draft`, anything `undetermined`, and the branch switch Step 6 wants named: they're all one line each, and this is the message the user is already reading. A flag delivered three messages later has to re-establish its own context.

**What must never appear in the report:**

* **Anything you'd have to read a project file to know.** No verified fixes, no confirmed-already-handled items, no line counts.
* **Resolved threads as individual items**, or any wording implying they were checked.
* Parsed URL fields, the project profile, which endpoint you called, step numbers — the forbidden list above still applies inside the report.
* Checks that passed, beyond the single **State** row. "Project matches origin ✓", "tree is clean ✓", "authenticated as X" are all noise.

**Four ways this has gone wrong. Each is a thing not to do:**

* **Don't put "I am about to do work" in the slot where "here is what I found" belongs.** *"Now resolving Jira identity and fetching discussions in parallel"* is not a report. Neither is *"Now let me read the actual files."*
* **Don't split it in two.** A short orientation message now and the real report four minutes later is precisely the shape this replaced. One message, everything in it.
* **Don't emit it late.** Every field is known two turns in. Arriving with it three and a half minutes later, after the checkout, is the same failure as not sending it.
* **Don't emit it and keep going.** A report followed by a burst of tool calls is collapsed into a progress line and scrolled past. An unread report is worth about as much as no report.

`references/failures.md` has the runs, with timings and what the users said. Once the go-ahead lands, go quiet until Step 8's summary — apart from one line per fix as you make it, and any Step 6b gate. No per-file narration, no "now reading X", no step titles. One report out, one approval in, then the work. **And don't preface the report with a sentence restating its own numbers** — its header already carries them, and a preamble copy just pushes the first comment further down the screen.

### Four batches, not fifteen turns

Every tool call is a round trip, and the latency is the same whether it reads a lockfile or a whole MR. So **independence decides what goes together, not step number** — the steps are numbered by dependency and most of them don't depend on each other. Fifteen serial calls is what made one observed first phase five minutes. **`references/batching.md` has that run and the evidence behind every rule below; you can execute this plan without it.**

**Batch 1 — everything that needs nothing but the URL and the repo.** One turn:

* **You already have the script paths — don't go looking for them.** `locate_bundled_scripts`' own description states both absolute commands for this install verbatim, and it arrives with the tool list before you read this file. Copy them. **Don't `file_search`, don't `list_directory`, and don't call that tool** — run the command and let a missing-file error be the only thing that sends you looking.
* **The MR and its discussions, in one GraphQL call** (Step 2) — run the bundled script, don't hand-write the call:

  ```bash
  {scripts["fetch-mr.mjs"].run} --project {project_path} --iid {iid} --instance {host}
  ```

  **Run that line as one plain command, exactly as printed.** Don't wrap it in `node -e`, `execSync`, `bash -c`, or any other interpreter to project fields out of the result. An observed run wrapped it and the fetch never happened: a Windows shell does not treat a backslash before a quote as an escape, so Node got a damaged script and stopped at `Invalid string escape`. There is nothing to project anyway — `triage`, `counts` and `mr` are already top-level keys.

  **The flag is `--instance`. Don't "correct" it to `--host`**, which agent shells screen as a dev server. An unknown flag is a hard error rather than a silent default, because a dropped host returns a real MR from the wrong GitLab.

  **It triages and reconciles before it prints, so nothing gets handed back.** Output is `{ mode: "triaged", triage, counts, mr, discussions, omitted, hasNextPage, endCursor }`, and it resolves `workspace_remote` and `current_user` itself, so neither check can land in `undetermined` any more. **Read `triage` and `counts` off this output; don't call a triage tool on a payload it already triaged.** `--rest` for an instance without GraphQL; `--raw` for the untouched response, automatic when `server/` isn't reachable.

  **Too long for your command window? Re-run with `--brief`.** Same object, but `discussions`/`omitted` become `threadIndex` — one bodyless row per feedback thread (id, resolve state, path, line, note count, last author). That is where you enumerate the threads; three runs wrapped this script in `node -e` to compute those same fields instead. `discussions` itself is trimmed already and `omitted` says how, keeping unresolved bodies whole since Step 5 quotes only those. **If you're capturing output to a file or writing a script to project fields out of it, stop** — `--brief` or `--raw` with a specific reason is the only sanctioned way to ask for more; one run that improvised instead corrupted its own report's quoting.
* **The git reads, as one script call returning JSON:**

  ```bash
  {scripts["git-context.mjs"].run}
  ```

  Returns `{ remote, branch, dirty, dirtyFiles, log }`. **`dirty` is a real boolean**, which is the whole reason this is a script and not a chained one-liner. **Never hand-roll these reads.** Not `;`, not `&&`, not labelled echoes, and **don't `list_directory` the scripts folder to check the file is there.** **`remote` is in that output, so there is no separate `git remote get-url origin`**.
* `glab_auth_status`, for the `current_user` both bundled tools want (Step 1)
* `getAccessibleAtlassianResources`, if Atlassian tooling exists (Step 3) — it takes no arguments, so it never needs to wait for a ticket key. **The `cloudId` every later Atlassian call needs is that response's `id` (a UUID), or failing that the host out of its `url`. Never its `name`**, which fails both reads.
* **`references/reporting.md`, `references/investigating.md` and `references/jira-identity.md`, and this read is not optional.** `reporting.md` is the report's exact shape and **you may not render Step 5 from memory** — a run that skipped it improvised a report the template forbids. Read them here because they depend on nothing and the report is two turns away. Same rule for every other reference: **a reference read goes in the batch of the step that needs it, never in a turn of its own** — `fixing.md` with Step 7's first validation batch, `publishing.md` with Step 9's first command.

**Batch 2 — the Jira read.** One turn, and usually only two calls, because batch 1 came back already triaged:

* **`getJiraIssue` *and* `getTransitionsForJiraIssue`** (Step 3), on the key from batch 1's `triage.facts.ticketKey`. The transition list is a property of the issue rather than of the status you're about to read, so it doesn't wait for `getJiraIssue` to return. **If `ticketKey` is null, or the title and branch disagree, the Jira reads drop out of this batch** and go serial after Step 3 has reconciled the sources — a read against a guessed key is worse than a round trip, and a *write* against one is worse again.
* **Only on the `--raw` or `--rest` fallback:** `triage_graphql_mr` on the payload, or `triage_mr_payload` and `reconcile_discussion_counts` together. The latter takes **`discussions_text`** — the raw response passed through unchanged, never rebuilt as objects, which is how `resolvable` got dropped on a real run.

**Two things never happen in this batch, on any path: don't tally the threads yourself, and don't trim a payload to make a call succeed.** A hand tally beside the tool's is a second unsourced number rather than a check, and a call that failed on argument size failed on the size, not on what the argument held.

→ **Emit the report and stop.** End the turn there; batch 3 waits for the reply.

**Batch 3 — what the go-ahead unblocked.** One turn, *after* the user answers the report: the checkout, the approved Jira transition, and the profile reads you deferred — `package.json`, the lockfile, `.husky/*` (Step 1). All three are Step 6. The checkout belongs here only when batch 1 showed a clean tree and batch 2 raised no blocker; otherwise it waits for a separate answer while the transition and profile reads proceed.

**Batch 4 — the code reads.** Every file, symbol lookup and grep the approved threads point at, in one turn (Step 6). This is the only batch that must follow the checkout, because it reads the working tree.

Four turns of tool calls, not fifteen — with one wait, between batch 2 and batch 3, for the report.

**Exactly two things stay serial:** the Jira read when batch 1 couldn't settle the ticket key, per batch 2 above, and Step 7's edits, one at a time, for the reason in rule 11. And one standing rule the batches are shaped around: **a large payload never travels through you to reach a local tool.** Noticing you are about to retype one is the signal that the work belongs on the other side of that boundary.

A batch that comes back with a surprise (truncated response, an unexpected `undetermined`, a 404) is re-issued as its own call. **Re-issue only the call that failed. A batch is not a transaction** — the other results are still valid, and re-fetching a payload that already returned cleanly is a call for nothing.

### Verification is bounded — don't let it eat the run

Everything after the go-ahead is on a clock the user is watching, and what they approved was the work, not a research project. Reading the files a comment refers to is the job. Establishing ground truth about a third-party API's *internals* is not, and it's where Step 6 runs away.

**Bound the API verification in Step 6 to a couple of reads.** If confirming a reviewer's claim about a library needs more than that — chasing generated type metadata, tracing an injectable's provider chain through a bundled `.d.ts`, reverse-engineering a build artifact — **stop and raise it as a Step 6b finding**, with what you checked and what remains open. *"Reviewer claims X; I couldn't confirm it from the published types in two reads — worth checking before we act"* is useful and honest. Six minutes of type archaeology is not, and it lands in the same place either way.

**Two escalations of the same question is the cap, not two of each tool.** When `grep_search` comes back empty, the tempting move is `file_search`, then a shell text search, then a narrower glob, then the same search again with surrounding context — five tools failing on one question. Three tools failing the same way *is* the answer: the symbol isn't reachable that way. Take the cheap path once (a package's `types`/`typings` entry point from its `package.json`, then one grep inside that file) and if it doesn't land, the item is unverified.

**Never read compiler-mangled internals.** Angular's `ɵprov` / `ɵfac` / `ɵɵInjectableDeclaration` markers inside a generated `.d.ts`, bundled build artifacts, minified output — the answer is not worth the reading, and "unverified, here's what I checked" is the correct result. This has cost six minutes and thirty-odd calls once, and ten calls again with the rule already in front of the run.

A different current branch than `source_branch` is normal, not an alarm. With a clean tree, check it out and move on; only name the switch when it could discard the user's mental model of what they were working on (see Step 6).

## Formatting every report to the user

Every blocking step below (3's terminal/blocked stop, 5, 6b, 7's hunk-attribution question, 8, 9, 10, 12) presents a decision or a list of things — status changes, comments, fixes, options, replies — and each risks becoming unreadable if you free-style the layout. Follow the same three rules everywhere, not just where a step spells it out:

1. **One item, one block.** Give each item its own header line (bold or `###`), then put each field — quote, proposed action, file path — in its own paragraph with a blank line before and after. Never write a field as an indented line directly under a list number: without a blank line, CommonMark treats it as a "lazy continuation" of the same paragraph, and every renderer reflows it into one dense run-on block.
2. **Tables are for short, single-line facts only** (a file path, a status, a count). The moment a column would hold a full sentence — a reviewer quote, a proposed reply, a multi-clause explanation — stop using a table and switch to the one-block-per-item style from rule 1. A table cell doesn't wrap a paragraph; it just cuts it off or crushes it.
3. **Separate items with a horizontal rule (`---`) or a blank line**, so a report with five items reads as five distinct chunks, not one paragraph five times as long.

The templates below already follow this. When a step doesn't give you an exact template (Steps 1, 2, 6, 11), still apply these three rules to whatever you actually surface — which, per the section above, is usually only a blocker, a flag, or a gate.

## Anything posted to GitLab or Jira gets written like a person wrote it

The formatting rules above are for the report you show in chat. Everything you write for somebody else is a different surface: thread replies (Step 10), the commit message body, a Jira worklog note. Those land in a permanent record, next to whatever a human teammate would have typed, and a templated-sounding reply is the fastest way to make a reviewer feel their comment got a form response instead of an answer. **The report's own prose is not exempt.** A "What they're asking for" sentence follows the same rules as a reply; only its markers and its headings exist to be scanned.

The most common tell is opening every reply the same way: a short word, a dash, then the fix. Six of those in one batch read as generated even when each is accurate. **The rest, compressed: no em dashes, no emoji, no escalating agreement ("Great catch!", "You're absolutely right!"), no groups of three, no "not just X, it's Y", no sign-off, no bold inside a two-sentence reply, no passive voice hiding who made the change, and none of leverage, utilise, delve, robust, seamless, comprehensive, crucial or additionally.** Say what changed, where, and why, then stop. A reply three sentences longer than the comment it answers is carrying decoration. **Step 10's "Write replies like a person" section has the reasoning, a before and after pair, and four worked examples.** Read it before posting a batch, not only the first time.

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

**The `#note_` fragment is a starting point, never the full set.** It's the comment the user happened to click. Treat it as one entry in the list you fetch in Step 2, and verify it appears there.

If the user names an MR without a URL, derive host and project path from `git remote get-url origin` in Step 1.

**If the URL doesn't split cleanly on `/-/merge_requests/{iid}`, stop here — don't proceed with a partial match.** A GitHub PR link (`.../pull/123`) or a Bitbucket one (`.../pull-requests/123`) will fail this split; so will a plain typo. Do not invent a `project_path` or `iid` from a best-effort guess — that value poisons every API call downstream with no visible error until it's confusing. Instead:

* If it's recognizably a GitHub or Bitbucket PR URL, skip straight to the host guard in Step 1 and say so rather than attempting a GitLab call.
* If it's not recognizable as any of the three, show the user what you parsed and ask them to confirm or repaste the URL.

## Step 0b — Decide what the run is for, then pick the lane

The URL says *which* MR. The words next to it say what the run is **for**, and there are two answers. Read them before you plan anything.

* **Review lane** — the default. The user wants review comments addressed. Everything below runs as written.
* **Conflict-first lane** — the user named the conflict as the reason they're here: *"we have a conflict we need to fix"*, *"it can't merge"*, *"resolve the conflict on this MR"*, *"fix the merge conflict"*. The subject of the run is the conflict; review comments are context, not the work.

**Pick from what the user said, not from what the payload says.** A conflicted MR with no stated purpose is still the review lane — the conflict is a blocker there, and the report's blocker question is what lets the user choose (Step 2's "A conflicted MR changes the plan"). Their answer selects the lane. Conversely, a user who says "fix the conflict" is in the conflict-first lane even before you've confirmed a conflict exists; if `triage_mr_payload` comes back `has_conflicts: false`, say so and ask rather than hunting for one.

**The lane changes the middle of the run. It never changes which gates exist.** Same report, same stop, same summary-before-commit, same push discipline. A conflict is *more* consequential than a review fix, not less — it rewrites code nobody reviewed and it lands on a shared branch.

### Before planning a local merge: two cheaper paths

Two checks against data batch 1 already fetched, and **either can end the run in a single call, so run them before building the plan table.** A branch that is merely behind (`detailed_merge_status` on `checking`/`unchecked`, `has_conflicts: false`) is rebased through GitLab's API with nothing touched locally — confusing that with a real conflict is how a five-second call becomes a twenty-minute merge. And when every conflicting file meets GitLab's published UI criteria, the browser path is **offered rather than decided for the user**. **You cannot drive either resolution yourself and must not claim to have:** no `/api/v4/` endpoint resolves conflicts, and the Commits API cannot forge the merge commit.

**`references/conflicts.md` has both in full** — the rebase endpoint's polling and `403` cases, the exact criteria, why the web resolver is unreachable, and the `git merge-tree` reading that fills in the plan gate **without** starting the merge.

### The resolution plan gate (conflict-first lane, replaces Step 5)

**This replaces Step 5's report for this lane, and it is the same hard stop: present it, end the turn, wait.** Three decisions live in a conflict resolution and **all three are the user's** — the merge strategy, which side wins per region, and whether anything exceeds a mechanical pick.

**The template is in `references/conflicts.md`, which you must read before rendering this.** Two rules from it matter enough to name here: the **Beyond a mechanical pick** row is not optional, because `none` there is a claim under invariant 1 that every region is a straight side-pick; and **nothing gets merged or rebased before this gate closes**, strategy included — inspecting the repo's convention is right, choosing from it silently is not.

## Steps 1–4 — Investigate, without touching the working tree

**Procedure: `references/investigating.md`.** Read it in batch 1. It has the profile table with the batch each value belongs to, the exact API calls, the reconciliation rules, and the per-thread classification checklist.

**None of these four steps opens a file a comment points at, checks out a branch, or writes anything.** That is what makes the report cheap enough to put first, and it's a constraint rather than an observation: the reads that scale with the number of threads are the ones that cost minutes, and they all wait for Step 6. What *is* allowed here is a fixed handful of local reads — the git state, and one conditional read of this skill's own `review-feedback-patterns.md`; Step 1's `package.json`/lockfile/hook reads are deferred to batch 3 for the same reason.

| Step | Decides | Stops the run when |
|---|---|---|
| **1 — Profile** | Package manager, scripts, monorepo tool, framework, hooks, commit convention, dirty tree, current branch, authenticated username. **Derived from the repo, never assumed, never from another power.** Half is batch 1; the rest waits for batch 3 | The git host isn't GitLab — say so and don't improvise `gh` |
| **2 — Fetch MR** | `source_branch` (authoritative — never infer from the title), `target_branch`, `state`, `user_notes_count`, the three merge-status fields, **and every discussion — one GraphQL call for all of it.** Then **`triage_graphql_mr` on the whole payload** — don't eyeball it and don't count threads yourself. Report `feedbackThreads`, never `threadsTotal` | Any `blocker`: wrong project, terminal state, conflicts, zero comments. `undetermined` is *not* a pass. `reconciles: false` — never report on a partial set |
| **3 — Verify Jira** | One `(hostname, key)` pair, the exact current status, and the exact reachable active-development target. **Branches and status classification: `references/jira-identity.md`, read in batch 1.** Silent, and **no writes** — but the status it finds is a row in Step 5's report, because by then it's a fact you hold | Terminal, blocked, unclassifiable, or no unambiguous ticket |
| **4 — Classify** | One classification per unresolved thread — ✅ Fix, 💬 Question, 🔵 Nitpick, ⚠️ Disagree — **from the comment text alone.** Resolved threads are counted, not classified. No `✔️ Already addressed`: that is a claim about the code, and the code isn't read until Step 6 | Nothing |

## Step 5 — Present the Report (BLOCKING)

Report every unresolved thread, say what a go-ahead will do, then stop. Do not continue until the user replies. **Never skip this report**, however trivial the comments look, and **never split it** into an orientation message now and the real one later.

**Template: `references/reporting.md`**, read back in batch 1. It has the header arithmetic, the item shape, the fixed marker set, and the closing "what happens when you say go" block with its Jira line.

What the gate itself decides, beyond the section above:

* **Unresolved threads get full detail. Resolved ones get a number.** One numbered item per unresolved thread — marker, `file:line`, the reviewer's own words, what they're asking for. Resolved threads are a single count on the header line, stated as not re-checked, because they haven't been. Rendering them as items is what buried a real report's only actionable comment under nine settled ones.
* **A bare "go ahead" approves ✅ Fix and 🔵 Nitpick, and the Jira line with them.** Keep holding 💬 Question and ⚠️ Disagree until explicitly resolved. *"Go ahead, but leave Jira alone"* is a complete answer — take it and don't re-ask.
* **The header's numbers all come from `reconcile_discussion_counts`**, verbatim, and **`{needsYou} + {rolledUp}` must equal `feedbackThreads`** — the only proof in the report that every thread was accounted for rather than quietly dropped. Verify it before sending.
* The user may approve all, approve a subset, override a classification, or answer flagged items inline. Follow their reply.

## Step 6 — Start Work: Checkout, Jira, Then the Code

The go-ahead landed. **Procedure: `references/checkout.md`**, read in batch 3. It has the three checkout paths, the dirty-tree rules, the transition's turn, and the per-thread read checklist with its two caps.

**Batch 3 is the checkout, the Jira transition and the deferred profile reads, in one turn — and their order is the substance of the step:** get onto the right branch, tell the board work has started, then open the code. A run that edits first and moves the ticket afterwards spent the whole diff claiming nothing had started.

1. **Check out `source_branch`, fast-forward only.** **Never merge or rebase implicitly** — if fast-forward fails, stop and show ahead/behind. Name the switch when Step 1's log says it could surprise the user.
2. **Apply the Jira transition — only if Step 5's line was approved.** Confirm the exact resulting `status.name`; **a successful API response on its own is not evidence.** If the transition or the confirmation fails, 🛑 stop — there is no fail-open synchronization waiver. Then say nothing more about Jira until Step 8.
3. The profile reads Step 1 deferred — `package.json`, the lockfile, `.husky/*`.

**Batch 4 — read what the approved threads point at.** One turn, every file read, symbol lookup and grep together. **No edits here**, and no sub-agents: batched parallel reads are already as fast, and a sub-agent only adds coordination. **Two caps so this can't eat the run**, both in the reference; past either, the item is unverified — say what you checked and take it to Step 6b.

**This is where the report's items meet the actual code, and some won't survive it.** Every such case goes to Step 6b rather than being absorbed silently — the report is what the user approved, so anything that changes it is news.

### Step 6b — When the picture changes (BLOCKING)

Two things reach this gate: **an answered 💬/⚠️ item**, and **anything the code reads turned up that the report couldn't know.** Neither passed through Step 5, so neither is covered by its approval:

* The fix is **already in the code** — nothing to change. One line saying so, and it becomes a ✔️ item for Step 10's reply rather than an edit.
* The referenced **file or line no longer exists**.
* The reviewer's **premise doesn't hold** — the API they named doesn't exist, or doesn't do what the comment assumes.
* The fix needs a **new file, a new dependency, a new injection, a layer change**, or touches files no reviewer commented on.
* **Two approved items conflict**, so one of them can't be applied as described.
* Verification hit the two-read cap and the item is **unverified**.

Size the gate to the change:

* **A line or two, no new file, no new dependency, no architectural choice** → proceed as an approved Fix, saying in one line what you're about to change *before* the edit.
* **Anything larger, or any of the six cases above that removes or redirects work the user approved** → 🛑 present it and wait. `references/scope-gate.md` has the shape.

**Presenting a plan is not a gate unless you stop after it.** A plan followed by an edit in the same turn is narration; the turn must end on the question. And **always offer "reply to the thread without a code change"** as a real third option — sometimes that is the right answer.

## Step 7 — Fix One Comment at a Time

**Procedure: `references/fixing.md`.** Read it before the first validation command. It has the five-command validation sequence, the staging and formatter order, both halves of `attribute_staged_hunks`, and the self-review discovery. **The Jira transition already happened in Step 6** — don't touch the board again until Step 8.

**One fix at a time** (rule 11), each announced in one line as you make it (see output discipline above). Lint with the narrowest command that covers the change.

Three things in this step are stops rather than procedure, so they are stated here and not only in the reference:

1. **The final approval must cover the exact bytes that will be committed.** Any later mutation loops back through validation and re-presents Step 8. **An earlier approval never authorizes changed bytes.**
2. **Any staged hunk you cannot attribute is a 🛑 stop** — not a thing to rationalise, and never blamed on a formatter whose own output said it changed nothing. Ask whose change it is; the reference has the wording.
3. **The self-review pass is not optional and not deferrable to after the push.** It is the only step that reads the real diff with fresh eyes, which makes its absence the least visible and most expensive failure in the run. If the user has to ask *"can you run the self-review?"* after the push, this step failed. Its discovered-resource offer is answered by the user inside the Step 8 card (rule 10), never by you.

## Step 8 — Present the Final Summary (BLOCKING)

**STOP. No commit. No push. Wait for explicit approval.** If the user says "let me review first", wait — and re-present the summary after any further edits.

**Template and preconditions: `references/summary-gate.md`.** Read it with Step 7's first validation batch, before rendering. It has the card, the five preconditions in full, and the Jira question's two branches.

Four properties of this gate, which decide whether it is falsifiable at all:

1. **Five preconditions, and if any is missing you are not at Step 8 yet.** **Presenting the gate and verifying afterwards inverts the whole point** — the user's "yes" then applies to a description instead of to the change.
2. **Staged, Self-review and Jira after replies always appear, even when empty.** Dropping any of them makes the gate unfalsifiable: a summary without Self-review reads exactly like one where the pass came back clean. Every other section is omitted when empty rather than written as "none".
3. **The Jira block is a question, not a status line.** Writing *"currently TO REVIEW — no transition needed"* and moving on replaces the section with a conclusion.
4. **Three approvals here are independent: commit, Jira transition, and — later — the worklog.** "Ready to commit" authorizes commit and push, nothing else. If the reply doesn't clearly cover the Jira row, ask before Step 9. **Never ask for time spent at this gate** — that belongs at the end of Step 11, after the work is finished. A volunteered duration is a note to confirm later, never the logged value.

## Step 9 — Commit and Push (only after approval)

**Procedure: `references/publishing.md`.** Read it before committing.

1. **Re-check the approved staged set.** `git diff --cached` still matches what was approved, and `git status --short` shows no newly relevant unstaged file. If anything changed, back to validation and the Step 8 gate. **Don't start the pre-push hook here** — commit first, then present the choice.
2. **Commit.** No staging, no formatting after approval — either changes what the user reviewed. Then **read the pre-commit hook's output and compare `git show --numstat HEAD` against the approved `+X / -Y`** — the numbers, not the file list, which matches whether the commit holds your three lines or thirty from elsewhere. **Any divergence is a 🛑 stop, before the push.**
3. **The pre-push hook decision (BLOCKING).** When the hook runs builds rather than a quick check, present three options — **(a)** run it here, **(b)** hand you the command, **(c)** skip with `--no-verify` — then wait. The exact wording is in the reference; what matters here is that it is a real markdown list and not a blockquote, which collapses into one unreadable line. **Never choose (c) yourself**, and if the user picks it, **never write or disclose it** in any remote text. **Present (a) as the default with a 30-minute timeout and a duration estimate, never a predicted timeout.** **If their chosen option fails, that's information, not consent to a more permissive one.**
4. **Push.** The branch already tracks upstream, so no `-u`: `git push`, or `git push --no-verify` only if the user chose (c). **If the remote diverged, stop for an explicit reconciliation decision** — a merge or rebase changes the just-approved commit and needs renewed validation and a fresh Step 8. **Never merge, rebase, or force-push implicitly.**

**If this run resolved a conflict, re-read the MR payload after the push** and report `has_conflicts` from that read. `checking`/`unchecked` is pending, not cleared. `references/conflicts.md` has the three outcomes.

**Run git as a terminal command, never through `mcp_git_git_add`/`mcp_git_git_commit`.** Use whichever terminal tool your environment exposes, provided it **streams output live and takes a timeout you set** — which is why no tool is named here. Through an MCP tool a stalled hook is indistinguishable from a crash.

## Step 10 — Reply Inline and Resolve Each Thread

After the push, prepare replies — but post nothing yet. **Procedure: `references/publishing.md`**, read at Step 9's first command. It has the preview's shape, both API calls, how a reply should read, and the publication ledger.

### Preview (BLOCKING)

One block per thread, each reply a full sentence rather than a table cell, then one question covering the batch.

**STOP until the user approves.** They may approve all, edit a specific reply, or skip some — don't post or resolve anything skipped.

### Then post, then resolve

**Write each reply as an ordinary sentence someone would type after making the change.** A reviewer reading six in a row notices when all six open the same way.

**Independent threads' replies go out in parallel; a thread's resolve waits for that thread's own reply to land** — otherwise you close a thread with no explanation attached.

**For 💬 Question or ⚠️ Disagree, never reply with a fix confirmation** — post the user's answer or approved reasoning, and resolve only after they confirm. **For ✔️ Already addressed, say what already handled it** rather than describing a change you just made. **Never leave a fixed comment unresolved, and never resolve without a reply.**

**Keep a per-discussion ledger** — approved body, posted note ID, required resolution state, confirmed result. On any failure, stop, re-fetch the affected discussions, and **retry only the missing action**: never repost a reply already present, never resolve a thread whose reply is absent, never trust a local success the re-fetch disagrees with. **Resume Step 11 only after every approved action is observed remotely**; otherwise report what's outstanding and leave Jira active.

## Step 11 — Return Jira to Review and Log Time

Use the verified hostname, `{TICKET-KEY}` and `{cloudId}` retained from Step 3. **Never re-infer identity from the MR title at the end**; if the ticket evidence changed during the run, stop and reconcile it again before any write. **Procedure: `references/jira.md`** — read it before the first write. It has the question's exact wording, the write batch's shape, the five branches the re-read can land on, the closing comment's content rules, and how to report three results that can disagree.

**Publication success is a hard precondition.** The commit pushed, every approved reply posted, every approved resolvable thread resolved. Intentionally skipped replies aren't failures, but a failed push, reply or resolution **leaves Jira in active development** — report the exact GitLab failure and **do not run the review transition.** The time question below still runs; time was spent either way.

**`getJiraIssue` + `getTransitionsForJiraIssue` go out as one batch of two in the same turn as the time question, before you emit it — never after the answer.** That ordering is the whole step: the reads and the question are one turn, the writes are the next. A run that read "immediately before the write" as "after they reply" spent an extra round trip and a message on *"Confirmed still In Progress"*, and its question could not carry the figures it is required to carry. **Say nothing between the reads and the question** — what they found appears inside it. The batch runs even when no transition is needed, because the worklog is an automated write too, and **`timetracking` comes from it, never from Step 3.**

### Ask for time spent, then make every Jira write in one turn

**This is the final question in the workflow** — after the push, after every approved reply and resolution, at the point where the user can see what the pass cost. Never ask earlier. It is the last *question*, not the last *write*: the transition waits behind it so every write to the ticket leaves together.

Three things here are claims you can get wrong, so they are stated in this file and not only in the reference:

1. **Name the target as pending, never as done.** *"is now {status}"* is a claim about a write you haven't made, and putting the question before the writes makes that claim unavailable rather than merely forbidden. **Never write "Jira is now {status}" before the server has said so.**
2. **The comment is authorized by Step 8's Jira block, not by this question** — "leave Jira alone" there declined it too. It claims only what Step 10's ledger observed remotely, never the report's intentions.
3. **Never let one success imply another, and never report a status you didn't read back.** The transition, the comment and the worklog can disagree, so the closing line states each separately. **Ask for the time even when earlier stages failed** — these are independent approvals.

## Step 12 — Optional Follow-Up: Capture Recurring Lessons

**Not a default blocking gate.** After everything else is complete, say in one line whether any reusable pattern was noticed and offer capture as an optional follow-up. **Only run the file mutation if the user opts in** — "done", or no engagement, means the workflow is over. **If nothing passes, say so in one line and go to Step 13** — never manufacture a rule to make the step feel productive.

**Procedure: `references/lessons.md`.** Read it before writing to `.kiro/steering/review-feedback-patterns.md`, and only after the user opts in. It has what earns an entry, the preview's exact shape, the repeat-offender promotion rule, and the `[sources: ...]` trap that makes a count un-bumpable.

### Present and stop

**STOP until the user approves.** This file is injected into every future request in this repo, so it shapes behavior far beyond this MR — the highest-leverage write in the workflow and the one that least belongs on autopilot. If the user skips, drop it and don't re-raise it next run.

**Approval covers exactly the previewed lines.** A "yes" to two count bumps authorises two count bumps — not an unpreviewed edit made while the file happened to be open. **A frontmatter or `inclusion` change is a separate gate**, never folded into a count-bump preview: it decides whether these rules load at all. This step **appends and increments; it never rewrites or deletes an existing rule.**

## Step 13 — Where this skill ends

The threads are resolved, the Jira ticket has either returned to its approved review status or its unchanged/manual state is explicit, and the approved worklog is recorded or reported as skipped/failed. Say what happened in Step 12 too — even a one-line "no recurring patterns worth recording this time" closes the loop, since a summary that mentions everything except the step most likely to be silently skipped reads as incomplete. **Stop here.** Do not:

* ❌ Merge or approve the MR
* ❌ Delete the source branch
* ❌ Transition the ticket to Done / Merged / Closed
* ❌ Start on another set of review comments

Merging is the reviewer's call. The push you just made appears in the existing MR; they'll see it and re-review. Step 11 may return Jira to the approved review status, but transitioning it to Done before merge still tells the board the work is accepted when it hasn't been.

If the user explicitly asks you to do one of these, say what will happen and get
confirmation, rather than treating the request as blanket permission.

## Reference files — load these when the pointer says to

Each is loaded only when SKILL.md's prose points at it, which is why this file stays short enough to hold. Don't read them speculatively; don't skip one the prose named.

**Read them with the ordinary file-read tool, resolving `references/…` against this skill's own folder.** They are this skill's bundled reference files — the `references/` directory beside this `SKILL.md`, per the Agent Skills layout. They are **not** steering files, and **not** power steering: reaching for a power's `readSteering` with `references/investigating.md` fails with *"Steering file 'references/investigating.md' not found for power"*, which is the observed error this note exists to prevent. If a relative read doesn't resolve, glob for the filename under the skill directory rather than guessing at a power path.

**`scripts/` is different — those are run, not read.** `scripts/fetch-mr.mjs` and `scripts/git-context.mjs` exist because their two jobs are fully deterministic and have each failed when re-derived by hand: `--field` instead of `--raw-field` (GraphQL rejects the iid), and a bare `;` chain where a clean tree couldn't be told from a mangled separator. Run them with `node`; don't rewrite what they do inline.

| File | Read it when |
|---|---|
| `references/investigating.md` | Batch 1, with the fetch. Steps 1–4: the three traps up front, the profile table with batch assignments and what consumes each value, the fields that change the run, the reconciliation rules, the classification checklist |
| `references/checkout.md` | Batch 3, once the report has been answered. Step 6 in full: the dirty-tree gate, the three checkout paths, the Jira transition's turn, and the per-thread read checklist. Nothing in it precedes the go-ahead, which is why it isn't in batch 1 |
| `references/reporting.md` | Batch 1 too — Step 5's report is two turns away. Its template, the header arithmetic, the marker set, and the closing block with its Jira line |
| `references/scope-gate.md` | Step 6b, when an answered 💬/⚠️ item or a Step 6 file read changed the picture. The gate's two shapes and the "reply without a code change" option |
| `references/summary-gate.md` | Step 8, read with Step 7's first validation batch rather than in batch 1. The summary card, the five preconditions that must hold before it is rendered, and the exact Jira question with both its branches |
| `references/conflicts.md` | You're in the conflict-first lane (Step 0b), before building the plan table. The two online paths in full, and how to read `git merge-tree` without starting a merge |
| `references/fixing.md` | Step 7, before the first validation command. Build duplication, hunk-attribution output, and the self-review discovery procedure |
| `references/publishing.md` | Step 9, after the Step 8 gate closed. Commit verification, pre-push follow-through, how a reply should read, the publication ledger |
| `references/jira-identity.md` | Batch 1, with the fetch. Step 3's identity-reconciliation branch table and the status classification. No writes are described in it |
| `references/jira.md` | Step 11, before the first Jira write — not in batch 1. The five branches the re-read can land on, the exact transition resolution, the closing comment's content rules, the manual-mode wording, and how to report all three results |
| `references/glab-tooling.md` | A `glab` MCP call fails in a way you don't recognise. Repo-scoped `glab_mr_*` tools always fail; collections need `output: "ndjson"` |
| `references/lessons.md` | Step 12, and only after the user opts into lesson capture |
| `references/user-mistakes.md` | A row in "Mistakes a user can hand you" fired and its one-line verdict isn't enough to write the sentence. Why each verdict is what it is, and what to say. **Never read speculatively** — eleven of its twelve rows never fire on a healthy run |
| `references/failures.md` | A rule here looks arbitrary and you're about to reason around it, or a user asks why the workflow insists on something. The runs behind every rule, with timings and quotes. **Never needed to follow the workflow** — every rule above already says what to do and what not to do |

## Quick Reference

Four rows, not forty. **This is a fallback, not a summary** — the step prose above is authoritative, and a row here that disagreed with it would be invariant 4 in action. What survived is only what is written nowhere else: the report's shape, the stop list, and the two prohibition scans that aggregate rules spread across a dozen steps. Everything the old table restated has been deleted rather than moved, because a second paraphrase of resident prose is the drift risk, not a safety net.

| Step | Action |
| --- | --- |
| **Report (5)** | **One report covering every unresolved thread (general MR-level comments included), then wait — hard stop.** **Read `references/reporting.md` for the shape; never render this from memory.** The skeleton, if you somehow have only this row: `### MR !{iid} — {title}`, the `{needsYou} of {feedbackThreads}` lead sentence, `countLine` **verbatim**, the State/Ticket/Blockers/Flags rows, one numbered item per unresolved thread carrying its ✅/🔵/💬/⚠️ marker, then **Say go and I'll:** as a numbered list ending in "stop again before anything is committed", then one question. **No proposed diff and no `✔️ Already addressed` anywhere in it** — both are claims about code Step 5 has not read. Full detail per unresolved item: marker, `file:line`, the reviewer's words, what they're asking for. **Resolved threads are one count, stated as not re-checked — never itemised.** Header line 1 is `{needsYou} of {feedbackThreads}` and **`{needsYou}+{rolledUp}` must equal `feedbackThreads`**; line 2 carries the notes count with the `user_notes_count` tick plus the resolve split, where `{X}+{Y}` must equal `resolvableThreads`. Closes with a numbered list of what the go-ahead does — checkout, Jira move, reads, fixes — and one question. A bare "go ahead" covers ✅/🔵 and the Jira line; 💬/⚠️ stay held |
| Never (process) | Commit or push without approval, post replies without previewing, skip the report, skip the self-review pass, edit before approval, start implementing an answered Question in the same turn you plan it, guess answers to reviewer questions, reply as a general MR comment instead of inline, resolve silently, force-push without asking, merge or approve the MR, escalate to `--no-verify` when the user's chosen option fails, dispatch a sub-agent (or otherwise parallelize) to make an actual code edit in Step 7 |
| Never (unverified claims) | Report `+X/-Y` from memory instead of `--numstat`; treat `git status --short` or `Exit Code: 0` as evidence about file contents; commit a file you haven't diffed; attribute a hunk to a formatter whose output says it changed nothing; call a conflict resolved on the strength of a local merge exiting 0 instead of a post-push read of `has_conflicts`; call a status "active-equivalent" on the strength of `statusCategory`; bump a `×N` you cannot verify from `[sources:]`. When you can't account for something, ask — the user is the cheapest source of truth about their own tree |
| **Stop** | **Do not merge, approve, delete branch, or set Jira Done. The reviewer decides.** |
