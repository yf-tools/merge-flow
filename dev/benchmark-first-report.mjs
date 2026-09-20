#!/usr/bin/env node
/**
 * Offline analyzer for operator-captured first-report benchmark records.
 *
 * This file deliberately does not import a session runner, an SDK, or a network
 * client. It only reads a completed record file and writes derived evidence.
 *
 * Input schema (JSON):
 * {
 *   "benchmarkSetId": "set-1",
 *   "fixedConditions": { "requestHash": "...", "checkerVersion": "..." },
 *   "readOnlyEnforcement": { "verified": true, "version": "..." },
 *   "runs": [{
 *     "id": "cold-1", "cohort": "cold", "latencyMs": 123,
 *     "timedRunEnded": true, "replacementAttempt": false,
 *     "fixedConditions": { ... },
 *     "setup": { "isolatedSession": true, "activationPrimed": false,
 *       "factsPrimed": false, "referencesPrimed": false, "reportPrimed": false },
 *     "report": { "complete": true, "emitted": true },
 *     "stop": { "beforeStep6": true, "noSubsequentToolCall": true },
 *     "writes": [], "toolSequenceComplete": true,
 *     "toolSequence": [{ "name": "...", "classification": "read" }]
 *   }]
 * }
 *
 * Run with:
 *   node dev/benchmark-first-report.mjs records.json --json out.json --markdown out.md
 *   node dev/benchmark-first-report.mjs records.json --format markdown
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const proc = globalThis.process;

const REQUIRED_SETUP_KEYS = [
  "isolatedSession",
  "activationPrimed",
  "factsPrimed",
  "referencesPrimed",
  "reportPrimed",
];
const FORBIDDEN_PRIVACY_KEYS = new Set([
  "source",
  "sourceCode",
  "code",
  "reviewerText",
  "reviewerComment",
  "commentText",
  "secret",
  "secrets",
  "credential",
  "credentials",
  "token",
  "password",
  "payload",
  "payloadBody",
  "body",
]);
const SAFE_TOOL_KEY = /^(name|classification|mutation|kind|index|repeat)$/;
const SAFE_CONDITION_KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function addDiagnostic(diagnostics, code, message, runId) {
  diagnostics.push({ code, ...(runId ? { runId } : {}), message });
}

function scanPrivacy(value, path, diagnostics, seen = new Set()) {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) {
    addDiagnostic(diagnostics, "privacy.cycle", `cyclic value at ${path}`);
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanPrivacy(item, `${path}[${index}]`, diagnostics, seen));
  } else {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_PRIVACY_KEYS.has(key) || /(source|comment|secret|credential|token|password|payload|reviewer|body)/i.test(key)) {
        addDiagnostic(diagnostics, "privacy.forbidden-field", `forbidden privacy field ${path}.${key}`);
      }
      scanPrivacy(child, `${path}.${key}`, diagnostics, seen);
    }
  }
  seen.delete(value);
}

function validateToolSequence(run, diagnostics) {
  if (run.toolSequenceComplete !== true) addDiagnostic(diagnostics, "run.tool-sequence", "toolSequenceComplete must be true", run.id);
  if (!Array.isArray(run.toolSequence) || run.toolSequence.length === 0) {
    addDiagnostic(diagnostics, "run.tool-sequence", "Tool_Sequence must be a non-empty ordered array", run.id);
    return;
  }
  run.toolSequence.forEach((event, index) => {
    if (!isRecord(event)) {
      addDiagnostic(diagnostics, "run.tool-sequence", `Tool_Sequence item ${index} is not an object`, run.id);
      return;
    }
    if (typeof event.name !== "string" || event.name.length === 0) {
      addDiagnostic(diagnostics, "run.tool-sequence", `Tool_Sequence item ${index} has no tool name`, run.id);
    }
    for (const key of Object.keys(event)) {
      if (!SAFE_TOOL_KEY.test(key)) addDiagnostic(diagnostics, "privacy.tool-sequence-field", `unsupported Tool_Sequence field ${key}`, run.id);
    }
    if (event.classification === "write" || event.mutation === "write" || event.kind === "write") {
      addDiagnostic(diagnostics, "run.write", "Tool_Sequence contains a write operation", run.id);
    }
  });
}

function validateSetup(run, diagnostics) {
  if (!isRecord(run.setup)) {
    addDiagnostic(diagnostics, "setup.missing", "cohort setup evidence is required", run.id);
    return;
  }
  for (const key of REQUIRED_SETUP_KEYS) {
    if (typeof run.setup[key] !== "boolean") addDiagnostic(diagnostics, "setup.evidence", `setup.${key} must be boolean`, run.id);
  }
  if (run.setup.isolatedSession !== true) addDiagnostic(diagnostics, "setup.isolation", "run was not captured in an isolated session", run.id);
  if (run.cohort === "cold" && run.setup.activationPrimed !== false) addDiagnostic(diagnostics, "setup.cold", "cold run must not prime activation content", run.id);
  if (run.cohort === "warm" && run.setup.activationPrimed !== true) addDiagnostic(diagnostics, "setup.warm", "warm run must prime activation content", run.id);
  for (const key of ["factsPrimed", "referencesPrimed", "reportPrimed"]) {
    if (run.setup[key] !== false) addDiagnostic(diagnostics, "setup.priming", `setup.${key} must be false`, run.id);
  }
}

/** Validate one run but do not discard it from the set when it fails. */
export function validateRunShape(run, expectedConditions) {
  const diagnostics = [];
  if (!isRecord(run)) {
    addDiagnostic(diagnostics, "run.shape", "run must be an object");
    return diagnostics;
  }
  const runId = typeof run.id === "string" ? run.id : undefined;
  if (!runId) addDiagnostic(diagnostics, "run.id", "run id is required");
  if (run.cohort !== "cold" && run.cohort !== "warm") addDiagnostic(diagnostics, "run.cohort", "cohort must be cold or warm", runId);
  if (!isFiniteNumber(run.latencyMs) || run.latencyMs < 0) addDiagnostic(diagnostics, "run.latency", "latencyMs must be a finite non-negative number", runId);
  if (run.timedRunEnded !== true) addDiagnostic(diagnostics, "run.timing", "timedRunEnded must be true before analysis output", runId);
  if (run.replacementAttempt !== false) addDiagnostic(diagnostics, "run.replacement", "replacementAttempt must be explicitly false", runId);
  if (!isRecord(run.fixedConditions) || stableJson(run.fixedConditions) !== stableJson(expectedConditions)) addDiagnostic(diagnostics, "conditions.drift", "run fixed conditions differ from the set conditions", runId);
  validateSetup(run, diagnostics);
  if (!isRecord(run.report) || run.report.complete !== true || run.report.emitted !== true) addDiagnostic(diagnostics, "report.incomplete", "run must emit a complete First_Report", runId);
  if (!isRecord(run.stop) || run.stop.beforeStep6 !== true || run.stop.noSubsequentToolCall !== true) addDiagnostic(diagnostics, "report.stop", "run must stop before Step 6 with no subsequent tool call", runId);
  if (!Array.isArray(run.writes) || run.writes.length !== 0) addDiagnostic(diagnostics, "run.write", "writes must be an empty array", runId);
  validateToolSequence(run, diagnostics);
  return diagnostics;
}

