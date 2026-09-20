# Design Document: Optimize MR Review Latency

## Overview

This change restructures `skills/mr-comments/SKILL.md` into a compact activation-resident router. The router owns the complete review-lane path through the first report. Post-report procedure stays behind direct pointers to the existing reference set, and historical evidence stays in existing evidence references. The change preserves workflow decisions, gates, authorization scopes, scripts, fallback checks, and failure behavior.

The hard output contracts are deliberately simple:

- `SKILL.md` is at most **35,000 UTF-8 bytes**.
- The opening fence of the structurally complete resident Step 5 template is at a UTF-8 byte offset of at most **20,000**.
- A normal review-lane first report uses resident guidance without rereading `SKILL.md` or loading a reference.
- `conflicts.md` loads only after an explicit conflict-first selection.
- `fetch-mr.mjs` is the authoritative normal retrieval path, and the normalized `glab_mr_` callable family is forbidden across the whole workflow.
- Behavior protected by the implementation-start baseline remains protected.
- Live validation consists of exactly five cold plus five warm read-only attempts.

At review time, `node dev/test.mjs` passes **1,055 assertions** and `dev/measure.mjs` reports 75,229 characters / 567 lines for `SKILL.md`. These are observations, not acceptance thresholds. The working tree already contains pre-existing edits in files the implementation may overlap, so implementation must capture a Baseline_Snapshot and preserve those edits rather than treating `HEAD` as the baseline.

## Goals

1. Make the complete first report executable from resident guidance.
2. Remove normal pre-report reads of `reporting.md`, `investigating.md`, and every other reference.
3. Preserve explicit exceptional routing without speculative reference loads.
4. Keep conflict procedure unavailable until the user explicitly chooses conflict resolution first.
5. Keep the bundled fetch script authoritative and prohibit the full repository-scoped MR tool family.
6. Replace brittle wording checks where section, semantic slot, graph, byte, route, or trace structure exists.
7. Preserve every established gate and authorization boundary.
8. Measure actual cold and warm first-report latency safely.

## Non-goals

- No modification to `skills/mr-comments/scripts/fetch-mr.mjs`.
- No production JavaScript/server/module change.
- No new runtime dependency or property-testing package.
- No Jira-transition optimization, Jira `cloudId` cache, GraphQL `currentUser` change, native token HTTP route, prefetch hook, or composite tool.
- No benchmark code that launches agent sessions, primes caches, stores credentials, or makes GitLab/Jira calls.
- No fixed assertion-count target; retained behavior and zero failures matter, not preserving the number 1,055.

## Baseline and Change Boundary

Implementation begins before any feature edit with:

1. `git status` and a list of pre-existing modified/untracked files;
2. hashes or saved diffs for every file the feature may touch;
3. a hash for `fetch-mr.mjs` and other protected production files;
4. exact UTF-8 router bytes and Step 5 template opening offset;
5. the complete `node dev/test.mjs` result.

The approved working-tree state is the baseline even when it differs from `HEAD`. The implementation must not reset, stash, overwrite, or claim pre-existing work. If an overlapping edit cannot be separated safely, work stops for a baseline decision. Final scope verification compares protected files with this snapshot, not with `HEAD`.

Expected feature files are limited to:

- `skills/mr-comments/SKILL.md`;
- only those existing `skills/mr-comments/references/*.md` files that need a timing, ownership, or deduplication correction;
- `dev/test.mjs`;
- one dev-only benchmark analyzer and its result artifacts, if needed.

## Target Information Architecture

The resident router uses this semantic order:

1. frontmatter, purpose, and compact invariants;
2. loading protocol and run state;
3. Step 0 target parsing and validation;
4. Step 0b explicit lane selection;
5. Steps 1-4 complete first-report investigation path;
6. Step 5 complete report template, authorization boundary, blocker substitution, and stop;
7. Steps 6-12 compact routing cards;
8. Step 13 terminal boundary;
9. direct cross-cutting reference index.

Everything needed for a normal first report occurs before the Step 6 heading.

### UTF-8 budget

Only the final two limits are acceptance contracts. Internal budgets provide headroom:

