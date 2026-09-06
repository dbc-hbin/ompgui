import assert from "node:assert/strict";
import test from "node:test";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { createJiti } from "jiti";

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
