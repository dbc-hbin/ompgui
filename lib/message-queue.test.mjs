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

test("snapshots retain attachment metadata but strip private image payloads", () => {
  const image = { type: "image", mimeType: "image/png", data: "AQID" };
  const item = {
    id: "image-only", text: "", lane: "followUp", status: "queued", images: [image],
    attachments: [{ mimeType: image.mimeType, bytes: 3, data: image.data }],
  };
  const expected = {
    id: item.id, text: "", lane: "followUp", status: "queued",
    attachments: [{ mimeType: "image/png", bytes: 3 }],
  };
  const raw = { revision: 2, items: [item] };
  assert.deepEqual(parseMessageQueueItem(item), expected);
  assert.deepEqual(parseMessageQueueSnapshot(raw), { revision: 2, items: [expected] });
  assert.deepEqual(parseMessageQueueSnapshot({ type: "message_queue_update", queue: raw }), { revision: 2, items: [expected] });
  assert.deepEqual(snapshotFromAgentState({ messageQueue: raw }), { revision: 2, items: [expected] });
});

test("recall accepts legacy text and validated private images without leaking queue payloads", () => {
  const legacy = { id: "legacy", text: "old message", lane: "steer", status: "queued" };
  assert.deepEqual(parseRecallQueuedMessageResult({ queue: { revision: 1, items: [] }, recalled: legacy }), {
    queue: { revision: 1, items: [] }, recalled: legacy,
  });
  const images = [{ type: "image", mimeType: "image/png", data: "AQID", privateExtra: "strip" }];
  for (const text of ["", "describe this"]) {
    const recalled = { ...legacy, text, images, attachments: [{ mimeType: "image/png", bytes: 3 }] };
    const result = parseRecallQueuedMessageResult({ queue: { revision: 2, items: [recalled] }, recalled });
    assert.deepEqual(result, {
      queue: { revision: 2, items: [{ ...legacy, text, attachments: recalled.attachments }] },
      recalled: { ...legacy, text, attachments: recalled.attachments, images: [{ type: "image", mimeType: "image/png", data: "AQID" }] },
    });
  }
});

test("recall rejects malformed private images and metadata mismatches", () => {
  const image = { type: "image", mimeType: "image/png", data: "AQID" };
  const attachment = { mimeType: "image/png", bytes: 3 };
  const base = { id: "q1", text: "", lane: "followUp", status: "queued", attachments: [attachment], images: [image] };
  const invalid = [
    { images: null }, { images: {} }, { images: [null] },
    { images: [{ ...image, type: "text" }] }, { images: [{ ...image, data: "!" }] },
    { images: [{ ...image, mimeType: "text/plain" }] },
    { images: [{ type: "image", source: { type: "base64", media_type: "image/png", data: image.data } }] },
    { images: Array(11).fill(image) }, { images: [] }, { images: undefined },
    { attachments: undefined }, { attachments: [] },
    { attachments: [attachment, attachment] },
    { attachments: [{ ...attachment, bytes: 2 }] },
    { attachments: [{ ...attachment, mimeType: "image/jpeg" }] },
  ];
  for (const patch of invalid) {
    assert.equal(parseRecallQueuedMessageResult({ queue: { revision: 1, items: [] }, recalled: { ...base, ...patch } }), null);
  }
});

test("attachment metadata rejects invalid byte, mime and count boundaries", () => {
  const item = { id: "q1", text: "", lane: "steer", status: "queued" };
  const attachment = { mimeType: "image/png", bytes: 3 };
  const invalid = [
    null, {}, [null], [{ bytes: 3 }], [{ ...attachment, mimeType: "text/plain" }],
    ...[0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 10 * 1024 * 1024 + 1, "3"].map((bytes) => [{ ...attachment, bytes }]),
    Array(11).fill(attachment),
  ];
  for (const attachments of invalid) {
    assert.equal(parseMessageQueueSnapshot({ revision: 1, items: [{ ...item, attachments }] }), null);
  }
  const attachments = Array(10).fill({ mimeType: "image/png", bytes: 10 * 1024 * 1024 });
  assert.deepEqual(parseMessageQueueItem({ ...item, attachments }), { ...item, attachments });
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