| Resident area | Planning budget | Cumulative |
| --- | ---: | ---: |
| Frontmatter, purpose, invariants, loading | 6,000 | 6,000 |
| Steps 0 and 0b | 3,000 | 9,000 |
| Steps 1-4 complete hot path | 7,000 | 16,000 |
| Step 5 lead-in before opening fence | 1,500 | 17,500 |
| Step 5 template and gate semantics | 5,000 | 22,500 |
| Steps 6-13 cards and direct index | 9,000 | 31,500 |
| Headroom | 3,500 | 35,000 |

The template targets an opening offset no later than 17,500 bytes, leaving 2,500 bytes below the hard 20,000-byte limit. Measurements use UTF-8 bytes, never JavaScript character count:

```javascript
const routerBytes = Buffer.byteLength(skill, "utf8");
const openingByteOffset = Buffer.byteLength(skill.slice(0, fence.charStart), "utf8");
```

## First-Report Hot Path

The review lane follows this dependency order:

1. **Resident state:** activation content is already loaded; activation is not an explicit read event.
2. **Target validation:** parse host, nested project path, IID, and optional note ID; reject malformed or ambiguous input before a GitLab call.
3. **Lane selection:** review is default. Only the user's words record `conflict-first-selected`; payload conflict fields never select the lane.
4. **Open the pre-report interval:** no progress output, write, discussion-referenced project read, explicit `SKILL.md` read, or speculative reference load.
5. **Batch 1:** concurrently run the authoritative bundled fetch and resolve accessible Atlassian resources.
6. **Completeness gate:** validate pagination, reconciliation, linked-note presence, supported payload state, and project identity. An incomplete normal result does not silently downgrade.
7. **Jira identity:** settle one ticket key; disagreement blocks guessed Jira reads.
8. **Batch 2:** when one key is settled, concurrently get the issue status/summary and available transitions.
9. **Classification:** classify every unresolved thread from discussion text only; count resolved threads without itemizing or claiming code verification.
10. **Render Step 5:** fill orientation, Jira status, counts, blockers/flags, one full item per unresolved discussion, resolved-not-rechecked accounting, authorization list, and one question.
11. **Blocker substitution:** a blocker decision question replaces the default question; it does not create a second question or implicitly switch lanes.
12. **Emit and stop:** the complete report is the first user-facing output and the last event in that turn.

Malformed targets and uncovered retrieval failures retain their established blocker behavior and are not mislabeled as complete First_Reports.

## Resident Step 5 Template Schema

The Actual_Resident_Report_Template is discovered structurally, not by searching for a full sentence. It is the first fence inside parsed resident Step 5 that contains all required semantic roles.

The implementation uses stable semantic placeholder keys so wording can change without breaking the contract. Representative keys are:

- orientation: `{mr.iid}`, `{mr.title}`, `{mr.state}`, `{mr.mergeability}`, `{mr.targetBranch}`, `{mr.sourceBranch}`;
- Jira: `{jira.key}`, `{jira.currentStatus}`, optional `{jira.activeTransition}`;
- counts: `{counts.needsYou}`, `{counts.feedbackThreads}`, `{counts.countLine}`, `{counts.unresolved}`, `{counts.resolved}`;
- risk: `{triage.blockers}`, optional `{triage.flags}`;
- unresolved item: `{discussion.classification}`, `{discussion.path}`, `{discussion.line}`, `{discussion.author}`, `{discussion.quote}`, and a classification-specific prompt slot;
- approval: checkout/stay, optional Jira start move, post-checkout reads plus Fix/Nitpick scope, and later-phase stop;
- closing: one default question slot and one replacement rule for a blocker question.

The structural parser verifies:

1. a Step 5 fence exists and contains the required semantic keys;
2. orientation rows precede unresolved item blocks;
3. at least one complete unresolved-item skeleton exists;
4. the authorization list follows the item area and contains all four authorization roles;
5. exactly one closing-question role exists, with blocker replacement rather than addition;
6. resolved-not-rechecked accounting and the no-code-evidence boundary are represented.

It does not require the literal phrase `Say go and I'll` or any complete prose sentence. A harmless rewording fixture must pass.

## Progressive Disclosure and Reference Timing

### Normal and exceptional pre-report routes

