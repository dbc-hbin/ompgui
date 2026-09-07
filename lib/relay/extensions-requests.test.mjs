import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const requests = await jiti.import("./extensions-requests.ts");
const extensions = await jiti.import("./extensions.ts");
const { handleExtensionsRequest } = requests;
const { readMcpConfig } = await jiti.import("../omp/mcp-config.ts");
const { readNativeSettings } = await jiti.import("../omp/settings-config.ts");
const { allowFileRoot } = await jiti.import("../file-access.ts");

const ctx = { deviceId: "d_test", sessionId: null };

async function throwsCode(fn, code) {
  try {
    await fn();
  } catch (error) {
    assert.equal(error.code, code, `expected code ${code}, got ${error.code}: ${error.message}`);
    return error;
  }
  assert.fail(`expected throw with code ${code}`);
}

function isolateAgentDir() {
  const dir = mkdtempSync(join(tmpdir(), "ompgui-ext-req-"));
  const prevDir = process.env.PI_CODING_AGENT_DIR;
  const prevOmp = process.env.OMP_PROFILE;
  const prevPi = process.env.PI_PROFILE;
  process.env.PI_CODING_AGENT_DIR = dir;
  delete process.env.OMP_PROFILE;
  delete process.env.PI_PROFILE;
  return () => {
    if (prevDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prevDir;
    if (prevOmp === undefined) delete process.env.OMP_PROFILE;
    else process.env.OMP_PROFILE = prevOmp;
    if (prevPi === undefined) delete process.env.PI_PROFILE;
    else process.env.PI_PROFILE = prevPi;
    rmSync(dir, { recursive: true, force: true });
  };
}

function tempWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), "ompgui-ext-ws-"));
  allowFileRoot(dir);
  return dir;
}

test("unknown extensions action fails", async () => {
  await throwsCode(() => handleExtensionsRequest("nope", {}, ctx), "unknown_action");
});

