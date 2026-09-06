import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

function fakeState(overrides = {}) {
  return {
    sessionId: "session-1",
    thinkingLevel: "off",
    isStreaming: false,
    isCompacting: false,
    steeringMode: "all",
    followUpMode: "one-at-a-time",
    interruptMode: "wait",
    autoCompactionEnabled: true,
    messageCount: 0,
    queuedMessageCount: 0,
    todoPhases: [],
    ...overrides,
  };
}

function createHarness(options = {}) {
  const commands = [];
  const pending = [];
  let onFrame = null;
  const proc = {
    isAlive: true,
    async sendCommand(command) {
      commands.push({ ...command });
      if (typeof options.sendCommand === "function") {
        return options.sendCommand(command, { commands, pending, proc });
      }
      if (command.type === "get_state") return fakeState();
      return {};
    },
    onFrame(listener) {
      onFrame = listener;
      return () => {
        if (onFrame === listener) onFrame = null;
      };
    },
    sendFrame() {},
    async dispose() {
      proc.isAlive = false;
      for (const waiter of pending.splice(0)) {
        waiter.reject(new Error("disposed"));
      }
    },
  };
  return { commands, pending, proc, emit(frame) { onFrame?.(frame); } };
}

async function loadWrapper() {
  const jiti = createJiti(import.meta.url);
  return jiti.import("./rpc-manager.ts");
}

async function openSession(t, options = {}) {
  const { AgentSessionWrapper, WebRpcError } = await loadWrapper();
  const harness = createHarness(options);
  const session = new AgentSessionWrapper(harness.proc, process.cwd());
  session.start();
  const events = [];
  session.onEvent((event) => events.push(event));
  t.after(() => session.destroy());
  return { session, harness, events, WebRpcError };
}

function outgoing(commands) {
  return commands.filter((command) => command.type === "prompt" || command.type === "steer" || command.type === "follow_up");
}

async function flush() {
  for (let i = 0; i < 16; i += 1) await Promise.resolve();
}

test("enqueue then recall before terminal yields no original outgoing prompt", async (t) => {
  const { session, harness } = await openSession(t);
  harness.emit({ type: "agent_start" });
  const result = await session.send({ type: "enqueue_message", lane: "followUp", message: "do not send me" });
  assert.equal(result.queue.items[0].text, "do not send me");
  const recalled = await session.send({
    type: "recall_queued_message",
    id: result.queue.items[0].id,
    expectedRevision: result.queue.revision,
  });
  assert.equal(recalled.recalled.text, "do not send me");
  harness.emit({ type: "agent_end", isTerminal: true });
  await flush();
  assert.deepEqual(outgoing(harness.commands), []);
  const state = await session.send({ type: "get_state" });
  assert.equal(state.messageQueue.items.length, 0);
});

test("enqueue then delete before terminal yields no original outgoing prompt", async (t) => {
  const { session, harness } = await openSession(t);
  harness.emit({ type: "agent_start" });
  const result = await session.send({ type: "enqueue_message", lane: "followUp", message: "delete me" });
  await session.send({
    type: "delete_queued_message",
    id: result.queue.items[0].id,
    expectedRevision: result.queue.revision,
  });
  harness.emit({ type: "agent_end", isTerminal: true });
  await flush();
  assert.deepEqual(outgoing(harness.commands), []);
});

test("promotion priority dispatches steer before follow-up", async (t) => {
  const { session, harness } = await openSession(t);
  harness.emit({ type: "agent_start" });
  harness.emit({ type: "tool_execution_start", toolCallId: "t1" });
  await session.send({ type: "enqueue_message", lane: "followUp", message: "after" });
  await session.send({ type: "enqueue_message", lane: "steer", message: "now" });
  assert.deepEqual(outgoing(harness.commands), []);
  harness.emit({ type: "tool_execution_end", toolCallId: "t1" });
  await flush();
  assert.deepEqual(outgoing(harness.commands), [
    { type: "prompt", message: "now", streamingBehavior: "steer" },
  ]);
  harness.emit({ type: "agent_end", isTerminal: true });
  await flush();
  assert.deepEqual(outgoing(harness.commands), [
    { type: "prompt", message: "now", streamingBehavior: "steer" },
    { type: "prompt", message: "after" },
  ]);
});