| Condition | Eligible reference load |
| --- | --- |
| Normal review-lane first-report path | None |
| Explicit initial conflict-first selection | `conflicts.md`, after the selection event |
| Explicit post-report conflict-first reply | `conflicts.md`, in the later turn after the reply |
| Bundled fetch cannot produce a complete supported result and fallback is selected | `glab-tooling.md`, after the failure/selection event |
| Jira identity sources disagree and resident rules cannot settle them | `jira-identity.md`, after the discrepancy event |
| A named mismatch verdict fires and its wording is needed | `user-mistakes.md`, after the mismatch event |
| Historical evidence or latency rationale | Never an execution dependency |

`reporting.md` and `investigating.md` remain maintenance/rationale files and are never first-report dependencies. Their current batch-1 instructions and duplicate normative template are removed. Existing content is reused or deduplicated; no new reference file is created.

### Post-report routing cards

Each resident card has `eligible after`, `allowed scope`, `stop`, and `procedure` fields.

| Step | Eligible after | Resident boundary | Existing owner |
| --- | --- | --- | --- |
| 6 | Step 5 approval | Approved checkout, listed Jira start move, deferred profile reads, and approved code reads; no commit/push | `checkout.md` |
| 6b | A reply/finding changes approved scope | Present changed scope and stop when baseline requires approval | `scope-gate.md` |
| 7 | Step 6/6b scope settled | Sequential edits, validation, attribution; unexplained hunk stops | `fixing.md` |
| 8 | Exact staged bytes validated/self-reviewed | Final summary stops before commit/push | `summary-gate.md` |
| 9 | Step 8 approval | Commit verification and push; heavy-hook choice stops | `publishing.md` |
| 10 | Push and applicable conflict check complete | Reply preview stops before post/resolve | `publishing.md` |
| 11 | Publication ledger complete | Time question stops before Jira writes | `jira.md` |
| 12 | Explicit lesson opt-in | Exact local steering preview stops before mutation | `lessons.md` |
| 13 | Step 12 completed/skipped/inapplicable | Terminal; no merge/approve/delete/Done/new pass | Resident only |

`conflicts.md` may be reused during Step 9 only if that run already recorded a Conflict_First_Selection. It is not a second owner of publication procedure.

### No-reread state

```javascript
const runState = {
  residentLoaded: true,
  loadedReferences: new Set(),
  failedReferenceReads: new Set(),
  conflictFirstSelectedAt: null,
  firstReportEmittedAt: null,
  closedGates: new Set(),
};
```

A successful reference read enters `loadedReferences` and is reused for the rest of the run. A targeted retry is allowed only after a recorded failed/truncated read. The trace validator treats activation as resident state, not as a file-read event.

## Conflict-First Gate

`conflicts.md` becomes eligible only after:

1. an explicit conflict-first purpose in the initial request; or
2. an explicit conflict-first choice in a reply after the review-lane report turn has ended.

`has_conflicts`, `merge_status`, and `detailed_merge_status` do not grant eligibility. In the review lane, a conflicted payload uses the resident blocker-question replacement and leaves `conflicts.md` unloaded. The selection event must precede the read in the trace.

## Authoritative Retrieval and Family-Wide Prohibition

Resident Step 2 contains one structured route table:

| Status | Route | Eligibility |
| --- | --- | --- |
| normal | `scripts/fetch-mr.mjs` with `--project`, `--iid`, `--instance` | Every supported first fetch |
| forbidden-prefix | normalized `glab_mr_` callable family | Never |
| explicit-fallback | existing repository-independent raw/REST route | Only after an incomplete supported normal result and explicit selection |

The normal and deny rows are consecutive. A complete normal result supplies MR data, discussions, git context, triage, counts, and pagination state without another MR fetch.

### Static callable policy

Static validation scans `SKILL.md` and every existing reference for callable identifiers, normalizes wrappers/namespaces to the unqualified suffix, and applies two rules:

1. the family token `glab_mr_` may appear only in the structured deny declaration or a clearly non-operative test fixture;
2. any concrete callable whose normalized name begins with `glab_mr_` fails, even if namespaced or previously unseen.

This is intentionally stricter than an enumeration and avoids trying to infer whether permissive prose was meant as an executable route. Operative routes must be represented structurally; undeclared executable call sites fail separately. Runtime trace events apply the same normalization.

