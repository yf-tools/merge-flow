# Steps 1–4 in full — profile, fetch, verify, classify

Read this in batch 1, alongside SKILL.md's four-batch plan. SKILL.md keeps what each step decides and where it stops; this file has the tables, the exact calls, and the classification checklist.

**Everything here runs before Step 5's report, and none of it touches the working tree or opens a file a comment points at.** That is the reason the report can go out two turns in. Step 6 — the checkout, the Jira write, the code reads — is everything the go-ahead released, and it lives in its own file so batch 1 doesn't carry it.

## The three traps, before anything else

These are first because they were last, and a read of this file came back truncated: roughly 2,900 bytes of its tail never reached the run, and the tail was where these lived. Each one fails silently and late.

1. **`--raw-field`, never `--field`.** `--field iid=508` coerces to a number and GraphQL answers _"Variable $iid of type String! was provided invalid value"_. The bundled script already gets this right, which is most of why it exists.
2. **GraphQL returns global IDs, and a surviving prefix 404s every reply.** `gid://gitlab/Discussion/260206ef…`, `gid://gitlab/Note/87594`. The bare remainders are **exactly** the REST ids, verified against a live MR, so replies and resolves work once the prefix is gone. Leave one in and the failure lands at the very end of the run, after the approval gate has closed. The script and `triage_graphql_mr` both strip them: **use the `discussions` they return, never the raw GraphQL nodes.**
3. **Never rebuild a discussions payload by hand to pass it somewhere.** On REST that means `discussions_text`, the response passed through unchanged. Rebuilding is how `resolvable` got dropped once, producing `resolvableThreads: 0` on an MR with eleven, with nothing raised because a missing field reads as `undefined` rather than as a mistake.

## Step 1 — Profile the project

**The bundled `mr-review-checks` server does not scan projects** — its five tools all operate on data you hand them, and none of them touches the filesystem. `locate_bundled_scripts` is the one exception to "data you hand them", and it still reads nothing: it computes paths from the server's own module location. Derive every value here yourself, directly from the repo, and depend on no other power to do it.

Keep these as plain facts, not a structured object. The **Used by** column is why each one is worth a call; nothing here is optional, and **Batch** says _when_, not _whether_.