test("mcp.save preserves omitted env/headers and mcp.get never echoes secrets", async () => {
  const cwd = tempWorkspace();
  try {
    await handleExtensionsRequest("mcp.save", {
      cwd,
      name: "tmp-mcp",
      server: { type: "stdio", command: "node", args: ["s.js"], env: { API_KEY: "fake-secret-1" }, headers: { Authorization: "Bearer fake-secret-2" } },
    }, ctx);
    // Edit without env/headers: stored secrets must survive.
    await handleExtensionsRequest("mcp.save", {
      cwd,
      name: "tmp-mcp",
      server: { type: "stdio", command: "node", args: ["s2.js"] },
    }, ctx);
    const stored = readMcpConfig(cwd).config.mcpServers["tmp-mcp"];
    assert.deepEqual(stored.env, { API_KEY: "fake-secret-1" });
    assert.deepEqual(stored.headers, { Authorization: "Bearer fake-secret-2" });
    const got = await handleExtensionsRequest("mcp.get", { cwd, name: "tmp-mcp" }, ctx);
    assert.equal(got.name, "tmp-mcp");
    assert.equal(got.envConfigured, true);
    assert.equal(got.headersConfigured, true);
    const serialized = JSON.stringify(got);
    assert.ok(!serialized.includes("fake-secret-1"), "secret leaked in mcp.get");
    assert.ok(!serialized.includes("fake-secret-2"), "header secret leaked in mcp.get");
    assert.ok(!("env" in got.config) || JSON.stringify(got.config).indexOf("fake-secret") === -1);
    // Rename without secrets preserves them too.
    await handleExtensionsRequest("mcp.save", {
      cwd,
      name: "tmp-mcp-renamed",
      previousName: "tmp-mcp",
      server: { type: "stdio", command: "node" },
    }, ctx);
    const renamed = await handleExtensionsRequest("mcp.get", { cwd, name: "tmp-mcp-renamed" }, ctx);
    assert.equal(renamed.envConfigured, true);
    assert.ok(!JSON.stringify(renamed).includes("fake-secret-1"));
    await handleExtensionsRequest("mcp.save", {
      cwd, name: "tmp-mcp-renamed",
      server: { type: "stdio", command: "node", env: null, headers: null },
    }, ctx);
    const cleared = readMcpConfig(cwd).config.mcpServers["tmp-mcp-renamed"];
    assert.deepEqual(cleared.env, {});
    assert.deepEqual(cleared.headers, {});
    await handleExtensionsRequest("mcp.delete", { cwd, name: "tmp-mcp-renamed" }, ctx);
    await throwsCode(() => handleExtensionsRequest("mcp.get", { cwd, name: "tmp-mcp-renamed" }, ctx), "mcp_not_found");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("mcp.save reports a rename conflict without overwriting either server", async () => {
  const cwd = tempWorkspace();
  try {
    const alpha = { type: "stdio", command: "node", env: { TOKEN: "alpha-secret" }, headers: { Authorization: "alpha-header" } };
    const beta = { type: "http", url: "https://example.com/mcp", env: { TOKEN: "beta-secret" }, headers: { Authorization: "beta-header" } };
    await handleExtensionsRequest("mcp.save", { cwd, name: "alpha", server: alpha }, ctx);
    await handleExtensionsRequest("mcp.save", { cwd, name: "beta", server: beta }, ctx);

    const error = await throwsCode(() => handleExtensionsRequest("mcp.save", {
      cwd, name: "beta", previousName: "alpha", server: { type: "stdio", command: "replacement" },
    }, ctx), "mcp_name_conflict");
    assert.ok(!/alpha-secret|beta-secret|alpha-header|beta-header/.test(error.message));
    assert.deepEqual(readMcpConfig(cwd).config.mcpServers, { alpha, beta });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("mcp.validate rejects bad transports and mcp.save reports coded errors", async () => {
  const ok = await handleExtensionsRequest("mcp.validate", {
    name: "ok-server",
    server: { type: "stdio", command: "npx", args: ["-y", "x"] },
  }, ctx);
  assert.deepEqual(ok, { ok: true });
  await throwsCode(() => handleExtensionsRequest("mcp.validate", {
    name: "bad server",
    server: { type: "stdio", command: "npx" },
  }, ctx), "invalid_mcp");
});

test("agents.save/get round-trips a >100k systemPrompt without truncation", async () => {
  const restore = isolateAgentDir();
  try {
    const big = `PROMPT-START\n${"x".repeat(120_000)}\nPROMPT-END`;
    const saved = await handleExtensionsRequest("agents.save", {
      name: "big-prompt-agent",
      description: "boundary agent",
      systemPrompt: big,
      scope: "user",
    }, ctx);
    assert.equal(saved.name, "big-prompt-agent");
    const got = await handleExtensionsRequest("agents.get", { name: "big-prompt-agent", scope: "user" }, ctx);
    assert.equal(got.name, "big-prompt-agent");
    assert.equal(got.systemPrompt, big);
    assert.ok(got.systemPrompt.length > 8000);
    assert.ok(got.systemPrompt.includes("PROMPT-END"));
    // List stays a preview: bounded page, no full prompt payload.
    const listed = await handleExtensionsRequest("agents.list", { offset: 0, limit: 1 }, ctx);
    assert.equal(listed.limit, 1);
    assert.ok(typeof listed.total === "number");
    assert.ok(!("systemPrompt" in listed.agents[0]), "list must not embed full prompts");
    await handleExtensionsRequest("agents.delete", { name: "big-prompt-agent", scope: "user" }, ctx);
    await throwsCode(() => handleExtensionsRequest("agents.get", { name: "big-prompt-agent", scope: "user" }, ctx), "agent_not_found");
  } finally {
    restore();
  }
});

test("agents.setDisabled and setOverride round-trip through native settings", async () => {
  const restore = isolateAgentDir();
  try {
    await handleExtensionsRequest("agents.setDisabled", { name: "scout", disabled: true }, ctx);
    assert.ok(readNativeSettings().settings.task.disabledAgents.includes("scout"));
    await handleExtensionsRequest("agents.setOverride", {
      name: "scout",
      kind: "model",
      value: "openai/gpt-5-mini",
    }, ctx);
    assert.equal(readNativeSettings().settings.task.agentModelOverrides.scout, "openai/gpt-5-mini");
    await handleExtensionsRequest("agents.setOverride", { name: "scout", kind: "model" }, ctx);
    assert.equal(readNativeSettings().settings.task.agentModelOverrides.scout, undefined);
    await handleExtensionsRequest("agents.setDisabled", { name: "scout", disabled: false }, ctx);
    assert.ok(!readNativeSettings().settings.task.disabledAgents.includes("scout"));
    await throwsCode(() => handleExtensionsRequest("agents.setOverride", { name: "scout", kind: "bogus" }, ctx), "invalid_args");
  } finally {
    restore();
  }
});

test("agents.get returns full fields including tools/model/prewalk/advisor", async () => {
  const restore = isolateAgentDir();
  try {
    await extensions.saveRelayAgent({
      name: "full-fields",
      description: "full",
      systemPrompt: "hello prompt",
      scope: "user",
      tools: ["read", "grep"],
      model: "openai/gpt-5-mini",
      prewalk: true,
      advisor: false,
      blocking: true,
    });
    const got = await handleExtensionsRequest("agents.get", { name: "full-fields", scope: "user" }, ctx);
    assert.deepEqual(got.tools, ["read", "grep"]);
    assert.equal(got.model, "openai/gpt-5-mini");
    assert.equal(got.prewalk, true);
    assert.equal(got.advisor, false);
    assert.equal(got.blocking, true);
    await handleExtensionsRequest("agents.save", {
      name: "full-fields", description: "updated", systemPrompt: "hello prompt",
      scope: "user", blocking: false,
    }, ctx);
    const updated = await handleExtensionsRequest("agents.get", { name: "full-fields", scope: "user" }, ctx);
    assert.equal(updated.blocking, false);
    assert.equal(got.systemPrompt, "hello prompt");
    await handleExtensionsRequest("agents.delete", { name: "full-fields", scope: "user" }, ctx);
  } finally {
    restore();
  }
});

test("skills.toggle rejects non-SKILL.md and skills.list paginates", async () => {
  const cwd = tempWorkspace();
  try {
    await throwsCode(() => handleExtensionsRequest("skills.toggle", {
      cwd,
      filePath: join(cwd, "note.md"),
      disableModelInvocation: true,
    }, ctx), "not_a_skill_file");
    const listed = await handleExtensionsRequest("skills.list", { cwd, offset: 0, limit: 1 }, ctx);
    assert.equal(listed.offset, 0);
    assert.equal(listed.limit, 1);
    assert.ok(typeof listed.total === "number");
    assert.ok(typeof listed.hasMore === "boolean");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("plugins.list uses the selected native marketplace install instead of stale top-level metadata", async (t) => {
  const cwd = tempWorkspace();
  const cli = await jiti.import("../omp/omp-cli.ts");
  t.mock.method(cli, "runOmpCli", async () => ({
    stdout: JSON.stringify({
      npm: [{ name: "npm-plugin", enabled: false, version: "1.0.0" }],
      marketplace: [
        {
          id: "native@marketplace", scope: "project", enabled: true, version: "stale",
          entries: [
            { scope: "project", enabled: false, version: "2.3.4", installPath: cwd },
            { scope: "user", enabled: true, version: "9.0.0", installPath: cwd },
          ],
        },
        { id: "installed@marketplace", entries: [{ enabled: true, version: "3.0.0", installPath: cwd }] },
        { id: "missing@marketplace", entries: [{ enabled: true, installPath: join(cwd, "missing-plugin") }] },
        { id: "legacy@marketplace", enabled: false, version: "4.0.0", entries: [] },
      ],
    }),
    stderr: "",
  }));
  try {
    const listed = await handleExtensionsRequest("plugins.list", { cwd }, ctx);
    assert.deepEqual(listed.packages, [
      { source: "npm-plugin", scope: "global", status: "disabled", disabled: true, version: "1.0.0" },
      { source: "native@marketplace", scope: "project", status: "disabled", disabled: true, version: "2.3.4" },
      { source: "installed@marketplace", scope: "global", status: "installed", disabled: false, version: "3.0.0" },
      { source: "missing@marketplace", scope: "global", status: "missing", disabled: false },
      { source: "legacy@marketplace", scope: "global", status: "disabled", disabled: true, version: "4.0.0" },
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("plugins.action validates the finite action set before spawning omp", async () => {
  const cwd = tempWorkspace();
  try {
    await throwsCode(() => handleExtensionsRequest("plugins.action", {
      cwd,
      action: "explode",
    }, ctx), "invalid_action");
    await throwsCode(() => handleExtensionsRequest("plugins.action", {
      cwd,
      action: "install",
    }, ctx), "invalid_source");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("mcp.list keeps enabled configuration distinct from runtime and ignores client session selection", async () => {
  const restore = isolateAgentDir();
  const cwd = tempWorkspace();
  try {
    await handleExtensionsRequest("mcp.save", {
      cwd, name: "configured-only", server: { type: "stdio", command: "true", env: { TOKEN: "private-env" }, headers: { Authorization: "private-header" } },
    }, ctx);
    const result = await handleExtensionsRequest("mcp.list", { cwd, sessionId: "untrusted-session", limit: 1 }, ctx);
    assert.equal(result.sessionId, null);
    assert.equal(result.liveServers, undefined);
    const all = await handleExtensionsRequest("mcp.list", { cwd, limit: 200 }, ctx);
    assert.equal(all.inventory.find((row) => row.name === "configured-only").status, "configured");
    assert.equal(result.inventory.length, 1);
    assert.equal(result.hasMore, result.total > 1);
    assert.ok(!JSON.stringify(all).includes("private-env"));
    assert.ok(!JSON.stringify(all).includes("private-header"));
  } finally {
    restore();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("mcp.list merges only the authenticated live runtime without exposing process targets or secrets", async () => {
  const restore = isolateAgentDir();
  const cwd = tempWorkspace();
  const previousRegistry = globalThis.__ompSessions;
  let queries = 0;
  globalThis.__ompSessions = new Map([["selected-mcp", {
    isAlive: () => true,
    getMcpList: async () => {
      queries++;
      return "Project level (.omp/mcp.json):\n  live-fixture ● connected [stdio]\n  offline-fixture ○ not connected [http]\n";
    },
  }]]);
  try {
    await handleExtensionsRequest("mcp.save", { cwd, name: "live-fixture", server: { type: "stdio", command: "true", env: { TOKEN: "private-env" }, headers: { Authorization: "private-header" } } }, ctx);
    await handleExtensionsRequest("mcp.save", { cwd, name: "unreported-fixture", server: { type: "stdio", command: "true" } }, ctx);
    const result = await handleExtensionsRequest("mcp.list", { cwd, sessionId: "other-session", limit: 1 }, { ...ctx, sessionId: "selected-mcp" });
    assert.equal(queries, 1);
    assert.equal(result.sessionId, "selected-mcp");
    assert.equal(result.liveError, undefined);
    assert.deepEqual(result.liveServers.filter((row) => row.name === "live-fixture"), [{ name: "live-fixture", source: "Project level", status: "connected", type: "stdio" }]);
    assert.equal(result.liveServers.find((row) => row.name === "offline-fixture").status, "not_connected");
    assert.equal(result.liveServers.find((row) => row.name === "unreported-fixture").status, "configured");
    assert.ok(!JSON.stringify(result).includes("private-env"));
    assert.ok(!JSON.stringify(result).includes("private-header"));
    assert.ok(result.liveServers.every((row) => Object.keys(row).every((key) => ["name", "source", "status", "type"].includes(key))));
  } finally {
    globalThis.__ompSessions = previousRegistry;
    restore();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("mcp.list distinguishes an inactive session and failed query from disconnected servers", async () => {
  const restore = isolateAgentDir();
  const cwd = tempWorkspace();
  const previousRegistry = globalThis.__ompSessions;
  globalThis.__ompSessions = new Map([["failed-mcp", { isAlive: () => true, getMcpList: async () => { throw new Error("TOKEN=private-env Authorization: private-header"); } }]]);
  try {
    const inactive = await handleExtensionsRequest("mcp.list", { cwd }, { ...ctx, sessionId: "absent-mcp" });
    assert.equal(inactive.sessionId, "absent-mcp");
    assert.equal(inactive.liveServers, undefined);
    assert.match(inactive.liveError, /inactive/i);
    const failed = await handleExtensionsRequest("mcp.list", { cwd }, { ...ctx, sessionId: "failed-mcp" });
    assert.equal(failed.liveServers, undefined);
    assert.match(failed.liveError, /query failed/i);
    assert.ok(!JSON.stringify(failed).includes("private-env"));
    assert.ok(!JSON.stringify(failed).includes("private-header"));
    assert.equal(globalThis.__ompSessions.size, 1, "listing must not start a session");
  } finally {
    globalThis.__ompSessions = previousRegistry;
    restore();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("mcp.save writes a disabled temporary command server and deletes it", async () => {
  const cwd = tempWorkspace();
  try {
    await handleExtensionsRequest("mcp.save", {
      cwd,
      name: "tmp-disabled-cmd",
      server: { type: "stdio", command: "true", enabled: false, timeout: 5000 },
    }, ctx);
    const listed = await handleExtensionsRequest("mcp.list", { cwd }, ctx);
    const row = listed.inventory.find((entry) => entry.name === "tmp-disabled-cmd");
    assert.ok(row, "saved server missing from inventory");
    assert.equal(row.source, "Project level");
    await handleExtensionsRequest("mcp.delete", { cwd, name: "tmp-disabled-cmd" }, ctx);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