`fetch-mr.mjs` is protected by the Baseline_Snapshot and is not edited by this feature.

## Behavioral Preservation

Preservation relies on evidence already present in the repository rather than a new generated behavioral model:

- capture the complete pre-change suite result;
- retain existing assertions unless a mapped structural replacement is equivalent or stricter;
- keep phrase checks only for genuinely linguistic requirements;
- keep unique procedure ownership and direct-pointer checks;
- run every retained suite before and after the move;
- compare protected-file hashes with the Baseline_Snapshot;
- audit the final diff for Phase 2 and production-code changes.

Moved text is handled in this order:

1. if an equivalent rule already exists in the correct owner, delete the duplicate;
2. otherwise move only the missing procedural/rationale content to that existing owner;
3. keep gate existence, eligibility, bounded authority, and stop semantics resident;
4. never create a second owner or a reference chain.

## Structural Validation Design

All validation remains in `dev/test.mjs` and uses Node built-ins.

### Core helpers

- `parseMarkdownSections(text)` — heading spans while respecting fences.
- `parseFences(section)` — fenced-block spans.
- `findActualResidentReportTemplate(skill)` — Step 5 scoped semantic-schema discovery.
- `utf8Bytes(text)` and `byteOffsetOf(text, charOffset)`.
- `extractReferencePointers(section)` and `buildDisclosureGraph(skill, refs)`.
- `parseRouteDeclarations(section)` and `normalizeCallable(identifier)`.
- `validateWorkflowTrace(events, contracts)` — derives lane, pre-report interval, gates, read eligibility, successful-load reuse, report completeness/stop, write safety, and callable policy.
- `summarizeBenchmark(records)` — validates one ten-attempt set and derives cohort summaries.

### Deterministic fixture matrix

Each family has a compliant fixture and a targeted mutation. No custom property-testing framework or 100-iteration generator is required.

| Contract | Targeted invalid fixture |
| --- | --- |
| Router bytes | 35,001 UTF-8 bytes, including a multibyte boundary case |
| Template opening | valid schema opening at byte 20,001 |
| Template discovery | decoy fence plus a fence missing one semantic role |
| Harmless wording | reword prose while retaining structure and semantic keys; must pass |
| Hot-path order | move Step 6 before one required hot-path role |
| Gate placement | move a gate/authorization role into a neighboring step |
| Ownership/pointers | missing owner, duplicate owner, wrong direct pointer, reference chain |
| Normal reference timing | load any reference on an otherwise normal pre-report path |
| Conflict timing | load `conflicts.md` from payload state without user selection |
| No reread | reopen a successfully loaded reference; allow only a failed/truncated retry |
| Pre-report isolation | project read, write, progress output, or same-turn post-report call |
| Static callable family | plain/namespaced/future `glab_mr_<suffix>` outside the deny declaration |
| Runtime callable family | forbidden normalized call in a trace |
| Benchmark shape | 4/6 cohorts, replacement attempt, wrong median, truncated slowest sequence, condition drift |

Diagnostics use stable IDs such as `router.byte-size`, `template.opening-offset`, `reference.conflict-selection`, `reference.successful-reuse`, and `callable.forbidden-prefix`.

## Live Validation Design

### Separation of responsibilities

A local Node script cannot reliably create isolated Kiro sessions, prime activation context, intercept tools, or prove cache state. Therefore the live design has two parts:

1. **Operator-run protocol:** a human/operator creates the isolated sessions, applies benchmark-only Read_Only_Enforcement, submits the fixed request, and captures run shape.
2. **Live_Validation_Analyzer:** a dev-only Node script validates records and derives results. It never launches sessions, uses credentials, or calls remote services.

If a read-only enforcement boundary or verifiable warm priming is unavailable, live validation is blocked before the first timed request rather than simulated.

### Fixed conditions

Record before timing:

- one stable GitLab MR URL/IID;
- clean disposable checkout path, commit, and remote;
- non-secret credential identities and hosts;
- network route;
- exact request text/hash, with no conflict-first selection;
- checker/analyzer and write-classifier versions;
- report-only stopping rule;
- evidence that mutating tools/commands are denied.

