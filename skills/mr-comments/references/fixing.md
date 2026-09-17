# Step 7 in full — validation, staging, hunk attribution, self-review

Read this when you reach Step 7, before the first validation command. SKILL.md keeps the edit-one-at-a-time rule, the attribution tool call, the stop conditions and the question templates. This file has the reasoning, the observed failures, and the discovery procedure.

## Definitive validation and staging

The final approval must cover the exact bytes that will be committed.

1. Run and record the narrowest relevant **diagnostics/type check, targeted tests, lint, and smoke test**. Run a build when required by the change; otherwise record `deferred to CI`. A skipped check must include the reason. **These are independent commands against the same already-written tree — run them as parallel background processes rather than waiting for each to finish before starting the next.** Diagnostics, tests, and lint don't write files, so nothing about running them concurrently changes what they report. A smoke test that needs a running dev server is the one exception worth a moment's thought — start the server once, then let it serve the others rather than spinning up a second instance.
2. Stage only the approved MR-review files by name — never `git add .`.
3. Run the pre-commit staged formatter discovered in Step 1, then re-stage anything it changed.
4. If formatting changed behavior-relevant bytes, rerun every affected validation check.
5. Use `git diff --cached` as the definitive input to the self-review and Step 8 summary. Also show `git status --short` so excluded work is visible.

Any later mutation — including a project checklist fix — loops back through this entire phase: validate affected behavior, stage by name, format, re-stage, inspect `git diff --cached`, then re-present Step 8 and wait again. An earlier approval never authorizes changed bytes.

### Don't duplicate the build the pre-push hook is about to run

**Weigh a full build against what Step 1 already told you about the pre-push hook.** If the pre-push hook contents you read there run `nx build`/`ng build` (or an equivalent full build) for the exact project(s) you touched, that build is going to happen again in Step 9 regardless of what you do here — Step 9 can't skip it, only defer _when_ it runs. Running the same full production build here too, on top of the one Step 9 is about to run, buys you nothing the second run doesn't already tell you, and it's the difference between one multi-minute build and two on a change that hasn't grown since the first. Prefer the type-check/diagnostics you already ran over a duplicate full build in that case, and say so plainly in the evidence block: `Build: covered by the pre-push hook (runs {command}) — not duplicated here`. Still run your own build here when either is true: no pre-push hook exists, the hook doesn't cover the project(s) you changed, or this is the _first_ validation pass for a set of edits that haven't been build-checked at all yet — the point is skipping a redundant _second_ full build of the same untouched-since code, not skipping validation.

**A development build is still a build.** Observed on MR !500: the run correctly noted that the pre-push hook builds all six projects, said it was _"skipping full production build here"_, and then started two builds anyway — one library build and one `--c=development` app build — and spent roughly two minutes polling them before the summary. Swapping the configuration flag doesn't change the arithmetic; if the hook is about to build the project you touched, the build you start here is the duplicate whatever flags it carries. The type-check/diagnostics and the targeted lint are the substitute, and the evidence line says so.

**Run project scripts exactly as the `scripts` block defines them.** You read that block in Step 1 precisely so you don't have to guess what a script already passes. Appending a flag it already carries is a failed command and a wasted round trip: on MR !500, `pnpm run lint:components-ui --max-warnings=0` became `nx lint components-ui --max-warnings=0 "--max-warnings=0"` and died on `Property 'maxWarnings' does not match the schema`, for both projects, before being re-run bare.

## Why attribution exists: `git add {file}` stages the file, not your edits

This is the phase's whole reason for existing, and it is counter-intuitive enough to state outright: **`git add path/to/file.ts` stages every uncommitted change in that file — including changes you did not make.** Between your first edit and your `git add` there may be many minutes of wall-clock time, and in that window the file can acquire content from at least three sources other than you:

- **The user, editing in the same editor.** They are watching you work. Fixing something adjacent, or continuing unrelated work in the same file, is entirely normal and they have no reason to mention it.
- **Editor-side actions on save** — organize-imports, an ESLint autofix, a format-on-save rule. These fire when your write tool touches the file, so they are indistinguishable from your own edit unless you look.
- **A branch operation or another tool** that rewrote the file after you read it.

`git status --short` cannot tell you about any of this. It prints `M file.ts` whether the file holds one line of your change or forty lines from three sources. Running `git status` and then committing is not verification — it confirms _which files_ changed and tells you nothing about _what_ changed in them.

## Reading `attribute_staged_hunks`' output

It returns `unexplainedFiles`, `needsJudgement` (every hunk in a file that does have a basis, one entry each), `files` (per-file counts), `totals`, `numstat`, `resolutionFiles` and `mixedFiles`, plus binary and renamed files.

