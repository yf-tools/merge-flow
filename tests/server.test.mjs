import test from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SERVER = join(ROOT, "server", "server.js");

function rpc(messages) {
  const input = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
  const r = spawnSync(process.execPath, [SERVER], {
    input,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.strictEqual(r.status, 0, `Server exited with status ${r.status}: ${r.stderr}`);
  const lines = (r.stdout || "").split(/\r?\n/).filter(Boolean);
  return lines.map((l) => JSON.parse(l));
}

test("MCP server initializes and returns protocol capabilities", () => {
  const responses = rpc([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } },
    },
  ]);

  const init = responses.find((m) => m.id === 1);
  assert.ok(init, "Received initialize response");
  assert.strictEqual(init.result.serverInfo.name, "mr-review-checks");
  assert.ok(init.result.protocolVersion);
});

test("MCP server exposes the 5 required tools with schemas", () => {
  const responses = rpc([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } },
    },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  ]);

  const list = responses.find((m) => m.id === 2);
  assert.ok(list, "Received tools/list response");
  const toolNames = list.result.tools.map((t) => t.name).sort();
  const expected = [
    "attribute_staged_hunks",
    "locate_bundled_scripts",
    "reconcile_discussion_counts",
    "triage_graphql_mr",
    "triage_mr_payload",
  ];
  assert.deepStrictEqual(toolNames, expected);
});

test("locate_bundled_scripts returns accessible paths for helper scripts", () => {
  const responses = rpc([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "locate_bundled_scripts", arguments: {} },
    },
  ]);

  const res = responses.find((m) => m.id === 2);
  assert.ok(res, "Received tool call response");
  assert.strictEqual(res.result.isError, undefined);
  const data = JSON.parse(res.result.content[0].text);
  assert.ok(data.scripts["fetch-mr.mjs"]?.path);
  assert.ok(existsSync(data.scripts["fetch-mr.mjs"].path));
  assert.ok(data.scripts["git-context.mjs"]?.path);
  assert.ok(existsSync(data.scripts["git-context.mjs"].path));
});

test("preflight.mjs diagnostic tool runs and outputs structured JSON", () => {
  const preflight = join(ROOT, "preflight.mjs");
  const r = spawnSync(process.execPath, [preflight, "--json", "--repo", ROOT], {
    encoding: "utf8",
    timeout: 45_000,
  });
  assert.ok(r.status === 0 || r.status === 1, "Preflight exited cleanly with 0 or 1");
  const data = JSON.parse(r.stdout);
  assert.ok(Array.isArray(data.checks));
  assert.ok(typeof data.failed === "number");
  assert.ok(data.checks.some((c) => c.name === "git"));
  assert.ok(data.checks.some((c) => c.name === "mr-review-checks"));
});
