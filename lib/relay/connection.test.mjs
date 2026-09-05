import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { attachRelayConnection } = await jiti.import("./connection.ts");
const { RELAY_PROTOCOL_VERSION } = await jiti.import("./protocol.ts");

function fakeSocket() {
  const outgoing = [];
  let closed = null;
  const socket = {
    outgoing,
    bufferedAmount: 0,
    sendText(text) {
      outgoing.push(JSON.parse(text));
      return true;
    },
    close(code, reason) {
      closed = { code, reason };
    },
    getClosed() {
      return closed;
    },
  };
  return socket;
}

function noopTimers() {
  return {
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
}

function helloPairing() {
  return JSON.stringify({
    op: "hello",
    protocol: RELAY_PROTOCOL_VERSION,
    pairingSecret: "c".repeat(43),
  });
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("hello is required before sessions.list", async () => {
  const socket = fakeSocket();
  const conn = attachRelayConnection(socket, {
    authenticate() {
      return { ok: true, serverId: "s_1", deviceId: "d_1", token: "tok" };
    },
    ...noopTimers(),
  });
  conn.onText(JSON.stringify({ op: "sessions.list" }));
  await flush();
  assert.equal(socket.outgoing[0].op, "hello_err");
  assert.ok(socket.getClosed());
});

test("pairing hello then lists sessions and opens a snapshot", async () => {
  const socket = fakeSocket();
  const events = [];
  const conn = attachRelayConnection(socket, {
    authenticate() {
      return { ok: true, serverId: "s_server", deviceId: "d_phone", token: "new-token-value" };
    },
    async listSessions() {
      return {
        sessions: [{ id: "sess-1", cwd: "/tmp", created: "t", modified: "t", messageCount: 1, firstMessage: "hi" }],
        runningIds: [],
      };
    },
    async openSession(id, emit) {
      events.push(id);
      emit({ type: "connected", sessionId: id });
      return {
        snapshot: {
          title: "Demo",
          cwd: "/tmp",
          leafId: "leaf",
          messages: [{ role: "user", text: "hi" }],
          agent: { running: false, ready: false },
        },
        dispose() {},
      };
    },
    async sendCommand() {
      return null;
    },
    async listBranches(id) {
      return { id, leafId: "leaf", branches: [] };
    },
    ...noopTimers(),
  });

  conn.onText(helloPairing());
  await flush();
  assert.equal(socket.outgoing[0].op, "hello_ok");
  assert.equal(socket.outgoing[0].token, "new-token-value");

  conn.onText(JSON.stringify({ op: "sessions.list" }));
  await flush();
  assert.equal(socket.outgoing[1].op, "sessions");
  assert.equal(socket.outgoing[1].sessions[0].id, "sess-1");

  conn.onText(JSON.stringify({ op: "session.open", id: "sess-1" }));
  await flush();
  const snapshot = socket.outgoing.find((frame) => frame.op === "session.snapshot");
  assert.equal(snapshot.id, "sess-1");
  assert.equal(snapshot.messages[0].text, "hi");
  assert.deepEqual(events, ["sess-1"]);

  conn.onText(JSON.stringify({ op: "cmd", req: 1, type: "prompt", message: "go" }));
  await flush();
  assert.equal(socket.outgoing.at(-1).op, "cmd_ok");
});

test("models.list works after hello without an open session", async () => {
  const socket = fakeSocket();
  const conn = attachRelayConnection(socket, {
    authenticate() {
      return { ok: true, serverId: "s_server", deviceId: "d_phone", token: "new-token-value" };
    },
    async listModels() {
      return [
        { provider: "openai", id: "gpt-5", name: "GPT-5" },
        { provider: "anthropic", id: "claude", name: "claude" },
      ];
    },
    ...noopTimers(),
  });

  conn.onText(helloPairing());
  await flush();
  assert.equal(socket.outgoing[0].op, "hello_ok");

  conn.onText(JSON.stringify({ op: "models.list" }));
  await flush();
  const frame = socket.outgoing.find((entry) => entry.op === "models");
  assert.deepEqual(frame, {
    op: "models",
    models: [
      { provider: "openai", id: "gpt-5", name: "GPT-5" },
      { provider: "anthropic", id: "claude", name: "claude" },
    ],
  });
  assert.equal(socket.getClosed(), null);
});

test("models.list load failure yields empty list without closing", async () => {
  const socket = fakeSocket();
  const conn = attachRelayConnection(socket, {
    authenticate() {
      return { ok: true, serverId: "s_server", deviceId: "d_phone" };
    },
    async listSessions() {
      return { sessions: [], runningIds: [] };
    },
    async listModels() {
      return [];
    },
    ...noopTimers(),
  });

  conn.onText(helloPairing());
  await flush();
  conn.onText(JSON.stringify({ op: "models.list" }));
  await flush();
  assert.deepEqual(
    socket.outgoing.find((entry) => entry.op === "models"),
    { op: "models", models: [] },
  );
  assert.equal(socket.getClosed(), null);
});

test("session.create lists projects and auto-opens the new session", async () => {
  const socket = fakeSocket();
  const conn = attachRelayConnection(socket, {
    authenticate() {
      return { ok: true, serverId: "s_server", deviceId: "d_phone", token: "tok" };
    },
    async listSessions() {
      return { sessions: [], runningIds: [] };
    },
    async listModels() {
      return [];
    },
    async createSession(input) {
      assert.equal(input.cwd, "/tmp/proj");
      return { sessionId: "sess-new" };
    },
    async openSession(id) {
      assert.equal(id, "sess-new");
      return {
        snapshot: {
          cwd: "/tmp/proj",
          leafId: null,
          messages: [],
          agent: { running: false, ready: true },
        },
        dispose() {},
      };
    },
    async listProjects() {
      return [{ path: "/tmp/proj", name: "proj" }];
    },
    async listFiles() {
      return { path: "/tmp/proj", entries: [{ name: "README.md", path: "/tmp/proj/README.md", dir: false }] };
    },
    listSlash() {
      return [{ name: "plan", requiresArgs: true, hint: "plan" }];
    },
    ...noopTimers(),
  });

  conn.onText(helloPairing());
  await flush();
  conn.onText(JSON.stringify({ op: "projects.list" }));
  await flush();
  conn.onText(JSON.stringify({ op: "slash.list" }));
  await flush();
  conn.onText(JSON.stringify({ op: "files.list", path: "/tmp/proj" }));
  await flush();
  conn.onText(JSON.stringify({ op: "session.create", cwd: "/tmp/proj", message: "hi" }));
  await flush();

  assert.equal(socket.outgoing.find((frame) => frame.op === "projects").projects[0].name, "proj");
  assert.equal(socket.outgoing.find((frame) => frame.op === "slash").commands[0].name, "plan");
  assert.equal(socket.outgoing.find((frame) => frame.op === "files").entries[0].name, "README.md");
  assert.equal(socket.outgoing.find((frame) => frame.op === "session.created").id, "sess-new");
  assert.equal(socket.outgoing.find((frame) => frame.op === "session.snapshot").id, "sess-new");
});

test("files.read, session.delete, and worktrees.list emit server frames", async () => {
  const socket = fakeSocket();
  const conn = attachRelayConnection(socket, {
    authenticate() {
      return { ok: true, serverId: "s_server", deviceId: "d_phone", token: "tok" };
    },
    async listSessions() {
      return { sessions: [], runningIds: [] };
    },
    async listModels() {
      return [];
    },
    async readFile(path) {
      assert.equal(path, "/tmp/proj/README.md");
      return { path, name: "README.md", text: "# hi", encoding: "utf8", bytes: 4 };
    },
    async deleteSession(id) {
      assert.equal(id, "sess-old");
      return { id };
    },
    async listWorktrees(cwd) {
      assert.equal(cwd, "/tmp/proj");
      return {
        cwd,
        projectRoot: "/tmp/proj",
        isGit: true,
        currentWorktreePath: "/tmp/proj",
        worktrees: [{ path: "/tmp/proj", branch: "main", isMain: true }],
      };
    },
    ...noopTimers(),
  });

  conn.onText(helloPairing());
  await flush();
  conn.onText(JSON.stringify({ op: "files.read", path: "/tmp/proj/README.md" }));
  await flush();
  conn.onText(JSON.stringify({ op: "session.delete", id: "sess-old" }));
  await flush();
  conn.onText(JSON.stringify({ op: "worktrees.list", cwd: "/tmp/proj" }));
  await flush();

  const file = socket.outgoing.find((frame) => frame.op === "file");
  assert.equal(file.name, "README.md");
  assert.equal(file.text, "# hi");
  assert.equal(socket.outgoing.find((frame) => frame.op === "session.deleted").id, "sess-old");
  assert.equal(socket.outgoing.some((frame) => frame.op === "sessions"), true);
  assert.equal(socket.outgoing.find((frame) => frame.op === "worktrees").worktrees[0].branch, "main");
});

test("files.write, git.status, branches, skills, plugins, and mcp emit server frames", async () => {
  const socket = fakeSocket();
  const conn = attachRelayConnection(socket, {
    authenticate() {
      return { ok: true, serverId: "s_server", deviceId: "d_phone", token: "tok" };
    },
    async listSessions() {
      return { sessions: [], runningIds: [] };
    },
    async listModels() {
      return [];
    },
    async writeFile(path, text) {
      assert.equal(path, "/tmp/proj/a.ts");
      assert.equal(text, "hi");
      return { path, bytes: 2 };
    },
    async gitStatus(cwd) {
      assert.equal(cwd, "/tmp/proj");
      return { cwd, isGitRepository: true, repositoryRoot: "/tmp/proj", files: [{ filePath: "/tmp/proj/a.ts", status: "modified", code: "M" }] };
    },
    async listBranches(id) {
      assert.equal(id, "sess-1");
      return { id, leafId: "leaf-2", branches: [{ id: "leaf-2", label: "hello", role: "user" }] };
    },
    async listSkills(cwd) {
      return { cwd, skills: [{ name: "demo", description: "d", filePath: "/tmp/SKILL.md", disableModelInvocation: false }] };
    },
    async listPlugins(cwd) {
      return { cwd, packages: [{ source: "@x/y", scope: "global", status: "loaded", disabled: false }] };
    },
    async listMcp() {
      return { inventory: [{ name: "docs", source: "Project level", status: "configured", type: "stdio", enabled: true }] };
    },
    ...noopTimers(),
  });

  conn.onText(helloPairing());
  await flush();
  conn.onText(JSON.stringify({ op: "files.write", path: "/tmp/proj/a.ts", text: "hi" }));
  await flush();
  conn.onText(JSON.stringify({ op: "git.status", cwd: "/tmp/proj" }));
  await flush();
  conn.onText(JSON.stringify({ op: "session.branches", id: "sess-1" }));
  await flush();
  conn.onText(JSON.stringify({ op: "skills.list", cwd: "/tmp/proj" }));
  await flush();
  conn.onText(JSON.stringify({ op: "plugins.list", cwd: "/tmp/proj" }));
  await flush();
  conn.onText(JSON.stringify({ op: "mcp.list" }));
  await flush();

  assert.equal(socket.outgoing.find((frame) => frame.op === "file.written").bytes, 2);
  assert.equal(socket.outgoing.find((frame) => frame.op === "git.status").files[0].code, "M");
  assert.equal(socket.outgoing.find((frame) => frame.op === "branches").leafId, "leaf-2");
  assert.equal(socket.outgoing.find((frame) => frame.op === "skills").skills[0].name, "demo");
  assert.equal(socket.outgoing.find((frame) => frame.op === "plugins").packages[0].source, "@x/y");
  assert.equal(socket.outgoing.find((frame) => frame.op === "mcp").inventory[0].name, "docs");
});

test("session.export, session.leaf, git.diff, skills.toggle, plugins.action, mcp.delete, and mcp.upsert emit server frames", async () => {
  const socket = fakeSocket();
  const conn = attachRelayConnection(socket, {
    authenticate() {
      return { ok: true, serverId: "s_server", deviceId: "d_phone", token: "tok" };
    },
    async listSessions() {
      return { sessions: [], runningIds: [] };
    },
    async listModels() {
      return [];
    },
    async exportSession(id) {
      assert.equal(id, "sess-1");
      return { id, fileName: "omp-session-sess-1.html", bytes: 42, html: "<html></html>" };
    },
    async snapshotLeaf(id, leafId) {
      assert.equal(id, "sess-1");
      assert.equal(leafId, "leaf-9");
      return { leafId, messages: [], agent: { running: false, ready: true } };
    },
    async listBranches(id) {
      assert.equal(id, "sess-1");
      return { id, leafId: "leaf-9", branches: [{ id: "leaf-9", label: "hello" }] };
    },
    async gitDiff(cwd, path) {
      assert.equal(cwd, "/tmp/proj");
      assert.equal(path, "/tmp/proj/a.ts");
      return { path, supported: true, status: "modified", patch: "diff --git a/a.ts" };
    },
    async toggleSkill(cwd, filePath, disable) {
      assert.equal(cwd, "/tmp/proj");
      assert.equal(filePath, "/tmp/proj/SKILL.md");
      assert.equal(disable, true);
      return { filePath, disableModelInvocation: true };
    },
    async listSkills(cwd) {
      return { cwd, skills: [{ name: "demo", description: "d", filePath: "/tmp/proj/SKILL.md", disableModelInvocation: true }] };
    },
    async pluginAction(cwd, action, source, scope) {
      assert.equal(cwd, "/tmp/proj");
      assert.equal(action, "enable");
      assert.equal(source, "@x/y");
      return { cwd, packages: [{ source: "@x/y", scope: scope ?? "global", status: "loaded", disabled: false }] };
    },
    async deleteMcp(cwd, name) {
      assert.equal(cwd, "/tmp/proj");
      assert.equal(name, "docs");
      return { name };
    },
    async upsertMcp(input) {
      assert.equal(input.name, "docs");
      assert.equal(input.type, "stdio");
      return { name: "docs" };
    },
    async listMcp() {
      return { inventory: [{ name: "docs", source: "Project level", status: "configured", type: "stdio", enabled: true }] };
    },
    ...noopTimers(),
  });

  conn.onText(helloPairing());
  await flush();
  conn.onText(JSON.stringify({ op: "session.export", id: "sess-1" }));
  await flush();
  conn.onText(JSON.stringify({ op: "session.leaf", id: "sess-1", leafId: "leaf-9" }));
  await flush();
  conn.onText(JSON.stringify({ op: "git.diff", cwd: "/tmp/proj", path: "/tmp/proj/a.ts" }));
  await flush();
  conn.onText(JSON.stringify({ op: "skills.toggle", cwd: "/tmp/proj", filePath: "/tmp/proj/SKILL.md", disableModelInvocation: true }));
  await flush();
  conn.onText(JSON.stringify({ op: "plugins.action", cwd: "/tmp/proj", action: "enable", source: "@x/y" }));
  await flush();
  conn.onText(JSON.stringify({ op: "mcp.delete", cwd: "/tmp/proj", name: "docs" }));
  await flush();
  conn.onText(JSON.stringify({ op: "mcp.upsert", cwd: "/tmp/proj", name: "docs", type: "stdio", command: "npx", args: ["-y", "x"] }));
  await flush();

  const exported = socket.outgoing.find((frame) => frame.op === "session.exported");
  assert.equal(exported.id, "sess-1");
  assert.equal(exported.fileName, "omp-session-sess-1.html");
  assert.equal(exported.html, "<html></html>");
  const snapshot = socket.outgoing.find((frame) => frame.op === "session.snapshot");
  assert.equal(snapshot.id, "sess-1");
  assert.equal(snapshot.leafId, "leaf-9");
  assert.equal(socket.outgoing.filter((frame) => frame.op === "branches").length >= 1, true);
  assert.equal(socket.outgoing.find((frame) => frame.op === "git.diff").status, "modified");
  assert.equal(socket.outgoing.find((frame) => frame.op === "skill.updated").disableModelInvocation, true);
  assert.equal(socket.outgoing.filter((frame) => frame.op === "skills").length, 1);
  assert.equal(socket.outgoing.find((frame) => frame.op === "plugins").packages[0].source, "@x/y");
  assert.equal(socket.outgoing.find((frame) => frame.op === "mcp.deleted").name, "docs");
  assert.equal(socket.outgoing.find((frame) => frame.op === "mcp.upserted").name, "docs");
  assert.equal(socket.outgoing.filter((frame) => frame.op === "mcp").length, 2);
});

test("session.import, skills.search, agents.list, files.index, projects.add, and auth.providers emit server frames", async () => {
  const socket = fakeSocket();
  const conn = attachRelayConnection(socket, {
    authenticate() {
      return { ok: true, serverId: "s_server", deviceId: "d_phone", token: "tok" };
    },
    async listSessions() {
      return { sessions: [], runningIds: [] };
    },
    async listModels() {
      return [];
    },
    async importSession(fileName, content) {
      assert.equal(fileName, "sess.jsonl");
      assert.ok(content.includes("session"));
      return { id: "sess-new", cwd: "/tmp/proj" };
    },
    async searchSkills(query, limit) {
      assert.equal(query, "pdf");
      assert.equal(limit, 5);
      return { query, results: [{ package: "owner/repo@pdf", installs: "1K installs" }] };
    },
    async listAgents(cwd) {
      assert.equal(cwd, "/tmp/proj");
      return { cwd, agents: [{ name: "my-agent", description: "d", source: "user" }] };
    },
    async searchFiles(cwd, query) {
      assert.equal(cwd, "/tmp/proj");
      assert.equal(query, "read");
      return { cwd, query, matches: [{ path: "README.md" }] };
    },
    async addProject(cwd) {
      assert.equal(cwd, "/tmp/proj");
      return { path: "/tmp/proj", name: "proj" };
    },
    async listProjects() {
      return [{ path: "/tmp/proj", name: "proj" }];
    },
    async listAuthProviders() {
      return { providers: [{ id: "openai", name: "OpenAI", loggedIn: true }] };
    },
    ...noopTimers(),
  });

  conn.onText(helloPairing());
  await flush();
  conn.onText(JSON.stringify({ op: "session.import", fileName: "sess.jsonl", content: '{"type":"session","cwd":"/tmp/proj"}' }));
  await flush();
  conn.onText(JSON.stringify({ op: "skills.search", query: "pdf", limit: 5 }));
  await flush();
  conn.onText(JSON.stringify({ op: "agents.list", cwd: "/tmp/proj" }));
  await flush();
  conn.onText(JSON.stringify({ op: "files.index", cwd: "/tmp/proj", query: "read" }));
  await flush();
  conn.onText(JSON.stringify({ op: "projects.add", cwd: "/tmp/proj" }));
  await flush();
  conn.onText(JSON.stringify({ op: "auth.providers" }));
  await flush();

  assert.equal(socket.outgoing.find((frame) => frame.op === "session.imported").id, "sess-new");
  assert.equal(socket.outgoing.find((frame) => frame.op === "skill.results").results[0].package, "owner/repo@pdf");
  assert.equal(socket.outgoing.find((frame) => frame.op === "agents").agents[0].name, "my-agent");
  assert.equal(socket.outgoing.find((frame) => frame.op === "files.index").matches[0].path, "README.md");
  assert.equal(socket.outgoing.find((frame) => frame.op === "project.added").path, "/tmp/proj");
  assert.equal(socket.outgoing.filter((frame) => frame.op === "sessions").length >= 1, true);
  assert.equal(socket.outgoing.filter((frame) => frame.op === "projects").length >= 1, true);
  assert.equal(socket.outgoing.find((frame) => frame.op === "auth.providers").providers[0].id, "openai");
});
