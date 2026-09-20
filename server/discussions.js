/**
 * Discussion count reconciliation — pure decision layer.
 *
 * Produces the brief's count line: "Found 7 reviewer comments across 7 threads
 * (9 notes, reconciles ✓)". Threads, notes and *reviewer* notes are three
 * different numbers that get conflated when counted by eye, and the comparison
 * against `user_notes_count` only means something if both sides were derived the
 * same way. Arithmetic belongs in a function.
 */

/**
 * Innermost loop body, extracted so the nested loops read as one call each.
 * Mutates `counts` and `thread`.
 */
function foldNote(n, counts, thread, currentUser, noteIdFromUrl) {
  counts.notesTotal++;

  // Checked before the system-note return: a `#note_` fragment copied out of the
  // activity feed points at a system note, and answering "not found" for one made a
  // complete fetch look broken.
  if (noteIdFromUrl !== undefined && noteIdFromUrl !== null && String(n?.id) === String(noteIdFromUrl)) {
    counts.linkedNoteFound = true;
  }

  if (n?.system === true) {
    counts.systemNotes++;
    return;
  }
  thread.hasNonSystem = true;

  if (currentUser && n?.author?.username === currentUser) counts.ownNotes++;
  else counts.reviewerNotes++;

  if (n?.resolvable === true) {
    thread.isResolvable = true;
    if (n?.resolved !== true) thread.resolved = false;
  }
}

/** Fold one discussion into the running counters, via `foldNote` per note. */
function foldThread(d, counts, currentUser, noteIdFromUrl) {
  const notes = Array.isArray(d?.notes) ? d.notes : [];
  const thread = { isResolvable: false, resolved: true, hasNonSystem: false };

  for (const n of notes) foldNote(n, counts, thread, currentUser, noteIdFromUrl);

  // An all-system thread is activity log, not feedback. `threadsTotal` still counts
  // it, but counting it as one to triage makes the count line self-contradictory:
  // "3 reviewer comments across 5 threads (3 notes)" claims two empty threads.
  if (thread.hasNonSystem) counts.feedbackThreads++;

  if (thread.isResolvable && thread.hasNonSystem) {
    counts.resolvableThreads++;
    if (thread.resolved) counts.resolvedThreads++;
  }
}

/**
 * One thread's feedback notes and resolution state, by the same rule `foldThread` uses:
 * resolvable when any non-system note is, resolved when every resolvable one is.
 *
 * Stated twice in this file, which invariant 4 only permits with a test proving the two
 * agree — `audit[slim]: resolution agrees with the counter` is that test. Kept as a
 * separate pass rather than folded into `foldThread` because that function's single-pass
 * accumulation is what holds its complexity down.
 */
function threadState(notes) {
  const feedback = (Array.isArray(notes) ? notes : []).filter((n) => n?.system !== true);
  const resolvable = feedback.some((n) => n?.resolvable === true);
  return {
    feedback,
    resolvable,
    resolved: resolvable && feedback.every((n) => n?.resolvable !== true || n?.resolved === true),
  };
}

/**
 * The discussions trimmed to what a report and Step 10 consume, with a summary of what
 * was dropped. Lives here, beside the counter, so "resolved" means one thing in this
 * power. Measured need: an untrimmed real payload ran 30,200 of 32,254 bytes and
 * overran the tool-result limit, costing five extra calls to work around.
 *
 * Dropped: system notes and threads holding nothing else (activity log, never triaged
 * — `threadsTotal`/`systemNotes` still count them from the unfiltered set), and full
 * bodies of already-resolved threads (kept as a short excerpt so an unanswered
 * question can still be spotted and promoted). Per-note `position` is hoisted to the
 * thread. Unresolved threads keep every body whole, since those are the only ones a
 * report quotes.
 *
 * @param {Array<object>} discussions Unfiltered `.../discussions` entries.
 * @param {number} [excerptAt] Characters of a resolved note's body to keep.
 */
