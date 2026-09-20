# Requirements Document

## Introduction

This feature reduces the activation context and elapsed time required to produce the first merge-request review report. It compacts `skills/mr-comments/SKILL.md` into a progressive-disclosure router while preserving the established workflow, its safety gates, the bundled repository-independent fetch path, and all behavior protected by the pre-change validation baseline. Post-report procedure and historical explanation may move only into the existing reference set. No production code or Phase 2 optimization is part of this feature.

## Glossary

- **MR_Review_Skill**: `skills/mr-comments/SKILL.md`, its bundled scripts, and `skills/mr-comments/references/`.
- **Resident_Router**: The UTF-8 content of `skills/mr-comments/SKILL.md` loaded when the skill activates.
- **Workflow_Run**: One invocation of the MR_Review_Skill for one GitLab merge request.
- **Review_Lane**: The default lane for reviewing and addressing merge-request feedback.
- **Conflict_First_Selection**: An explicit statement from the user, in the initial request or a reply to the First_Report, that conflict resolution is the purpose to perform first. Payload conflict state alone is not a selection.
- **Conflict_First_Lane**: The lane entered only after a Conflict_First_Selection.
- **First_Report_Hot_Path**: The complete resident guidance required to validate the target, choose the lane, gather read-only GitLab/git/Jira facts, reconcile and classify discussions, render the Step 5 report, apply blocker-question behavior, and stop for approval without opening discussion-referenced project files or relying on a reference file.
- **Renderable_Review_Run**: A Review_Lane run with a valid target and enough supported read-only facts to render the complete First_Report. A malformed target or an uncovered retrieval failure may instead produce the Behavioral_Baseline blocker output.
- **First_Report**: The complete Step 5 review report containing merge-request orientation, reconciled counts, exact Jira status, blockers, optional flags, every unresolved discussion item, resolved-not-rechecked accounting, the authorization list, and exactly one closing question.
- **Pre_Report_Interval**: The interval from skill activation until the lane's first blocking report is emitted: the First_Report in the Review_Lane or the approved-shape resolution plan gate in the Conflict_First_Lane.
- **Actual_Resident_Report_Template**: The first fenced template block in resident Step 5 that satisfies the complete report-template structural schema; a summary, pointer, or incomplete fence does not qualify.
- **UTF_8_Byte_Offset**: The zero-based number of UTF-8 encoded bytes preceding a target character.
- **Existing_Reference_Set**: `batching.md`, `checkout.md`, `conflicts.md`, `failures.md`, `fixing.md`, `glab-tooling.md`, `investigating.md`, `jira-identity.md`, `jira.md`, `lessons.md`, `publishing.md`, `reporting.md`, `scope-gate.md`, `summary-gate.md`, and `user-mistakes.md` under `skills/mr-comments/references/`.
- **Reference_Load**: An explicit file-read operation that opens a file in the Existing_Reference_Set during a Workflow_Run.
- **Successful_Reference_Load**: A Reference_Load that returned the complete requested file content.
- **Procedural_Detail**: Step-by-step instructions needed only after the First_Report gate closes or after a named exceptional condition fires.
- **Historical_Narrative**: Run chronology, timestamps, quotations, or incident history that supports a rule but is not required to execute it.
- **Critical_Gate**: A user-approval stop for the conflict plan, Step 5 report, Step 6b scope change, Step 8 final summary, Step 9 pre-push choice, Step 10 reply preview, or Step 12 lesson preview.
- **Critical_Pointer**: A direct resident path from a workflow step to the existing reference that uniquely owns its Procedural_Detail.
- **Bundled_Fetch_Script**: `skills/mr-comments/scripts/fetch-mr.mjs`, invoked from the skill directory with project path, merge-request IID, and GitLab instance. Its normal output supplies the merge request, discussions, git context, triage result, and reconciled counts.
- **Repository_Scoped_MR_Tool**: Any callable whose normalized unqualified name begins with `glab_mr_`, including namespaced callables whose suffix begins with that prefix.
- **Explicit_Fallback_Path**: A repository-independent raw or REST fallback selected only after the Bundled_Fetch_Script cannot return a complete supported result, preserving the established completeness checks.
- **Baseline_Snapshot**: The implementation-start record of git status, relevant file hashes, router measurements, and `node dev/test.mjs` results. It represents the approved working-tree state, not necessarily `HEAD`.
- **Behavioral_Baseline**: The decisions, ordering, gates, authorization scopes, read/write boundaries, failure handling, script behavior, reference constraints, and pass/fail semantics present in the Baseline_Snapshot, except where this document is explicitly stricter.
- **Validation_Suite**: `dev/test.mjs` after implementation.
- **Phrase_Contract**: An assertion that passes or fails primarily from literal prose.
- **Structural_Contract**: An assertion based on parsed section/fence/list/table structure, semantic placeholder keys, reference ownership/reachability, normalized callable identifiers, byte ranges, or execution events.
- **Regression_Fixture**: A controlled compliant or intentionally invalid document, route, or trace demonstrating a contract's pass/fail behavior.
- **Report_Only_Run**: A live run that performs read-only investigation, emits the First_Report, and stops before checkout, transition, project-source reads, edits, commits, pushes, replies, resolutions, worklogs, or other writes.
- **Cold_Cohort**: Five Report_Only_Runs, each in a fresh isolated session with no prior MR_Review_Skill activation or reference content in that session.
- **Warm_Cohort**: Five Report_Only_Runs, each in a separate session where only the MR_Review_Skill activation content was primed before timing; MR/Jira facts, references, and report output were not primed.
- **Benchmark_Set**: Exactly ten timed Report_Only_Run attempts under one fixed condition set: five cold and five warm. Failed attempts remain in the set and are not replaced.
- **First_Report_Latency**: Wall-clock time from submission of the timed MR review request until the complete First_Report is visible and the run has stopped without a following tool call.
- **Tool_Sequence**: The ordered tool/script invocation list for a Report_Only_Run, including repeats and mutation classification, but excluding source code, comments, secrets, and payload bodies.
- **Write_Operation**: A mutation of repository files, working tree, branch state, merge request, Jira issue, discussion, remote branch, local steering, or credentials.
- **Live_Validation_Analyzer**: A dev-only analyzer for operator-captured run-shape records. It validates and summarizes the Benchmark_Set; it does not launch agent sessions, prime caches, hold credentials, or execute GitLab/Jira calls.
- **Read_Only_Enforcement**: A benchmark-only external boundary that denies mutating tools/commands before execution. It must not alter production plugin behavior.
- **Phase_2_Follow_Up_Set**: Jira-transition optimization, Jira `cloudId` reuse, GraphQL `currentUser`, native token-based HTTP, a prefetch hook, and a composite tool.
- **Follow_Up_Documentation**: Non-operative documentation that labels potential later work as deferred and does not change runtime behavior or acceptance criteria.

