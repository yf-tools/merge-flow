# Implementation Plan: Optimize MR Review Latency

## Overview

Compact the `mr-comments` resident router, preserve established workflow behavior, replace only structurally observable brittle assertions, and validate the result statically and with exactly five cold plus five warm read-only report runs. The plan deliberately does not modify production JavaScript, `fetch-mr.mjs`, or any Phase 2 behavior.

The current working tree already contains pre-existing changes, including overlap with files this feature may touch. Those changes are part of the implementation-start baseline unless the user says otherwise; they must not be reset, stashed, overwritten, or attributed to this feature.

## Tasks

- [x] 1. Capture and protect the implementation-start baseline
  - [x] 1.1 Record the approved working-tree state before any feature edit
    - Record `git status`, the current commit, and hashes or saved diffs for every potentially overlapping file.
    - Explicitly distinguish pre-existing edits from this feature's later edits. Do not reset, stash, clean, or rewrite an overlapping file when ownership is ambiguous; stop for a baseline decision instead.
    - Hash `skills/mr-comments/scripts/fetch-mr.mjs`, server modules, manifests, and other protected production files so final scope can be compared with this snapshot rather than with `HEAD`.
    - _Requirements: 4.7, 7.4, 7.5, 7.6_

  - [x] 1.2 Capture exact static baseline evidence
    - Run `node dev/test.mjs` and record the full result. The review-time observation is 1,055 passing assertions, but implementation uses the value it actually observes.
    - Record `SKILL.md` UTF-8 bytes with `Buffer.byteLength`, and record the opening UTF-8 byte offset of the structurally qualifying resident Step 5 template fence. Do not use line or JavaScript-character counts as substitutes.
    - Preserve the commands and raw measurements for the final before/after comparison.
    - _Requirements: 1.1, 1.3, 1.4, 6.4-6.6, 7.4, 7.7_

- [x] 2. Add focused structural and trace contracts to `dev/test.mjs`
  - [x] 2.1 Implement Markdown, byte, template, ownership, and pointer validation
    - Add line-oriented section/fence parsing, UTF-8 conversion, Step 5 template discovery from semantic placeholder roles, direct-reference extraction, and one declarative step-owner/pointer map.
    - Add deterministic compliant and targeted-invalid fixtures for 35,000/35,001-byte boundaries, 20,000/20,001-byte template openings, decoy/incomplete fences, hot-path ordering, gate placement, owner uniqueness, direct pointers, and reference chains.
    - Add a harmless prose-rewording fixture that preserves structure and must pass. Do not identify the template from complete literal sentences.
    - Use stable contract IDs and diagnostics that report source, measured value/position, and missing role/edge.
    - _Requirements: 1.1-1.9, 5.2, 5.4, 5.5, 5.8, 6.1-6.8, 6.14, 6.15_

  - [x] 2.2 Implement reference-timing, no-reread, report-stop, and callable validators
    - Add a workflow-event validator that derives lane, selections, pre-report interval, successful/failed reads, closed gates, first output, report stop, project reads, writes, and calls from event order.
    - Cover the normal-path zero-reference rule; explicit no-reads for `SKILL.md`, `reporting.md`, and `investigating.md`; successful-reference reuse; failed/truncated retry; post-gate eligibility; and conflict selection before `conflicts.md`.
    - Parse structured route/call sites across `SKILL.md` and every existing reference, normalize namespaces/wrappers, and reject every concrete callable whose normalized name begins with `glab_mr_`. Permit the family token only in the structured deny declaration or non-operative test fixtures.
    - Add targeted fixtures for initial/post-report conflict selection, payload-only conflicts, premature/duplicate reads, pre-report project reads/writes/progress, same-turn calls after report emission, plain/namespaced/future forbidden callables, and complete bundled-fetch use.
    - Run `node dev/test.mjs`; fix only the new helpers/fixtures at this stage.
    - _Requirements: 2.1-2.9, 3.1-3.9, 4.1-4.6, 6.9-6.15_

