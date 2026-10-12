# Conflict resolution — mechanics

Read this as soon as you're in the conflict-first lane (SKILL.md Step 0b) and **before you render the plan gate** — the gate's template is in this file, not in SKILL.md. SKILL.md keeps the lane decision, the fact that the gate replaces Step 5 and is a hard stop, and the pointer here. Everything you need in order to actually fill it in is below.

## What the conflict-first lane changes, step by step

SKILL.md declares the lane choice and that the gates are identical either way. This is what actually differs inside each step.

| Step | Review lane | Conflict-first lane |
| --- | --- | --- |
| 0–3 | As written | Identical — including `triage_mr_payload`, the reconciliation, and the Jira identity check |
| 4 classify | One classification per thread | No classification: the threads aren't work items here. Open comments still tell you which side of a conflict was reviewer-requested |
| 5 report | Triage report gate | **Resolution plan gate** (template below). The conflict is the *subject*, so it does not also occupy the Blockers row |
| 6 | Checkout, the approved Jira move, then read the files the threads point at | Same (checkout, reassign if flagged, and Jira start transition if in To Do/Backlog/Review), plus **both sides** of every conflicted region. **The merge itself is not part of the checkout** — it waits for the plan gate |
| 6b | New scope from an answered Question or from what the reads turned up | Same, and it applies to anything the resolution turns out to need beyond the plan you presented |
| 7 | Fixes, one at a time | The resolution, one region at a time. Files go in `conflict_files`, never `approved_files`. **Drops out entirely if the user resolves online** |
| 8 | Summary gate | Same gate, before the **merge commit**. `mixedFiles` splits it in two |
| 9 | Commit and push | Same, plus the post-push conflict re-read |
| 10 | Preview replies, then reply and resolve | **Skipped**, unless the user also asked for the comments. Say once that you're leaving the threads alone |
| 11 | Jira review transition + worklog | Worklog only if the user wants one. A merge-resolution normally doesn't change the ticket's review state — if you think it should, ask instead of assuming |
| 12–13 | As written | As written |

**Two of `triage_mr_payload`'s blockers mean something different in this lane, and neither is suppressed — both get *reinterpreted out loud*.** The tool is right to raise them; it doesn't know why the user is here.

* **`conflicts`** is the subject of the run, not an obstacle to it. Don't put it on the Blockers row and don't ask whether to resolve first — that question is already answered. The plan gate carries the real decisions.
* **`zero-comments`** stops the review lane because a triage report with nothing in it is worthless. Here it stops nothing: an MR can have a conflict and no feedback at all. Say once that there's no review feedback, put the count in the report as usual, and carry on. Do **not** treat this as licence to skip `reconcile_discussion_counts` — the plan gate still quotes its `countLine`, and "no comments" is a claim that needs the tool behind it.

Every other blocker (wrong project, terminal state) means exactly what it means in the review lane and stops the run the same way.

## The two online paths, in full

Both are checks against data already in hand from batch 1. Either can end the run in a single call, so run them before building the plan table.

### 1. Is it actually a conflict, or is the branch just behind?

`detailed_merge_status: "conflict"` is a conflict. `"checking"`, `"unchecked"`, or a merge widget stuck on *"Checking ability to merge automatically"* with `has_conflicts: false` is **not** — that's a stale or behind branch, and there is a public API for it:

```text
glab_api  PUT projects/{project_path_encoded}/merge_requests/{iid}/rebase
```

It returns `202` and `{"rebase_in_progress": true}`; poll the MR with `include_rebase_in_progress=true` until it clears. **Its documented prerequisite is that no conflicts exist** — with a real conflict it comes back `{"rebase_in_progress": false, "merge_error": "Rebase failed. Please rebase locally"}`, which is the API telling you to take the local path. No checkout, no local merge, nothing touched in the user's tree. Requires Developer on the source project, and it fails `403` on a source branch protected from force-push.

Confusing these two is how a five-second API call becomes a twenty-minute local merge. Read `detailed_merge_status` before assuming.

### 2. Could GitLab resolve it online instead?

GitLab publishes the exact criteria for a conflict being resolvable in its own UI, and they are a good proxy for "is this simple". Every conflicting file must be:

* a non-binary text file
* under 200 KB once conflict markers are added
* UTF-8 compatible
* free of pre-existing conflict markers
* present at the same path on both branches

When all of them qualify, **offer that as an option in the plan gate rather than deciding for the user**: they can use interactive mode (pick a side per region), the inline editor (blend by hand), or — on Premium/Ultimate with Duo Agent Platform available — *Resolve conflicts → Resolve with GitLab Duo*, which resolves, commits and pushes to the source branch server-side and posts a summary comment. Either way GitLab creates a merge commit **on the source branch only**, never merging into the target, which is the same shape a local resolution produces.

