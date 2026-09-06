import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  parseClientFrame,
  commandFromRelayCmd,
  RELAY_PROTOCOL_VERSION,
} = await jiti.import("./protocol.ts");

test("parses pairing hello and device hello", () => {
  const pairing = parseClientFrame(JSON.stringify({
    op: "hello",
    protocol: RELAY_PROTOCOL_VERSION,
    pairingSecret: "a".repeat(43),
    label: "Pixel",
  }));
  assert.equal(pairing.op, "hello");
  assert.equal(pairing.pairingSecret.length, 43);

  const device = parseClientFrame(JSON.stringify({
    op: "hello",
    protocol: RELAY_PROTOCOL_VERSION,
    deviceId: "d_abcdefghijklmnopqr",
    token: "b".repeat(43),
  }));
  assert.equal(device.op, "hello");
  assert.equal(device.deviceId.startsWith("d_"), true);
});

test("rejects unknown ops and disallowed commands", () => {
  assert.equal(parseClientFrame("{").code, "invalid_json");
  assert.equal(parseClientFrame(JSON.stringify({ op: "explode" })).code, "unknown_op");
  assert.equal(parseClientFrame(JSON.stringify({ op: "hello", protocol: 2 })).code, "protocol");
  assert.equal(parseClientFrame(JSON.stringify({ op: "cmd", req: 1, type: "bash" })).code, "unsupported_command");
  assert.equal(parseClientFrame(JSON.stringify({
    op: "cmd", req: 1, type: "prompt", message: "hi", images: [{ data: "x" }],
  })).code, "invalid_command");
});

test("parses prompt with valid images and usage op", () => {
  const promptWithImg = parseClientFrame(JSON.stringify({
    op: "cmd", req: 2, type: "prompt", message: "look",
    images: [{ data: "aGVsbG8=", mimeType: "image/png" }],
  }));
  assert.equal(promptWithImg.op, "cmd");
  assert.deepEqual(promptWithImg.images, [{ data: "aGVsbG8=", mimeType: "image/png" }]);
  assert.deepEqual(commandFromRelayCmd(promptWithImg), {
    type: "prompt",
    message: "look",
    images: [{ data: "aGVsbG8=", mimeType: "image/png" }],
  });

  const usage = parseClientFrame(JSON.stringify({ op: "usage" }));
  assert.deepEqual(usage, { op: "usage" });
});

test("maps allowed cmds to rpc-manager send bodies", () => {
  const prompt = parseClientFrame(JSON.stringify({ op: "cmd", req: 7, type: "prompt", message: "hi" }));
  assert.deepEqual(commandFromRelayCmd(prompt), { type: "prompt", message: "hi" });
  const abort = parseClientFrame(JSON.stringify({ op: "cmd", req: 8, type: "abort" }));
  assert.deepEqual(commandFromRelayCmd(abort), { type: "abort" });
  const model = parseClientFrame(JSON.stringify({
    op: "cmd", req: 9, type: "set_model", provider: "openai", modelId: "gpt",
  }));
  assert.deepEqual(commandFromRelayCmd(model), { type: "set_model", provider: "openai", modelId: "gpt" });
});

test("parses models.list client frame", () => {
  const frame = parseClientFrame(JSON.stringify({ op: "models.list" }));
  assert.deepEqual(frame, { op: "models.list" });
});

test("parses settings.get and settings.update frames", () => {
  const get = parseClientFrame(JSON.stringify({ op: "settings.get" }));
  assert.deepEqual(get, { op: "settings.get" });

  const update = parseClientFrame(JSON.stringify({ op: "settings.update", settings: { theme: "dark" } }));
  assert.deepEqual(update, { op: "settings.update", settings: { theme: "dark" } });

  const invalid = parseClientFrame(JSON.stringify({ op: "settings.update", settings: "dark" }));
  assert.equal(invalid.code, "invalid_settings");

  const missing = parseClientFrame(JSON.stringify({ op: "settings.update" }));
  assert.equal(missing.code, "invalid_settings");
});

test("parses session.create, projects, files, slash, and extra cmds", () => {
  const created = parseClientFrame(JSON.stringify({
    op: "session.create",
    cwd: "/Users/me/ompgui",
    message: "hello",
    provider: "openai",
    modelId: "gpt",
    thinkingLevel: "high",
  }));
  assert.equal(created.op, "session.create");
  assert.equal(created.cwd, "/Users/me/ompgui");
  assert.equal(created.thinkingLevel, "high");

  assert.deepEqual(parseClientFrame(JSON.stringify({ op: "projects.list" })), { op: "projects.list" });
  assert.deepEqual(parseClientFrame(JSON.stringify({ op: "slash.list" })), { op: "slash.list" });
  const files = parseClientFrame(JSON.stringify({ op: "files.list", path: "/tmp" }));
  assert.equal(files.op, "files.list");
  assert.equal(files.path, "/tmp");

  const thinking = parseClientFrame(JSON.stringify({
    op: "cmd", req: 4, type: "set_thinking_level", level: "high",
  }));
  assert.deepEqual(commandFromRelayCmd(thinking), { type: "set_thinking_level", level: "high" });
  assert.deepEqual(
    commandFromRelayCmd(parseClientFrame(JSON.stringify({ op: "cmd", req: 5, type: "compact" }))),
    { type: "compact" },
  );
  assert.deepEqual(
    commandFromRelayCmd(parseClientFrame(JSON.stringify({ op: "cmd", req: 6, type: "get_subagents" }))),
    { type: "get_subagents" },
  );
});