- [x] 3. Compact the resident router and correct existing reference timing
  - [x] 3.1 Rewrite resident loading, lane selection, Steps 0-5, and the retrieval route
    - Make activation resident state, forbid explicit `SKILL.md` rereads, and keep a normal review-lane first report independent of references.
    - Keep review as the default lane and record conflict-first selection only from the user's words.
    - Keep the complete target validation, bundled-fetch route, completeness/fallback boundary, Jira identity/status path, classification rules, no-project-read/no-write boundary, and blocker behavior resident before Step 6.
    - Put the normal `fetch-mr.mjs --project --iid --instance` route immediately beside the `glab_mr_` deny declaration; keep every fallback repository-independent and conditional.
    - Install one complete Step 5 fenced template using stable semantic placeholder keys, with every required report role, exactly one closing question, blocker replacement, bare-go scope, and end-turn stop.
    - _Requirements: 1.2-1.5, 2.1-2.11, 3.1-3.5, 4.1-4.6, 5.1, 5.3-5.7_

  - [x] 3.2 Replace Steps 6-12 with bounded routing cards and retain Step 13
    - Give each post-report step explicit `eligible after`, `allowed scope`, `stop`, and direct `procedure` fields pointing to its unique existing owner.
    - Keep every gate and authorization boundary resident in the step where it applies; keep Step 13 resident, last, and terminal.
    - Keep `conflicts.md` unavailable until a recorded initial or post-report conflict-first selection, and permit Step 9 reuse only for a run that already made that selection.
    - Retain a direct compact index for every existing reference without creating a reference-to-reference chain.
    - _Requirements: 1.5-1.9, 3.3-3.9, 5.2-5.8_

  - [x] 3.3 Deduplicate or move only content required by the router reduction
    - Remove batch-1 and normative-template instructions from `reporting.md` and normal pre-report instructions from `investigating.md`; keep the complete normative template resident.
    - For each removed Step 6-12 procedure, first reuse an equivalent rule already in the correct owner; move text only when the owner is genuinely missing it. Do not broadly rewrite references that already satisfy ownership.
    - Keep historical material only in the existing evidence owners. Do not create a new reference or duplicate an owner.
    - Preserve every pre-existing working-tree edit recorded in Task 1.
    - Finish with `SKILL.md` at no more than 35,000 UTF-8 bytes and the qualifying Step 5 opening fence at no more than byte 20,000.
    - _Requirements: 1.1-1.9, 3.1-3.9, 5.1-5.8_

- [x] 4. Migrate brittle assertions and complete static validation
  - [x] 4.1 Replace only phrase checks that now have a structural signal
    - Replace line-count, template-location, ordering, pointer/ownership, reference-timing, and fixed-tool-name checks with the parsers/trace validators from Task 2.
    - Retain phrase checks for genuinely linguistic or tone requirements. For every removed assertion, document the equivalent or stricter structural replacement and keep a passing and failing fixture.
    - Keep all manifest/frontmatter, package layout, bundled-script, decision-module, GraphQL, transport, redaction, portability, Jira, publication, hunk-attribution, reference-size, and duplication coverage.
    - _Requirements: 5.1-5.8, 6.1-6.15, 7.1-7.3_

  - [x] 4.2 Run and record final static checks
    - Run `node dev/test.mjs` and require zero failures across retained and new contracts.
    - Re-measure exact UTF-8 router bytes and template opening offset with the same Task 1 definitions; require `<= 35,000` and `<= 20,000` respectively.
    - Compare `fetch-mr.mjs` and every protected production file with the Task 1 snapshot; any feature-caused change is a blocker.
    - Inspect the changed-file scope for Phase 2 routes, dependencies, hooks, caches, native HTTP, composite tooling, or runtime behavior; remove none of the user's pre-existing work while resolving scope.
    - _Requirements: 1.1-1.4, 4.7, 7.1-7.7, 9.1-9.5_

- [x] 5. Add a dev-only live-run analyzer, not a session launcher
  - [x] 5.1 Implement run-shape validation and summary output
    - Add a small Node-built-in analyzer (for example `dev/benchmark-first-report.mjs`) that accepts operator-captured run-shape records and never launches/warms sessions, stores credentials, or makes network calls.
    - Validate one set with exactly five cold and five warm attempts, fixed-condition equality, cohort setup evidence, complete reports, report stops, zero writes, no replacement attempts, and complete ordered Tool_Sequences.
    - Compute each median as sorted index two, select each cohort's slowest run deterministically, and preserve its complete sequence.
    - Emit JSON and concise Markdown only after timed runs have ended. Records must exclude source code, reviewer text, secrets, and payload bodies.
    - _Requirements: 8.1-8.15_

  - [x] 5.2 Add deterministic analyzer tests
    - Test valid 5/5 input, 4/6 or 6/4 input, failed attempts retained in ten, eleventh replacements, condition drift, write attempts, incomplete reports, Step 6/post-report events, tied and untied slowest runs, median calculation, full sequence retention, privacy-shape rejection, JSON, and Markdown rendering.
    - Keep live credentials and network access outside `node dev/test.mjs`.
    - _Requirements: 8.1-8.15_

