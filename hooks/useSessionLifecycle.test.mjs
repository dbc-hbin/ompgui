import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { useAgentSession } = await jiti.import("./useAgentSession.ts");
const { useSessionMessageQueue } = await jiti.import("./useSessionMessageQueue.ts");

// Like ChatInput.test.mjs, exercise the real hooks with persistent state slots.
// Effects are deliberately disabled: these tests deliver events through the
// hook's subscription ref, not a browser EventSource or background poller.
async function withHooks(useHook, callback) {
  const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previous = internals.H;
  const slots = [];
  let cursor = 0;
  internals.H = {
    useState(initial) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = typeof initial === "function" ? initial() : initial;
      return [slots[slot], (next) => {
        slots[slot] = typeof next === "function" ? next(slots[slot]) : next;
      }];
    },
    useReducer(reducer, initial, initialize) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = initialize ? initialize(initial) : initial;
      return [slots[slot], (action) => { slots[slot] = reducer(slots[slot], action); }];
    },
    useRef(initial) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = { current: initial };
      return slots[slot];
    },
    useMemo(factory) { cursor++; return factory(); },
    useCallback(value) { cursor++; return value; },
    useEffect() { cursor++; },
    useSyncExternalStore(_subscribe, _getSnapshot, getServerSnapshot) {
      cursor++;
      return getServerSnapshot();
    },
  };
  try {
    await callback(() => {
      cursor = 0;
      return useHook();
    });
  } finally {
    internals.H = previous;
  }
}

const queuedDraft = {
  id: "draft-1",
  text: "Important unsent draft",
  lane: "followUp",
  status: "queued",
  attachments: [{ mimeType: "image/png", bytes: 3 }],
};
const recalledDraft = {
  ...queuedDraft,
  images: [{ type: "image", mimeType: "image/png", data: "AQID" }],
};

for (const boundary of ["unchanged", "load generation", "queue epoch", "session switch"]) {
  test(`recall preserves acknowledged text and images across ${boundary}`, async (t) => {
    const ack = Promise.withResolvers();
    const notices = [];
    let context = {
      sessionId: "same-session", loadGeneration: 10, runtimeGeneration: 10,
      alive: true, runtimeReady: true,
    };
    t.mock.method(globalThis, "fetch", (url, options) => {
      assert.equal(url, "/api/agent/same-session");
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), {
        type: "recall_queued_message", id: "draft-1", expectedRevision: 7,
      });
      return ack.promise;
    });
    await withHooks(() => useSessionMessageQueue({
      getSessionContext: () => context,
      canMutateSession: () => true,
      addNotice: (notice) => notices.push(notice),
    }), async (render) => {
      let queue = render();
      queue.handleQueueEvent({ revision: 7, items: [queuedDraft] });
      queue = render();
      const recall = queue.handleRecallQueuedMessage(queuedDraft.id);
      if (boundary === "load generation") context = { ...context, loadGeneration: 11 };
      if (boundary === "queue epoch") queue.beginQueueEpoch();
      if (boundary === "session switch") {
        context = { ...context, sessionId: "other-session", loadGeneration: 11 };
        queue.beginQueueEpoch();
        queue.handleQueueEvent({
          revision: 2,
          items: [{ id: "other-draft", text: "Keep this session's draft", lane: "steer", status: "queued" }],
        });
      }
      const beforeAck = render().queuedMessages;
      // The server has destructively removed the item. Returning null now
      // would lose its only private image payload, regardless of queue fences.
      ack.resolve({ ok: true, status: 200, json: async () => ({
        success: true, data: { queue: { revision: 8, items: [] }, recalled: recalledDraft },
      }) });
      assert.deepEqual(await recall, recalledDraft);
      const afterAck = render().queuedMessages;
      if (boundary === "unchanged") {
        assert.equal(afterAck.revision, 8);
        assert.deepEqual(afterAck.items, []);
      } else {
        assert.deepEqual(afterAck, beforeAck, "stale acknowledgement must not publish its queue snapshot");
      }
      assert.deepEqual(notices, []);
    });
  });
}

const sessionOptions = { session: { id: "same-session", name: "Lifecycle" }, newSessionCwd: null };
const previousMessage = { role: "user", content: [{ type: "text", text: "PREVIOUS RUN" }], timestamp: 1 };
const followupMessage = { role: "user", content: [{ type: "text", text: "AUTOMATIC FOLLOWUP" }], timestamp: 2 };

