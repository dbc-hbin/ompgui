import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { RpcProcess } = jiti("./rpc-process.ts");

function makeTransport() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr,
    pid: 4321,
    kill() {
      queueMicrotask(() => child.emit("exit", 0, null));
      return true;
    },
  });
  const commands = [];
  const spawnCalls = [];
  const signals = [];
  let partial = "";
  let onCommand = () => {};
  stdin.on("data", (chunk) => {
    partial += chunk.toString("utf8");
    const lines = partial.split("\n");
    partial = lines.pop();
    for (const line of lines) {
      if (!line) continue;
      const command = JSON.parse(line);
      commands.push(command);
      onCommand(command);
    }
  });
  stdin.on("end", () => queueMicrotask(() => child.emit("exit", 0, null)));
  queueMicrotask(() => {
    stdout.write(`${JSON.stringify({ type: "ready", supportedProtocolVersions: [1, 2] })}\n`);
  });

  return {
    commands,
    spawnCalls,
    signals,
    kill(pid, signal) { signals.push([pid, signal]); return true; },
    child,
    set onCommand(callback) { onCommand = callback; },
    send(frame) { stdout.write(`${JSON.stringify(frame)}\n`); },
    spawn(...args) { spawnCalls.push(args); return child; },
  };
}

function startProcess(transport) {
  return new RpcProcess({
    cwd: process.cwd(),
    dependencies: {
      resolveOmpBin: () => "fake-omp",
      spawn: transport.spawn,
      kill: transport.kill,
    },
  });
}

test("RpcProcess negotiates v2 and correlates out-of-order command responses", async () => {
  const transport = makeTransport();
  transport.onCommand = (command) => {
    if (command.type === "negotiate_protocol") {
      transport.send({ type: "response", id: command.id, command: command.type, success: true, data: { protocolVersion: 2 } });
    }
  };
  const proc = startProcess(transport);
  const ready = await proc.waitReady();
  assert.equal(await proc.negotiateProtocol(ready), 2);

  const received = Promise.withResolvers();
  transport.onCommand = (command) => {
    if (command.type === "second") received.resolve();
  };
  const first = proc.sendCommand({ type: "first" });
  const second = proc.sendCommand({ type: "second" });
  await received.promise;
  const [firstCommand, secondCommand] = transport.commands.slice(-2);
  transport.send({ type: "response", id: secondCommand.id, command: "second", success: true, data: "second" });
  transport.send({ type: "response", id: firstCommand.id, command: "first", success: true, data: "first" });

  assert.equal(await first, "first");
  assert.equal(await second, "second");
  await proc.dispose(0);
});

test("RpcProcess sends native JSONL image prompts without output-protocol input caps", async (t) => {
  // v1 must not inherit the 1 MiB output record bound; negotiated v2 must
  // not inherit the 64 MiB output reassembly bound at the full web limit.
  for (const [version, imageCount] of [[1, 2], [2, 10]]) {
    await t.test(`protocol ${version}: ${imageCount} images of 10 MiB`, async () => {
      const transport = makeTransport();
      const imageData = Buffer.alloc(10 * 1024 * 1024, 0x61).toString("base64");
      const images = Array.from({ length: imageCount }, () => ({ type: "image", mimeType: "image/png", data: imageData }));
      transport.onCommand = (command) => {
        // Actual native stdin dispatches type/id directly, with no chunk decoder.
        assert.notEqual(command.type, "rpc_chunk");
        assert.equal(typeof command.id, "string");
        let data;
        switch (command.type) {
          case "negotiate_protocol": data = { protocolVersion: 2 }; break;
          case "prompt":
            assert.equal(command.message, "Inspect\nthese images 𐐀");
            assert.deepEqual(command.images, images);
            data = "accepted";
            break;
          case "get_state": data = { isStreaming: false }; break;
          default: assert.fail(`Unknown native command: ${command.type}`);
        }
        transport.send({ type: "response", id: command.id, command: command.type, success: true, data });
      };
      const proc = startProcess(transport);
      try {
        const ready = await proc.waitReady();
        if (version === 2) await proc.negotiateProtocol(ready);
        const prompt = proc.sendCommand({ type: "prompt", message: "Inspect\nthese images 𐐀", images });
        const state = proc.sendCommand({ type: "get_state" });
        assert.deepEqual(await Promise.all([prompt, state]), ["accepted", { isStreaming: false }]);
        const commands = transport.commands.slice(-2);
        assert.deepEqual(commands.map((command) => command.type), ["prompt", "get_state"]);
        assert.notEqual(commands[0].id, commands[1].id);
      } finally {
        await proc.dispose(0);
      }
    });
  }
});

test("RpcProcess does not create a separate Windows console", async () => {
  const transport = makeTransport();
  const proc = startProcess(transport);
  assert.equal(transport.spawnCalls[0][2].windowsHide, true);
  if (process.platform === "win32") assert.equal(transport.spawnCalls[0][2].detached, false);
  await proc.dispose(0);
});