**Use the right one of the two count shapes.** `numstat` and `totals` are **repo-wide** — one figure for the whole staged set. The Step 8 template needs a figure **per file** (`` `{file}` ({+X / -Y}) ``), and those come from `files[].added` / `files[].removed`. Using `numstat` on each row prints the same total on every line, which reads as a set of per-file counts and is wrong on all but the single-file case.

**Only list a file in `formatter_files` if the formatter said it changed that file.** A formatter you assume ran is not evidence, and feeding it a guess launders the guess into the tool's output.

**A merge-conflict resolution goes in `conflict_files`, not `approved_files`.** Otherwise resolution hunks — which can be a real design decision, see "A conflicted MR changes the plan" in Step 2 — pass the attribution check under a review comment's approval. Anything in the returned `mixedFiles` carries both a resolution and a fix in the _same file_: split the commits, and name which hunks are which in the Step 8 summary.

**When the diff is too large to pass whole, pass a condensed one — and then stop trusting its counts.** A big refactor can exceed what fits in `diff_text`; handing the tool a trimmed diff so it can still enumerate hunks is fine, and better than skipping attribution. But its `+X / -Y` figures are then computed from a diff that isn't the real one, so take every number from `git diff --cached --numstat` instead and check that the hunk list matches the `@@` headers git actually printed. Say in the summary that you did this. Observed on MR !508 (eight hunks across a modernization pass) — handled exactly this way, which is why it's written down rather than left to be re-derived.

**What the tool settles, and what it can't.** `unexplainedFiles` is unambiguous — a staged file with no approved change, no formatter report and no conflict resolution must be raised. `needsJudgement` is the honest part: the tool cannot tell whose lines are whose _inside a file you legitimately edited_, which is the main failure case. It lists each hunk separately so that "the diff looks right" stops being an available answer, but the verdict is still yours, and often the user's. Do not read an empty `unexplainedFiles` as "attribution done."

Then work through what it gave you:

1. **Read the actual diff, not just the tool's summary.** The tool counts lines; it doesn't know what the lines mean. Never substitute `git status`, `--stat`, or your memory of the `str_replace` calls you made — your recollection of your own edits is not evidence about the file's current contents.
2. **Give every `needsJudgement` hunk a verdict**, tracing it to a specific approved review comment or to the formatter you just ran. This is the part the tool explicitly cannot do for you.
3. **Any hunk you cannot attribute is a 🛑 stop.** Do not rationalise it, and in particular do not attribute it to the formatter unless the formatter's own output says it changed that file — which is also why you must not pass a guessed path in `formatter_files`. A formatter that printed _"no files changed"_ did not silently edit anything: if unexplained hunks exist after that output, the formatter is ruled out, not the explanation.
4. **Never guess at the origin of a change you didn't make.** "The prettier config must strip this" and "some plugin probably did it" are inventions. The user is the cheapest and most reliable source of truth about their own working tree, and asking costs one turn while committing their unrelated work into your MR costs them a dirty diff a reviewer will ask about.
5. **Unstage rather than include.** If the user confirms an unrelated hunk, `git restore --staged {file}` is wrong — it would drop your change too. Offer instead to keep their work in the tree and commit only your files, or to let them commit theirs separately first. Never resolve this by discarding anything.

### Report line counts from the diff, never from memory

Every `+X / -Y` in the Step 8 summary comes from `git diff --cached --numstat`. Numbers you inferred from your own edits will be wrong the moment anything else touched the file — and being wrong here is uniquely damaging, because the user reads those counts as a description of what they are approving. A summary claiming `+2/-1` on a file that will commit `+6/-3` is not an approximation; it is a gate that asked about different bytes than the ones that shipped.

## The self-review pass

Before Step 8, re-read the definitive staged diff (`git diff --cached`) — not from memory of what you changed — and check it against whatever review conventions this project actually has.

**This pass is not optional and it is not deferrable to after the push.** It is the only step that reads the real diff with fresh eyes, so it is the only step positioned to catch a hunk you didn't write — which makes it the step whose absence is least visible and most expensive. A run that skips it and pushes cleanly looks identical to a run that did it properly, right up until a reviewer asks why an unrelated file moved. If the user has to ask _"can you run the self-review?"_ after the commit is already on the remote, this step failed, however good the eventual report is.

### 1. Discover review resources by what they say they do, not by their filename

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

### 2. Offer what you found — don't silently apply it

If discovery turns up something relevant, **say what you found and offer to run it**, rather than either ignoring it or quietly applying it. The user knows their own conventions and may have a reason to skip.

**That offer is a line inside the Step 8 card, not a message of its own.** The wording below is what goes in the card's Self-review bullet — don't send it now as a standalone question, because doing so is the first of the two observed failures listed below:

> Found `.kiro/steering/code-review-self.md` — its description says it's a self-review checklist to run before pushing. Run it against these changes before committing?

Once the user's reply to that card actually says yes, apply only the items relevant to the files you actually touched — a 40-item checklist against a 3-line diff should produce 2–3 relevant checks, not 40 lines of "N/A." If they decline, note that and move on.

