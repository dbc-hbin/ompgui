import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { attachRelayConnection } = await jiti.import("./connection.ts");
const { RelayChunkAssembler } = await jiti.import("./chunks.ts");
const { RELAY_PROTOCOL_VERSION } = await jiti.import("./protocol.ts");

function fixture(overrides = {}) {
  const outgoing = [];
  const timers = new Map();
  let timerId = 0;
  let closed = null;
  const socket = {
    bufferedAmount: 0,
    sendText(text) { outgoing.push(JSON.parse(text)); return true; },
    close(code, reason) { closed = { code, reason }; },
  };
  const connection = attachRelayConnection(socket, {
    authenticate: () => ({ ok: true, serverId: "s_parity", deviceId: "d_parity" }),
    isDeviceAuthorized: () => true,
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    listBranches: async (id) => ({ id, leafId: "leaf", branches: [] }),
    ...overrides,
  });
  return { connection, outgoing, timers, get closed() { return closed; } };
}

async function flush() {
  for (let index = 0; index < 512; index++) await Promise.resolve();
}

async function authenticate(f) {
  f.connection.onText(JSON.stringify({ op: "hello", protocol: RELAY_PROTOCOL_VERSION, pairingSecret: "c".repeat(43) }));
  await flush();
  assert.equal(f.outgoing[0].op, "hello_ok");
}

function request(f, req, domain, action, args = {}) {
  f.connection.onText(JSON.stringify({ op: "request", req, domain, action, args }));
}

test("request dispatch bounds pending operations and preserves correlated results", async (t) => {
  const gate = Promise.withResolvers();
  const started = [];
  const f = fixture({ requestHandlers: { files: async (_action, args) => {
    started.push(args.path);
    await gate.promise;
    return { path: args.path };
  } } });
  t.after(() => f.connection.onClose());
  await authenticate(f);
  request(f, 1, "files", "list", { path: "/first" });
  await flush();
  for (let req = 2; req <= 65; req++) request(f, req, "files", "list", { path: `/item-${req}` });
  await flush();
  assert.deepEqual(started, ["/first"]);
  assert.deepEqual(f.outgoing.find(frame => frame.op === "result" && frame.req === 65), { op: "result", req: 65, success: false, error: { code: "busy", message: "Too many pending relay operations" } });
  gate.resolve();
  await flush();
  const results = f.outgoing.filter(frame => frame.op === "result" && frame.success);
  assert.deepEqual(results.map(frame => frame.req), Array.from({ length: 64 }, (_, i) => i + 1));
  assert.deepEqual(results[0], { op: "result", req: 1, success: true, data: { path: "/first" } });
  assert.deepEqual(results.at(-1).data, { path: "/item-64" });
  assert.equal(f.closed, null);
});

test("reopening the same session ignores callbacks belonging to its previous subscription", async (t) => {
  const emitters = [];
  const disposed = [];
  const f = fixture({ openSession: async (_id, emit) => {
    const index = emitters.push(emit) - 1;
    return {
      snapshot: { leafId: "leaf", messages: [], agent: { running: false, ready: true } },
      dispose() { disposed.push(index); },
    };
  } });
  t.after(() => f.connection.onClose());
  await authenticate(f);
  f.connection.onText(JSON.stringify({ op: "session.open", id: "same-session" }));
  await flush();
  f.connection.onText(JSON.stringify({ op: "session.open", id: "same-session" }));
  await flush();
  assert.deepEqual(disposed, [0]);
  emitters[0]({ type: "connected", sessionId: "stale" });
  emitters[1]({ type: "connected", sessionId: "current" });
  await flush();
  assert.deepEqual(f.outgoing.filter(frame => frame.op === "event"), [
    { op: "event", id: "same-session", payload: { type: "connected", sessionId: "current" } },
  ]);
});

test("device revocation closes every socket and suppresses late session events", async (t) => {
  const emitters = [];
  let authorized = true;
  let disposed = 0;
  const deps = {
    isDeviceAuthorized: () => authorized,
    openSession: async (_id, emit) => {
      emitters.push(emit);
      return { snapshot: { leafId: "leaf", messages: [], agent: { running: false, ready: true } }, dispose() { disposed++; } };
    },
    requestHandlers: { system: async () => { authorized = false; return { deviceId: "d_parity" }; } },
  };
  const first = fixture(deps);
  const second = fixture(deps);
  t.after(() => { first.connection.onClose(); second.connection.onClose(); });
  for (const f of [first, second]) {
    await authenticate(f);
    f.connection.onText(JSON.stringify({ op: "session.open", id: "session" }));
    await flush();
  }
  request(first, 7, "system", "devices.revoke", { deviceId: "d_parity" });
  await flush();
  assert.deepEqual(first.outgoing.at(-1), { op: "result", req: 7, success: true, data: { deviceId: "d_parity" } });
  assert.equal(first.closed?.code, 1008);
  assert.equal(second.closed?.code, 1008);
  assert.equal(disposed, 2);
  const before = [first.outgoing.slice(), second.outgoing.slice()];
  for (const emit of emitters) emit({ type: "connected", sessionId: "late" });
  await flush();
  assert.deepEqual([first.outgoing, second.outgoing], before);
  assert.equal(first.timers.size, 0);
  assert.equal(second.timers.size, 0);
});

test("large request results are ordered chunks reconstructing the complete Unicode payload", async (t) => {
  const data = { text: "😀".repeat(100_000) };
  const f = fixture({ requestHandlers: { files: async () => data } });
  t.after(() => f.connection.onClose());
  await authenticate(f);
  request(f, 9, "files", "read", { path: "/large" });
  await flush();
  const frames = f.outgoing.slice(1);
  const assembler = new RelayChunkAssembler();
  let result = null;
  for (const frame of frames) {
    assert.equal(frame.op, "chunk");
    assert.ok(Buffer.byteLength(JSON.stringify(frame)) <= 256 * 1024);
    result = assembler.accept(frame);
  }
  assert.deepEqual(JSON.parse(result), { op: "result", req: 9, success: true, data });
  assert.equal(f.closed, null);
});