## Requirements

### Requirement 1: Compact Resident Router

**User Story:** As a skill maintainer, I want a compact resident router, so activation loads only the content required for the current decision path.

#### Acceptance Criteria

1. THE Resident_Router SHALL occupy no more than 35,000 UTF-8 encoded bytes.
2. THE Resident_Router SHALL contain the complete First_Report_Hot_Path before the resident Step 6 heading begins.
3. THE Resident_Router SHALL contain the Actual_Resident_Report_Template inside resident Step 5.
4. THE opening fence of the Actual_Resident_Report_Template SHALL begin at a UTF_8_Byte_Offset no greater than 20,000.
5. THE Resident_Router SHALL retain the applicable stop and authorization boundary for every Critical_Gate.
6. THE Resident_Router SHALL retain a Critical_Pointer in every post-report step that delegates Procedural_Detail.
7. THE Resident_Router SHALL retain Step 13 as the final workflow step and preserve its terminal stop.
8. THE MR_Review_Skill SHALL place removed Steps 6-13 Procedural_Detail only in the Existing_Reference_Set and under the existing unique owner for that step.
9. THE MR_Review_Skill SHALL place Historical_Narrative removed from the Resident_Router only in the Existing_Reference_Set.

### Requirement 2: Complete First-Report Behavior

**User Story:** As a merge-request author, I want the complete review picture before work begins, so one informed approval can release the next phase.

#### Acceptance Criteria

