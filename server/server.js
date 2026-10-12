#!/usr/bin/env node
/**
 * mr-review-checks MCP server — transport only: JSON-RPC framing over stdio,
 * method dispatch, tool schemas. Decisions live in the pure sibling modules.
 *
 * The tools exist because three failures are about *noticing*, not deciding — a
 * field never read, a count stated approximately, a staged hunk glossed over.
 * A prose rule competes with 20,000 words for attention; a returned flag doesn't.
 *
 * Entry point referenced by mcp.json. Node built-ins only.
 */

import { triageMrPayload } from "./mr-payload.js";
import { reconcileDiscussionCounts } from "./discussions.js";
import { attributeStagedHunks } from "./hunks.js";
import { normalizeGraphqlMr } from "./graphql.js";

/**
 * Raw `.../discussions` response (ndjson lines or a JSON array) → array.
 *
 * Exists so the caller never rebuilds the payload by hand. That's how `resolvable`
 * got dropped on a real run: `resolvableThreads: 0` on an MR with eleven, no error,
 * because a missing field reads as `undefined` rather than as a mistake.
 */
function parseDiscussionsText(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new TypeError("discussions_text must be a non-empty string of ndjson lines or a JSON array");
  }

  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new TypeError("discussions_text parsed to a non-array");
    return parsed;
  }

  const out = [];
  for (const [i, line] of trimmed.split(/\r?\n/).entries()) {
    const l = line.trim();
    if (!l) continue;
    try {
      out.push(JSON.parse(l));
    } catch {
      // Name the line: the usual cause is a truncated response, and the caller
      // needs to continue from an offset rather than reconcile on the partial set.
      throw new TypeError(
        `discussions_text line ${i + 1} is not valid JSON — a truncated response ends this way;continue from an offset rather than reconciling on the partial set`,
      );
    }
  }
  return out;
}

/**
 * Node's `process`, typed locally because this power ships no `@types/node`.
 * Lists exactly what this file uses; widen when the usage widens.
 *
 * @type {{
 *   stdin: { setEncoding(encoding: string): void, on(event: string, listener: (chunk: string) => void): void },
 *   stdout: { write(chunk: string): boolean },
 *   exit(code?: number): never,
 * }}
 */
const proc = /** @type {any} */ (globalThis).process;

/**
 * An absolute path inside this power, derived from this file's own location.
 *
 * The run has no other way to learn it. Neither `kiro_powers activate` nor `readSkill`
 * returns an install path, and a measured run spent 60 seconds and nine directory
 * listings walking `~/.kiro` to guess where its own scripts were — 40% of that run,
 * before any GitLab call had been made.
 *
 * Computed, never stat'ed. This server touches no filesystem and that stays true, so a
 * returned path is where the file should be rather than proof that it is there.
 */
function powerPath(relative) {
  const p = decodeURIComponent(new URL(relative, import.meta.url).pathname);
  // On Windows `pathname` is `/C:/…`, where the leading slash is not part of the path.
  return /^\/[a-zA-Z]:/.test(p) ? p.slice(1) : p;
}

/**
 * Newest first. MCP requires negotiation, not a fixed version: echo a supported
 * request back, otherwise offer one we do speak and let the client decide.
 */
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const PREFERRED_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];
const FALLBACK_PROTOCOL_VERSION = "2024-11-05";

const SERVER_NAME = "mr-review-checks";
/**
 * Tracks the power's version in `plugin.json`, not its own release cadence. The server ships
 * only inside this power and is never installed separately, so two numbers would only ever
 * confuse a bug report — a tester reading "server 1.0.0" out of a handshake while the power
 * says 1.5.0 has to be told the two are unrelated. `server/package.json` and the assertions
 * in dev/test.mjs pin all three together so they cannot drift apart again.
 */
const SERVER_VERSION = "1.5.0";

function negotiateProtocolVersion(requested) {
  if (typeof requested !== "string" || requested.length === 0) return FALLBACK_PROTOCOL_VERSION;
  if (SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) return requested;
  return PREFERRED_PROTOCOL_VERSION;
}

/** Absolute path to one bundled script. */
function scriptPath(file) {
  return powerPath(`../skills/mr-resolve/scripts/${file}`);
}

/** A ready-to-run, space-safe command for one bundled script. */
function scriptCommand(file) {
  return `node "${scriptPath(file)}"`;
}