- [ ] 6. Preflight one safe fixed live-validation set
  - [x] 6.1 Verify conditions and read-only enforcement before timing
    - Select one stable MR and a clean disposable checkout; record commit/remote, non-secret credential identities, hosts/network route, exact request hash, analyzer/write-classifier versions, and stopping rule.
    - Configure and verify a benchmark-only external boundary that denies checkout/branch mutation, file writes, Jira/GitLab writes, commits, pushes, local steering writes, and other mutations. Do not add a plugin hook or production behavior.
    - Verify the operational cold setup and warm setup. Warm priming may load only activation content; it may not load MR/Jira facts, references, or a prior report.
    - If read-only enforcement, isolated sessions, or warm-state evidence cannot be verified, stop before the first timed request and report live validation as blocked.
    - _Requirements: 8.3-8.5, 8.7, 8.14, 9.1-9.5_

- [ ] 7. Execute exactly five cold and five warm report-only attempts
  - [~] 7.1 Run one ten-attempt Benchmark_Set
    - Execute `cold-1` through `cold-5` and `warm-1` through `warm-5` under the fixed conditions. The order may be interleaved, but the set contains exactly five of each and exactly ten timed requests.
    - Start timing at request submission after any warm priming; stop at the visible complete First_Report. Send no go-ahead and allow no Step 6 event.
    - Capture latency, Tool_Sequence, report completeness, stop state, cohort setup evidence, and any blocked write for every attempt.
    - Keep failed attempts in the set. Do not replace one with an eleventh run. If conditions drift after timing starts, mark this set failed rather than restarting it in place.
    - _Requirements: 8.1-8.7, 8.11-8.13_

  - [~] 7.2 Analyze and publish the ten-attempt evidence
    - Run the analyzer on all ten records.
    - Report five individual values per cohort in execution order, each sorted list, each third-value median, and the complete Tool_Sequence for the slowest cold and warm attempts.
    - Identify every write attempt, incomplete report, report-stop violation, condition drift, or setup failure with run ID and latency.
    - Confirm result artifacts were written only after timed runs and contain no code, comments, secrets, credentials, or payload bodies.
    - _Requirements: 8.8-8.15_

- [ ] 8. Perform the final behavior, scope, and traceability audit
  - [~] 8.1 Close only when every required artifact and boundary is evidenced
    - Run `node dev/test.mjs` once more and record exact final bytes/offset.
    - Reconcile the final diff with the Task 1 Baseline_Snapshot, preserving pre-existing changes and proving `fetch-mr.mjs` plus protected production code are unchanged by this feature.
    - Verify every requirement group maps to a completed task and evidence artifact; identify any blocked live criterion rather than claiming completion.
    - Verify all Phase 2 mentions say `Deferred follow-up — not implemented` and no Phase 2 implementation is present.
    - _Requirements: 1.1-9.5_

## Dependencies

1. Task 1 blocks every edit.
2. Task 2 completes before Task 3 so the hard boundaries and timing regressions are executable before the move.
3. Task 3 completes before Task 4's final assertion migration and static gate.
4. Task 5 starts after Task 4 so analyzer tests do not compete with simultaneous edits to `dev/test.mjs`.
5. Tasks 4 and 5 both pass before Task 6.
6. Task 6 must pass before the first timed request in Task 7.
7. Task 8 follows the completed ten-attempt set; a blocked Task 6 or failed Benchmark_Set is reported, not bypassed.

## Notes

- Deterministic fixtures are sufficient; this feature does not require 15 custom property-test generators or a third-party property-testing dependency.
- The live analyzer audits records but cannot itself prove session isolation or enforce read-only behavior; those are explicit operator preconditions.
- Exactly ten means exactly ten timed attempts in one Benchmark_Set. Failures count, replacements do not exist, and a later retry is a separately identified set.
- No task authorizes production code changes. In particular, `fetch-mr.mjs`, decision modules, GraphQL normalization, transport behavior, hooks, and every Phase 2 item remain unchanged relative to the implementation-start baseline.