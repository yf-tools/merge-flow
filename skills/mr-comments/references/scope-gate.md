# Step 6b — when the picture changes

Read this when a 💬 Question or ⚠️ Disagree item comes back answered, or when Step 6's file reads contradicted the report. Most runs hit one of the two, and both arrive after the go-ahead — if you are still writing Step 5's report, this is the wrong file.

SKILL.md declares the gate and its stop property. What goes inside it is here.

**The layout rules are not repeated here.** SKILL.md's "Formatting every report to the user" has them: one item per block, every field in its own paragraph with a blank line on both sides, and no tables for anything longer than a short fact. Breaking that one makes this unreadable whatever it contains.
Two things arrive here, and neither passed through Step 5's report.

**An answered 💬 Question or ⚠️ Disagree** is new scope arriving mid-run. The answer resolves the _question_; it does not approve an _implementation_. This is the most common way a well-gated run turns into an ungated one: the user supplies a decision, you see the fix clearly, and you start editing — the plan and the first `str_replace` land seconds apart, with no turn boundary in between for the user to disagree.

**Or Step 6's file reads contradicted the report.** The report was written without opening a file, so some of it will not survive contact with the code: the fix is already there, the referenced line is gone, the reviewer's premise doesn't hold, two approved items collide, or verification hit the two-read cap. **Approved work that turns out not to exist is news, not a quiet no-op** — say so rather than dropping the item, and offer a thread reply in its place.

Route either back through a gate whose weight matches the change:

- **Confined to a line or two, no new file, no new dependency, no architectural choice** → treat it as an approved Fix and continue. Say in one line what you're about to change so it appears before the edit rather than after.
- **Anything larger — a new file, a new service or module, a new injection, a change in which layer owns the logic, or a fix that touches files no reviewer commented on** → 🛑 present it and wait:

  ```text
  ### {New scope from your answer / What the code says} — thread {N}

  {Your answer: "{what they told you}" / What the report said: "{the item as approved}" · What's actually there: {what you found}}

  → **What it implies:** {the change, one or two sentences}

  → **Files:** {new files marked (new)}; {existing files touched}

  → **Design choice, if any:** {the decision and the alternative you rejected, one line each}

  Go ahead with this? (yes / adjust / just reply to the thread without a code change)
  ```

**Presenting a plan is not a gate unless you stop after it.** A plan followed immediately by an edit in the same turn is narration. The turn must end on the question.

The third option matters and is easy to forget: sometimes the right response to an answered question is a thread reply and no code at all. Offer it explicitly rather than assuming every answer implies an implementation. Once the user approves, the item is a Fix for every later step — it counts in the Step 8 summary and is eligible for Step 12 lesson capture exactly as if it had been labelled ✅ from the start.