const TOOLS = [
  {
    name: "locate_bundled_scripts",
    // The paths are interpolated into the description on purpose, because a tool
    // description is delivered with the tool list — which the run already has before it
    // reads anything. Documenting the convention in prose was not enough three times
    // running: the run answered a written-down path with `file_search` plus
    // `list_directory` to verify it, because a convention is a claim and a path the
    // server computed from its own location is evidence. Now the evidence arrives
    // unprompted and the happy path costs no call at all.
    description:
      "Absolute paths to this power's bundled scripts, for running them from a working directory that is the user's repository rather than this power. " +
      `ON THIS INSTALL THEY ARE ALREADY RESOLVED, so you do not need to call this tool: fetch-mr.mjs is ${scriptCommand("fetch-mr.mjs")} and git-context.mjs is ${scriptCommand("git-context.mjs")}. ` +
      "Both strings are quoted for a path containing spaces and can be used verbatim as the start of a shell command. Run that command as one plain command: do not wrap it in `node -e`, `execSync`, or `bash -c` to reshape its output, because the nested quoting breaks on a Windows shell before the script ever runs. Do not verify them with `file_search` or `list_directory` first — run the command and let a missing-file error be the signal. " +
      "Call this tool only when one of those paths actually fails, which means a non-standard install. It takes no arguments and returns the same paths plus `powerRoot`.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "triage_mr_payload",
    description:
      "Reads a merge request payload and returns everything in it that changes what the run should do next. Call this immediately after fetching `.../merge_requests/{iid}` in Step 2, instead of eyeballing the response. Returns `blockers` (need an answer before continuing: wrong project, merged/closed/locked state, merge conflicts, zero comments), `flags` (say once and carry on: not-your-MR, no ticket key in the title, draft), `undetermined` (checks that could NOT be run because an input was missing — never treat these as passed), `facts` (iid, branches, state, note count, conflict fields, ticket key and commit type), and `proceed`. The wrong-project check compares host AND path, so the same project path on two different GitLab instances is a blocker rather than a match. Ticket keys are returned as `facts.ticketKeys` (every candidate in the title) plus `facts.ticketKey` (the one to use) and `facts.ticketKeyCorroborated` — true only when the source branch repeats it. An uncorroborated key lands in `undetermined`: it is a candidate, not a confirmed ticket, because a title can carry `UTF-8` or `IE-11` and those are not issues. The conflict check exists because a real run had `has_conflicts: true` in hand and never mentioned it until the user asked ten minutes later; the fields are read here whether or not anyone remembers they exist.",
    inputSchema: {
      type: "object",
      required: ["mr"],
      properties: {
        mr: {
          type: "object",
          description: "The parsed merge request JSON, unmodified.",
        },
        workspace_remote: {
          type: "string",
          description:
            "`git remote get-url origin` for the open workspace, for the wrong-project check. Omit it and that check is reported in `undetermined` rather than silently passing.",
        },
        current_user: {
          type: "string",
          description:
            "The username glab is authenticated as, for the ownership flag. Omit it and that check is reported in `undetermined`.",
        },
        current_branch: {
          type: "string",
          description:
            "`git branch --show-current` for the open workspace. Raises a `branch-mismatch` flag when it differs from the MR's source branch, so the report states the switch instead of guessing. Omit it and the check lands in `undetermined` — which never means 'already checked out'.",
        },
      },
    },
  },
  {
    name: "reconcile_discussion_counts",
    description:
      "Counts a merge request's discussions and reconciles them against the MR's own `user_notes_count`. Call this in Step 4 with the unfiltered `.../discussions` payload — filtering system notes is this tool's job. Returns `threadsTotal` (every discussion in the payload), `feedbackThreads` (those holding at least one non-system note — the number you triage and report), `notesTotal`, `systemNotes`, `reviewerNotes`, `ownNotes`, resolvable/resolved/unresolved thread counts, `reconciles` (true/false/null), `linkedNoteFound`, a ready-to-use `countLine`, `undetermined`, and a `reason` explaining a mismatch. `undetermined` is non-empty when `current_user` was omitted: without it your own prior replies cannot be separated from reviewer feedback, so `reviewerNotes` is inflated and `ownNotes` is 0 by default rather than by measurement. The `reason` distinguishes a shortfall (re-fetch, the page was not exhausted) from an excess (re-fetching cannot help), because they have different causes. Threads, notes and reviewer notes are three different numbers that get conflated when counted by eye, and `reconciles: null` means the check could not be performed — treat that as unknown, never as agreement.",
    inputSchema: {
      type: "object",
      properties: {
        discussions_text: {
          type: "string",
          description:
            "PREFERRED. The raw `.../discussions` response exactly as received — ndjson lines, or a single JSON array. Pass the text through unchanged; do not rebuild it as objects. Rebuilding is how `resolvable` got dropped on a real run, which silently reported 0 resolvable threads on an MR with 11.",
        },
        discussions: {
          type: "array",
          items: { type: "object" },
          description:
            "Parsed `.../discussions` entries, unfiltered, each with a `notes` array. Only needed when you have objects rather than the original text — prefer `discussions_text`.",
        },
        user_notes_count: {
          type: "number",
          description: "`user_notes_count` from the MR payload. Without it, `reconciles` comes back null.",
        },
        current_user: {
          type: "string",
          description: "Username to treat as your own prior replies, so they're excluded from the reviewer count.",
        },
        note_id_from_url: {
          type: "string",
          description: "A `note_id` from the pasted URL, if present, to confirm it appears in the full fetch.",
        },
      },
    },
  },
  {
    name: "triage_graphql_mr",
    description:
      "PREFERRED over triage_mr_payload + reconcile_discussion_counts when the MR was fetched with GraphQL. Does both jobs in one call from one payload: returns `triage` (blockers/flags/undetermined/facts/proceed, identical to triage_mr_payload) and `counts` (identical to reconcile_discussion_counts, including the ready-to-use `countLine`), plus `discussions` already normalized to the REST shape with `gid://` prefixes stripped — use those ids for Step 10's replies and resolves, they are the REST ids. Also returns `hasNextPage`: true means the discussion fetch was incomplete and means exactly what `reconciles: false` means — do not report on a partial set. One GraphQL call replaces two REST calls at 62% less context (measured: 10,578 chars vs 27,984) and cannot truncate, because field selection controls the size rather than trimming the response afterwards.",
    inputSchema: {
      type: "object",
      required: ["graphql"],
      properties: {
        graphql: {
          type: "object",
          description:
            "The GraphQL response, either the whole `{ data: { project: { mergeRequest } } }` envelope or the bare mergeRequest object. Send the query with `--raw-field`, not `--field` — the latter coerces the iid to a number and GraphQL rejects it.",
        },
        workspace_remote: {
          type: "string",
          description:
            "`git remote get-url origin` for the open workspace, for the wrong-project check. Omit it and that check lands in `undetermined` rather than silently passing.",
        },
        current_user: {
          type: "string",
          description:
            "The username glab is authenticated as. Feeds both the ownership flag and the exclusion of your own prior replies from the reviewer count. Omit it and both degrade silently.",
        },
        current_branch: {
          type: "string",
          description:
            "`git branch --show-current` for the open workspace. Raises a `branch-mismatch` flag when it differs from the MR's source branch, so the report states the switch instead of guessing. Omit it and the check lands in `undetermined` — which never means 'already checked out'.",
        },
        note_id_from_url: {
          type: "string",
          description: "The `#note_` fragment from the pasted URL, if any, so `linkedNoteFound` can be checked.",
        },
      },
    },
  },
  {
    name: "attribute_staged_hunks",
    description:
      "Parses `git diff --cached` and enumerates every staged hunk with its line counts, so none is glossed over before the Step 8 gate. Returns `totals` and a `numstat` string (`+X / -Y`) that must be used instead of recalled numbers, `unexplainedFiles` (staged files with no approved change, no formatter report and no conflict resolution — unambiguous, must be raised with the user), `needsJudgement` (every hunk in a file that does have a basis, listed individually), `resolutionFiles` and `mixedFiles` (files carrying a conflict resolution, and those carrying a resolution AND a review fix — split those into separate commits), plus binary, renamed and `combinedFiles`. A path in `combinedFiles` came back as a combined diff, which means git still treats it as unmerged: its counts are read from the marker columns and are approximate, so finish the merge and re-read before quoting them at a gate. A path git could not be parsed out of is reported as `<unresolved path>` and has no basis, so it surfaces as unexplained rather than being folded into the previous file. IMPORTANT LIMIT: this cannot tell you whose hunk is whose inside a file you legitimately edited — that is the main failure case and it needs judgement plus usually asking the user. The tool makes that judgement unavoidable by listing each hunk separately; it does not replace it. Only pass a file in `formatter_files` if a formatter's own output named it.",
    inputSchema: {
      type: "object",
      required: ["diff_text"],
      properties: {
        diff_text: {
          type: "string",
          description: "Raw `git diff --cached` output.",
        },
        approved_files: {
          type: "array",
          items: { type: "string" },
          description: "Files this run was approved to change (carrying a fix for an approved review comment).",
        },
        formatter_files: {
          type: "array",
          items: { type: "string" },
          description:
            "Files a formatter REPORTED changing. A formatter you assume ran is not evidence — include only what the tool's own output named.",
        },
        conflict_files: {
          type: "array",
          items: { type: "string" },
          description:
            "Files changed while resolving an approved merge conflict. Keep these OUT of approved_files: a review fix traces to a reviewer's comment, a resolution traces to two branches touching the same lines, and merging the two lets resolution hunks inherit a review comment's approval silently.",
        },
      },
    },
  },
];

