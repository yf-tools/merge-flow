/**
 * MR payload triage — pure decision layer.
 *
 * Exists because a decision-relevant field can sit in a payload unread: one run
 * had `has_conflicts: true` and `detailed_merge_status: "conflict"` in hand and
 * mentioned neither until the user asked ten minutes later. Here the fields get
 * read whether or not anyone remembers they exist.
 */

/** MR states that mean this is not active work. */
export const TERMINAL_MR_STATES = ["merged", "closed", "locked"];

/**
 * Git remote or GitLab web URL → bare `group/subgroup/project`, so an SSH remote
 * and an HTTPS web URL compare. `null` means "could not determine", never a mismatch.
 */
export function normalizeProjectPath(url) {
  if (typeof url !== "string" || url.trim().length === 0) return null;
  let s = url.trim();

  s = s.replace(/\.git$/i, "");
  // scp-style ssh: git@host:group/project
  const scp = new RegExp(/^[^@/]+@[^:/]+:(.+)$/).exec(s);
  if (scp) s = scp[1];
  else {
    // any scheme://host/group/project
    const withScheme = new RegExp(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\/(.+)$/i).exec(s);
    if (withScheme) s = withScheme[1];
  }

  // A GitLab web URL for an MR carries the project path before `/-/`.
  const dashIndex = s.indexOf("/-/");
  if (dashIndex !== -1) s = s.slice(0, dashIndex);

  s = stripSlashes(s);
  return s.length > 0 ? s.toLowerCase() : null;
}

/**
 * The host a remote or web URL points at, lowercased, without userinfo or port.
 *
 * Separate from `normalizeProjectPath` because that function's contract is the path
 * and callers rely on it. Kept as its own value so the wrong-project check can compare
 * both: `acme/app` on gitlab.com and `acme/app` on an internal instance are different
 * repositories, and comparing paths alone reported them as the same one.
 */
export function normalizeProjectHost(url) {
  if (typeof url !== "string" || url.trim().length === 0) return null;
  const s = url.trim();

  const scp = new RegExp(/^[^@/]+@([^:/]+):/).exec(s);
  const scheme = new RegExp(/^[a-z][a-z0-9+.-]*:\/\/([^/]+)/i).exec(s);
  let host = scp?.[1] ?? scheme?.[1] ?? null;
  if (host === null) return null;

  const at = host.lastIndexOf("@");
  if (at !== -1) host = host.slice(at + 1);
  const colon = host.lastIndexOf(":");
  if (colon !== -1 && !host.includes("]")) host = host.slice(0, colon);

  host = host.trim().toLowerCase();
  return host.length > 0 ? host : null;
}

/**
 * Index scan, not `/^\/+|\/+$/`: the regex form trips slow-regex scanners even
 * anchored, and a linear scan sidesteps the argument.
 */
function stripSlashes(s) {
  let start = 0;
  while (start < s.length && s[start] === "/") start++;

  let end = s.length;
  while (end > start && s[end - 1] === "/") end--;

  return s.slice(start, end);
}

/**
 * Conventional-commit type (`fix`, `feat`, …) off the head of a title.
 *
 * Not one regex: `/^\s*([a-z]+)\s*(?:\([^)]*\))?\s*!?:/` was flagged for
 * super-linear backtracking (three zero-width-capable positions to search).
 * String slicing does the same parse with no ambiguity.
 */
function extractCommitType(title) {
  const colonIndex = title.indexOf(":");
  if (colonIndex === -1) return null;

  let head = title.slice(0, colonIndex).trimEnd();
  if (head.endsWith("!")) head = head.slice(0, -1);

  const parenIndex = head.indexOf("(");
  if (parenIndex !== -1) head = head.slice(0, parenIndex);

  head = head.trim();
  return /^[a-z]+$/.test(head) ? head : null;
}

/**
 * Prefixes that are standards, encodings or product versions rather than Jira
 * projects. `KEY-123` cannot be told from `UTF-8` by shape, and the old pattern
 * happily reported `UTF-8`, `SHA-256` and `IE-11` as ticket keys, suppressing the
 * `no-ticket-key` flag and sending Jira lookups after issues that don't exist.
 *
 * A blocklist is the wrong tool for proving a key is real, which is why it is paired
 * with branch corroboration below rather than trusted on its own.
 */