test("relayModelsFrame sanitizes invalid model identities", async () => {
  const { relayModelsFrame, toRelayModelOption } = await jiti.import("./protocol.ts");

  assert.deepEqual(
    toRelayModelOption({ provider: "openai", id: "gpt-5", name: "GPT-5" }),
    { provider: "openai", id: "gpt-5", name: "GPT-5" },
  );
  // name falls back to id.
  assert.deepEqual(
    toRelayModelOption({ provider: "anthropic", id: "claude" }),
    { provider: "anthropic", id: "claude", name: "claude" },
  );
  // missing provider/id or non-objects are dropped.
  assert.equal(toRelayModelOption({ id: "x" }), null);
  assert.equal(toRelayModelOption({ provider: "p" }), null);
  assert.equal(toRelayModelOption(null), null);
  assert.equal(toRelayModelOption("openai/gpt"), null);

  // name capped at 128 chars; provider/id preserved exactly up to 512 chars
  const long = "a".repeat(200);
  const clipped = toRelayModelOption({ provider: long, id: long, name: long });
  assert.equal(clipped.provider.length, 200);
  assert.equal(clipped.id.length, 200);
  assert.equal(clipped.name.length, 128);
  assert.equal(toRelayModelOption({ provider: "a".repeat(513), id: "x" }), null);
  assert.equal(toRelayModelOption({ provider: "x", id: "a".repeat(513) }), null);

  assert.deepEqual(relayModelsFrame(undefined), { op: "models", models: [] });
});

test("parses files.read, session lifecycle, archives, and worktrees", () => {
  const read = parseClientFrame(JSON.stringify({ op: "files.read", path: "/tmp/a.ts" }));
  assert.equal(read.op, "files.read");
  assert.equal(read.path, "/tmp/a.ts");
  assert.equal(parseClientFrame(JSON.stringify({ op: "files.read" })).code, "invalid_path");

  const del = parseClientFrame(JSON.stringify({ op: "session.delete", id: "sess-1" }));
  assert.equal(del.op, "session.delete");
  assert.equal(parseClientFrame(JSON.stringify({ op: "session.delete", id: "" })).code, "invalid_session");

  const renamed = parseClientFrame(JSON.stringify({ op: "session.rename", id: "sess-1", name: "Hello" }));
  assert.equal(renamed.op, "session.rename");
  assert.equal(renamed.name, "Hello");
  assert.equal(parseClientFrame(JSON.stringify({ op: "session.rename", id: "sess-1", name: "  " })).code, "invalid_name");

  assert.deepEqual(parseClientFrame(JSON.stringify({ op: "sessions.archives" })), { op: "sessions.archives" });
  const restore = parseClientFrame(JSON.stringify({ op: "session.restore", key: "2026/a.jsonl.gz" }));
  assert.equal(restore.op, "session.restore");

  const trees = parseClientFrame(JSON.stringify({ op: "worktrees.list", cwd: "/tmp/proj" }));
  assert.equal(trees.op, "worktrees.list");
  const added = parseClientFrame(JSON.stringify({ op: "worktrees.add", cwd: "/tmp/proj", branch: "feat" }));
  assert.equal(added.op, "worktrees.add");
  assert.equal(added.branch, "feat");
});

test("parses files.write, git, branches, export, skills, plugins, and mcp", () => {
  const write = parseClientFrame(JSON.stringify({ op: "files.write", path: "/tmp/a.ts", text: "export const x = 1;" }));
  assert.equal(write.op, "files.write");
  assert.equal(parseClientFrame(JSON.stringify({ op: "files.write", path: "/tmp/a.ts" })).code, "invalid_text");

  const git = parseClientFrame(JSON.stringify({ op: "git.status", cwd: "/tmp/proj" }));
  assert.equal(git.op, "git.status");
  const diff = parseClientFrame(JSON.stringify({ op: "git.diff", cwd: "/tmp/proj", path: "/tmp/proj/a.ts" }));
  assert.equal(diff.op, "git.diff");

  const branches = parseClientFrame(JSON.stringify({ op: "session.branches", id: "sess-1" }));
  assert.equal(branches.op, "session.branches");
  const leaf = parseClientFrame(JSON.stringify({ op: "session.leaf", id: "sess-1", leafId: "entry-9" }));
  assert.equal(leaf.op, "session.leaf");
  assert.equal(parseClientFrame(JSON.stringify({ op: "session.leaf", id: "sess-1" })).code, "invalid_leaf");

  assert.equal(parseClientFrame(JSON.stringify({ op: "session.export", id: "sess-1" })).op, "session.export");
  assert.equal(parseClientFrame(JSON.stringify({ op: "skills.list", cwd: "/tmp/proj" })).op, "skills.list");
  const toggle = parseClientFrame(JSON.stringify({
    op: "skills.toggle", cwd: "/tmp/proj", filePath: "/tmp/proj/SKILL.md", disableModelInvocation: true,
  }));
  assert.equal(toggle.op, "skills.toggle");
  assert.equal(toggle.disableModelInvocation, true);

  const plugin = parseClientFrame(JSON.stringify({
    op: "plugins.action", cwd: "/tmp/proj", action: "enable", source: "@x/y",
  }));
  assert.equal(plugin.op, "plugins.action");
  assert.equal(parseClientFrame(JSON.stringify({ op: "plugins.action", cwd: "/tmp/proj", action: "enable" })).code, "invalid_source");

  assert.equal(parseClientFrame(JSON.stringify({ op: "mcp.list" })).op, "mcp.list");
  const upsert = parseClientFrame(JSON.stringify({
    op: "mcp.upsert", cwd: "/tmp/proj", name: "docs", type: "stdio", command: "npx", args: ["-y", "x"],
  }));
  assert.equal(upsert.op, "mcp.upsert");
  assert.equal(upsert.command, "npx");
});

