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
