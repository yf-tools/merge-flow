/**
 * Staged-hunk enumeration and attribution — pure analysis layer.
 *
 * `git add file.ts` stages *everything* uncommitted in that file, and
 * `git status --short` shows ` M file.ts` either way — so a run editing a file the
 * user is also editing commits their unrelated work. Only `git diff --cached`,
 * hunk by hunk, catches that.
 *
 * What it cannot do: tell whose hunk is whose inside a file you legitimately
 * edited. That's the main case and it needs judgement. Returning each hunk as a
 * separate item in `needsJudgement` makes that judgement unavoidable rather than
 * replacing it — "the diff looks right" stops being an available answer.
 */

/**
 * The `@` run gives the parent count, so `@@` is an ordinary diff and `@@@` a combined
 * one from an unmerged path. Content lines carry one marker column per parent, which is
 * `@`-count minus one. Matching only `@@` used to leave a conflicted file with zero
 * hunks while it still counted as basis-explained, so no per-hunk verdict was asked for.
 */
const HUNK_HEADER = /^(@{2,8}) ((?:-\d+(?:,\d+)? )+)(\+\d+(?:,\d+)?) \1(.*)$/;

/** Both sides quoted, which is how git emits a path needing escapes. */
const QUOTED_PAIR = /^("(?:[^"\\]|\\.)*") ("(?:[^"\\]|\\.)*")$/;

/** The plain `a/x b/x` form. Lazy on the left so the split lands on ` b/`. */
const PLAIN_PAIR = /^a\/(.+?) b\/(.+)$/;

/** A path may arrive as `a/x`, `b/x`, or bare. */
const stripSide = (p) => (p.startsWith("a/") || p.startsWith("b/") ? p.slice(2) : p);

/**
 * Undo git's C-style path quoting: `"caf\303\251.ts"` → `café.ts`.
 *
 * The octal escapes are UTF-8 *bytes*, so decoding them one character at a time
 * produces mojibake and the path then matches nothing the caller passed in. Routing
 * through percent-encoding gets the multi-byte decode for free and needs no Node
 * globals, which `TextDecoder` and `Buffer` would both cost us here.
 */
function unquoteGitPath(raw) {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const body = raw.slice(1, -1);
  const literal = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\" };

  let percent = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") {
      percent += encodeURIComponent(body[i]);
      continue;
    }
    const next = body[i + 1] ?? "";
    if (Object.hasOwn(literal, next)) {
      percent += encodeURIComponent(literal[next]);
      i += 1;
      continue;
    }
    const octal = body.slice(i + 1, i + 4);
    if (/^[0-7]{3}$/.test(octal)) {
      percent += `%${Number.parseInt(octal, 8).toString(16).padStart(2, "0")}`;
      i += 3;
      continue;
    }
    percent += encodeURIComponent("\\");
  }

  try {
    return decodeURIComponent(percent);
  } catch {
    return body;
  }
}

/** `a/x b/x` or `"a/x" "b/x"` → the two paths, or null when neither form fits. */
function splitDiffPaths(rest) {
  const quoted = new RegExp(QUOTED_PAIR).exec(rest);
  if (quoted) return { oldPath: stripSide(unquoteGitPath(quoted[1])), newPath: stripSide(unquoteGitPath(quoted[2])) };

  const plain = new RegExp(PLAIN_PAIR).exec(rest);
  if (plain) return { oldPath: plain[1], newPath: plain[2] };

  return null;
}

function finishHunk(state) {
  if (state.file && state.hunk) state.file.hunks.push(state.hunk);
  state.hunk = null;
}

function finishFile(state) {
  finishHunk(state);
  if (state.file) {
    const f = state.file;
    // Deferred to here because `---`/`+++` may have filled a path the header couldn't.
    f.renamed = f.oldPath !== null && f.path !== null && f.oldPath !== f.path;
    state.files.push(f);
  }
  state.file = null;
}

/**
 * `diff --git ...` always starts a new file, even when neither path form parses.
 *
 * The old version only started one when the regex matched, so an unparseable header
 * left the previous file current and the following `@@` opened a hunk *on it* —
 * absorbing a foreign staged file's lines into an approved change and reporting
 * `allFilesExplained: true`. Starting the file regardless fails safe instead: an
 * unresolved path matches no basis, so it surfaces as unexplained.
 */
function tryStartFile(raw, state) {
  if (!raw.startsWith("diff --git ")) return false;

  finishFile(state);
  const paths = splitDiffPaths(raw.slice("diff --git ".length).trim());
  state.file = {
    path: paths?.newPath ?? null,
    oldPath: paths?.oldPath ?? null,
    binary: false,
    renamed: false,
    combined: false,
    hunks: [],
  };
  return true;
}

/**
 * `--- a/x` and `+++ b/x`, which only appear before a file's first hunk. Consuming
 * them here rather than filtering them inside a hunk is the fix for content lines
 * that legitimately start with `---` or `+++`, as markdown and YAML front matter do.
 * They also recover a path the `diff --git` line couldn't give us.
 */
