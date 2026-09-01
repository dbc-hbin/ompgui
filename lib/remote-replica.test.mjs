import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  REMOTE_REPLICA_MAX_MESSAGES,
  REMOTE_REPLICA_MAX_TEXT_CHARS,
  loadRemoteReplicaSnapshot,
  parseRemoteReplicaJson,
  persistRemoteReplicaSnapshot,
  projectRemoteReplica,
} = await jiti.import("./remote-replica.ts");

test("projects only bounded text from safe display roles", () => {
  const snapshot = projectRemoteReplica({
    origin: "https://omp.example.test",
    session: { id: "session-1", name: "Demo", cwd: "/tmp/demo" },
    leafId: "leaf-2",
    updatedAt: 123,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "hello" },
          { type: "image", data: "BASE64_IMAGE_SHOULD_NOT_SURVIVE", mimeType: "image/png" },
        ],
      },
      {
        role: "assistant",
        model: "provider/model",
        provider: "provider",
        usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        content: [
          { type: "thinking", thinking: "PRIVATE_THINKING_SHOULD_NOT_SURVIVE" },
          { type: "toolCall", toolCallId: "tool-1", toolName: "read", input: { path: "/secret" } },
          { type: "text", text: "answer" },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "tool-1",
        content: [{ type: "text", text: "TOOL_OUTPUT_SHOULD_NOT_SURVIVE" }],
        details: { credentials: "API_KEY_SHOULD_NOT_SURVIVE" },
      },
      { role: "bashExecution", command: "cat secret", output: "BASH_OUTPUT_SHOULD_NOT_SURVIVE" },
      { role: "developer", content: "SYSTEM_INSTRUCTION_SHOULD_NOT_SURVIVE" },
      { role: "fileMention", files: [{ path: "/secret", content: "FILE_CONTENT_SHOULD_NOT_SURVIVE" }] },
      { role: "custom", customType: "hidden", display: false, content: "HIDDEN_SHOULD_NOT_SURVIVE" },
      { role: "custom", customType: "python-execution", display: true, content: "PYTHON_OUTPUT_SHOULD_NOT_SURVIVE" },
      { role: "custom", customType: "visible", display: true, content: "custom text" },
    ],
  });

  assert.ok(snapshot);
  assert.deepEqual(snapshot.session.messages.map(({ role, text }) => ({ role, text })), [
    { role: "user", text: "hello" },
    { role: "assistant", text: "answer" },
    { role: "custom", text: "custom text" },
  ]);
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.session.id, "session-1");
  assert.equal(snapshot.session.title, "Demo");
  assert.equal(snapshot.session.leafId, "leaf-2");
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of ["BASE64_IMAGE", "PRIVATE_THINKING", "TOOL_OUTPUT", "BASH_OUTPUT", "SYSTEM_INSTRUCTION", "FILE_CONTENT", "PYTHON_OUTPUT", "API_KEY", "tool-1", "provider/model"]) {
    assert.equal(serialized.includes(forbidden), false, `replica contains ${forbidden}`);
  }
});

test("keeps the newest 50 safe messages and bounds text", () => {
  const snapshot = projectRemoteReplica({
    origin: "https://omp.example.test",
    session: { id: "session-2" },
    messages: Array.from({ length: REMOTE_REPLICA_MAX_MESSAGES + 7 }, (_, index) => ({
      role: "user",
      content: `${index}:${"x".repeat(REMOTE_REPLICA_MAX_TEXT_CHARS + 100)}`,
    })),
  });

  assert.ok(snapshot);
  assert.equal(snapshot.session.messages.length, REMOTE_REPLICA_MAX_MESSAGES);
  assert.equal(snapshot.session.messages[0].text.startsWith("7:"), true);
  assert.equal(snapshot.session.messages.at(-1)?.text.startsWith("56:"), true);
  assert.equal(snapshot.session.messages.every((message) => message.text.length <= REMOTE_REPLICA_MAX_TEXT_CHARS), true);
});

test("parser drops unsafe fields and malformed messages before restore", () => {
  const parsed = parseRemoteReplicaJson(JSON.stringify({
    version: 1,
    origin: "https://omp.example.test",
    updatedAt: 42,
    credentials: "must be dropped",
    session: {
      id: "session-3",
      messages: [
        { role: "user", text: "safe", credentials: "must be dropped" },
        { role: "toolResult", text: "tool output" },
        { role: "assistant", text: "" },
      ],
    },
  }));

  assert.deepEqual(parsed?.session.messages, [{ role: "user", text: "safe" }]);
  assert.equal(JSON.stringify(parsed).includes("credentials"), false);
});

test("persists safe snapshots to browser and native storage", () => {
  const previousWindow = globalThis.window;
  const values = new Map();
  let nativeJson = null;
  globalThis.window = {
    localStorage: {
      setItem(key, value) { values.set(key, value); },
    },
    OmpguiRemoteReplica: {
      storeSnapshot(json) { nativeJson = json; },
    },
  };
  try {
    const snapshot = projectRemoteReplica({
      origin: "https://omp.example.test",
      session: { id: "session-adapter" },
      messages: [{ role: "user", content: "cached text" }],
      updatedAt: 9,
    });
    assert.ok(snapshot);
    assert.equal(persistRemoteReplicaSnapshot(snapshot), true);
    assert.equal(values.size, 1);
    const browserJson = values.values().next().value;
    assert.equal(typeof browserJson, "string");
    assert.deepEqual(JSON.parse(browserJson), snapshot);
    assert.equal(typeof nativeJson, "string");
    assert.deepEqual(JSON.parse(nativeJson), snapshot);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("loads only a sanitized matching replica and never AgentMessage fields", () => {
  const previousWindow = globalThis.window;
  const values = new Map();
  globalThis.window = {
    localStorage: {
      getItem(key) { return values.get(key) ?? null; },
      setItem(key, value) { values.set(key, value); },
    },
    location: { origin: "https://omp.example.test" },
  };
  try {
    const snapshot = projectRemoteReplica({
      origin: "https://omp.example.test",
      session: { id: "session-load" },
      messages: [
        { role: "user", content: "cached" },
        { role: "toolResult", toolCallId: "tool-1", content: [{ type: "text", text: "secret" }] },
      ],
      updatedAt: 11,
    });
    assert.ok(snapshot);
    persistRemoteReplicaSnapshot(snapshot);

    const loaded = loadRemoteReplicaSnapshot("session-load", "https://omp.example.test");
    assert.deepEqual(loaded?.session.messages, [{ role: "user", text: "cached" }]);
    assert.equal(Object.keys(loaded.session.messages[0]).sort().join(","), "role,text");
    assert.equal(JSON.stringify(loaded).includes("secret"), false);
    assert.equal(loadRemoteReplicaSnapshot("other-session", "https://omp.example.test"), null);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