test("stale CAS is rejected and sending items cannot be mutated", async (t) => {
  let releaseSteer;
  const { session, harness, WebRpcError } = await openSession(t, {
    sendCommand(command, { pending }) {
      if (command.type === "get_state") return fakeState();
      if (command.type === "prompt" && command.streamingBehavior === "steer") {
        return new Promise((resolve, reject) => {
          pending.push({ resolve, reject });
          releaseSteer = () => resolve({});
        });
      }
      return {};
    },
  });
  harness.emit({ type: "agent_start" });
  const enqueuePromise = session.send({ type: "enqueue_message", lane: "steer", message: "hold" });
  await flush();
  const sending = await session.send({ type: "get_state" });
  assert.equal(sending.messageQueue.items[0].status, "sending");
  await assert.rejects(
    session.send({
      type: "delete_queued_message",
      id: sending.messageQueue.items[0].id,
      expectedRevision: 0,
    }),
    (error) => error instanceof WebRpcError && error.code === "queue_stale_revision",
  );
  await assert.rejects(
    session.send({
      type: "delete_queued_message",
      id: sending.messageQueue.items[0].id,
      expectedRevision: sending.messageQueue.revision,
    }),
    (error) => error instanceof WebRpcError && error.code === "queue_item_sending",
  );
  releaseSteer();
  const done = await enqueuePromise;
  assert.equal(done.queue.items.length, 0);
});

test("exact-once drain removes a successful item and does not resend it", async (t) => {
  const { session, harness } = await openSession(t);
  const result = await session.send({ type: "enqueue_message", lane: "followUp", message: "once" });
  assert.deepEqual(outgoing(harness.commands), [{ type: "prompt", message: "once" }]);
  assert.equal(result.queue.items.length, 0);
  const state = await session.send({ type: "get_state" });
  assert.equal(state.messageQueue.items.length, 0);
  harness.emit({ type: "agent_end", isTerminal: true });
  await flush();
  assert.equal(outgoing(harness.commands).length, 1);
});

test("failed send is retained and is not retried", async (t) => {
  const { session, harness } = await openSession(t, {
    sendCommand(command) {
      if (command.type === "get_state") return fakeState();
      if (command.type === "prompt") throw new Error("write failed");
      return {};
    },
  });
  const result = await session.send({ type: "enqueue_message", lane: "followUp", message: "keep failed" });
  assert.equal(result.queue.items[0].status, "failed");
  assert.match(result.queue.items[0].error, /not confirmed/);
  harness.emit({ type: "agent_end", isTerminal: true });
  await flush();
  assert.equal(outgoing(harness.commands).length, 1);
  const recalled = await session.send({
    type: "recall_queued_message",
    id: result.queue.items[0].id,
    expectedRevision: result.queue.revision,
  });
  assert.equal(recalled.recalled.text, "keep failed");
  assert.equal(recalled.queue.items.length, 0);
});

test("tool-active steering is deferred until observed tool completion", async (t) => {
  const { session, harness } = await openSession(t);
  harness.emit({ type: "agent_start" });
  harness.emit({ type: "tool_execution_start", toolCallId: "call-1" });
  await session.send({ type: "enqueue_message", lane: "steer", message: "wait for tool" });
  assert.deepEqual(outgoing(harness.commands), []);
  harness.emit({ type: "tool_execution_end", toolCallId: "call-1" });
  await flush();
  assert.deepEqual(outgoing(harness.commands), [
    { type: "prompt", message: "wait for tool", streamingBehavior: "steer" },
  ]);
});

test("abort holds follow-ups until enqueue or promote resumes them", async (t) => {
  const { session, harness } = await openSession(t);
  harness.emit({ type: "agent_start" });
  const queued = await session.send({ type: "enqueue_message", lane: "followUp", message: "after abort" });
  await session.send({ type: "abort" });
  harness.emit({ type: "agent_end", isTerminal: true });
  await flush();
  assert.deepEqual(outgoing(harness.commands), []);
  await session.send({
    type: "promote_queued_message",
    id: queued.queue.items[0].id,
    expectedRevision: queued.queue.revision,
  });
  assert.deepEqual(outgoing(harness.commands), [{ type: "prompt", message: "after abort" }]);
});