function tryFileHeaderPath(raw, state) {
  if (state.hunk) return false;
  if (!raw.startsWith("--- ") && !raw.startsWith("+++ ")) return false;

  const value = raw.slice(4).trim();
  if (value === "/dev/null") return true;

  const path = stripSide(unquoteGitPath(value));
  if (raw.startsWith("+++ ")) state.file.path ??= path;
  else state.file.oldPath ??= path;
  return true;
}

/** `Binary files ...` / `GIT binary patch` — marks the current file. */
function tryMarkBinary(raw, state) {
  if (!raw.startsWith("Binary files ") && !raw.startsWith("GIT binary patch")) return false;
  state.file.binary = true;
  return true;
}

function tryStartHunk(raw, state) {
  const hh = new RegExp(HUNK_HEADER).exec(raw);
  if (!hh) return false;

  finishHunk(state);
  const columns = hh[1].length - 1;
  if (columns > 1) state.file.combined = true;

  state.hunk = {
    header: `${hh[1]} ${hh[2]}${hh[3]} ${hh[1]}`,
    context: (hh[4] || "").trim(),
    oldStart: Number(new RegExp(/-(\d+)/).exec(hh[2])?.[1] ?? 0),
    newStart: Number(new RegExp(/\+(\d+)/).exec(hh[3])?.[1] ?? 0),
    columns,
    added: 0,
    removed: 0,
  };
  return true;
}

/**
 * A content line inside the current hunk. Only the leading marker columns are read,
 * so nothing about the rest of the line can be mistaken for a header, and a combined
 * diff's extra column is handled by the same arithmetic.
 */
function applyContentLine(raw, state) {
  if (!state.hunk) return;
  const marks = raw.slice(0, state.hunk.columns);
  if (marks.includes("+")) state.hunk.added++;
  else if (marks.includes("-")) state.hunk.removed++;
}

/**
 * `git diff --cached` → files and hunks with line counts. Renames, binary files and
 * combined diffs are recorded rather than dropped: anything undiffable is exactly what
 * should surface.
 *
 * A state machine over the diff's lines; the `try*` functions are its states, each
 * reporting whether it matched, which keeps this loop flat.
 */
export function parseStagedDiff(diffText) {
  if (typeof diffText !== "string") throw new Error("diffText must be a string");

  const state = { files: [], file: null, hunk: null };

  for (const raw of diffText.split(/\r?\n/)) {
    if (tryStartFile(raw, state)) continue;
    if (!state.file) continue;
    if (tryFileHeaderPath(raw, state)) continue;
    if (tryMarkBinary(raw, state)) continue;
    if (tryStartHunk(raw, state)) continue;
    applyContentLine(raw, state);
  }
  finishFile(state);

  return state.files;
}

/** A file whose path neither header form yielded. It matches no basis, by design. */
const UNRESOLVED_PATH = "<unresolved path>";

