# Steps 1–4 exceptional and fallback evidence

The resident router owns the normal review-lane hot path through the first report: target validation, default lane selection, bundled retrieval, completeness checks, Jira identity/status reads, discussion classification, and the report stop. This file is not a normal pre-report dependency. Read it only when an exceptional diagnostic, an unresolved fallback, or a maintainer investigation requires the detail below.

## The three fallback traps

These details remain here because they explain recovery on paths that the bundled result does not cover:

1. **`--raw-field`, never `--field`.** `--field iid=508` coerces the value to a number while GraphQL expects a string. The bundled script already uses the safe form.
2. **Strip GraphQL global-ID prefixes before REST discussion operations.** Values such as `gid://gitlab/Discussion/...` and `gid://gitlab/Note/...` must become the bare REST IDs. Use normalized discussions returned by the existing normalizer rather than raw GraphQL nodes.
3. **Do not rebuild a discussions payload for a fallback decision call.** On REST, pass `discussions_text` unchanged so fields such as `resolvable`, note IDs, and resolution state cannot be lost during hand conversion.

## Explicit fallback procedure

The bundled `fetch-mr.mjs` route is authoritative for the supported normal path. If it cannot return a complete supported result, the router must record the failure and the user must explicitly select a repository-independent fallback. A fallback is not a silent downgrade.

On the REST fallback, request the merge request resource and every discussion page with the existing encoded project path, `output: "ndjson"` where the endpoint returns a collection, `per_page=100`, and pagination enabled. Preserve the raw discussion response for reconciliation. A truncated response is incomplete: continue from the known pagination point or report the uncovered retrieval failure; do not triage a partial set.

Run the existing decision modules on the unmodified fallback payload: `triage_mr_payload` for blockers and flags, then `reconcile_discussion_counts` with the unchanged discussion text. Treat `reconciles: null` as unknown, not success. A false reconciliation, missing linked note, unsupported payload state, or missing page is a blocker until corrected. Never hand-tally threads or replace missing fields with guessed values.

## Exceptional identity and mismatch handling

If title, source branch, description links, or linked issues disagree about the Jira key or hostname, do not issue Jira reads against a guess. Record each candidate and ask the user to identify the one `(hostname, ticket key)` pair. If no key exists, stop for the separate/manual review workflow. Use the Atlassian resource `id` as `cloudId`, never its display name.

If a named mismatch verdict fires and the resident rule does not provide enough wording, load `user-mistakes.md` after that event. If the user explicitly selects conflict-first, record the selection before loading `conflicts.md`; payload conflict state alone never qualifies. The normal review lane leaves both references unloaded.

## Classification boundary

Discussion classification is based on comment text and the normalized payload, not project files. The normal report may include reviewer wording, positions, and one classification per unresolved thread; it must not claim a verified fix, current code state, or proposed diff before Step 6. Resolved discussions remain count-only and are not presented as code-verified.

## Evidence retained for maintainers

The previous full procedure recorded profile values, fetch fields, reconciliation rules, and classification examples. Those details are preserved in the bundled script, decision modules, and the existing evidence references rather than duplicated here. This file is intentionally limited to exceptional and fallback handling so a normal first-report run does not need to load it.
