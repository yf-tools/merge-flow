# Steps 9–10 in full — commit, push, reply, resolve

Read this when you reach Step 9, after the Step 8 gate has closed. SKILL.md keeps the pre-push (a)/(b)/(c) gate, the reply preview gate, the API call shapes and the stop conditions. This file has the verification detail, the recovery ledger, and how a reply should actually read.

## Verifying what the commit actually contains

The pre-commit hook runs between your `git commit` and the commit object existing, and it can rewrite staged content. **Read its output, then verify the result against the approved set** — the two are independent, and the mismatch is the interesting case:

1. **Read the hook's own output.** A staged formatter that reports _"no files changed"_ / _"everything is awesome"_ changed nothing, and you may not later attribute any unexpected hunk to it. One reporting _"reformatted 2 files"_ did, and those files need re-checking.
2. **Compare `git show --numstat HEAD` against the `+X / -Y` figures the user approved in Step 8.** Not the file list — the numbers. A file list matches whether the commit holds your three lines or thirty from elsewhere.
3. **Any divergence is a 🛑 stop, before the push.** Report the exact difference between approved and committed, say what the hook's output does and does not explain, and ask. This is the last point where the change is still local and a fix costs nothing; after the push it costs an extra commit on a branch a reviewer is already reading.

Do not treat `Exit Code: 0` as confirmation of content. The commit succeeding tells you git wrote an object, not that the object matches what was approved.

## The pre-push hook decision — presentation and follow-through

**Format the options as a real markdown list, each on its own line.** Do not put them in a blockquote and do not run them together in a paragraph — consecutive lines inside a blockquote collapse into one line when rendered, which makes a three-way choice unreadable at exactly the moment the user has to decide something.

The shape, and note it is a plain list rather than a quote for exactly the reason above:

```text
Committed. Now the push — this repo's pre-push hook runs `{command}`, which lints and builds all {n} projects ({list them}). Expect several minutes.

**How do you want to handle it?**

* **(a) Run it here** — safest, identical to CI; I'll set a 30-minute timeout
* **(b) Give me the command** — you run it in your own terminal, useful if you want the machine back
* **(c) Skip with `--no-verify`** — reasonable if CI runs the same checks
```

Then wait. **Never choose (c) yourself** — a hook exists because someone wanted it enforced. If the user picks it, that is a legitimate private execution choice: **never write or disclose it** in any remote text, MR or Jira.

**Present (a) as the default it is, and raise your timeout to fit it.** Pass an explicit `timeout` of 30 minutes on the push command rather than relying on the default. Measured on a 6-project Angular monorepo, the full hook — six lints plus six production builds — finished in about nine minutes and pushed cleanly. Do not tell the user (a) "will probably time out": it is a guess, it is usually wrong, and it pushes them toward `--no-verify` on a false premise. Give a duration estimate, note that you have set a long timeout, and let them weigh it.

**If (a) does time out, that is information, not a verdict.** Report where the hook got to, confirm the real state (`git status -sb`, `git log --oneline -1`), and re-offer (b) and (c). Never escalate on your own.

**If the option they chose then fails, don't escalate to a more permissive one.** Choosing (a) is not consent to (c) when (a) times out. Report what failed, confirm the actual state (`git status -sb` and `git log --oneline -1` — a hook killed mid-run usually means nothing was pushed), and re-offer the remaining options.

## Use terminal commands, not git MCP tools

When git hooks are present (Step 1), run `git add`, `git commit` and `git push` as
**terminal commands**. Do not use `mcp_git_git_add` / `mcp_git_git_commit` — hooks
execute either way, but through an MCP tool you get no visible output, no timeout,
and no TTY. A stalled hook (e.g. `pretty-quick` waiting on a full pipe) is
indistinguishable from a crash.

**Use whatever terminal tool your environment exposes; this rule deliberately names
none.** Two properties are what it depends on, and both are checkable before you
rely on them: the tool **streams the hook's output** as it arrives, and it **accepts
a timeout you choose** — the pre-push gate above sets 30 minutes because a measured
hook took nine. The git MCP tools offer neither: their parameters are a repo path
plus a message or a file list, with nowhere to put a duration, and they return a
result summary rather than the hook's stdout. Naming one shell's tool here would
pin the instruction to one operating system while leaving those two requirements
implicit, which is backwards.

Verified on a real repo: `git_commit` hung indefinitely while the pre-commit hook
ran the staged formatter, with no output visible. A terminal command streams hook
output live and fails on a timeout you can act on.

## Write replies like a person, not a template

**A reviewer reading six replies in a row will notice if all six open the same way.** The most common tell is starting every reply with a word or two, a dash, and the fix (`Fixed — did X`, `Renamed — did Y`, `Added — did Z`). One reply like that reads fine; six in the same thread read like a script, and a human reviewer clocks it immediately as generated text rather than someone actually addressing their comment.

Write each reply as an ordinary sentence someone would type after actually making the change — plain punctuation, no dash-led fragment, varied openings:

- "Switched to `canOpenExternally()` so a missing or malformed URL both fall through to the modal now."
- "Good catch. This was already in `biometric.service.ts`, so I reused the same constants."
- "Renamed to `onCampaignClick`, matching what you suggested in the comment."
- "This one's already handled: `a3bbad5b` fixed it before this review pass, no further change needed here."

Vary the opening across replies in the same batch — not every one needs "Fixed," and not every one needs to restate what the comment asked for before answering it. If a reply genuinely has two distinct clauses that need separating, use a comma or a period and a new sentence, not a dash. Say what changed in plain terms; skip "See latest commit" as a fixed sign-off on every single one — it's fine occasionally, redundant when it's the last line of all six.