test("RpcProcess consumes child pipe errors without swallowing write failures", async () => {
  const transport = makeTransport();
  const proc = startProcess(transport);
  assert.ok(transport.child.stdin.listenerCount("error") > 0);
  assert.ok(transport.child.stdout.listenerCount("error") > 0);

  // These are emitted during real child teardown and must not become uncaught
  // EventEmitter errors in the host process.
  transport.child.stdout.emit("error", new Error("stdout closed"));
  transport.child.stdin.emit("error", new Error("stdin closed"));

  const writeStarted = Promise.withResolvers();
  const originalWrite = transport.child.stdin.write.bind(transport.child.stdin);
  let finishWrite;
  let failedCommand;
  transport.child.stdin.write = (chunk, callback) => {
    failedCommand = JSON.parse(chunk);
    finishWrite = callback;
    writeStarted.resolve();
    return false;
  };
  const failed = assert.rejects(proc.sendCommand({ type: "write_failure" }), /write failed/);
  const next = proc.sendCommand({ type: "get_state" });
  await writeStarted.promise;
  // A false return must retain backpressure until the stream callback runs.
  assert.equal(failedCommand.type, "write_failure");
  assert.deepEqual(transport.commands, []);
  transport.child.stdin.write = originalWrite;
  transport.onCommand = (command) => {
    transport.send({ type: "response", id: command.id, command: command.type, success: true, data: "recovered" });
  };
  finishWrite(new Error("write failed"));
  await failed;
  assert.equal(await next, "recovered");
  const unsolicited = [];
  proc.onFrame((frame) => unsolicited.push(frame));
  transport.send({ type: "response", id: failedCommand.id, command: failedCommand.type, success: true });
  assert.equal(unsolicited[0]?.id, failedCommand.id, "failed command must no longer be pending");

  transport.child.stdin.write = () => { throw new Error("synchronous write failure"); };
  await assert.rejects(proc.sendCommand({ type: "sync_failure" }), /synchronous write failure/);
  transport.child.stdin.write = originalWrite;
  assert.equal(await proc.sendCommand({ type: "get_state" }), "recovered");
  await proc.dispose(0);
});

test("RpcProcess reassembles v2 events and rejects pending commands when the child crashes", async () => {
  const transport = makeTransport();
  transport.onCommand = (command) => {
    if (command.type === "negotiate_protocol") {
      transport.send({ type: "response", id: command.id, command: command.type, success: true, data: { protocolVersion: 2 } });
    }
  };
  const proc = startProcess(transport);
  const ready = await proc.waitReady();
  await proc.negotiateProtocol(ready);

  const frames = [];
  proc.onFrame((frame) => frames.push(frame));
  const expected = { type: "message_update", content: "x".repeat(1024 * 1024) };
  const bytes = Buffer.from(JSON.stringify(expected));
  const chunkSize = 256 * 1024;
  const count = Math.ceil(bytes.length / chunkSize);
  for (let index = 0; index < count; index++) {
    transport.send({
      type: "rpc_chunk", chunkId: "event-1", index, count, byteLength: bytes.length,
      data: bytes.subarray(index * chunkSize, (index + 1) * chunkSize).toString("base64"),
    });
  }
  assert.deepEqual(frames, [expected]);

  const pending = proc.sendCommand({ type: "never_returns" });
  transport.child.emit("exit", 7, null);
  await assert.rejects(pending, /omp exited/);
});

test("leader exit reaps its surviving group and retires ownership before late disposal", { skip: process.platform === "win32" }, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const transport = makeTransport();
  let descendantAlive = true;
  transport.kill = (pid, signal) => {
    assert.equal(pid, -transport.child.pid);
    if (signal === "SIGKILL") descendantAlive = false;
    transport.signals.push([pid, signal]);
    return true;
  };
  const proc = startProcess(transport);
  await proc.waitReady();
  const disposing = proc.dispose(100);
  transport.child.emit("exit", 0, null);
  assert.equal(descendantAlive, false, "leader exit must not leave its descendant running");
  await disposing;
  const signalsAtExit = [...transport.signals];
  t.mock.timers.tick(10_000);
  await proc.dispose();
  transport.child.emit("exit", 0, null);
  assert.deepEqual(transport.signals, signalsAtExit, "retired group IDs must never be signalled later");
});

test("failed spawn never signals a group and settles pending disposal", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const transport = makeTransport();
  const proc = startProcess(transport);
  const disposing = proc.dispose(100);
  transport.child.emit("error", new Error("spawn failed"));
  await disposing;
  t.mock.timers.tick(10_000);
  await proc.dispose();
  assert.deepEqual(transport.signals, []);
});

test("shutdown escalates once and concurrent disposal shares completion", { skip: process.platform === "win32" }, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const transport = makeTransport();
  transport.child.stdin.removeAllListeners("end");
  const proc = startProcess(transport);
  await proc.waitReady();
  const first = proc.dispose(100);
  assert.equal(proc.dispose(100), first);
  t.mock.timers.tick(100);
  assert.deepEqual(transport.signals, [[-4321, "SIGTERM"]]);
  t.mock.timers.tick(100);
  assert.deepEqual(transport.signals, [[-4321, "SIGTERM"], [-4321, "SIGKILL"]]);
  transport.child.emit("exit", 0, "SIGKILL");
  await first;
});
