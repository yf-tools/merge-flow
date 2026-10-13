---
name: mr-reflect
description: Filters signal-vs-noise for post-merge continuous learning. Autonomously analyzes reviewer feedback and resolved discussions on completed or merged GitLab MRs, applying a strict signal-vs-noise filter to convert recurring code review mistakes into durable, preventative project guidelines without noise or rule bloat. Use when reflecting on completed merge requests, analyzing reviewer feedback patterns, or learning from past MR discussions.
license: MIT
compatibility: GitLab only - GitHub and Bitbucket pull requests are out of scope. Needs network access, git, an authenticated glab or GitLab MCP server, Node.js for bundled scripts, and access to workspace rule directories.
metadata:
  version: "1.0.0"
  author: Youssef Fathalla
---

# mr-reflect — Post-MR Continuous Learning Engine

The post-merge reflection engine for **MergeFlow**. Once a GitLab merge request is merged or closed, `mr-reflect` analyzes all reviewer discussions, filters out subjective noise, and synthesizes high-signal engineering lessons into project rules to prevent recurring mistakes.

## Invariants

1. **Signal over noise:** Never turn a subjective preference, one-off temporary hack, or conversational nitpick into a permanent rule.
2. **Human gate on rule creation:** Rules are proposed in a clear diff/report and only persisted upon explicit user confirmation.
3. **No rule bloat:** Merge related lessons into existing guidelines rather than creating redundant rules.
4. **Actionable phrasing:** Every rule must specify what to do, what to avoid, and the rationale or detection heuristic.

## Workflow

```text
Merged/Closed MR
       │
       ▼
[Step 1] Fetch discussions and final diff
       │
       ▼
[Step 2] Classify feedback through Signal-vs-Noise Filter
       │
       ├── Discard noise (subjective styles, one-off hacks, nitpicks)
       └── Retain signal (architecture, edge cases, tests, project idioms)
       │
       ▼
[Step 3] Synthesize preventative rules with rationale
       │
       ▼
[Step 4] Present Reflection Report to Developer (BLOCKING GATE)
       │
       ▼ (On user approval)
[Step 5] Persist approved rules into workspace rules / guidelines
```

### Step 1 — Ingest MR Review Threads

1. Fetch the discussions and comments for the target MR using GitLab tools (`glab` or GitLab MCP).
2. Gather the resolved threads, reviewer suggestions, and the final commits that resolved them.
3. Extract each reviewer comment that prompted a code change.

### Step 2 — Signal vs. Noise Evaluation Filter

Evaluate every reviewer feedback item against the qualification criteria:

| Category                     | Qualification Criteria                                                            | Disposition            |
| :--------------------------- | :-------------------------------------------------------------------------------- | :--------------------- |
| **Architectural Violations** | Layering breaches, improper dependency directions, leaking domain abstractions    | **High Signal (Keep)** |
| **Unhandled Edge Cases**     | Off-by-one errors, nullability/undefined traps, concurrency/race conditions       | **High Signal (Keep)** |
| **Missing Test Types**       | Omitting regression tests, failure mode assertions, integration coverage          | **High Signal (Keep)** |
| **Project & Stack Idioms**   | Repository conventions (e.g. `inject()` vs constructor, specific logger patterns) | **High Signal (Keep)** |
| **Subjective Styling**       | Indentation or formatting debates already handled or ignored by the linter        | **Noise (Discard)**    |
| **One-off Workarounds**      | Temporary hotfixes, deprecated library quirks scheduled for deletion              | **Noise (Discard)**    |
| **Conversational Banter**    | Non-actionable comments, emoji reactions, ambiguous nitpicks                      | **Noise (Discard)**    |

### Step 3 — Recurrence Tracking & Rule Formulation

#### IDE Target Detection Hierarchy

Before logging or promoting rules, detect which assistant/IDE guidelines convention is active in the workspace:

| Environment             | Detected Indicator                     | Feedback Ledger Path                 | Promoted Active Rules Path                  |
| :---------------------- | :------------------------------------- | :----------------------------------- | :------------------------------------------ |
| **Kiro**                | `.kiro/steering/` directory exists     | `.kiro/steering/feedback-review.md`  | `.kiro/steering/{topic}.md`                 |
| **Antigravity**         | `.agents/rules/` directory exists      | `.agents/rules/feedback-review.md`   | `.agents/rules/{topic}.md`                  |
| **Cursor**              | `.cursor/rules/` directory exists      | `.cursor/rules/feedback-review.md`   | `.cursor/rules/{topic}.mdc` (or `.md`)      |
| **Claude Code**         | `.claude/rules/` or `CLAUDE.md` exists | `.claude/rules/feedback-review.md`   | `.claude/rules/{topic}.md` (or `CLAUDE.md`) |
| **Windsurf**            | `.windsurf/rules/` or `.windsurfrules` | `.windsurf/rules/feedback-review.md` | `.windsurf/rules/{topic}.md`                |
| **Universal / Default** | None of the above                      | `.agents/rules/feedback-review.md`   | `AGENTS.md` (in workspace root)             |

For each high-signal item:

1. **Check the Feedback Ledger (`feedback-review.md`):**
   - Check the resolved ledger path from the table above.
   - If an existing entry matches this pattern, increment its recurrence counter: `[x1] -> [x2] -> [x3]`.
   - If it is new, register it with count `[x1]` along with the MR reference, anti-pattern snippet, and correct pattern.

2. **Evaluate Promotion Threshold:**
   - **New patterns (`[x1]`):** Kept in the ledger for historical tracking without bloating active rules immediately.
   - **Recurring patterns (`[x2]+`):** High priority candidates to be promoted directly into the team's active ruleset (e.g. `.kiro/steering/*.md`, `.agents/rules/*.md`, `.cursor/rules/*.mdc`, `.claude/rules/*.md`, or `AGENTS.md`) to permanently prevent future recurrence across the team and AI assistants.

3. **Formulate Succinct Guideline:**
   - **Pattern:** Clear, positive directive.
   - **Anti-Pattern:** Concrete snippet or description of the mistake.
   - **Context:** Why this matters in this repository.

### Step 4 — Reflection Report (BLOCKING GATE)

Present the structured report to the user and stop:

```markdown
### MergeFlow Reflection Report: MR !{iid} ({title})

#### Analyzed Feedback

- Total reviewer threads analyzed: {count}
- Discarded as noise: {noise_count}
- Qualified as high-signal: {signal_count}

#### Ledger Updates & Proposed Rules

1. **{Pattern Title}** `[x2 - Recurring]` _(Promote to Active Rules)_
   - **Anti-Pattern:** {Description / snippet of recurring mistake}
   - **Guideline:** {What developers and AI assistants should do instead}
   - **Target File:** `{resolved_active_rules_path}/{topic}.md`

2. **{New Pattern}** `[x1 - Logged]`
   - **Logged in:** `{resolved_ledger_path}` for frequency tracking.

---

Would you like to persist these updates to your feedback ledger and promote recurring rules?
```

### Step 5 — Rule & Ledger Persistence

Upon explicit confirmation:

- Update or append the entries in the target feedback ledger (`feedback-review.md`).
- For recurring items approved for promotion (`[x2]+`), write or update the focused rule in the user's workspace rule directory (`.kiro/steering/`, `.agents/rules/`, `.cursor/rules/`, `.claude/rules/`, or `AGENTS.md`).