test("parses session.import, skills search/install, agents, files.index, and projects", () => {
  const imported = parseClientFrame(JSON.stringify({
    op: "session.import", fileName: "sess.jsonl", content: '{"type":"session","cwd":"/tmp"}',
  }));
  assert.equal(imported.op, "session.import");
  assert.equal(imported.fileName, "sess.jsonl");
  assert.equal(parseClientFrame(JSON.stringify({ op: "session.import", fileName: "a.jsonl", content: "  " })).code, "invalid_content");
  assert.equal(parseClientFrame(JSON.stringify({ op: "session.import", fileName: "a.jsonl", content: "x".repeat(180_001) })).code, "invalid_content");
  assert.equal(parseClientFrame(JSON.stringify({ op: "session.import", fileName: "../a.jsonl", content: "{}" })).code, "invalid_file_name");

  const search = parseClientFrame(JSON.stringify({ op: "skills.search", query: "pdf", limit: 5 }));
  assert.equal(search.op, "skills.search");
  assert.equal(search.limit, 5);
  assert.deepEqual(parseClientFrame(JSON.stringify({ op: "skills.search", query: "pdf" })), { op: "skills.search", query: "pdf" });
  assert.equal(parseClientFrame(JSON.stringify({ op: "skills.search", query: "" })).code, "invalid_query");
  assert.equal(parseClientFrame(JSON.stringify({ op: "skills.search", query: "x", limit: 99 })).code, "invalid_limit");

  const install = parseClientFrame(JSON.stringify({ op: "skills.install", package: "owner/repo@skill", scope: "project", cwd: "/tmp/proj" }));
  assert.equal(install.op, "skills.install");
  assert.equal(install.scope, "project");
  assert.equal(parseClientFrame(JSON.stringify({ op: "skills.install", package: "x@y", scope: "bogus" })).code, "invalid_scope");

  assert.deepEqual(parseClientFrame(JSON.stringify({ op: "agents.list" })), { op: "agents.list" });
  assert.equal(parseClientFrame(JSON.stringify({ op: "agents.list", cwd: "/tmp/proj" })).op, "agents.list");
  const save = parseClientFrame(JSON.stringify({
    op: "agents.save", name: "my-agent", description: "does things", systemPrompt: "be helpful", scope: "project", cwd: "/tmp/proj",
  }));
  assert.equal(save.op, "agents.save");
  assert.equal(save.name, "my-agent");
  assert.equal(parseClientFrame(JSON.stringify({
    op: "agents.save", name: "Bad_Name", description: "d", systemPrompt: "s", scope: "user",
  })).code, "invalid_name");
  const del = parseClientFrame(JSON.stringify({ op: "agents.delete", name: "my-agent", scope: "user" }));
  assert.equal(del.op, "agents.delete");
  assert.equal(parseClientFrame(JSON.stringify({ op: "agents.delete", name: "x", scope: "bogus" })).code, "invalid_scope");

  assert.deepEqual(parseClientFrame(JSON.stringify({ op: "auth.providers" })), { op: "auth.providers" });

  const index = parseClientFrame(JSON.stringify({ op: "files.index", cwd: "/tmp/proj", query: "read" }));
  assert.equal(index.op, "files.index");
  assert.equal(index.query, "read");
  assert.equal(parseClientFrame(JSON.stringify({ op: "files.index", cwd: "/tmp/proj" })).code, "invalid_query");
  assert.equal(parseClientFrame(JSON.stringify({ op: "files.index", cwd: "/tmp/proj", query: "x".repeat(101) })).code, "invalid_query");

  assert.equal(parseClientFrame(JSON.stringify({ op: "projects.add", cwd: "/tmp/proj" })).op, "projects.add");
  assert.equal(parseClientFrame(JSON.stringify({ op: "projects.remove", cwd: "/tmp/proj" })).op, "projects.remove");
  assert.equal(parseClientFrame(JSON.stringify({ op: "projects.add", cwd: "" })).code, "invalid_cwd");
});