function cohortSummary(runs) {
  const latencies = runs.map((run) => run.latencyMs);
  const sortedLatencies = [...latencies].sort((a, b) => a - b);
  const slowest = runs.reduce((best, run) => {
    if (!best || run.latencyMs > best.latencyMs || (run.latencyMs === best.latencyMs && String(run.id) < String(best.id))) return run;
    return best;
  }, null);
  return {
    runIds: runs.map((run) => run.id),
    latenciesMs: latencies,
    sortedLatenciesMs: sortedLatencies,
    medianMs: sortedLatencies[2],
    slowestRunId: slowest?.id,
    slowestLatencyMs: slowest?.latencyMs,
    slowestToolSequence: slowest?.toolSequence,
  };
}

/**
 * Validate and summarize one ten-attempt Benchmark_Set. Failed attempts remain
 * in `runs` and are reported in `failures`; no replacement is inferred.
 */
export function summarizeBenchmark(input) {
  const diagnostics = [];
  if (!isRecord(input)) throw new Error("benchmark input must be a JSON object");
  scanPrivacy(input, "$", diagnostics);
  const runs = Array.isArray(input.runs) ? input.runs : [];
  if (runs.length !== 10) addDiagnostic(diagnostics, "set.attempt-count", `Benchmark_Set must contain exactly 10 attempts; received ${runs.length}`);
  if (!isRecord(input.fixedConditions)) addDiagnostic(diagnostics, "conditions.missing", "fixedConditions must be an object");
  const readOnly = input.readOnlyEnforcement;
  if (!isRecord(readOnly) || readOnly.verified !== true) addDiagnostic(diagnostics, "safety.read-only", "read-only enforcement must be verified before timing");
  const ids = runs.map((run) => run?.id).filter((id) => typeof id === "string");
  if (new Set(ids).size !== ids.length) addDiagnostic(diagnostics, "set.duplicate-id", "run IDs must be unique");
  const cold = runs.filter((run) => run?.cohort === "cold");
  const warm = runs.filter((run) => run?.cohort === "warm");
  if (cold.length !== 5) addDiagnostic(diagnostics, "set.cold-count", `Cold_Cohort must contain exactly 5 attempts; received ${cold.length}`);
  if (warm.length !== 5) addDiagnostic(diagnostics, "set.warm-count", `Warm_Cohort must contain exactly 5 attempts; received ${warm.length}`);
  runs.forEach((run) => validateRunShape(run, input.fixedConditions ?? {}).forEach((diagnostic) => diagnostics.push(diagnostic)));
  const failures = diagnostics.filter((diagnostic) => diagnostic.runId).map((diagnostic) => ({ runId: diagnostic.runId, code: diagnostic.code, message: diagnostic.message, latencyMs: runs.find((run) => run?.id === diagnostic.runId)?.latencyMs, toolSequence: runs.find((run) => run?.id === diagnostic.runId)?.toolSequence }));
  const result = {
    benchmarkSetId: input.benchmarkSetId ?? null,
    valid: diagnostics.length === 0,
    diagnostics,
    fixedConditions: input.fixedConditions ?? null,
    readOnlyEnforcement: { verified: readOnly?.verified === true, version: readOnly?.version ?? null },
    attempts: runs.length,
    cohorts: { cold: cohortSummary(cold), warm: cohortSummary(warm) },
    failures,
  };
  return result;
}