test("teardown and delayed settle cannot resurrect a discarded queue", async (t) => {
  let releasePrompt;
  const { session, harness } = await openSession(t, {
    sendCommand(command, { pending }) {
      if (command.type === "get_state") return fakeState();
      if (command.type === "prompt") {
        return new Promise((resolve, reject) => {
          pending.push({ resolve, reject });
          releasePrompt = () => resolve({});
        });
      }
      return {};
    },
  });
  harness.emit({ type: "agent_start" });
  const queued = session.send({ type: "enqueue_message", lane: "followUp", message: "late" });
  await flush();
  assert.deepEqual(outgoing(harness.commands), []);
  await session.destroyAndWait();
  harness.emit({ type: "agent_end", isTerminal: true });
  releasePrompt?.();
  await queued.catch(() => {});
  await flush();
  assert.deepEqual(outgoing(harness.commands), []);
});

test("reconnect listeners receive the authoritative queue snapshot", async (t) => {
  const jiti = createJiti(import.meta.url);
  const { parseMessageQueueSnapshot, snapshotFromAgentState } = await jiti.import("./message-queue.ts");
  const { session, harness } = await openSession(t);
  harness.emit({ type: "agent_start" });
  await session.send({ type: "enqueue_message", lane: "followUp", message: "still here" });
  const replayed = [];
  const stop = session.onEvent((event) => replayed.push(event));
  t.after(stop);
  const parsedEvent = parseMessageQueueSnapshot(replayed.find((event) => event.type === "message_queue_update"));
  assert.equal(parsedEvent?.items[0].text, "still here");
  const state = await session.send({ type: "get_state" });
  const parsedState = snapshotFromAgentState(state);
  assert.equal(parsedState?.revision, parsedEvent?.revision);
  assert.deepEqual(parsedState?.items, parsedEvent?.items);
  const listed = await session.send({ type: "get_message_queue" });
  assert.deepEqual(listed.queue.items, parsedEvent?.items);
});

test("native prompt/steer/follow_up still forward to omp", async (t) => {
  const { session, harness } = await openSession(t);
  harness.emit({ type: "agent_start" });
  await session.send({ type: "steer", message: "native steer" });
  await session.send({ type: "follow_up", message: "native follow" });
  assert.deepEqual(outgoing(harness.commands), [
    { type: "steer", message: "native steer" },
    { type: "follow_up", message: "native follow" },
  ]);
});

test("terminal agent_end refreshes a stale native count so server followups drain", async (t) => {
  let nativeCount = 2;
  const { session, harness } = await openSession(t, {
    sendCommand(command) {
      if (command.type === "get_state") return fakeState({ queuedMessageCount: nativeCount });
      return {};
    },
  });
  const sampled = await session.send({ type: "get_state" });
  assert.equal(sampled.queuedMessageCount, 2);
  await session.send({ type: "enqueue_message", lane: "followUp", message: "web follow" });
  assert.deepEqual(outgoing(harness.commands), []);
  nativeCount = 0;
  harness.emit({ type: "agent_end", isTerminal: true });
  await flush();
  assert.deepEqual(outgoing(harness.commands), [{ type: "prompt", message: "web follow" }]);
});

test("web followup does not jump ahead of still-native queued work", async (t) => {
  const { session, harness } = await openSession(t, {
    sendCommand(command) {
      if (command.type === "get_state") return fakeState({ queuedMessageCount: 1 });
      return {};
    },
  });
  await session.send({ type: "get_state" });
  await session.send({ type: "enqueue_message", lane: "followUp", message: "web follow" });
  harness.emit({ type: "agent_end", isTerminal: true });
  await flush();
  assert.deepEqual(outgoing(harness.commands), []);
});

test("local-only prompt ack does not leave the dispatch barrier stuck", async (t) => {
  const { session, harness } = await openSession(t, {
    sendCommand(command) {
      if (command.type === "get_state") return fakeState();
      if (command.type === "prompt" && command.message === "/slash") return { agentInvoked: false };
      if (command.type === "follow_up") return { agentInvoked: false };
      return {};
    },
  });
  await session.send({ type: "enqueue_message", lane: "followUp", message: "/slash" });
  await session.send({ type: "enqueue_message", lane: "followUp", message: "hello" });
  assert.deepEqual(outgoing(harness.commands), [
    { type: "prompt", message: "/slash" },
    { type: "prompt", message: "hello" },
  ]);
  harness.emit({ type: "agent_end", isTerminal: true });
  await flush();
  await session.send({ type: "follow_up", message: "/native" });
  await session.send({ type: "enqueue_message", lane: "followUp", message: "after native slash" });
  assert.equal(outgoing(harness.commands).at(-1).message, "after native slash");
});