**Fold this offer into the Step 8 summary rather than raising it as its own separate pause.** Step 8 is already a hard stop asking "ready to commit and push?" — asking "and should I run this checklist first?" in the same breath is one decision point instead of two and avoids adding another gate. The offer belongs **as the Self-review bullet inside the Step 8 card itself** — not as a free-standing question asked on its own before the card exists, and not something you answer yourself. See "Compliance claims require evidence, not description" in SKILL.md for the general rule this offer must follow.

Two observed failures of this, both real and both worth naming so they're recognizable:

- **Asked the question, then answered it themselves.** The agent asked _"want me to run it against this diff?"_ as its own message, then immediately answered with _"I did a quick pass myself"_ — the item-3 generic checks below, not the named resource — followed by _"otherwise I'll proceed to the summary,"_ and rendered the complete `Summary — ready to commit` card in that same turn. The named checklist never ran; the question was treated as settled without the user ever answering it.
- **Skipped the question and reported a result outright.** After naming `code-review-self.md` and summarizing what its _description_ covers (Angular/SCSS conventions), the same message went straight to _"I checked it against those standards: no BEM violations, no hardcoded colors, no `::ng-deep`, no `!important`... No new issues found"_ — never posing the question, never opening the checklist's actual content. Asked directly _"did u run it?"_, the honest answer was no: what ran was the item-3 generic pass, reported in vocabulary borrowed from the checklist's description and presented as if the named file had been read.

The fix in both cases is the same: the offer appears **as an unresolved line inside the Step 8 card**, phrased as an open question, with the card's own single closing question ("Ready to commit and push?") left to cover it. The item-3 generic pass is a baseline you always run regardless of what discovery finds — it is never a substitute for running a _named, discovered_ resource, and running it does not let you mark that resource's offer as closed.

### 3. Always run the generic pass regardless

Whether or not a project-specific resource was found or run, do this much yourself — it's cheap and catches the mistakes that no checklist bothers to write down:

- Compare the diff against what you _think_ you changed — catch accidental leftover `console.log`, `debugger`, commented-out code, or unrelated file changes that got staged.
- Confirm every change traces to a stated reviewer comment (no scope creep).
- Scan the diff for accidentally-added secrets (API keys, tokens, passwords in string literals).

Anything this catches must be fixed, then sent back through definitive validation, staging, formatting and the Step 8 approval gate. Do not silently change an already-reviewed staged set.

### 4. Report what happened, in the Step 8 summary

Never let this pass stay invisible. In the Step 8 summary, state:

- What you found, named, and what its description said it was for — plus whether it was run, offered, or declined.
- If discovery turned up nothing relevant, say where you looked and ask once whether there's a review step you should know about for next time.
- Anything the pass actually caught and fixed.

---

## Then the fixes (Step 7)

**This is the one place in the workflow not to parallelize or delegate, even though Step 6's reads just were.** Investigation is read-only and forgiving of speed; writing isn't. A sub-agent editing a file at the same time you edit a different one is indistinguishable, from `git diff --cached`'s point of view, from the user editing that file while you work — and the entire hunk-attribution mechanism exists to catch exactly that shape of problem. Parallel edits from your own dispatched agents would trip your own trap. Apply fixes one at a time, in this process, even when several are independent enough that they _could_ run concurrently.

For each approved item:

1. Read the exact code before changing it.
2. Apply the fix with `str_replace` (`fs_write` for larger rewrites).
3. Follow existing project conventions, including any framework steering identified in Step 6.
4. Lint using what you found in Step 1 — never a hardcoded package manager, and never assume a bare `lint` script exists. Resolve the command in this order:
   1. **Project-scoped script** — monorepos usually expose one script per project (`lint:mobile`, `lint:components-ui`, …) and no generic `lint` at all. Find the entry in `package.json`'s `scripts` matching the library or app you edited:

      ```text
      {run prefix} lint:{project}
      ```

   2. **Monorepo runner** — if no matching script exists and the monorepo tool is `nx`, invoke the target directly:

      ```text
      {package manager} nx lint {project}
      ```

   3. **Ecosystem default** — a generic `lint` script (JS) or the equivalent for the ecosystem you detected (`ruff`/`flake8` for Python, `cargo clippy` for Rust, a Makefile `lint` target, …). Mention where the command came from when reporting, so the user can see whether it's project convention or a generic fallback.
   4. **Nothing matches** — say so and skip. Don't invent a command.

   Prefer the narrowest scope that covers your change. Rung 1 beats rung 3 for exactly this reason: a repo-wide `check` script that lints and builds every app can take minutes, while linting the one affected project takes seconds. Only drop to a broader command when nothing project-scoped exists.

5. Confirm in one line what changed and which comment it addresses, then move on.

Keep fixes traceable per comment — don't merge unrelated changes to the same file into one edit.