const norm = (p) =>
  p === null || p === undefined ? UNRESOLVED_PATH : String(p).replaceAll("\\", "/").replace(/^\.\//, "");

/**
 * Fold one parsed file into `acc`, mutating it. `sets` is an object rather than
 * three positionals so a fourth basis doesn't reorder existing call sites.
 *
 * @param {object} f One entry from `parseStagedDiff`.
 * @param {{approved: Set<string>, formatted: Set<string>, resolved: Set<string>}} sets
 * @param {object} acc
 */
function foldFile(f, sets, acc) {
  const p = norm(f.path);
  const basis = [];
  if (sets.approved.has(p)) basis.push("approved-change");
  if (sets.formatted.has(p)) basis.push("formatter-reported");
  if (sets.resolved.has(p)) basis.push("conflict-resolution");

  if (f.binary) acc.binaryFiles.push(p);
  if (f.combined) acc.combinedFiles.push(p);
  if (f.renamed) acc.renamedFiles.push({ from: norm(f.oldPath), to: p });

  const fileAdded = f.hunks.reduce((n, h) => n + h.added, 0);
  const fileRemoved = f.hunks.reduce((n, h) => n + h.removed, 0);
  acc.added += fileAdded;
  acc.removed += fileRemoved;
  acc.hunkCount += f.hunks.length;

  if (basis.length === 0) {
    acc.unexplainedFiles.push(p);
  } else {
    for (const h of f.hunks) {
      acc.needsJudgement.push({
        path: p,
        header: h.header,
        context: h.context,
        added: h.added,
        removed: h.removed,
        basis,
      });
    }
  }

  acc.files.push({
    path: p,
    basis,
    binary: f.binary,
    renamed: f.renamed,
    combined: f.combined,
    added: fileAdded,
    removed: fileRemoved,
    hunks: f.hunks,
  });
}

/** The prose `reason` field, one sentence per category of thing found. */
function buildAttributionReason({ unexplainedFiles, needsJudgement, binaryFiles, resolutionFiles, combinedFiles }) {
  const reasons = [];
  if (unexplainedFiles.length) {
    reasons.push(
      `${unexplainedFiles.length} staged file(s) have no approved change, no formatter report and no conflict resolution: ${unexplainedFiles.join(", ")}. Ask whose these are before committing; never attribute them to a formatter that didn't say it touched them.`,
    );
  }
  if (needsJudgement.length) {
    reasons.push(
      `${needsJudgement.length} hunk(s) sit in files with a legitimate basis. File-level basis does not prove line-level authorship — a parallel edit in a file you also changed looks identical here. Account for each hunk individually.`,
    );
  }
  if (binaryFiles.length) reasons.push(`Binary file(s) staged, not reviewable as a diff: ${binaryFiles.join(", ")}.`);
  if (combinedFiles.length) {
    reasons.push(
      `${combinedFiles.length} file(s) are staged as a combined diff, which means git still considers them unmerged: ${combinedFiles.join(", ")}. The per-line counts for these come from the marker columns and are approximate — finish the merge and re-read the diff before trusting them at a gate.`,
    );
  }
  if (resolutionFiles.length) {
    reasons.push(
      `${resolutionFiles.length} staged file(s) carry a merge-conflict resolution: ${resolutionFiles.join(", ")}. A resolution is not a review fix — keep it in its own commit, and if any of these also carries an approved fix, say which hunks are which rather than letting the resolution ride along under the fix's approval.`,
    );
  }
  if (!reasons.length) reasons.push("Nothing staged.");
  return reasons.join(" ");
}

/**
 * Enumerate staged hunks and mark what can and cannot be accounted for.
 *
 * @param {object} input
 * @param {string} input.diffText Raw `git diff --cached` output.
 * @param {string[]} [input.approvedFiles] Files this run was approved to change,
 *   i.e. files carrying a fix for an approved review comment.
 * @param {string[]} [input.formatterFiles] Files a formatter *reported* changing.
 *   Only include files the tool's own output named — a formatter you assume ran
 *   is not evidence.
 * @param {string[]} [input.conflictFiles] Files changed resolving an approved
 *   conflict. Kept out of `approvedFiles`: merging them lets resolution hunks —
 *   often a real design decision — inherit a review comment's approval silently.
 *
 * Of the returned fields, three carry rules rather than data:
 * `unexplainedFiles`: no basis at all — unambiguous, must be raised.
 * `needsJudgement`: hunks in explained files where same-file authorship can't be
 * proven from the diff — present individually and ask.
 * `mixedFiles`: both a review fix and a resolution, where "one commit" stops
 * being defensible.
 */
export function attributeStagedHunks(input) {
  // `input ?? {}` rather than `= {}` on the parameter: `{}` satisfies none of the
  // type's required properties, and the runtime checks below are the real enforcement.
  // This keeps a no-argument call landing on them. (The other two modules cite this.)
  const { diffText, approvedFiles = [], formatterFiles = [], conflictFiles = [] } = input ?? {};

  if (!Array.isArray(approvedFiles) || !Array.isArray(formatterFiles) || !Array.isArray(conflictFiles)) {
    throw new TypeError("approvedFiles, formatterFiles and conflictFiles must be arrays of paths");
  }

  const sets = {
    approved: new Set(approvedFiles.map(norm)),
    formatted: new Set(formatterFiles.map(norm)),
    resolved: new Set(conflictFiles.map(norm)),
  };

  const acc = {
    files: [],
    unexplainedFiles: [],
    needsJudgement: [],
    binaryFiles: [],
    combinedFiles: [],
    renamedFiles: [],
    added: 0,
    removed: 0,
    hunkCount: 0,
  };

  for (const f of parseStagedDiff(diffText)) foldFile(f, sets, acc);

  // Derived from what was staged, not from the inputs: a `conflictFiles` path absent
  // from the diff is not a resolution that happened, and reporting it as one is the
  // same laundering the `formatterFiles` rule forbids.
  const resolutionFiles = acc.files.filter((f) => f.basis.includes("conflict-resolution")).map((f) => f.path);
  const mixedFiles = acc.files
    .filter((f) => f.basis.includes("conflict-resolution") && f.basis.includes("approved-change"))
    .map((f) => f.path);

  const reason = buildAttributionReason({ ...acc, resolutionFiles });

  return {
    files: acc.files,
    totals: { files: acc.files.length, hunks: acc.hunkCount, added: acc.added, removed: acc.removed },
    numstat: `+${acc.added} / -${acc.removed}`,
    unexplainedFiles: acc.unexplainedFiles,
    needsJudgement: acc.needsJudgement,
    binaryFiles: acc.binaryFiles,
    combinedFiles: acc.combinedFiles,
    renamedFiles: acc.renamedFiles,
    resolutionFiles,
    mixedFiles,
    allFilesExplained: acc.unexplainedFiles.length === 0,
    reason,
  };
}
