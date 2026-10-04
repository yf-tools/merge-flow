/**
 * Translates a GraphQL merge-request payload into the REST shapes the decision
 * tools already accept, so they need only one vocabulary.
 *
 * The trap this file exists to close: GraphQL returns `gid://gitlab/Note/87594`
 * where REST returns `87594`. A surviving `gid://` 404s every reply POST, at the
 * end of a run, after the approval gate has closed.
 */

/** `gid://gitlab/Note/87594` → `"87594"`; a bare id passes through unchanged. */
export function stripGid(value) {
  if (typeof value !== "string") return value ?? null;
  if (!value.startsWith("gid://")) return value;
  const cut = value.lastIndexOf("/");
  return cut === -1 ? value : value.slice(cut + 1);
}

/** GraphQL enums are SCREAMING_CASE; the REST fields they map to are snake_case. */
function enumToRest(value) {
  return typeof value === "string" ? value.toLowerCase() : (value ?? null);
}

/** Unwrap a Relay `{ nodes: [...] }` connection, tolerating null and absence. */
function nodes(connection) {
  return Array.isArray(connection?.nodes) ? connection.nodes : [];
}

/**
 * `position` stays null on a non-diff note, matching REST.
 *
 * `old_path`/`old_line` are carried because a comment on a deleted line has null
 * `newPath` and `newLine`, which otherwise renders as `null:null` in a report.
 *
 * `line_range` is always null here, and that is not an oversight: GitLab's
 * `DiffPosition` type has no such field (confirmed by introspection), so the
 * multi-line span a REST payload can express is not available on this path.
 */
function normalizeNote(n) {
  const position = n?.position
    ? {
        new_path: n.position.newPath ?? null,
        new_line: n.position.newLine ?? null,
        old_path: n.position.oldPath ?? null,
        old_line: n.position.oldLine ?? null,
        line_range: null,
      }
    : null;

  return {
    id: stripGid(n?.id),
    system: n?.system === true,
    resolvable: n?.resolvable === true,
    resolved: n?.resolved === true,
    body: n?.body ?? null,
    created_at: n?.createdAt ?? null,
    author: { username: n?.author?.username ?? null },
    position,
  };
}

/**
 * Accepts the transport envelope or a bare `mergeRequest`. `hasNextPage: true`
 * means the same as `reconciles: false` downstream — incomplete fetch, report
 * nothing on it.
 *
 * @param {object} payload
 * @returns {{ mr: object, discussions: Array<object>, hasNextPage: boolean, endCursor: string|null }}
 */
export function normalizeGraphqlMr(payload) {
  // GraphQL answers 200 with an `errors` array rather than a transport failure, so this
  // has to be checked before anything is read out of `data`.
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    const summary = payload.errors.map((e) => e?.message ?? String(e)).join("; ");
    throw new TypeError(`GraphQL returned errors, so there is no merge request to triage: ${summary}`);
  }

  const nested = payload?.data?.project?.mergeRequest ?? payload?.project?.mergeRequest ?? payload?.mergeRequest ?? null;

  // A bare `mergeRequest` is accepted, but it has to actually look like one. The old
  // version fell back to the envelope itself, so `{ data: { project: null } }` passed
  // the object guard and produced an all-null MR — which silenced every blocker and
  // returned `proceed: true` for a project that wasn't found or wasn't permitted.
  const bare = payload && typeof payload === "object" && !Array.isArray(payload) && "iid" in payload ? payload : null;
  const gql = nested ?? bare;

  if (!gql || typeof gql !== "object" || Array.isArray(gql)) {
    throw new TypeError(
      "no merge request in this payload: expected { data: { project: { mergeRequest } } }, or a bare mergeRequest carrying an iid. A null project means the path was wrong or not visible to this token.",
    );
  }

  const iid = Number(gql.iid);

  const mr = {
    iid: Number.isFinite(iid) ? iid : null,
    title: typeof gql.title === "string" ? gql.title : null,
    state: enumToRest(gql.state),
    source_branch: gql.sourceBranch ?? null,
    target_branch: gql.targetBranch ?? null,
    user_notes_count: typeof gql.userNotesCount === "number" ? gql.userNotesCount : null,
    has_conflicts: gql.conflicts === true,
    merge_status: enumToRest(gql.mergeStatusEnum),
    detailed_merge_status: enumToRest(gql.detailedMergeStatus),
    draft: gql.draft === true,
    web_url: gql.webUrl ?? null,
    author: { username: gql.author?.username ?? null },
    assignees: nodes(gql.assignees).map((a) => ({ username: a?.username ?? null })),
    head_pipeline: gql.headPipeline
      ? {
          id: stripGid(gql.headPipeline.id),
          status: enumToRest(gql.headPipeline.status),
          label: gql.headPipeline.detailedStatus?.label || gql.headPipeline.detailedStatus?.text || enumToRest(gql.headPipeline.status),
        }
      : null,
  };

  const discussions = nodes(gql.discussions).map((d) => ({
    id: stripGid(d?.id),
    notes: nodes(d?.notes).map(normalizeNote),
  }));

  // A thread can outrun its own notes page, so an inner truncation is just as
  // incomplete a fetch as an outer one and has to raise the same flag. Reporting only
  // the outer page is what made "this path cannot truncate" untrue.
  const notesTruncated = nodes(gql.discussions).some((d) => d?.notes?.pageInfo?.hasNextPage === true);

  return {
    mr,
    discussions,
    hasNextPage: gql.discussions?.pageInfo?.hasNextPage === true || notesTruncated,
    endCursor: gql.discussions?.pageInfo?.endCursor ?? null,
  };
}

/**
 * Kept beside the normalizer that consumes it so a field can't be added to one and not
 * the other. Every field below was confirmed to exist by introspecting a GitLab 18.x
 * instance rather than assumed; `DiffPosition` has no `lineRange`, which is why none is
 * requested and `line_range` normalizes to null.
 *
 * The inner `notes` connection is paginated on purpose. Left unbounded it silently
 * truncated a long thread with no `pageInfo` to report it, which made the documented
 * "this path cannot truncate" claim false.
 *
 * Send with `--raw-field`, never `--field`: the latter coerces iid to a number
 * and GraphQL rejects it ("Variable $iid of type String! was provided invalid value").
 */
export const MR_QUERY = `query($fullPath: ID!, $iid: String!) {
  project(fullPath: $fullPath) {
    mergeRequest(iid: $iid) {
      iid title state sourceBranch targetBranch userNotesCount
      conflicts mergeStatusEnum detailedMergeStatus draft webUrl
      author { username }
      assignees { nodes { username } }
      headPipeline { id status detailedStatus { text label } }
      discussions(first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          notes(first: 100) {
            pageInfo { hasNextPage }
            nodes { id system resolvable resolved body createdAt author { username } position { newPath newLine oldPath oldLine } }
          }
        }
      }
    }
  }
}`;