function send(msg) {
  proc.stdout.write(JSON.stringify(msg) + "\n");
}

function ok(id, value) {
  send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] } });
}

function toolError(id, message) {
  // Bad input must be visible: a result returned anyway is a guess dressed as
  // a computation.
  send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: message }], isError: true } });
}

/**
 * Tool name → pure function from `arguments` to a result. A table rather than an
 * `if` chain: the fourth tool pushed `handleRequest` past the linter's cognitive
 * complexity limit of 15. Handlers throw on bad input; `handleRequest` converts
 * that to an explicit tool error.
 */
const TOOL_HANDLERS = {
  locate_bundled_scripts: () => {
    // The quoting is part of the answer: the default install path contains the user's
    // name, which frequently contains a space.
    const script = (file) => ({ path: scriptPath(file), run: scriptCommand(file) });
    return {
      powerRoot: powerPath("../"),
      scriptsDir: powerPath("../skills/mr-resolve/scripts/"),
      scripts: { "fetch-mr.mjs": script("fetch-mr.mjs"), "git-context.mjs": script("git-context.mjs") },
      note: "Computed from this server's own module location, not verified against the filesystem. Forward slashes work on every platform Node runs on, including Windows.",
    };
  },

  triage_mr_payload: (args) =>
    triageMrPayload({
      mr: args.mr,
      workspaceRemote: args.workspace_remote,
      currentUser: args.current_user,
      currentBranch: args.current_branch,
      dirty: args.dirty,
      dirtyFiles: args.dirty_files,
    }),

  reconcile_discussion_counts: (args) =>
    reconcileDiscussionCounts({
      // `discussions_text` wins when both arrive: it can't have lost a field.
      discussions: args.discussions_text !== undefined ? parseDiscussionsText(args.discussions_text) : args.discussions,
      userNotesCount: args.user_notes_count,
      currentUser: args.current_user,
      noteIdFromUrl: args.note_id_from_url,
    }),

  triage_graphql_mr: (args) => {
    const { mr, discussions, hasNextPage, endCursor } = normalizeGraphqlMr(args.graphql);
    return {
      triage: triageMrPayload({
        mr,
        workspaceRemote: args.workspace_remote,
        currentUser: args.current_user,
        currentBranch: args.current_branch,
        dirty: args.dirty,
        dirtyFiles: args.dirty_files,
      }),
      counts: reconcileDiscussionCounts({
        discussions,
        userNotesCount: mr.user_notes_count,
        currentUser: args.current_user,
        noteIdFromUrl: args.note_id_from_url,
      }),
      discussions,
      hasNextPage,
      endCursor,
    };
  },

  attribute_staged_hunks: (args) =>
    attributeStagedHunks({
      diffText: args.diff_text,
      approvedFiles: args.approved_files ?? [],
      formatterFiles: args.formatter_files ?? [],
      conflictFiles: args.conflict_files ?? [],
    }),
};

function handleRequest(req) {
  const { id, method, params } = req;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: negotiateProtocolVersion(params?.protocolVersion),
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
    });
    return;
  }

  if (typeof method === "string" && method.startsWith("notifications/")) return;

  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }

  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const args = params?.arguments || {};

    const handler = TOOL_HANDLERS[toolName];
    if (handler) {
      try {
        return ok(id, handler(args));
      } catch (err) {
        return toolError(id, `${toolName} failed: ${err.message}`);
      }
    }

    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${toolName}` } });
    return;
  }

  if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } });
  }
}

let buffer = "";
proc.stdin.setEncoding("utf8");
proc.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newlineIndex;
  while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // ignore malformed lines
    }
    try {
      handleRequest(msg);
    } catch (err) {
      if (msg?.id !== undefined) {
        send({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: `Internal error: ${err.message}` } });
      }
    }
  }
});

proc.stdin.on("end", () => proc.exit(0));