function sequenceLines(sequence) {
  return sequence.map((event, index) => `${index + 1}. ${event.name}${event.classification ? ` [${event.classification}]` : ""}`).join("\n");
}

export function renderMarkdown(summary) {
  const lines = [
    `# First-report benchmark ${summary.benchmarkSetId ?? "(unnamed)"}`,
    "",
    `Status: **${summary.valid ? "PASS" : "FAIL"}**  `,
    `Attempts: ${summary.attempts} (5 cold / 5 warm)  `,
    `Read-only enforcement: ${summary.readOnlyEnforcement.verified ? "verified" : "NOT VERIFIED"}`,
    "",
  ];
  for (const cohort of ["cold", "warm"]) {
    const data = summary.cohorts[cohort];
    lines.push(`## ${cohort[0].toUpperCase() + cohort.slice(1)} cohort`, "", "| Run | Latency (ms) |", "| --- | ---: |");
    data.runIds.forEach((id, index) => lines.push(`| ${id} | ${data.latenciesMs[index] ?? "—"} |`));
    lines.push("", `Sorted: ${data.sortedLatenciesMs.join(", ")}`, `Median (third sorted value): **${data.medianMs ?? "—"} ms**`, `Slowest: **${data.slowestRunId ?? "—"}** (${data.slowestLatencyMs ?? "—"} ms)`, "", "Complete Tool_Sequence for slowest run:", "", "```text", ...(data.slowestToolSequence ? [sequenceLines(data.slowestToolSequence)] : ["—"]), "```", "");
  }
  lines.push("## Failures", "");
  if (summary.failures.length === 0) lines.push("None.");
  else for (const failure of summary.failures) lines.push(`- **${failure.runId}** (${failure.latencyMs ?? "—"} ms): ${failure.code} — ${failure.message}\n  Tool_Sequence: ${failure.toolSequence?.map((event) => event.name).join(" → ") ?? "—"}`);
  return lines.join("\n");
}

function usage() {
  proc.stderr.write("Usage: node dev/benchmark-first-report.mjs <records.json|-> [--json <file>] [--markdown <file>] [--format json|markdown|both]\n");
}

export function main(argv = proc.argv.slice(2)) {
  const inputPath = argv.find((arg) => !arg.startsWith("--"));
  if (!inputPath) { usage(); return 2; }
  const value = inputPath === "-" ? JSON.parse(readFileSync(0, "utf8")) : JSON.parse(readFileSync(resolve(inputPath), "utf8"));
  const summary = summarizeBenchmark(value);
  const markdown = renderMarkdown(summary);
  const jsonOption = argv.indexOf("--json");
  const markdownOption = argv.indexOf("--markdown");
  const jsonPath = jsonOption >= 0 ? argv[jsonOption + 1] : undefined;
  const markdownPath = markdownOption >= 0 ? argv[markdownOption + 1] : undefined;
  const formatIndex = argv.indexOf("--format");
  const format = formatIndex >= 0 ? argv[formatIndex + 1] : (jsonPath || markdownPath ? "none" : "both");
  if (!["none", "json", "markdown", "both"].includes(format)) throw new Error("--format must be json, markdown, or both");
  if (jsonPath || format === "json" || format === "both") {
    const output = JSON.stringify(summary, null, 2) + "\n";
    if (jsonPath) writeFileSync(resolve(jsonPath), output, "utf8"); else proc.stdout.write(output);
  }
  if (markdownPath || format === "markdown" || format === "both") {
    if (markdownPath) writeFileSync(resolve(markdownPath), `${markdown}\n`, "utf8"); else proc.stdout.write(`${markdown}\n`);
  }
  return summary.valid ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { proc.exitCode = main(); } catch (error) { proc.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); proc.exitCode = 2; }
}