for (const startsNextRun of [false, true]) {
  test(startsNextRun
    ? "automatic agent_start fences out held terminal history from the previous run"
    : "terminal history remains applicable when no next run starts", async (t) => {
    const history = Promise.withResolvers();
    let historyRequests = 0;
    t.mock.method(globalThis, "fetch", (url) => {
      if (url === "/api/sessions/same-session?deferThinking=1&deferMedia=1") {
        historyRequests++;
        return history.promise;
      }
      if (url === "/api/sessions/same-session/subagents") {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ subagents: [] }) });
      }
      if (url === "/api/agent/same-session") {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ running: false }) });
      }
      assert.fail(`Unexpected request: ${url}`);
    });
    await withHooks(() => useAgentSession(sessionOptions), async (render) => {
      let session = render();
      session.handleAgentEventRef.current({ type: "agent_start" });
      session.handleAgentEventRef.current({ type: "agent_end", isTerminal: true });
      assert.equal(historyRequests, 1, "terminal event must start the held history request");
      if (startsNextRun) {
        session.handleAgentEventRef.current({ type: "agent_start" });
        session.handleAgentEventRef.current({ type: "message_end", message: followupMessage });
        assert.deepEqual(render().messages, [followupMessage]);
      }
      history.resolve({ ok: true, status: 200, json: () => ({
        leafId: "previous-leaf", context: { messages: [previousMessage], entryIds: ["previous-entry"] },
      }) });
      // Flush the fetch continuation and its json await, without real timers.
      await history.promise;
      await Promise.resolve();
      session = render();
      assert.deepEqual(session.messages, [startsNextRun ? followupMessage : previousMessage]);
      assert.equal(session.agentRunning, startsNextRun);
      if (!startsNextRun) assert.equal(session.sessionReadiness.history, "ready");
    });
  });
}

test("duplicate agent_start preserves in-progress assistant content and active tools", async () => {
  await withHooks(() => useAgentSession(sessionOptions), async (render) => {
    let session = render();
    session.handleAgentEventRef.current({ type: "agent_start" });
    const partialAssistant = { role: "assistant", content: [{ type: "text", text: "Still working" }] };
    session.handleAgentEventRef.current({ type: "message_update", message: partialAssistant });
    session.handleAgentEventRef.current({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "bash" });
    session = render();
    const streamingMessage = session.streamState.streamingMessage;
    assert.deepEqual(streamingMessage, partialAssistant);
    session.handleAgentEventRef.current({ type: "agent_start" });
    session = render();
    assert.equal(session.agentRunning, true);
    assert.equal(session.streamState.isStreaming, true);
    assert.deepEqual(session.streamState.streamingMessage, streamingMessage);
    assert.deepEqual(session.agentPhase, { kind: "running_tools", tools: [{ id: "tool-1", name: "bash" }] });
  });
});

test("tool partials upsert by call id, final replaces in place, and late partial cannot overwrite final", async () => {
  await withHooks(() => useAgentSession(sessionOptions), async (render) => {
    let session = render();
    const emit = (event) => session.handleAgentEventRef.current(event);
    emit({ type: "agent_start" });
    emit({ type: "message_end", message: previousMessage });
    emit({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "bash" });
    const firstContent = [{ type: "text", text: "first chunk" }];
    emit({ type: "tool_execution_update", toolCallId: "tool-1", toolName: "bash", partialResult: { content: firstContent } });
    session = render();
    assert.equal(session.messages.length, 2);
    assert.equal(session.messages[1].role, "toolResult");
    assert.equal(session.messages[1].toolCallId, "tool-1");
    assert.deepEqual(session.messages[1].content, firstContent);
    // Another call must retain its own slot while the first call is updated.
    const otherContent = [{ type: "text", text: "other tool output" }];
    emit({ type: "tool_execution_update", toolCallId: "tool-2", toolName: "read", partialResult: { content: otherContent } });
    const updatedContent = [{ type: "text", text: "first chunk\nsecond chunk" }];
    emit({ type: "tool_execution_update", toolCallId: "tool-1", toolName: "bash", partialResult: { content: updatedContent } });
    session = render();
    assert.equal(session.messages.length, 3);
    assert.deepEqual(session.messages[1].content, updatedContent);
    assert.equal(session.messages[2].toolCallId, "tool-2");
    assert.deepEqual(session.messages[2].content, otherContent);
    const final = {
      role: "toolResult", toolCallId: "tool-1", toolName: "bash",
      content: [{ type: "text", text: "complete output" }],
      details: { exitCode: 0 }, isError: false, timestamp: 3,
    };
    emit({ type: "message_end", message: final });
    session = render();
    assert.equal(session.messages.length, 3);
    assert.deepEqual(session.messages[0], previousMessage);
    assert.deepEqual(session.messages[1], final);
    assert.equal(session.messages[2].toolCallId, "tool-2");
    const completedMessages = session.messages;
    emit({ type: "tool_execution_update", toolCallId: "tool-1", toolName: "bash", partialResult: { content: firstContent } });
    assert.deepEqual(render().messages, completedMessages);
  });
});
