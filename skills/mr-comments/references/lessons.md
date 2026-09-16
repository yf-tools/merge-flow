# Step 12 in full — capturing recurring lessons

Loaded from `SKILL.md` Step 12, and only when the user opts into lesson capture. If they said "done", declined, or didn't engage, none of this applies — go to Step 13.

The gate itself, and the fact that this step is optional, live in SKILL.md. Everything below is the procedure once it's been accepted.

## What earns an entry

Not every comment does. Most don't. Apply this test to each **✅ Fix** and **🔵 Nitpick** from Step 4, **plus any 💬 Question or ⚠️ Disagree item that turned into an actual code change once the user answered it** — the Step 4 label was your first guess, made from the comment text alone and before the user weighed in, so a question that resolved into "yes, change it" is exactly as eligible as something you labeled Fix from the start. Record it only if **all three** hold:

1. It's a **convention or pattern**, not a one-off. ("Use the directional radius mixin" qualifies; "typo in a variable name" doesn't.)
2. It can be phrased as an **instruction followable before writing code**, not a description of what went wrong.
3. It would **apply again** in a different file in this repo.

Skip, without asking:

- Typos, one-off logic bugs, business-requirement corrections
- **Anything lint or the formatter already catches.** The tool already enforces it; a steering rule adds weight for no behavior change. Steering is for what tooling _can't_ catch.
- Anything you can only phrase vaguely. "Be careful with naming" is not a rule. If you can't make it specific, it isn't one.

**If nothing passes, say so in one line and go to Step 13.** Do not manufacture a rule to make the step feel productive — a file of weak rules is worse than a short file of sharp ones.

## The file

Target `.kiro/steering/review-feedback-patterns.md`.

**The file must explain its own notation.** The session that reads it is working on a
new feature and has never seen this skill — `×3` with no legend gets ignored or
misread as a priority label. A count with no attached instruction changes nothing.
When creating the file, open it with this header verbatim:

```markdown
# Review Feedback Patterns

Rules recovered from real merge-request review comments on this repo.
`×N` is how many times review has flagged the same thing.

- **×1** — Established convention. Follow it.
- **×2–×3** — Recurring. Follow it, then verify the change against it before presenting work.
- **×4 and above** — Persistent failure. State explicitly that you checked this rule.
  A rule violated this often _while already in context_ is usually worded too vaguely
  to act on — say so and propose a sharper wording rather than just complying harder.

Counts are maintained by the `mr-comments` skill. Don't edit them by hand.

## Repeat offenders

- Prefer `inject()` over constructor injection in new services. ×3

## SCSS

- Use the directional radius mixin, never `border-radius` shorthand — RTL breaks otherwise. ×1
```

Use `×` (U+00D7), not `*` — an asterisk is markdown emphasis and will italicise the
line or vanish.

## Keep it out of the MR

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

## Handling a repeat

Before adding anything, search the file for a rule already covering it.

- **Found** → increment the count and append the new MR/note reference to the rule's `[sources: ...]` list if it is not already present. Never replace or drop earlier sources, and never add a second bullet for the same rule.
- **Already listed in `[sources: ...]`** → this MR/note is already counted. Leave the count alone and say so. Re-encountering a comment you have already recorded is the normal case when an MR gets a second review pass.
- **Count reaches 3** → move it under `## Repeat offenders` at the top of the file.

### A rule with no `[sources: ...]` cannot be bumped

The whole dedup mechanism is the sources list. A rule reading `… ×2` with no sources is a count you cannot verify and therefore **must not increment** — you have no way to tell whether the MR in front of you is already one of those two. Getting this wrong is not hypothetical: a rule about duplicated view logic, at ×2, on an MR whose duplication comments were triaged in an earlier session of the _same_ MR, will bump to ×3 and promote itself to Repeat offenders on the strength of counting one MR twice. The promotion then looks like evidence.

When the matching rule has no sources, do not bump silently. Say what you found and offer the two honest options:

```text
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

## Present and stop

```text
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

### Frontmatter and inclusion mode get their own gate

Changing the file's `inclusion` mode is not a rule edit — it changes **whether these rules load at all**, which outranks every individual rule in it. It also cuts against the file's purpose: the rules exist to be present _while new code is being written_, and `inclusion: auto` means they only load when a request already looks review-shaped, which is the case where you'd have caught the problem anyway.

So: never fold a frontmatter change into a count-bump preview. If you think the mode is wrong, finish the approved bumps, then raise it separately as its own question with the tradeoff stated in one line each way:

> Separate from the bumps: this file's frontmatter has `description:` but no `inclusion:`, so it defaults to always-included — loaded on every request in this repo. Options: leave it always-on (rules present while writing new code, costs context every turn), or `inclusion: auto` (loads only for review-shaped requests, cheaper but absent exactly when a rule would prevent the mistake). Want to change it, or leave as is?

Note that omitting `inclusion:` **is** always-included; the absence of the key is not a bug to fix. Present the current behavior accurately rather than as an oversight, and let the user decide. If they don't engage, leave it alone.

## Keep it small

- One line per rule, imperative mood.
- **Never rewrite or delete an existing rule here.** If one looks wrong or contradicts a new finding, say so and let the user decide. This step appends and increments; nothing else.
- Past roughly 40 rules the file stops being read and starts being skimmed. At that point propose splitting it by domain into separate files with `inclusion: fileMatch`, so SCSS rules load for SCSS work instead of on every request.