| Value | Derive it from | Used by | Batch |
| --- | --- | --- | --- |
| Git host + project path | The pasted MR URL (Step 0). Otherwise `git remote get-url origin` | The host guard below; fallback when no URL was pasted | 1 |
| Current branch | `git branch --show-current` | Step 6's safety check; a report Flags row when a switch surprises | 1 |
| Dirty tree | `git status --porcelain` — any output means dirty | Step 6, which it gates entirely | 1 |
| Commit convention | `git log --oneline -n 40` and read the actual subject lines | Step 8's commit message shape | 1 |
| The GitLab username you're authenticated as | `glab_auth_status` reports `Logged in to {host} as {username}` | `current_user` on both halves of Step 2's check | 1 |
| Package manager | Lockfile at the root: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lockb` → bun, `package-lock.json` → npm | Step 7's lint command, with its run prefix. Blank, never guessed, for non-JS | 3 |
| Scripts | The `scripts` block of `package.json`, in full | Step 7 — monorepos often expose `lint:{project}` and no `lint` | 3 |
| Monorepo tool | `nx.json` → nx, `turbo.json` → turborepo, `lerna.json` → lerna, `pnpm-workspace.yaml` → pnpm workspaces | Step 7's fallback rung | 3 |
| Framework | Dependencies in `package.json` (`@angular/core`, `next`, `react`, `vue`, …) | Whether framework steering applies at all; a polyglot repo needs more than one | 3 |
| Git hooks | `.husky/pre-commit` and `.husky/pre-push`; else `.git/hooks/` | Step 9 — what runs, how slow, and which formatter to run ahead of it | 3 |

Non-JS ecosystems have equivalents (`Cargo.toml`, `pyproject.toml`, `go.mod`, `pom.xml`); the principle is unchanged — read the real config, don't assume.

**The Batch column is the whole point of splitting this table.** Batch 1 comes from one `git-context.mjs` call plus `glab_auth_status`, because the report and the wrong-project check need it. The batch-3 half isn't needed until Step 7 lints and Step 9 commits, so reading it before the report buys nothing and delays the only thing the user is waiting for.

**Issue each batch as parallel calls in one turn.** None of them depend on another's result, and six serial profiling turns ahead of the MR fetch is most of why one real run's first output was three minutes late.

**Omitting `current_user` degrades two checks silently**, which is why it earns its own call: the ownership check lands in `undetermined` rather than passing, and every one of your own prior replies is counted as reviewer feedback, so the count line overstates the volume on exactly the MRs where you have already replied once per thread. `reconcile_discussion_counts` now reports that in its own `undetermined`, but the fix is to pass the value. If the call isn't available, ask rather than passing nothing, and if you pass nothing anyway, say which two checks it cost.

**Host guard.** If the git host isn't a GitLab instance, stop and say so plainly:

> This repo's remote is {host}, not GitLab. This skill only covers GitLab merge requests — the review-thread API differs on other hosts. Want me to handle the review comments manually instead?

Do not improvise `gh` commands from a GitLab workflow.

Treat anything you couldn't detect as "not detected" — ask or skip the dependent step. Don't substitute a default. Self-review resource discovery (Step 7) happens later, once there's a real diff to check against — don't front-load it here.

**One more batch-1 read, and it's conditional:** if this skill's own memory file `review-feedback-patterns.md` (written by Step 12) exists in this repo, read it now. It's one small file this skill wrote itself, not project source, so it costs nothing riding an existing turn — and having it in hand lets Step 5's report say _"matches an existing rule, ×2 already"_ where that's true. If it isn't there, that's the normal case on a first run.

## Step 2 — Fetch the MR and every review comment

**This call is batch 1**, and on the default path it is one script call whose triage is already done. The REST equivalent is `mcp_gitlab_glab_api` on `projects/{project_path_encoded}/merge_requests/{iid}` with `hostname` — a single resource, so no `ndjson`, and never `mcp_gitlab_glab_mr_view` (`glab-tooling.md`).

Whichever path produced it, these are the fields that change what the run does. Read them off `mr`:

- `source_branch` — **authoritative** branch name to check out; never infer it from the title
- `state` — `opened` / `merged` / `closed` / `locked`. The last three all raise a `terminal-state` blocker
- `user_notes_count` — what the count reconciles against
- `has_conflicts`, `merge_status`, `detailed_merge_status` — whether this MR can actually merge. **Read these; don't skip past them.** They arrive in the same payload as everything else, so there is no extra call and no excuse for missing them.

**Ticket identity for Jira lifecycle synchronization** — the title's key is one piece of evidence, not the answer, and the tool hands you all of it: `facts.ticketKey`, `facts.ticketKeys` (every candidate in the title), `facts.ticketKeyCorroborated`, and `facts.commitType` for Step 9 rather than defaulting to `fix`. Corroborated means the source branch repeats the title's key, so the author typed it twice; when it is false the tool says so in `undetermined`, because `UTF-8` and `IE-11` are ticket-shaped and neither is an issue. Collect the rest now — keys in `source_branch`, Jira browse links in the description, linked issues if exposed — and treat an uncorroborated key as a candidate for Step 3 to confirm, never as the answer. Don't postpone disagreement until worklog time.

**A `no-ticket-key` flag is not permission to continue without a ticket.** It is a flag rather than a blocker only because the title is one source of several and the others haven't been read yet. **Step 3 with no key at all is a hard stop** — never invent one, never leave `{TICKET-KEY}` as a literal placeholder, and never quietly drop the ticket segment from the Step 8 commit message as a way of proceeding. Only the user's explicit statement that this MR has no Jira ticket allows the run to go on without one.

### Run the payload through `triage_mr_payload` — don't eyeball it

**Why this is a tool and not a list of things to remember.** Everything it checks is already sitting in the payload you just fetched. The failure mode isn't misjudging those fields, it's never reading one — and a prose instruction to "also check X" competes for attention with the rest of the skill. The tool reads them whether or not you remembered they exist.

- **`proceed: false`** → work through `blockers` before anything else. Each carries a message you can put straight to the user.
- **`flags`** → one line each, on the report's **Flags** row. They don't get their own message and they don't trickle out over the following turns.
- **`undetermined`** → say which check couldn't run and why. **A check that didn't run is not a check that passed** — if you didn't pass `workspace_remote`, you do not know the project matches.

**Why two of those checks are weighted differently:**

- **`wrong-project` blocks** because Step 6 is about to check out a branch, and doing that against the wrong repo silently touches code with nothing to do with this MR. Ask before the report goes out: _"This MR belongs to `{mr project}`, but this workspace's remote is `{local project}`. Wrong URL, or is this intentional (e.g. reviewing a fork)?"_
- **`not-yours` only flags**, because reviewing on someone else's behalf is normal — but it's also the shape of a simple typo (`!490` vs `!409`). One line on the report's **Flags** row, and let the user's next message correct course rather than waiting on an answer.

For the conflict blocker, see `conflicts.md`.

### Fetch ALL the review comments — fallback only

**The script already did this.** What follows applies on the `--rest` path, and each part is required: `output: "ndjson"` because a list endpoint's default output fails schema validation (`glab-tooling.md`), `per_page=100` because **the endpoint silently defaults to 20 discussions per page** and every downstream count is then wrong, and `paginate: true` to follow the `Link` headers past page one.

**A truncated response is not a failed fetch.** A heavily reviewed MR's discussion list can run past the MCP response limit and cut off mid-object. Continue from the truncation point with the tool's `offset` and stitch the remainder onto what you already have — don't re-issue the same request from zero hoping for a smaller payload, and don't reconcile on the half you got. Expect this on any MR with more than a handful of threads.

### Reconcile the count before going further

**Get these numbers from `reconcile_discussion_counts`, not by counting.** Pass the unfiltered payload. **Don't pre-filter or pre-count anything first.** Dropping `system: true` notes yourself, or comparing a hand-tallied number against `user_notes_count`, is how the reconciliation stops meaning anything: the tool derives the comparable figure the same way GitLab does, and a number you already filtered is no longer comparable to either.

**Keep five fields per note, and don't trim below them:** `system`, `id`, `author.username`, `resolvable`, `resolved` — plus `notes[]` and `id` on each thread. Trimming _to_ those is fine; dropping one is not, and **nothing errors when you do** — the count just comes back wrong. Omitting `resolvable` once produced `resolvableThreads: 0` on an MR with eleven.

**One call.** If it rejects the input, **fix the argument the error names — don't re-call with a different subset to see what sticks.** `discussions must be an array of discussion objects` means the array is missing; it does not mean `user_notes_count: 0` alone is worth an attempt.

What the tool decides for you:

- **Activity-log noise is excluded.** `"assigned to @x"` and `"requested review from @y"` are `system: true` and are not feedback.
- **The comparison is note-for-note, not thread-for-thread**, against `user_notes_count` from Step 2.
- **`reconciles: false` means stop and re-fetch** — never triage a partial set. A shortfall by a round number (exactly 20, or exactly 100) is a paging artifact rather than a missing comment. Re-issuing the _same_ request changes nothing: the call above already sets `paginate` and `per_page=100`, so if it still comes back short, the fetch itself needs a different approach (check the page count, or run `glab api` through the terminal) — and if you can't resolve it, that's the uncovered case, not something to triage around.
- **`reconciles: null`** → the check could not run because no `user_notes_count` was supplied. **That is unknown, not agreement** — don't render a `✓` you didn't earn.
- **`linkedNoteFound: false`** → the note the URL pointed at isn't in what you fetched. Something is wrong with the fetch; say so rather than triaging around it.

### Three counts, not one — keep them apart

`user_notes_count` counts **notes**. A report counts **threads**. And only some notes are reviewer feedback, because your own earlier replies are non-system notes too and inflate the note count without adding anything to triage. Collapse them into one number and the report contradicts itself: _"10 comments found (1 unresolved, 4 already resolved)"_ is a 10 that can never equal 1 + 4.

| Field | Used for |
| --- | --- |
| `expectedNotes` | the `user_notes_count` reconciliation only |
| `feedbackThreads` | the report body — one item per thread |
| `threadsTotal` | nothing you report; it's the raw payload length, activity log included |
| `reviewerNotes` | describing how much feedback there actually is |

**Report `feedbackThreads`, never `threadsTotal`.** GitLab returns activity-log entries as discussions — `"assigned to @x"`, `"requested review from @y"` — each a thread whose only note is `system: true`, counted in `threadsTotal` because it is in the payload and triaged by nobody. Five reviewer comments across five threads, each already carrying one reply from you, is `expectedNotes: 10`, `feedbackThreads: 5`, `reviewerNotes: 5`, and **5 items** in the report; add two "requested review from" entries and only `threadsTotal` moves, to 7.

Reviewers typically leave several comments in one pass. Finding exactly one is a signal to re-check, not a finding.

Per thread you need the discussion `id`, note `id`, `position.new_path` and `new_line`, body, author, resolved state, and any existing replies — someone may have already answered. **A thread with no `position` is a general MR-level comment**; triage it as a general item, not a code comment. On the GraphQL path `line_range` is always null, because GitLab's `DiffPosition` has no such field.

If the user wants only open items, filter to `resolved: false` **after** fetching everything, so the counts still reconcile.

**A zero-comment MR was already caught above** — `triage_mr_payload` raises `zero-comments` from `user_notes_count`, before any discussions fetch. So if you reach the reconciliation at all, that check passed. If it somehow didn't, stop rather than continuing into Step 4 with an empty set.

## Step 3 — Verify the Jira ticket (batch 2, before the report)

Identify and validate the ticket here. **Do not transition it here, and do not ask about transitioning it here** — the transition is item 2 of Step 5's closing list, and Step 6 applies it. Run it quietly: nothing about Step 3 reaches the user except the status row on the report.

`getJiraIssue` and `getTransitionsForJiraIssue` go out together in **batch 2**: **issue both in the same turn.** The transition list is a property of the issue, not of the status you are about to read, so waiting for the first to return before asking for the second spends a round trip on nothing.

**The one case that serializes:** batch 1's sources disagree about the key, or the title carries none. Then the Jira reads drop out of batch 2 and wait until reconciliation has settled on one `(hostname, key)` pair — a read against a guessed key is worse than a round trip, and a _write_ against one is worse again.

**Batch 2, not batch 3, and that is the change that made the report whole.** The key is readable off batch 1's `title` and `sourceBranch` the moment that call returns, so nothing forces the ticket read behind the user's reply — and its status is one of the facts they need in order to answer the report. Reading it afterwards is what used to push the board question into a separate message a turn later.

## Step 4 — Classify each comment from what it says

**No file reads in this step.** Everything here comes from the discussion payload you already have, which is what lets Step 5's report go out two turns into the run. The code gets read in Step 6, after the go-ahead.

Per thread:

1. **Record where it points.** `notes[0].position.new_path` and `new_line`; a `line_range` means it spans several lines. No `position` at all means a general MR-level comment — render it as `_(general MR comment)_`.
2. **Skip resolved threads.** They are a count on the report's header line, not items. **One exception:** a resolved thread whose last note is an unanswered question aimed at the author is still live — promote it as a 💬 Question and say in the item that GitLab already has it resolved.
3. **Classify from the comment text:**
   - **✅ Fix** — valid, actionable
   - **💬 Question** — needs an answer you don't have. Never guess; hold it.
   - **🔵 Nitpick** — style preference, low risk
   - **⚠️ Disagree** — you'd push back; record your reasoning

   **There is no ✔️ Already addressed here.** That is a claim about the current code, and you haven't read any. It becomes available in Step 6 and surfaces through Step 6b.

4. **Say what they're asking for, in one sentence, in the reviewer's terms.** Not what you'll change — you don't know that yet. "Wants a static `[id]` on the wrappers that render backend data" is a restatement; "add `[id]='banner__title'` to line 12" is a fix you haven't verified.
5. **Note where comments interact.** Two comments on one file often imply a single combined change, or one sets a convention the other must follow. Recording it here stops the report presenting them as independent decisions, and stops Step 7 rewriting the same line twice.
6. **Check each against `review-feedback-patterns.md`** if Step 1's conditional read found one. A match means a reviewer is repeating themselves across MRs, which is worth a clause in the item — _"matches an existing rule, ×2 already"_ — and worth remembering for Step 12.

**A single item on a freshly-reviewed MR is a signal, not a finding.** Reviewers leave several comments in a pass; one usually means the fetch was short. The reconciliation in Step 2 is what settles that — don't classify your way past a `reconciles: false`.

## The payload does not pass through you

**So on the default path there is no bundled-tool call here at all.** `scripts/fetch-mr.mjs` returns the same `triage` and `counts` `triage_graphql_mr` would, computed by the same modules in the process that already held the response. Read `counts.countLine`, `counts.feedbackThreads`, `triage.blockers` and `triage.facts.ticketKey` straight off it. Handing the payload to a tool instead means writing it back out as arguments token by token, which costs more than the fetch and, on a real run, failed outright: the argument arrived as a string, the run diagnosed a size problem, and it started trimming note fields — the exact road by which `resolvable` was dropped once and reported `resolvableThreads: 0` on an MR with eleven.

**Two prohibitions follow, and they apply on every path:**

- **Never hand-tally the threads.** Not as a cross-check against the tool, not before calling it, not after. Counting `system` / `resolvable` / `resolved` / author across twenty threads by reading them is the specific work these tools exist to replace. A tally that agrees adds nothing; one that disagrees has no defined winner. The tool's output _is_ the evidence invariant 1 asks for.
- **Never trim a payload to make a call fit.** A failure on a large argument is about the argument, not its contents, and "the size or structure may have caused it" is an unconfirmed cause. Use `--raw` deliberately if you need the untriaged payload; don't improvise a smaller one.

`--raw` is selected automatically, with a note on stderr, when `server/` isn't reachable — the case where this skill folder is used outside the power. Only then do the calls below apply.

## The `--raw` and REST fallbacks

Both are exceptional paths. On the default path the script has already done this work and there is no bundled-tool call here at all.

**`--raw` gives you the untriaged GraphQL response.** Hand it to `triage_graphql_mr` verbatim, exactly as received — no trimming, no re-keying, no rebuilding the notes. It goes across intact or not at all. That tool's own description lists its four inputs; don't retype the shape from memory.

**On REST, use `discussions_text`** on `reconcile_discussion_counts`: the raw ndjson response passed through unchanged. **Don't rebuild the payload as objects to pass it in.** That's how `resolvable` got dropped on a real run: the tool reported `resolvableThreads: 0` for an MR with eleven, and nothing errored, because a missing field reads as `undefined` rather than as a mistake. Passing the text through removes the opportunity, because you can't drop a field you never touched.

**Never hand-write the `glab api graphql` invocation.** The query lives in `MR_QUERY` in `server/graphql.js`, beside the normalizer that consumes it, and the script is the only sanctioned way to send it.