1. WHEN a Renderable_Review_Run begins, THE First_Report SHALL be its first user-facing output.
2. WHILE the Pre_Report_Interval is active, THE MR_Review_Skill SHALL keep discussion-referenced project files unopened.
3. WHILE the Pre_Report_Interval is active, THE MR_Review_Skill SHALL perform no Write_Operation.
4. WHEN required read-only facts are available, THE First_Report SHALL render merge-request state, mergeability, target branch, source branch, Jira key, exact Jira status, blockers, optional flags, and reconciled counts.
5. WHEN unresolved discussions exist, THE First_Report SHALL render one full-detail item for every unresolved discussion.
6. WHEN resolved discussions exist, THE First_Report SHALL render them only as an accurate count stating that they were not re-checked against project code.
7. WHILE discussion-referenced project files remain unopened, THE First_Report SHALL omit claims about current code, verified fixes, completed handling, or proposed diffs.
8. IF triage returns a blocker with a decision question, THEN the blocker question SHALL replace the default closing question.
9. WHEN the First_Report is emitted, THE run SHALL end the turn without a subsequent tool call and wait for the user's reply.
10. WHEN the user gives an unqualified go-ahead, THE MR_Review_Skill SHALL preserve the Behavioral_Baseline authorization for checkout, the listed Jira start transition, approved post-checkout reads, and approved Fix/Nitpick items.
11. WHEN the user gives an unqualified go-ahead, Question and Disagree items, commits, pushes, remote publication, Jira finish writes, worklogs, and lesson writes SHALL remain outside that authorization.

### Requirement 3: Progressive Reference Timing and No Rereads

**User Story:** As a user waiting for the first report, I want references loaded only when eligible and only once, so unrelated procedures do not add latency.

#### Acceptance Criteria

1. WHILE the Pre_Report_Interval is active, THE MR_Review_Skill SHALL issue zero explicit file-read calls for `skills/mr-comments/SKILL.md`, `references/reporting.md`, and `references/investigating.md`.
2. WHILE a normal Review_Lane pre-report path has no exceptional diagnostic or fallback condition, THE MR_Review_Skill SHALL issue zero Reference_Load operations.
3. WHILE a Conflict_First_Selection is absent, `references/conflicts.md` SHALL remain unloaded, including when payload state reports conflicts.
4. WHEN the initial request contains a Conflict_First_Selection, THE MR_Review_Skill SHALL record that selection before loading `references/conflicts.md`.
5. WHEN a reply to the First_Report supplies a Conflict_First_Selection, THE First_Report turn SHALL already be closed, and the later reply SHALL precede the first `references/conflicts.md` load.
6. WHEN a post-report step becomes eligible after its preceding Critical_Gate closes, THE MR_Review_Skill SHALL load only the Existing_Reference_Set files required by that step.
7. AFTER a Successful_Reference_Load, THE MR_Review_Skill SHALL reuse that content for the remainder of the Workflow_Run and SHALL NOT reopen the file. A targeted retry is permitted only after a failed or truncated read and SHALL record that failure.
8. THE Resident_Router SHALL identify references as ordinary files read relative to the skill directory.
9. EVERY runtime reference path SHALL be directly reachable from the Resident_Router without a reference-to-reference chain.

### Requirement 4: Authoritative Merge-Request Retrieval

**User Story:** As a reviewer, I want merge-request data fetched through the repository-independent bundled path, so report generation does not fail because a tool starts outside the repository.

#### Acceptance Criteria

1. WHEN the First_Report_Hot_Path fetches merge-request data, THE normal route SHALL invoke the resolved bundled `fetch-mr.mjs` command from the skill's own directory with `--project {project_path} --iid {iid} --instance {host}`; it SHALL preserve the existing bundled-script locator/command contract rather than hardcoding a user path.
2. WHEN the Bundled_Fetch_Script returns a complete normal result, THE MR_Review_Skill SHALL consume its merge request, discussions, git context, triage result, reconciled counts, and pagination state without a second MR retrieval route.
3. WHERE an Explicit_Fallback_Path is selected, THE MR_Review_Skill SHALL preserve the Behavioral_Baseline completeness, pagination, field-preservation, triage, and reconciliation checks.
4. WHILE a Workflow_Run is active, THE MR_Review_Skill SHALL issue zero Repository_Scoped_MR_Tool invocations.
5. THE Resident_Router SHALL place the normalized `glab_mr_` deny rule structurally adjacent to the Bundled_Fetch_Script route, and the fallback route SHALL NOT weaken it.
6. IF any operative resident instruction, reference instruction, fallback declaration, or execution trace permits or invokes a callable whose normalized name begins with `glab_mr_`, THEN the Validation_Suite SHALL fail and identify the source and original callable.
7. THE Implementation SHALL NOT modify `skills/mr-comments/scripts/fetch-mr.mjs`; unchanged status SHALL be checked against the Baseline_Snapshot rather than assumed from `HEAD`.

