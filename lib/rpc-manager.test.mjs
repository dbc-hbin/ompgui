import assert from "node:assert/strict";
import test from "node:test";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { createJiti } from "jiti";

test("native ask select survives reconnect and only its pending response is forwarded", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { AgentSessionWrapper } = await createJiti(import.meta.url).import("./rpc-manager.ts");
  let receive;
  const sent = [];
  const proc = { isAlive: true, onFrame(fn) { receive = fn; return () => {}; }, sendFrame(frame) { sent.push(frame); } };
  const session = new AgentSessionWrapper(proc, process.cwd());
  session.start();
  const request = { type: "extension_ui_request", id: "ask-choice", method: "select", title: "Which storage? (1/2)", options: ["SQLite (Recommended)", "Other (type your own)"], optionDetails: [{ description: "Local file" }, {}], timeout: 1000 };
  receive(request);
  const events = [];
  const detach = session.onEvent(event => events.push(event));
  assert.deepEqual(events[0], { type: "extension_ui_pending", ids: ["ask-choice"] });
  assert.equal(events[1].optionDetails[0].description, "Local file");
  detach();
  const replay = [];
  session.onEvent(event => replay.push(event));
  assert.equal(replay[1].id, "ask-choice");
  await assert.rejects(session.send({ type: "extension_ui_response", id: "wrong", value: "SQLite (Recommended)" }), error => error.code === "dialog_not_pending");
  await assert.rejects(session.send({ type: "extension_ui_response", id: "ask-choice", value: "not offered" }), error => error.code === "invalid_dialog_response");
  assert.deepEqual(sent, []);
  await session.send({ type: "extension_ui_response", id: "ask-choice", value: "SQLite (Recommended)" });
  assert.deepEqual(sent, [{ type: "extension_ui_response", id: "ask-choice", value: "SQLite (Recommended)" }]);
  assert.equal(replay.at(-1).targetId, "ask-choice");
  await assert.rejects(session.send({ type: "extension_ui_response", id: "ask-choice", value: "SQLite (Recommended)" }), error => error.code === "dialog_not_pending");
  receive({ ...request, id: "expired" });
  t.mock.timers.tick(1001);
  assert.equal(replay.at(-1).targetId, "expired");
  await assert.rejects(session.send({ type: "extension_ui_response", id: "expired", value: "SQLite (Recommended)" }), error => error.code === "dialog_not_pending");
  receive({ ...request, id: "expired-before-timer" });
  t.mock.timers.setTime(Date.now() + 1001);
  await assert.rejects(session.send({ type: "extension_ui_response", id: "expired-before-timer", value: "SQLite (Recommended)" }), error => error.code === "dialog_not_pending");
  assert.equal(replay.at(-1).targetId, "expired-before-timer");
  t.mock.timers.tick(1001);
  assert.equal(replay.filter(event => event.method === "cancel" && event.targetId === "expired-before-timer").length, 1);
  receive({ ...request, id: "cancelled" });
  receive({ type: "extension_ui_request", method: "cancel", id: "cancel-event", targetId: "cancelled" });
  const afterCancel = [];
  session.onEvent(event => afterCancel.push(event));
  assert.deepEqual(afterCancel[0], { type: "extension_ui_pending", ids: [] });
});

test("MCP list send failures do not orphan a rejected waiter", async () => {
  const jiti = createJiti(import.meta.url);
  const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
  const sendError = new Error("prompt write failed");
  const proc = {
    isAlive: true,
    sendCommand() {
      return Promise.reject(sendError);
    },
  };
  const session = new AgentSessionWrapper(proc, process.cwd());
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    await assert.rejects(session.getMcpList(), (error) => error === sendError);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
    // The send failure must clear the waiter, not leave the next request stuck
    // behind the mcp_list_loading guard.
    await assert.rejects(session.getMcpList(), (error) => error === sendError);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("resolveSpawnCwdResult uses a live recorded directory and reports fallback otherwise", async () => {
  const jiti = createJiti(import.meta.url);
  const { resolveSpawnCwdResult } = jiti("./rpc-manager.ts");
  const { existsSync } = await import("node:fs");

  const live = process.cwd();
  assert.deepEqual(resolveSpawnCwdResult(live), { cwd: live, fellBack: false });

  const missing = "/nonexistent/path/that/should/not/exist";
  const result = resolveSpawnCwdResult(missing);
  assert.equal(result.fellBack, true);
  assert.ok(existsSync(result.cwd), "fallback cwd must exist on disk");
  assert.equal(result.cwd, process.cwd());

  assert.equal(resolveSpawnCwdResult(undefined).fellBack, true);
});

test("concurrent starts wait for disposal while destroy observers close immediately", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const previousBin = process.env.OMPGUI_OMP_BIN;
  process.env.OMPGUI_OMP_BIN = process.execPath;
  t.after(() => {
    if (previousBin === undefined) delete process.env.OMPGUI_OMP_BIN;
    else process.env.OMPGUI_OMP_BIN = previousBin;
  });
  const children = [];
  t.mock.method(childProcess, "spawn", () => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    });
    children.push(child);
    child.stdin.on("data", (chunk) => {
      const command = JSON.parse(chunk.toString());
      child.stdout.write(`${JSON.stringify({
        type: "response", id: command.id, command: command.type, success: true,
        data: command.type === "get_state" ? { sessionId: "lifecycle-test" } : {},
      })}\n`);
    });
    queueMicrotask(() => child.stdout.write('{"type":"ready"}\n'));
    return child;
  });
  // Earlier tests may have loaded RpcProcess through Node's native TS/ESM
  // loader. Updating the CommonJS builtin object alone leaves its already
  // imported named `spawn` export pointing at the real process launcher.
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const jiti = createJiti(import.meta.url);
  const { startRpcSession, getRpcSession } = jiti("./rpc-manager.ts");
  const previousRegistry = globalThis.__ompSessions;
  const previousLocks = globalThis.__ompStartLocks;
  globalThis.__ompSessions = new Map();
  globalThis.__ompStartLocks = new Map();
  t.after(() => {
    globalThis.__ompSessions = previousRegistry;
    globalThis.__ompStartLocks = previousLocks;
  });
  const { session } = await startRpcSession("lifecycle-test", "", process.cwd());
  let closed = 0;
  session.onDestroy(() => { closed++; });
  session.onDestroy(() => { throw new Error("observer failed"); });
  const disposing = session.destroyAndWait();
  assert.equal(closed, 1);
  assert.equal(session.isAlive(), false);
  assert.equal(getRpcSession("lifecycle-test"), session);
  const first = startRpcSession("lifecycle-test", "", process.cwd());
  const second = startRpcSession("lifecycle-test", "", process.cwd());
  await Promise.resolve();
  assert.equal(children.length, 1, "no replacement may spawn during disposal");
  children[0].emit("exit", 0, null);
  await disposing;
  const [replacement, concurrent] = await Promise.all([first, second]);
  assert.equal(children.length, 2);
  assert.equal(replacement.session, concurrent.session);
  assert.notEqual(replacement.session, session);
  assert.equal(getRpcSession("lifecycle-test"), replacement.session);
  assert.equal(closed, 1);
  const finalDisposal = replacement.session.destroyAndWait();
  children[1].emit("exit", 0, null);
  await finalDisposal;
  assert.equal(getRpcSession("lifecycle-test"), undefined);
});
