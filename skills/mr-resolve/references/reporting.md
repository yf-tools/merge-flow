# Step 5 report evidence

The resident router owns the complete Step 5 report template, its arithmetic, classification slots, authorization list, blocker replacement, and stop. This file is not a batch-1 dependency and does not supply runtime procedure. It preserves the evidence behind the resident rules for maintainers who need to understand why the report is shaped this way.

## Why the report is one blocking output

An earlier two-message flow sent a short brief, collected approval, and only then emitted the detailed review report. That split made the user answer before seeing the unresolved comments, asked the Jira question separately, and delayed the report by another round trip. The resident router therefore emits one complete report before any checkout, project-file read, or write, then ends the turn.

A separate run had the correct report content but continued with tool calls in the same turn. The report was effectively hidden in collapsed progress output. The resident stop is therefore an end-of-turn boundary, not a sentence announcing that the run will stop.

## Evidence for the report contents

The report carries the merge-request orientation, exact Jira status, reconciled counts, blockers, flags, every unresolved discussion item, resolved-not-rechecked accounting, the approved scope, and one closing question. These facts were all available before code reads; adding project claims would be unsupported because Step 6 has not opened the referenced files.

Resolved discussions are represented as a count rather than individual items because listing settled threads buried the actionable comment in an earlier run. The count explicitly says those threads were not re-checked against project code. General MR comments remain feedback items even when they have no file position.

The closing authorization list includes the checkout, the named Jira start transition when applicable, approved post-checkout reads and Fix/Nitpick work, and the later stop. Question and Disagree items, commits, pushes, publication, Jira finish writes, worklogs, and lesson writes remain separately gated. A blocker question replaces the default closing question instead of adding a second question.

## Historical observations retained as evidence

- One report paraphrased the count line, omitted a classification marker and added a pre-code "Suggested fix". The resident template keeps the count line verbatim and the no-code-evidence boundary structural.
- A report rendered resolved items as a long list and asked the Jira transition as a second question. The resident template keeps resolved items in the count and puts the optional transition in the single authorization list.
- A report claimed a branch was already checked out despite evidence showing a different branch. The branch wording now comes from triage facts and remains part of the resident report roles.
- A run on MR !506 found threads where the author had already replied describing a revert/fix; some were done and awaiting resolution while others were re-opened by the reviewer noting the fix was incomplete. Quoting the original note on a re-opened thread misrepresents the reviewer's current objection; the tooling now surfaces `replyStatus` (`unanswered`, `author_replied`, `reopened`) so the report highlights existing replies and quotes the reviewer's latest follow-up comment.
- When multiple threads ask the exact same design or alignment question across different files, presenting them as independent decisions creates redundant noise; grouping or cross-referencing them keeps the report actionable.

These observations are historical rationale only. They are not instructions to load this file during the normal pre-report path and do not duplicate the resident template.