**You cannot drive any of that yourself, and must not claim to have.** There is no `/api/v4/` endpoint that resolves conflicts — the web resolver posts to a Rails route under `/-/merge_requests/{iid}/conflicts/resolve`, outside the REST API, and Duo's button is GitLab's own agent, not something this workflow invokes. The Commits API (`POST .../repository/commits`) can write files to a branch with no clone, but it has no parameter for a second parent, so it cannot create the merge commit that joins the two histories: writing "resolved" content that way leaves the branch still missing the target's commits and still conflicted. If you find yourself reaching for it to avoid a checkout, that's the wrong instinct — hand the user the UI option, or do the local merge.

So the honest set of online paths is: **rebase via API** when it isn't really a conflict, and **hand it back to the UI or Duo** when it is and the files qualify. Everything else is local.

### If the user takes the online path

Steps 7–9 drop out and the verification doesn't. Nothing local happens — no checkout, no merge, no commit, no push. Wait for them to say they've done it, then re-read the MR payload exactly as Step 9's post-push check does, and report `has_conflicts` from that read. `checking`/`unchecked` is still pending, not cleared. Two things to say once and not repeat: their resolution commit is on the source branch and will show up in the MR diff, and if review comments are still open, ask whether to carry on into the review lane now that the code has moved.

## The plan gate — the template

Three decisions live in a conflict resolution, and **all three are the user's**: the merge strategy, which side wins per region, and whether anything here exceeds a mechanical pick. Present them together and stop.

```text
**MR !{iid} — conflict against `{target_branch}`**

**Strategy:** {merge `origin/{target}` into `{source}` locally / rebase `{source}` onto `origin/{target}` locally} — this repo's last {n} merges into feature branches look like {evidence from `git log --oneline --merges`}. {One line on the tradeoff: a merge is non-destructive and needs no force-push; a rebase keeps history linear but rewrites pushed commits.}
{**Or online:** all {n} conflicting file(s) meet GitLab's UI criteria, so you can resolve this yourself in the browser — interactive mode, the inline editor, or Resolve with GitLab Duo — without me touching your working tree. — include this line only when every file qualifies; omit the row entirely otherwise}

**Conflicted files:** {n} of {m} that differ on both sides — {list}

| # | Region | Their side — `{target}` | Your side — `{source}` | Proposed |
|---|---|---|---|---|
| 1 | `{file}:{line}` | {one line} | {one line} | {which, and why in ≤10 words} |

**Beyond a mechanical pick:** {each item — a rewrite, a deleted file, a moved member, a dropped refactor — one line each} — or `none`

{Open review comments bearing on any of this, one line each, or omit}

Proceed with this plan, or resolve it online yourself? Say which rows to change if any are wrong.
```

## Why the plan gate's rows are shaped the way they are

**The "Beyond a mechanical pick" row is the one that matters, and it is not optional.** If it says `none`, that is a claim under invariant 1 — you are asserting every region is a straight side-pick. On MR !508 the resolution dropped the branch's own refactor choices, relocated a private method, changed `protected`/`private` on three members and removed `standalone: true`, and every one of those would have belonged on that row. They reached the user after the commit.

**Never start the merge or rebase before this gate closes.** On MR !508 `git merge origin/develop --no-edit` went out 90 seconds after the URL, before anything was shown — and the strategy had been chosen silently from `git log --merges`. Inspecting the convention is right; deciding it alone is not. If GitLab project settings mandate fast-forward merges (`merge_method: ff`), merge commits are rejected by the remote — rebase is required. If you need to see the conflicts before you can fill in the table, use `git merge-tree` below — it reports conflicts **without** touching the working tree, which is exactly what it's for.

**A dirty tree or a branch switch is a bigger deal in this lane, not a smaller one.** Step 6's rules apply unchanged, and this plan gate's **Flags** row is where the switch gets named — before it happens, not in the closing summary 30 minutes later.

## `git merge-tree` reports every touched file, not just conflicts

When an MR has conflicts (Step 2) and you need to know *which* files actually conflict, `git merge-tree $(git merge-base HEAD origin/{TARGET}) HEAD origin/{TARGET}` is the right tool — but its output is easy to misread, and doing so costs several turns.

**This is also how you fill in the plan gate without starting the merge.** It reports conflicts against the index without touching the working tree, so the table can be built and approved before anything is modified. That ordering is the point of the gate.

**It prints a section for every file that differs on both sides**, conflicted or not, each headed `changed in both` (or `added in remote` / `removed in remote`) with `base`/`our`/`their` blob lines and then a diff. Reading that file list as a conflict list overstates the problem badly: on a real run it listed a dozen files when exactly **one** had genuine conflict markers.

**Grep for the conflict markers, and do not anchor the pattern.** Verified on git 2.53, the markers arrive *inside* the diff and so carry a leading `+`:

```text
@@ -1,3 +1,7 @@
 line1
+<<<<<<< .ourmh
 MASTER
+=======
+FEATURE
+>>>>>>> .their
 line3
```

