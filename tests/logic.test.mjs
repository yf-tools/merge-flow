import test from "node:test";
import assert from "node:assert";

import { parseMrTitle, normalizeProjectPath } from "../server/mr-payload.js";
import { reconcileDiscussionCounts } from "../server/discussions.js";
import { parseStagedDiff } from "../server/hunks.js";
import { stripGid } from "../server/graphql.js";

test("parseMrTitle extracts Jira ticket keys from PR/MR titles", () => {
  assert.strictEqual(parseMrTitle("fix(PROJ-123): fix login flow").ticketKey, "PROJ-123");
  assert.strictEqual(parseMrTitle("PROJ-999: update dependencies").ticketKey, "PROJ-999");
  assert.strictEqual(parseMrTitle("chore: update README").ticketKey, null);
});

test("normalizeProjectPath normalizes various git remote formats", () => {
  assert.strictEqual(
    normalizeProjectPath("git@gitlab.com:my-org/my-project.git"),
    "my-org/my-project"
  );
  assert.strictEqual(
    normalizeProjectPath("https://gitlab.com/my-org/my-project.git"),
    "my-org/my-project"
  );
  assert.strictEqual(
    normalizeProjectPath("https://gitlab.com/my-org/my-project"),
    "my-org/my-project"
  );
});

test("reconcileDiscussionCounts correctly handles threads, system notes, and resolution state", () => {
  const note = (id, username, extra = {}) => ({ id, author: { username }, system: false, ...extra });

  const discussions = [
    { id: "d1", notes: [note(1, "reviewer"), note(2, "author")] },
    { id: "d2", notes: [note(3, "reviewer", { resolvable: true, resolved: true })] },
    { id: "d3", notes: [note(4, "reviewer", { resolvable: true, resolved: false })] },
    { id: "d4", notes: [{ id: 5, system: true, author: { username: "system" } }] },
  ];

  const result = reconcileDiscussionCounts({
    discussions,
    userNotesCount: 4,
    currentUser: "author",
  });

  assert.strictEqual(result.threadsTotal, 4);
  assert.strictEqual(result.feedbackThreads, 3, "Excludes system-only discussions");
  assert.strictEqual(result.resolvedThreads, 1);
  assert.strictEqual(result.unresolvedThreads, 1);
  assert.strictEqual(result.needsYou, 1);
  assert.strictEqual(result.reconciles, true);
});

test("parseStagedDiff parses unified diff headers into per-file hunks", () => {
  const diff = `diff --git a/src/index.js b/src/index.js
index 0000000..1111111 100644
--- a/src/index.js
+++ b/src/index.js
@@ -1,3 +1,4 @@
 const a = 1;
+const b = 2;
 const c = 3;
`;

  const files = parseStagedDiff(diff);
  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0].path, "src/index.js");
  assert.strictEqual(files[0].hunks.length, 1);
  assert.strictEqual(files[0].hunks[0].added, 1);
  assert.strictEqual(files[0].hunks[0].removed, 0);
});

test("stripGid extracts numerical ID from GitLab GraphQL global ID", () => {
  assert.strictEqual(stripGid("gid://gitlab/Note/123456"), "123456");
  assert.strictEqual(stripGid("gid://gitlab/MergeRequest/789"), "789");
  assert.strictEqual(stripGid("already-plain-id"), "already-plain-id");
});