No source code, reviewer text, secrets, or payload bodies enter benchmark records.

### Cohorts

Execute one Benchmark_Set of exactly ten attempts:

- **cold-1 through cold-5:** separate fresh sessions with no prior skill activation in that session;
- **warm-1 through warm-5:** separate sessions where only activation content is primed immediately before the timed request.

Do not prime MR/Jira facts, references, or prior report output. The timing begins at timed request submission, after warm priming. Runs may be interleaved to reduce network-time bias while retaining exactly five of each.

### Safety and failure semantics

- Read_Only_Enforcement is verified before `cold-1`/the first timed run.
- No go-ahead is sent.
- The run stops at the complete First_Report before Step 6.
- Every timed attempt remains in the set, including failures; no eleventh replacement exists.
- A write attempt, incomplete report, post-report call, or condition drift fails the set.
- If a later retry is desired, it is a separately identified Benchmark_Set, not a restart inside this one.
- Result artifact writes happen after the timed run and are not included in its Tool_Sequence.

### Analyzer output

The JSON keeps fixed-condition hashes and ten run-shape records. Markdown renders:

1. fixed-condition metadata and safety evidence;
2. five cold and five warm rows in execution order;
3. each sorted cohort and its third-value median;
4. the complete slowest-run Tool_Sequence for each cohort;
5. all failures with run ID and latency.

## Phase 2 Boundary

Phase 2 stays a design note only. No benchmark renderer feature, generated route, static keyword scanner, runtime module, hook, cache, transport, or dependency is added for it. The final diff audit is sufficient: any implementation of a deferred item fails scope review. Mentions must say `Deferred follow-up — not implemented`.

## Error Handling

Validators fail closed with actionable diagnostics:

- bytes/offset: actual, limit, excess, source;
- template: Step 5 and missing semantic role;
- order/gate: expected and actual sections/events;
- ownership/pointer: step, expected owner, observed owner/edge;
- timing/no-reread: event sequence, prerequisite event, offending read;
- callable: source, original identifier, normalized name;
- benchmark: set/run ID, latency, complete Tool_Sequence, violated condition.

A normal fetch failure never silently selects fallback. A failed reference read may be retried once as a targeted read; a successful read is reused.

## Traceability

| Concern | Requirements | Design evidence | Tasks |
| --- | --- | --- | --- |
| 35,000-byte router / 20,000-byte template opening | 1.1-1.4, 6.4-6.7 | UTF-8 budget, semantic template schema, boundary fixtures | 1, 2, 3, 4 |
| First report, no code read/write, end-turn stop | 2.1-2.11 | First-Report Hot Path, trace validator | 2, 3, 4 |
| Reference timing and successful-load reuse | 3.1-3.9 | timing table, routing cards, run state | 2, 3, 4 |
| Conflict-first-only `conflicts.md` | 3.3-3.5, 6.10 | Conflict-First Gate | 2, 3, 4 |
| Authoritative fetch and family-wide prohibition | 4.1-4.7, 6.12-6.13 | route table, static/runtime normalization | 1, 2, 3, 4 |
| Behavioral preservation and workspace safety | 5.1-5.8, 7.1-7.7 | Baseline and Change Boundary, preservation method | 1, 3, 4, 8 |
| Exactly 5 cold + 5 warm safe runs | 8.1-8.15 | Live Validation Design | 5, 6, 7 |
| Phase 2 exclusion | 9.1-9.5 | Non-goals, Phase 2 Boundary | 1, 4, 8 |

## Testing Strategy

- Use deterministic boundary and mutation fixtures for structural contracts.
- Retain phrase assertions only for human wording/tone rules with no structural signal.
- Run `node dev/test.mjs` before edits, after structural helpers, after router/reference changes, and at final static validation.
- Test the analyzer only with synthetic run-shape records; live credentials/network remain outside the suite.
- Run the ten live attempts only after static validation and read-only preflight pass.

## Implementation Boundary

This design authorizes documentation/router changes, test changes, and a dev-only run-shape analyzer. It does not authorize production code changes. In particular, `fetch-mr.mjs`, server modules, decision semantics, GraphQL normalization, transport behavior, hooks, and Phase 2 items remain unchanged relative to the Baseline_Snapshot.