### The rules below govern what you post, not how this file is written

They cover **every word the run writes for somebody other than the person who asked for the pass**: thread replies, the commit message body, a Jira worklog note. Those land in a permanent record a colleague reads, and a reviewer deciding whether you understood their comment is reading one short paragraph once. Headings, marker emoji and bold runs do nothing for that.

The reports back to the requesting user are a different surface. Their 👉 and ✔️ markers stay, because those are lists to scan. **The prose inside them is not exempt** — a "Proposed action" sentence follows exactly the rules below.

**The tells a reviewer notices**, beyond the repeated opening above:

- **Escalating agreement.** "Great catch!", "You're absolutely right!", "Excellent point!" A peer writes "good catch" at most, and not on every thread.
- **Em dashes.** Use a comma, a colon, or a second sentence. It is the most reliable tell in generated text, and it is what makes the `Fixed — did X` shape above so recognisable.
- **Emoji.** None in a reply. There is nothing to scan.
- **Stock vocabulary.** leverage, utilise, delve, robust, seamless, comprehensive, crucial, additionally, furthermore. Say "used", "looked at", "solid".
- **Groups of three.** "cleaner, faster, and easier to maintain" reads as padding, because the third item is usually there for rhythm rather than because it's true.
- **"Not just X, it's Y."** State Y.
- **A sign-off.** "Hope this helps!" or "Let me know if you have any other questions!" is chat furniture in a code review.
- **Bold for emphasis.** Inside a two-sentence reply it emphasises nothing.
- **Hidden actors.** "The constant was moved" leaves the reviewer working out by whom and when. "I moved the constant" is shorter and answers it.
- **Filler openings.** "It is important to note that", "In order to". Cut them and start at the verb.
- **Curly quotes.** Straight `"` only. Editors substitute them silently, so check before posting.

Before:

> **Great catch!** This is indeed a crucial issue. I've refactored the logic to leverage the existing `canOpenExternally()` helper — ensuring robust, maintainable, and consistent behaviour across all URL states. Let me know if you'd like any further changes!

After:

> Switched to `canOpenExternally()`, so a missing or malformed URL both fall through to the modal now.

Shorter, same content, and it reads like the person who made the change wrote it. Length is the tell that survives every other fix: when a reply is three sentences longer than the comment it answers, something in it is decoration.

## The preview's shape

A reply is a full sentence, so don't put it in a table cell — a cell truncates or crushes it. One block per thread:

```text
### Proposed MR thread replies

---

**1. `_banner.scss:17`**

→ "Switched to the directional radius mixin."

---

Post these replies and resolve the threads? (yes / edit #N / skip)
```

## The two calls

```text
mcp_gitlab_glab_api                                    # reply — threaded, never a general MR comment
  args:  ["projects/{project_path_encoded}/merge_requests/{iid}/discussions/{discussion_id}/notes"]
  flags: { "method": "POST", "field": ["body={the reply}"], "hostname": "{host}" }
mcp_gitlab_glab_api                                    # resolve
  args:  ["projects/{project_path_encoded}/merge_requests/{iid}/discussions/{discussion_id}"]
  flags: { "method": "PUT", "field": ["resolved=true"], "hostname": "{host}" }
```

## Reply and resolve — ordering and parallelism

**Post replies to independent threads as parallel tool calls, not one per turn.** Each `POST` targets a different `discussion_id` and none of them depend on another thread's reply landing first, so there's no correctness reason to serialize them. Keep the publication ledger updated per call regardless of whether they ran in parallel or in sequence — the ledger is what makes partial failure recoverable, not the ordering of the calls.

For **Question** or **Disagree** items, never reply with a fix confirmation. Post the user's answer or approved reasoning instead.

For **✔️ Already addressed** items, reply and resolve the same as a Fix — but say what already handled it (e.g. "This was already fixed in `a3bbad5b` before this review pass, so nothing further is needed here.") rather than describing a change you just made.

**The resolve for a given thread must wait for that thread's own reply to succeed first** — resolving before the reply lands would close a thread with no explanation attached. Across _different_ threads there's no such dependency, so once each thread's reply has landed, its resolve call can run in parallel with every other thread's resolve call.

Never leave a fixed comment unresolved, and never resolve without a reply explaining what changed. For questions and disagreements, resolve only after the user confirms.

## Recover safely from partial publication

Keep a per-discussion publication ledger containing the approved reply body, posted reply note ID (when successful), required resolution state, and confirmed resolution result. If any reply or resolution fails, stop the pass, re-fetch all affected discussions from GitLab, and reconcile the ledger against the remote notes and `resolved` state. Retry only the missing action: never repost an approved reply already present, never resolve a thread whose approved reply is absent, and never treat a locally recorded API success as sufficient when the re-fetch disagrees.

**When thread resolution is restricted by project policy:** On some GitLab repositories, project settings allow only discussion authors or project maintainers to resolve threads. If the resolve call fails with HTTP 403 while the reply note succeeded, record in the ledger that the thread was replied to and remains open due to GitLab policy permissions. Do not let policy-restricted resolution halt downstream Jira transitions or time logging; report the outcome and proceed to Step 11.

**Optional reviewer notification and draft clearing:** After push succeeds, if the user approved clearing Draft status in Step 8, update the MR to ready via `glab mr update {iid} --ready`. You may also offer to re-request review on GitLab (`POST projects/{project_path_encoded}/merge_requests/{iid}/reviewers`) from the reviewers whose feedback was addressed. Resume Step 11 only after every approved action is observed remotely; otherwise report the remaining failures and leave Jira active.
