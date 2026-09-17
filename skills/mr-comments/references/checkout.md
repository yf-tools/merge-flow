# Step 6 in full — check out, move the ticket, then read the code

Read this when Step 5's report has been answered, not before. Everything here is released by that go-ahead and nothing here precedes it, which is why it lives apart from Steps 1–4: batch 1 has no use for it, and `investigating.md` grew past the size a single read reliably returns while carrying it.

## Check out the right branch

**This checkout is batch 3 — after the report and the reply to it, not before.** Nothing before Step 5 needs local state, and Step 2 decides whether this step should run at all: a zero-comment MR stops the workflow, and stopping _after_ switching the user's branch means you changed their working tree for a run that ended immediately. So the order is fetch, reconcile, verify, report, wait, _then_ check out. The report's closing list already named the switch, so the go-ahead covers it.

**Check the dirty-tree status from Step 1 first — it gates every path below.** If dirty, stop and offer only: stay on the current branch, or create a named stash with the exact recovery command (`git stash pop`). Do not propose committing unrelated changes onto this MR branch, and never offer discard as a convenience path; if the user explicitly requests deletion, show per-file diffs and reconfirm first.

**A clean tree isn't automatically safe to switch away from.** Before checking out, if the current branch differs from `source_branch`, glance at `git log --oneline -5` on the branch you're about to leave. A clean tree with no commits ahead of its own upstream is the common, silent case — just switch. A clean tree that's ahead of its upstream, or whose recent commits reference a different ticket key with no relation to this MR's `source_branch`, means the user has real work sitting on that branch that a silent switch would bury from view (it's not lost, just no longer what's in front of them). That one belongs on the report's **Flags** row _before_ the switch happens, and named again in one line as you switch: _"Switching from `{old-branch}` (ahead of its upstream, ticket `{OLD-KEY}`) to `{source_branch}` for this MR."_

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

**The Jira transition rides in this same turn**, when Step 5's line was approved. The call, the read-back, and what to do when either fails are in the Step 7 procedure file, under the Jira transition heading.

## The Jira transition (Step 6, with the checkout)

This is the moment the board's claim becomes true — work is starting now, so the status changes now. It happens in **Step 6, batched with the checkout and before any code is read**, and only if the user approved item 2 of Step 5's closing list.

1. Call `transitionJiraIssue` with the exact transition recorded in Step 3.
2. Confirm the resulting `status.name` is exactly the approved target. A successful API response is not evidence on its own — but **when the transition response itself names the resulting status, that _is_ the read-back**; re-read only when it doesn't.
3. **If the transition or the verification fails, stop.** Report the exact error, and wait for the user to either apply it manually and confirm the resulting status, or tell you to proceed without it. Do not start editing on the assumption it worked, and do not retry through a different transition. There is no fail-open synchronization waiver.
4. If the user declined, or chose "leave it", record that and move on. Say nothing further about it — they already decided.

Then say nothing more about Jira until Step 8. One line confirming the move is acceptable if it happened; a paragraph is not.

## Then read what each thread points at

**This is batch 4.** Every read in one turn of parallel calls; only serialize when two threads name the same file, and then read it once and reuse it. Do it yourself with plain tool calls — **don't dispatch sub-agents:** a batch of parallel `read_code`/`grep_search` calls already gets you the speed, and a sub-agent adds coordination without doing the work faster. **No edits in this step.**

**Speed comes from running the same checks concurrently, not from running fewer of them.** Every item below still applies to every approved thread.

1. Read the referenced file at the referenced line. Use `grep_search` / `read_code` if the code moved since the comment was posted. **If the file no longer exists at that path, or the line is out of range**, don't silently skip it or guess a new location — that's a Step 6b finding: _"file/line no longer exists — needs a fresh look"_, for the user to decide on.
2. **Check whether the fix is already there** — a later commit may have handled it. That makes it **✔️ Already addressed**: no edit, a Step 6b line saying so, and a Step 10 reply naming what already handles it. **Never silently drop an approved item because you found it done** — the user approved work, and its absence is news.
3. **If the reviewer names an API, mixin, or helper, confirm it exists before judging the comment.** Search the dependency tree, not just project source — a project-wide `grep_search` returning nothing usually means the symbol lives in `node_modules` (or the language's vendor directory), not that the reviewer is wrong. Read the real definition so your fix uses the real signature. Only push back after confirming it genuinely doesn't exist.

   **Cap this at a couple of reads.** The package's `types`/`typings` entry from its own `package.json`, then one search inside that file. Establishing _how a library wires itself internally_ is not what this needs. If two reads don't settle it, take the item to Step 6b as unverified, say what you checked, and let the user weigh in. Do not re-ask the same question through a third and fourth tool — that escalation is the failure, not the fix.

4. **Work out the concrete fix** — file, change, one sentence — without applying it yet.
5. **Check that fix against whatever project conventions apply to the file you actually edited.** Judge relevance from what each rule set says it covers, not from its filename — a steering file describing itself as "Angular component conventions" applies to a `.ts` component and not to a change in the Python service. In a polyglot repo more than one set may apply, and the wrong one applying is worse than none.
6. **Decide whether the item still matches what the report promised.** If it now needs a new file, a new dependency, an architectural choice, or files no reviewer commented on, it goes to Step 6b before any edit.
