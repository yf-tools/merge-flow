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

| Category | Qualification Criteria | Disposition |
| :--- | :--- | :--- |
| **Architectural Violations** | Layering breaches, improper dependency directions, leaking domain abstractions | **High Signal (Keep)** |
| **Unhandled Edge Cases** | Off-by-one errors, nullability/undefined traps, concurrency/race conditions | **High Signal (Keep)** |
| **Missing Test Types** | Omitting regression tests, failure mode assertions, integration coverage | **High Signal (Keep)** |
| **Project & Stack Idioms** | Repository conventions (e.g. `inject()` vs constructor, specific logger patterns) | **High Signal (Keep)** |
| **Subjective Styling** | Indentation or formatting debates already handled or ignored by the linter | **Noise (Discard)** |
| **One-off Workarounds** | Temporary hotfixes, deprecated library quirks scheduled for deletion | **Noise (Discard)** |
| **Conversational Banter** | Non-actionable comments, emoji reactions, ambiguous nitpicks | **Noise (Discard)** |

### Step 3 — Rule Formulation

For each high-signal item:

- Check existing rules in `.agents/rules/`, `AGENTS.md`, `GEMINI.md`, or skill lesson files to verify it is not already covered.
- Formulate a succinct guideline:
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

#### Proposed Preventative Rules

1. **{Rule Title}**
   - **Trigger/Context:** {Where this applies}
   - **Instruction:** {What the agent/developer should do}
   - **Target File:** `{path_to_rules_file}`

---
Would you like to persist these rules to your workspace guidelines?
```

### Step 5 — Rule Persistence

Upon explicit confirmation:

- Append or update the rule in the target guidelines file (e.g., `.agents/rules/` or project guidelines).
- Increment recurrence counters for repeat findings if tracking via lessons.