So `^<<<<<<<` matches nothing. There is also **no `CONFLICT:` line** in this three-argument form — those come from the newer `--write-tree` mode, which in turn doesn't print these per-file sections, so don't mix patterns from the two. **Refresh remote refs first:** run `git fetch origin {TARGET}` before computing `merge-base`, or `origin/{TARGET}` evaluates an outdated ref. Because the output is long, write it to a file rather than fighting a pager or a truncated pipe:

```bash
git fetch origin {TARGET}
base=$(git merge-base HEAD origin/{TARGET})
git merge-tree "$base" HEAD origin/{TARGET} > /tmp/mt.txt 2>&1
grep -n '<<<<<<<' /tmp/mt.txt
```

The same steps in PowerShell, since no text-search primitive is common to both shells:

```powershell
git fetch origin {TARGET}
$base = git merge-base HEAD origin/{TARGET}
git merge-tree $base HEAD origin/{TARGET} 2>&1 | Out-File -FilePath "$env:TEMP\mt.txt" -Encoding utf8
Select-String -Path "$env:TEMP\mt.txt" -Pattern '<<<<<<<' | Select-Object LineNumber, Line
```

Each hit is one conflicted region; the file it belongs to is the nearest preceding `changed in both` section. Read around those line numbers, then delete the temp file.

**Observed failure.** Four consecutive attempts misread the output as a conflict list, twice re-deriving the "prints every touched file" explanation mid-run, before dumping to a temp file and paging to line 1655 to find the single real conflict. Roughly two minutes for a fact that fits in a paragraph.

---

## A conflicted MR changes the plan — say so before triaging anything

**This section is the review lane, where a conflict arrives uninvited.** If the user came here *to* fix the conflict, you're in the conflict-first lane and the plan gate replaces the question below — the conflict is the subject of the run, so it doesn't occupy the Blockers row. Everything else here still applies.

`has_conflicts: true` (usually alongside `merge_status: "cannot_be_merged"` and `detailed_merge_status: "conflict"`) means this MR cannot merge as it stands. **It is a blocker, so the Blockers row states the fact and nothing else, while its question replaces the report's closing `Go ahead?` and is asked there — once, at the end, never in the row as well** — the report still renders in full. It is not a detail to bury below the items, and it is not something to notice later when a build fails.

> ⚠️ Conflicts against `develop`, `detailed_merge_status: conflict` — it can't merge as-is. Do you want the conflict resolved first (including switching branch, reassigning MR/Jira to you if not yours, and moving Jira to In Progress if in To Do), or should I work through the review comments above and leave the conflict to you?

Then wait for that answer. Why it replaces the go-ahead rather than riding alongside it: resolving a conflict often rewrites the very code the review comments are about, so fixing first can mean work a merge then overwrites — and the order is the user's call. **If they choose "resolve first", the run switches to the conflict-first lane** — Step 0b's table tells you what changes. Either way that answer also releases batches 3 and 4, so don't ask for a go-ahead a second time.

**A conflict resolution is new scope, not part of the review pass.** Treat it like Step 6b: **anything beyond a mechanical pick between two sides — rewriting a service, deleting a file, moving something to a different layer — gets its approach presented first.**

## Attribution

**Resolution files go in `conflict_files`, never in `approved_files`.** `attribute_staged_hunks` keeps resolution files as a separate basis (`conflict-resolution`) for the same reason the formatter basis is separate: the two answer different questions. A review fix traces to a reviewer's comment; a resolution traces to two branches touching the same lines. Fold them together and a resolution hunk — which can be a real design decision — inherits a review comment's approval without anyone deciding that. The tool returns `resolutionFiles` (what actually landed, derived from the diff rather than from your input) and `mixedFiles`.

**A file in `mixedFiles` carries both, and that's the case to split.** Commit the resolution on its own, then the review fixes: `git add {resolution files}` → commit → stage the fixes → commit. Two commits also give the reviewer a readable history, where one commit mixing a merge resolution with three review fixes gives them a diff nobody can review. When the same *file* holds both, say which hunks are which in the Step 8 summary rather than presenting the file as a single approved change — that's the one case where per-file basis genuinely isn't enough, and it's why `mixedFiles` exists as its own field.

## After the push

**Confirm the conflict actually cleared — from GitLab, after the push.** A local `git merge` that exits 0 tells you the merge succeeded locally, not that the MR can merge; GitLab recomputes `has_conflicts` asynchronously against the current target branch. So after Step 9's push completes, re-fetch the MR payload and read `has_conflicts` / `detailed_merge_status` again. Three outcomes:

* **Cleared** — one line, folded into the Step 9 result. Not its own message.
* **Still conflicted** — say so plainly and stop for a decision. Do not describe the conflict as resolved in the Step 10 replies or the Step 11 worklog comment; the target branch may have moved again while you worked.
* **`checking` / `unchecked`** — GitLab hasn't finished recomputing. That is not a pass. Report it as pending and let the user choose whether to wait, the same as any `undetermined` check.

This is a second read of a payload you already fetched once, which is normally what "re-issue only the call that failed" argues against. It's justified here because the value genuinely changed underneath you: the whole point of the push was to change it.