const NON_TICKET_PREFIXES = new Set([
  "AES", "ASCII", "CVE", "CWE", "ECMA", "GMT", "HTTP", "HTTPS", "IE", "IPV", "ISO",
  "JPEG", "MD", "PNG", "RFC", "RSA", "SHA", "SSL", "TLS", "UTC", "UTF", "WCAG",
]);

const TICKET_KEY = /\b([A-Z][A-Z0-9]*)-(\d+)\b/g;

/**
 * Every ticket-shaped candidate in a string, in order, minus the standards names.
 * Plural because one title can hold several and the first is not always the right one.
 */
export function ticketKeyCandidates(text) {
  if (typeof text !== "string") return [];
  const out = [];
  for (const m of text.matchAll(new RegExp(TICKET_KEY))) {
    if (NON_TICKET_PREFIXES.has(m[1])) continue;
    const key = `${m[1]}-${m[2]}`;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

/** Pull the ticket key and conventional-commit type out of an MR title. */
export function parseMrTitle(title) {
  const t = typeof title === "string" ? title : "";
  const ticketKeys = ticketKeyCandidates(t);
  return { ticketKey: ticketKeys[0] ?? null, ticketKeys, commitType: extractCommitType(t) };
}

function pushIssue(list, code, message, detail) {
  list.push(detail === undefined ? { code, message } : { code, message, detail });
}

/** Split out so `triageMrPayload` only runs checks rather than also assembling facts. */
function buildFacts(mr, workspaceRemote, currentBranch) {
  const { ticketKeys, commitType } = parseMrTitle(mr.title);
  const mrPath = normalizeProjectPath(mr.web_url) ?? null;
  const localPath = normalizeProjectPath(workspaceRemote) ?? null;

  // A key repeated in the branch name is corroborated by something the author had to
  // type twice; one that appears only in the title could be prose. Where they disagree,
  // the branch wins, and an uncorroborated key is reported rather than trusted.
  const branchKeys = ticketKeyCandidates(mr.source_branch ?? "");
  const corroborated = ticketKeys.find((k) => branchKeys.includes(k)) ?? null;
  const ticketKey = corroborated ?? ticketKeys[0] ?? null;

  return {
    ticketKeys,
    ticketKeyCorroborated: corroborated !== null,
    iid: mr.iid ?? null,
    title: typeof mr.title === "string" ? mr.title : null,
    sourceBranch: mr.source_branch ?? null,
    currentBranch: typeof currentBranch === "string" && currentBranch.trim() ? currentBranch.trim() : null,
    targetBranch: mr.target_branch ?? null,
    state: mr.state ?? null,
    userNotesCount: typeof mr.user_notes_count === "number" ? mr.user_notes_count : null,
    hasConflicts: mr.has_conflicts === true,
    mergeStatus: mr.merge_status ?? null,
    detailedMergeStatus: mr.detailed_merge_status ?? null,
    draft: mr.draft === true || mr.work_in_progress === true,
    projectPath: mrPath,
    workspaceProjectPath: localPath,
    projectHost: normalizeProjectHost(mr.web_url) ?? null,
    workspaceProjectHost: normalizeProjectHost(workspaceRemote) ?? null,
    author: mr.author?.username ?? null,
    assignees: Array.isArray(mr.assignees) ? mr.assignees.map((a) => a?.username).filter(Boolean) : [],
    ticketKey,
    commitType,
  };
}

/** Outranks every other check: continuing may check out a branch from another repo. */
function checkWrongProject(facts, blockers, undetermined) {
  const { projectPath: mrPath, workspaceProjectPath: localPath, projectHost: mrHost, workspaceProjectHost: localHost } = facts;

  if (!mrPath || !localPath) {
    undetermined.push(
      mrPath
        ? "wrong-project: no workspace remote supplied, so the MR's project could not be compared"
        : "wrong-project: the MR payload carried no usable web_url to compare",
    );
    return;
  }

  if (mrPath !== localPath) {
    pushIssue(blockers, "wrong-project", `This MR belongs to ${mrPath}, but this workspace's remote is ${localPath}.`, {
      mr: mrPath,
      workspace: localPath,
    });
    return;
  }

  // Same path, different instance. Named separately because the cause is usually a host
  // alias rather than the wrong URL, and the user can tell which from one line.
  if (mrHost && localHost && mrHost !== localHost) {
    pushIssue(
      blockers,
      "wrong-project",
      `Both point at ${mrPath}, but the MR is on ${mrHost} while this workspace's remote is ${localHost}. Same project path on two different GitLab instances is two different repositories — unless these are aliases for one host, in which case say so.`,
      { mr: `${mrHost}/${mrPath}`, workspace: `${localHost}/${localPath}` },
    );
    return;
  }

  if (!mrHost || !localHost) {
    undetermined.push(
      "wrong-project: paths match, but the host could not be read from both sides, so a same-path project on another instance would not have been caught",
    );
  }
}

/**
 * Which branch is checked out versus which one the MR is for.
 *
 * A flag rather than a blocker: being on the wrong branch at the start is the normal
 * case, and the run is supposed to check out. What this exists to stop is the run
 * *claiming* the right branch is already checked out when it isn't.
 *
 * Observed on MR !510. `git-context.mjs` returned `branch: "fix/BIDAYA-2084"` and the MR's
 * source was `fix/BIDAYA-2315`. The report said "**Branch:** `fix/BIDAYA-2315` — already
 * checked out" and its closing list said "Stay on `fix/BIDAYA-2315`". Both were false and
 * both contradicted output the run was holding. Because the approved list contained no
 * checkout, nine grep/read calls then ran against the previous MR's branch before an
 * unprompted `git branch --show-current` exposed it, costing five re-reads — and the fix
 * could as easily have been based on the wrong file contents.
 *
 * Prose could not fix that: the rule was already there. Comparing two strings the caller
 * already has is exactly the kind of noticing that belongs in a tool.
 */
function checkBranch(facts, flags, undetermined) {
  const { sourceBranch, currentBranch } = facts;

  if (!sourceBranch) {
    undetermined.push("branch: the MR payload carried no source_branch to compare");
    return;
  }
  if (!currentBranch) {
    undetermined.push(
      "branch: no current branch supplied, so whether the MR's branch is checked out is unknown — do not report it as checked out",
    );
    return;
  }
  if (currentBranch === sourceBranch) return;

  pushIssue(
    flags,
    "branch-mismatch",
    `Checked out is ${currentBranch}, but this MR is for ${sourceBranch}. Say you will switch; never report it as already checked out.`,
    { current: currentBranch, source: sourceBranch },
  );
}

function checkTerminalState(facts, blockers) {
  if (typeof facts.state === "string" && TERMINAL_MR_STATES.includes(facts.state.toLowerCase())) {
    pushIssue(blockers, "terminal-state", `This MR is ${facts.state} — it is not active work.`, facts.state);
  }
}

/**
 * Resolving a conflict may rewrite the code the review comments are about, so the
 * order is the user's call — a blocker, not a mention afterwards.
 */
function checkConflicts(facts, blockers) {
  const { hasConflicts, mergeStatus, detailedMergeStatus } = facts;
  if (!hasConflicts && mergeStatus !== "cannot_be_merged" && detailedMergeStatus !== "conflict") return;

  pushIssue(
    blockers,
    "conflicts",
    `This MR cannot merge as it stands — has_conflicts=${hasConflicts}, merge_status=${mergeStatus}, detailed_merge_status=${detailedMergeStatus}.`,
    { hasConflicts, mergeStatus, detailedMergeStatus },
  );
}

function checkZeroComments(facts, blockers, undetermined) {
  if (facts.userNotesCount === 0) {
    pushIssue(blockers, "zero-comments", "This MR has no user notes — there is nothing to triage.");
  } else if (facts.userNotesCount === null) {
    undetermined.push("zero-comments: user_notes_count absent from the payload");
  }
}

function checkOwnership(facts, currentUser, flags, undetermined) {
  if (!currentUser) {
    undetermined.push("not-yours: no authenticated username supplied, so ownership was not checked");
    return;
  }

  const owns = facts.author === currentUser || facts.assignees.includes(currentUser);
  if (owns) return;

  pushIssue(
    flags,
    "not-yours",
    `This MR is authored by ${facts.author ?? "unknown"} and assigned to ${
      facts.assignees.length ? facts.assignees.join(", ") : "nobody"
    }, not ${currentUser} — flagging in case the wrong MR was pasted.`,
  );
}

function checkTicketKey(facts, flags, undetermined) {
  if (!facts.ticketKey) {
    pushIssue(
      flags,
      "no-ticket-key",
      "No ticket-shaped key in the MR title. Don't invent one and don't leave a literal placeholder in the commit message.",
    );
    return;
  }

  // Found is not the same as verified. Say which, so a key lifted out of prose can't
  // ride into a Jira lookup as though the branch had confirmed it.
  if (!facts.ticketKeyCorroborated) {
    undetermined.push(
      `ticket-key: ${facts.ticketKey} came from the title alone — the source branch does not repeat it, so it is a candidate rather than a confirmed key${
        facts.ticketKeys.length > 1 ? ` (others in the title: ${facts.ticketKeys.slice(1).join(", ")})` : ""
      }`,
    );
  }
}

function checkDraft(facts, flags) {
  if (facts.draft) pushIssue(flags, "draft", "This MR is a draft.");
}

function checkDirtyTree(dirty, dirtyFiles, flags) {
  if (dirty === true && Array.isArray(dirtyFiles) && dirtyFiles.length > 0) {
    const count = dirtyFiles.length;
    const sample = count <= 3 ? dirtyFiles.join(", ") : `${dirtyFiles.slice(0, 3).join(", ")} (+${count - 3} more)`;
    pushIssue(
      flags,
      "dirty-tree",
      `Working tree has ${count} uncommitted modified file(s): ${sample}.`,
      { count, dirtyFiles },
    );
  }
}

/**
 * Triage a merge request payload.
 *
 * @param {object} input
 * @param {object} input.mr The parsed MR JSON from `.../merge_requests/{iid}`.
 * @param {string} [input.workspaceRemote] `git remote get-url origin` for the open
 *   workspace. Omit it and the wrong-project check reports as undetermined rather
 *   than passing silently.
 * @param {string} [input.currentBranch] `git branch --show-current` for the open
 *   workspace, so the report can state whether the MR's branch is actually checked out
 *   instead of guessing. Omitted means undetermined, never "already checked out".
 * @param {string} [input.currentUser] The username `glab` is authenticated as, for
 *   the ownership check. Omitted means undetermined, not "fine".
 * @param {boolean} [input.dirty] Whether the workspace working tree has uncommitted modifications.
 * @param {string[]} [input.dirtyFiles] List of uncommitted modified files.
 *
 * @returns {{
 *   blockers: Array<{code: string, message: string, detail?: any}>,
 *   flags: Array<{code: string, message: string, detail?: any}>,
 *   undetermined: string[],
 *   facts: object,
 *   proceed: boolean
 * }}
 *
 * `blockers` need an answer before continuing; `flags` are said once; `undetermined`
 * is separate because "not checked" is not "passed".
 */
export function triageMrPayload(input) {
  // `input ?? {}` rather than `= {}` on the parameter — see hunks.js. The runtime
  // check below is the enforcement; this keeps a no-argument call landing on it.
  const { mr, workspaceRemote, currentUser, currentBranch, dirty, dirtyFiles } = input ?? {};

  if (mr === null || typeof mr !== "object" || Array.isArray(mr)) {
    throw new Error("mr must be the parsed merge request object");
  }

  const blockers = [];
  const flags = [];
  const undetermined = [];
  const facts = buildFacts(mr, workspaceRemote, currentBranch);

  checkWrongProject(facts, blockers, undetermined);
  checkTerminalState(facts, blockers);
  checkConflicts(facts, blockers);
  checkZeroComments(facts, blockers, undetermined);
  checkOwnership(facts, currentUser, flags, undetermined);
  checkTicketKey(facts, flags, undetermined);
  checkBranch(facts, flags, undetermined);
  checkDraft(facts, flags);
  checkDirtyTree(dirty, dirtyFiles, flags);

  return { blockers, flags, undetermined, facts, proceed: blockers.length === 0 };
}
