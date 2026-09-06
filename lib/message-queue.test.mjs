import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  parseMessageQueueItem,
  parseMessageQueueSnapshot,
  parseRecallQueuedMessageResult,
  snapshotFromAgentState,
} = await jiti.import("./message-queue.ts");

test("parses authoritative items with stable ids and duplicate text", () => {
  const snapshot = parseMessageQueueSnapshot({
    revision: 3,
    items: [
      { id: "q1", text: "same", lane: "followUp", status: "queued" },
      { id: "q2", text: "same", lane: "steer", status: "sending" },
      { id: "q3", text: "failed row", lane: "followUp", status: "failed", error: "timeout" },
    ],
  });
  assert.deepEqual(snapshot?.items.map((item) => item.id), ["q1", "q2", "q3"]);
  assert.equal(snapshot?.items[1].lane, "steer");
  assert.equal(snapshot?.items[1].status, "sending");
  assert.equal(snapshot?.items[2].error, "timeout");
  assert.equal(parseMessageQueueItem({ text: "no-id", lane: "steer", status: "queued" }), null);
});

test("strict parser rejects invalid lane, status, item, and shape", () => {
  assert.equal(parseMessageQueueSnapshot({ revision: 1, items: [{ id: "q1", text: "x", kind: "steer", status: "queued" }] }), null);
  assert.equal(parseMessageQueueSnapshot({ revision: 1, items: [{ id: "q1", text: "x", lane: "steering", status: "queued" }] }), null);
  assert.equal(parseMessageQueueSnapshot({ revision: 1, items: [{ id: "q1", text: "x", lane: "steer", status: "pending" }] }), null);
  assert.equal(parseMessageQueueSnapshot({ revision: 1, items: [{ id: "q1", message: "x", lane: "steer", status: "queued" }] }), null);
  assert.equal(parseMessageQueueSnapshot({ queuedMessageCount: 2 }), null);
  assert.equal(parseMessageQueueItem({ id: "q1", text: "x", lane: "steer", status: "queued", error: 1 }), null);
});

test("reads SSE envelopes and ignores command results as events", () => {
  const fromEvent = parseMessageQueueSnapshot({
    type: "message_queue_update",
    queue: { revision: 9, items: [{ id: "a", text: "later", lane: "steer", status: "queued" }] },
  });
  assert.equal(fromEvent?.revision, 9);
  assert.equal(fromEvent?.items[0].id, "a");
  assert.equal(parseMessageQueueSnapshot({ queue: { revision: 1, items: [] } }), null);

  const result = parseRecallQueuedMessageResult({
    queue: { revision: 4, items: [] },
    recalled: { id: "q1", text: "restored", lane: "followUp", status: "queued" },
  });
  assert.equal(result?.recalled.text, "restored");
  assert.equal(result?.queue.revision, 4);
  assert.equal(parseRecallQueuedMessageResult({ queue: { revision: 4, items: [] } }), null);
  assert.equal(parseRecallQueuedMessageResult({ text: "old-shape", queue: { revision: 1, items: [] } }), null);
});

test("snapshotFromAgentState reads only messageQueue", () => {
  const fromQueue = snapshotFromAgentState({
    queuedMessageCount: 2,
    queue: { revision: 1, items: [{ id: "q1", text: "no", lane: "steer", status: "queued" }] },
  });
  assert.equal(fromQueue, null);
  const fromMessageQueue = snapshotFromAgentState({
    queuedMessageCount: 2,
    messageQueue: { revision: 5, items: [{ id: "q1", text: "yes", lane: "followUp", status: "queued" }] },
  });
  assert.equal(fromMessageQueue?.revision, 5);
  assert.equal(fromMessageQueue?.items[0].text, "yes");
});