export function slimThreadsForReport(discussions, excerptAt = 40) {
  if (!Array.isArray(discussions)) throw new TypeError("discussions must be an array of discussion objects");

  const omitted = { systemOnlyThreads: 0, systemNotes: 0, resolvedBodiesExcerptedAt: excerptAt };
  const threads = [];

  for (const d of discussions) {
    const all = Array.isArray(d?.notes) ? d.notes : [];
    const { feedback, resolvable, resolved } = threadState(all);
    omitted.systemNotes += all.length - feedback.length;

    if (feedback.length === 0) {
      omitted.systemOnlyThreads++;
      continue;
    }

    const targetNotes = resolved ? feedback.slice(0, 1) : feedback;
    const rawPos = feedback.find((n) => n?.position)?.position ?? null;
    const position = resolved ? undefined : rawPos;

    threads.push({
      id: d?.id ?? null,
      resolvable,
      resolved,
      ...(position !== undefined ? { position } : {}),
      notes: targetNotes.map((n) => {
        const body = typeof n?.body === "string" ? n.body : "";
        const cut = resolved && body.length > excerptAt;
        return {
          id: n?.id ?? null,
          author: n?.author ?? null,
          ...(resolved
            ? {}
            : {
                created_at: n?.created_at ?? null,
                resolvable: n?.resolvable === true,
                resolved: n?.resolved === true,
              }),
          body: cut ? `${body.slice(0, excerptAt).trimEnd()}…` : body,
          ...(cut ? { bodyExcerpted: true } : {}),
        };
      }),
    });
  }

  return { threads, omitted };
}

/**
 * One compact row per feedback thread, no bodies: id, resolve state, path, line, note
 * count, last author. Backs `--brief` — three runs hand-computed exactly this by
 * wrapping `fetch-mr.mjs` in a script instead, so it is emitted pre-computed instead.
 * Resolution comes from `threadState`, never re-derived, so it can't drift from
 * `slimThreadsForReport` or the counter.
 *
 * @param {Array<object>} discussions Unfiltered `.../discussions` entries.
 */
export function indexThreadsForReport(discussions) {
  if (!Array.isArray(discussions)) throw new TypeError("discussions must be an array of discussion objects");

  const rows = [];

  for (const d of discussions) {
    const { feedback, resolvable, resolved } = threadState(Array.isArray(d?.notes) ? d.notes : []);

    // Same exclusion as the slimmer: a thread holding only system notes is activity log,
    // not feedback, and counting it here would disagree with `feedbackThreads`.
    if (feedback.length === 0) continue;

    const position = feedback.find((n) => n?.position)?.position ?? null;
    const last = feedback[feedback.length - 1];

    rows.push({
      id: d?.id ?? null,
      resolvable,
      resolved,
      path: position?.new_path ?? position?.old_path ?? null,
      line: position?.new_line ?? position?.old_line ?? null,
      notes: feedback.length,
      lastAuthor: last?.author?.username ?? null,
    });
  }

  return rows;
}

/** The `reconciles ✓` / `MISMATCH …` / `not reconciled …` tail of `countLine`. */
function reconciliationTick(reconciles, userNotesCount) {
  if (reconciles === true) return "reconciles ✓";
  if (reconciles === false) return `MISMATCH vs user_notes_count ${userNotesCount}`;
  return "not reconciled — no user_notes_count supplied";
}

/**
 * Counts only — no trailing next-action: the brief has its own "Next:" row, which
 * a baked-in one would duplicate or contradict when a blocker stops the run.
 * "across N threads" is `feedbackThreads`, never `threadsTotal`.
 */
function buildCountLine(counts, expectedNotes, reconciles, userNotesCount) {
  const tick = reconciliationTick(reconciles, userNotesCount);
  const { reviewerNotes, feedbackThreads } = counts;
  return `Found ${reviewerNotes} reviewer comment${reviewerNotes === 1 ? "" : "s"} across ${feedbackThreads} thread${
    feedbackThreads === 1 ? "" : "s"
  } (${expectedNotes} note${expectedNotes === 1 ? "" : "s"}, ${tick})`;
}