### Requirement 5: Behavioral Preservation Across Disclosure Boundaries

**User Story:** As a maintainer, I want the compacted skill to behave like the established workflow, so latency improvements do not weaken safety or approval semantics.

#### Acceptance Criteria

1. THE Implementation SHALL preserve the Behavioral_Baseline except where this document defines a stricter result.
2. WHEN content moves from the Resident_Router to the Existing_Reference_Set, workflow step order SHALL be preserved.
3. WHEN content moves, lane decisions and Conflict_First_Selection semantics SHALL be preserved.
4. WHEN content moves, every Critical_Gate's stop behavior SHALL be preserved.
5. WHEN content moves, every approval scope SHALL be preserved.
6. WHEN content moves, every read/write boundary SHALL be preserved.
7. WHEN content moves, failure handling and fallback eligibility SHALL be preserved.
8. IF a delegated procedure is missing, multiply owned, or unreachable from the step that needs it, THEN the Validation_Suite SHALL fail and identify the step and reference.

### Requirement 6: Structural Regression Contracts

**User Story:** As a maintainer, I want tests to verify workflow structure and runtime behavior, so harmless prose edits remain possible while safety regressions fail.

#### Acceptance Criteria

1. WHEN a Phrase_Contract protects a structurally observable policy, THE Validation_Suite SHALL replace it with a Structural_Contract.
2. WHERE a policy has no structural or behavioral signal, THE Validation_Suite MAY retain a Phrase_Contract.
3. WHEN an existing assertion is replaced, its protected pass/fail behavior SHALL remain equivalent or stricter.
4. THE Validation_Suite SHALL measure Resident_Router size with `Buffer.byteLength(text, "utf8")` and fail above 35,000 bytes.
5. THE Validation_Suite SHALL locate the Actual_Resident_Report_Template by parsed Step 5 boundaries, fence structure, report-field/item/authorization structure, and semantic placeholder keys rather than full-sentence literal matching.
6. THE Validation_Suite SHALL measure the Actual_Resident_Report_Template opening UTF_8_Byte_Offset and fail above 20,000.
7. THE Validation_Suite SHALL verify that the complete First_Report_Hot_Path and Actual_Resident_Report_Template precede resident Step 6.
8. THE Validation_Suite SHALL verify Critical_Gates and Critical_Pointers in their applicable workflow steps.
9. THE Validation_Suite SHALL verify post-report Reference_Load operations occur only after their prerequisite gate.
10. THE Validation_Suite SHALL verify `references/conflicts.md` loads only after Conflict_First_Selection.
11. THE Validation_Suite SHALL verify pre-report no-reread, normal-path zero-reference-load, successful-load reuse, project-read/write isolation, first-output, and report-stop behavior through execution traces.
12. THE Validation_Suite SHALL normalize callable namespaces and detect the `glab_mr_` family by prefix across every structured operative call site in the Resident_Router and Existing_Reference_Set, not by enumerating current tool names.
13. THE Validation_Suite SHALL verify through execution traces that Report_Only_Runs contain zero Repository_Scoped_MR_Tool invocations.
14. THE Validation_Suite SHALL include at least one compliant fixture and one targeted invalid fixture for every new size, offset, template, ordering, ownership, pointer, gate-timing, conflict-timing, no-reread, report-stop, and forbidden-callable contract.
15. A targeted invalid fixture SHALL report its intended stable contract ID, and a harmless prose-rewording fixture that preserves structure SHALL continue to pass.

### Requirement 7: Existing Validation and Workspace Safety

**User Story:** As a maintainer, I want existing coverage and pre-existing work retained, so the restructure cannot silently discard behavior or overwrite unrelated changes.