/** The human-readable explanation of the `reconciles` verdict. */
function buildReason(reconciles, counts, expectedNotes, userNotesCount, threadsTotal) {
  // `reconciles: false` covers both directions, and they have different causes. Naming
  // a shortfall for an excess prescribed a re-fetch that cannot possibly help, which is
  // the "never state a cause you haven't confirmed" rule broken by the tool itself.
  if (reconciles === false && expectedNotes > userNotesCount) {
    return (
      `Counted ${expectedNotes} non-system notes, which is more than the MR reports in user_notes_count=${userNotesCount}. ` +
      `Re-fetching will not change this. The usual causes are notes added since the MR payload was read, or the same ` +
      `discussion counted twice by stitching a paginated response — re-read the MR payload before reporting either number.`
    );
  }
  if (reconciles === false) {
    return (
      `Counted ${expectedNotes} non-system notes but the MR reports user_notes_count=${userNotesCount}. ` +
      `A shortfall usually means the fetch was paginated and not exhausted — refetch with paginate before triaging, ` +
      `and do not present a report built on the partial set.`
    );
  }
  if (reconciles === null) {
    return "No user_notes_count supplied, so completeness of the fetch is unverified. Say so rather than implying it reconciled.";
  }

  const { systemNotes, ownNotes, feedbackThreads } = counts;
  const activityOnly = threadsTotal - feedbackThreads;
  const activityNote =
    activityOnly > 0
      ? `, and ${activityOnly} of ${threadsTotal} thread(s) hold only system notes, so they are not threads to triage.`
      : ".";
  return (
    `${expectedNotes} non-system notes matches user_notes_count. ${systemNotes} system note(s) excluded, ` +
    `${ownNotes} of your own replies excluded from the reviewer count${activityNote}`
  );
}

/**
 * Pass `discussions` unfiltered — filtering system notes is this function's job.
 * `reconciles: null` means the check could not run; treat as unknown, never as
 * agreement.
 *
 * @param {{ discussions: Array<object>, userNotesCount?: number, currentUser?: string, noteIdFromUrl?: string }} input
 */
export function reconcileDiscussionCounts(input) {
  // `input ?? {}` rather than `= {}` on the parameter — see hunks.js.
  const { discussions, userNotesCount, currentUser, noteIdFromUrl } = input ?? {};

  if (!Array.isArray(discussions)) {
    throw new TypeError("discussions must be an array of discussion objects");
  }

  const counts = {
    notesTotal: 0,
    systemNotes: 0,
    ownNotes: 0,
    reviewerNotes: 0,
    feedbackThreads: 0,
    resolvableThreads: 0,
    resolvedThreads: 0,
    linkedNoteFound: noteIdFromUrl === undefined || noteIdFromUrl === null ? null : false,
  };

  for (const d of discussions) foldThread(d, counts, currentUser, noteIdFromUrl);

  // GitLab's user_notes_count excludes system notes. Compare like with like.
  const expectedNotes = counts.notesTotal - counts.systemNotes;
  const haveExpectation = typeof userNotesCount === "number" && Number.isFinite(userNotesCount);
  const reconciles = haveExpectation ? expectedNotes === userNotesCount : null;

  const threadsTotal = discussions.length;
  const unresolvedThreads = counts.resolvableThreads - counts.resolvedThreads;

  const countLine = buildCountLine(counts, expectedNotes, reconciles, userNotesCount);
  const reason = buildReason(reconciles, counts, expectedNotes, userNotesCount, threadsTotal);

  // Same rule as the triage tool: a check that could not run is not a check that
  // passed. Without `currentUser` every one of your own prior replies is counted as
  // reviewer feedback, which overstates the count line on exactly the MRs where you
  // have already replied once per thread — and it used to do that with no signal at all.
  const undetermined = [];
  if (!currentUser) {
    undetermined.push(
      `own-notes: no current_user supplied, so your own prior replies could not be separated out — all ${counts.reviewerNotes} non-system note(s) are counted as reviewer feedback and ownNotes is 0 by default, not by measurement`,
    );
  }

  return {
    undetermined,
    threadsTotal,
    feedbackThreads: counts.feedbackThreads,
    notesTotal: counts.notesTotal,
    systemNotes: counts.systemNotes,
    reviewerNotes: counts.reviewerNotes,
    ownNotes: counts.ownNotes,
    resolvableThreads: counts.resolvableThreads,
    resolvedThreads: counts.resolvedThreads,
    unresolvedThreads,
    reconciles,
    expectedNotes,
    linkedNoteFound: counts.linkedNoteFound,
    countLine,
    reason,
  };
}