#### Acceptance Criteria

1. THE Validation_Suite SHALL continue to enforce manifest, frontmatter, package-layout, bundled-script, decision-module, GraphQL-normalization, transport, redaction, portability, Jira, publication, and hunk-attribution behavior from the Behavioral_Baseline.
2. THE Validation_Suite SHALL continue to enforce reference existence, size, unique ownership, direct pointers, and duplication constraints from the Behavioral_Baseline.
3. THE Validation_Suite SHALL continue to enforce workflow ordering, report shape, batch shape, Jira safety, publication safety, and command portability from the Behavioral_Baseline.
4. BEFORE any implementation edit, THE Baseline_Snapshot SHALL record current git status, relevant hashes, exact router bytes/template offset, and the full validation result.
5. THE Implementation SHALL preserve pre-existing working-tree changes and SHALL NOT reset, stash, overwrite, or attribute them to this feature.
6. IF overlapping pre-existing edits cannot be distinguished safely from the feature changes, implementation SHALL stop and request a baseline decision before editing that file.
7. WHEN `node dev/test.mjs` runs after implementation, it SHALL exit successfully with every retained and new contract passing.

### Requirement 8: Live First-Report Latency Validation

**User Story:** As a maintainer, I want repeatable cold and warm measurements, so the first-report latency result is observed rather than inferred from document size.

#### Acceptance Criteria

1. ONE Benchmark_Set SHALL contain exactly ten timed Report_Only_Run attempts.
2. THE Benchmark_Set SHALL contain exactly five Cold_Cohort runs and exactly five Warm_Cohort runs.
3. THE same merge request, repository checkout, credentials, network route, request text, checker version, and report-only stopping rule SHALL be used for both cohorts.
4. BEFORE the first timed request, Read_Only_Enforcement SHALL be active and verified; if it is unavailable, live validation SHALL remain blocked and no timed run SHALL start.
5. WHILE each Report_Only_Run is active, zero Write_Operations SHALL be permitted.
6. WHEN each run emits the First_Report, timing SHALL stop and the run SHALL end before Step 6, without a go-ahead.
7. THE operator SHALL capture First_Report_Latency, complete Tool_Sequence, report completeness, stop state, cohort setup evidence, and fixed-condition identifiers for every attempt.
8. THE Live_Validation_Analyzer SHALL report all five individual latency values for each cohort in execution order.
9. THE Live_Validation_Analyzer SHALL report each cohort median as the third value after sorting its five latencies ascending.
10. THE Live_Validation_Analyzer SHALL report the complete Tool_Sequence for the slowest run in each cohort.
11. IF a run attempts a Write_Operation, emits an incomplete report, or continues after the report, THEN the Benchmark_Set SHALL fail and identify the run, latency, and Tool_Sequence.
12. A failed attempt SHALL remain one of the ten attempts and SHALL NOT be replaced by an eleventh run.
13. IF fixed conditions drift after timing begins, THEN the Benchmark_Set SHALL fail; it SHALL NOT restart or mix replacement attempts inside the same set. A later retry is a separate Benchmark_Set.
14. THE Live_Validation_Analyzer SHALL operate only on run-shape records and SHALL NOT launch/prime sessions, hold credentials, make network calls, or persist source code, reviewer text, secrets, or payload bodies.
15. Benchmark JSON/Markdown artifacts SHALL be written only after the corresponding timed run has ended and outside its Tool_Sequence.

### Requirement 9: Deferred Optimization Boundary

**User Story:** As a maintainer, I want later optimization ideas separated from this change, so router compaction can be implemented and evaluated independently.

#### Acceptance Criteria

1. THE Implementation SHALL leave every item in the Phase_2_Follow_Up_Set outside implementation scope.
2. THE Implementation SHALL preserve current runtime behavior for every item in the Phase_2_Follow_Up_Set.
3. WHERE a Phase_2_Follow_Up_Set item is mentioned, Follow_Up_Documentation SHALL label it as deferred and non-operative.
4. NO Phase_2_Follow_Up_Set item SHALL be required for validation success.
5. THE final changed-file and behavior audit SHALL fail this feature if it adds a Phase 2 route, dependency, hook, cache, transport, or runtime behavior.