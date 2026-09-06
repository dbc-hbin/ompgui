import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

async function loadSubject() {
  const jiti = createJiti(import.meta.url);
  return jiti.import("./session-queue.ts");
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test("duplicate texts get distinct UUID ids and a monotonic revision", async () => {
  const { SessionMessageQueue } = await loadSubject();
  const queue = new SessionMessageQueue();
  const first = queue.enqueue({ lane: "followUp", text: "same" });
  const second = queue.enqueue({ lane: "followUp", text: "same" });
  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.equal(first.items[0].text, "same");
  assert.equal(second.items[1].text, "same");
  assert.match(second.items[0].id, UUID_V4);
  assert.match(second.items[1].id, UUID_V4);
  assert.notEqual(second.items[0].id, second.items[1].id);
  assert.equal(queue.getSnapshot(), second);
  assert.ok(Object.isFrozen(second));
  assert.ok(Object.isFrozen(second.items));
});

test("reset and replacement cannot target new work with an old item id", async () => {
  const { SessionMessageQueue, QUEUE_ERROR_MISSING, QUEUE_ERROR_STALE } = await loadSubject();
  const original = new SessionMessageQueue();
  const before = original.enqueue({ lane: "followUp", text: "same" });
  const oldId = before.items[0].id;
  assert.match(oldId, UUID_V4);
  const cleared = original.reset();
  assert.equal(cleared.revision, 0);
  assert.equal(cleared.items.length, 0);
  assert.throws(() => original.recall(oldId, before.revision), (error) => error.code === QUEUE_ERROR_STALE);
  assert.throws(() => original.delete(oldId, before.revision), (error) => error.code === QUEUE_ERROR_STALE);
  const after = original.enqueue({ lane: "followUp", text: "same" });
  assert.equal(after.revision, before.revision);
  const replacement = new SessionMessageQueue();
  const fresh = replacement.enqueue({ lane: "followUp", text: "same" });
  assert.equal(fresh.revision, before.revision);
  for (const [queue, snapshot] of [[original, after], [replacement, fresh]]) {
    assert.match(snapshot.items[0].id, UUID_V4);
    assert.notEqual(snapshot.items[0].id, oldId);
    assert.throws(() => queue.recall(oldId, snapshot.revision), (error) => error.code === QUEUE_ERROR_MISSING);
    assert.throws(() => queue.delete(oldId, snapshot.revision), (error) => error.code === QUEUE_ERROR_MISSING);
    assert.throws(() => queue.recall(oldId, 0), (error) => error.code === QUEUE_ERROR_STALE);
    assert.equal(queue.getSnapshot(), snapshot);
  }
});

test("stale compare-and-mutate rejects without changing the snapshot", async () => {
  const { SessionMessageQueue, QUEUE_ERROR_STALE } = await loadSubject();
  const queue = new SessionMessageQueue();
  const enqueued = queue.enqueue({ lane: "steer", text: "hello" });
  assert.throws(
    () => queue.delete(enqueued.items[0].id, enqueued.revision - 1),
    (error) => error.code === QUEUE_ERROR_STALE,
  );
  assert.equal(queue.getSnapshot().revision, enqueued.revision);
  assert.equal(queue.getSnapshot().items.length, 1);
});

test("sending items reject recall and delete even with the current revision", async () => {
  const { SessionMessageQueue, QUEUE_ERROR_SENDING } = await loadSubject();
  const queue = new SessionMessageQueue();
  const enqueued = queue.enqueue({ lane: "steer", text: "now" });
  const sending = queue.markSending(enqueued.items[0].id);
  assert.equal(sending.items[0].status, "sending");
  assert.throws(
    () => queue.delete(sending.items[0].id, sending.revision),
    (error) => error.code === QUEUE_ERROR_SENDING,
  );
  assert.throws(
    () => queue.recall(sending.items[0].id, sending.revision),
    (error) => error.code === QUEUE_ERROR_SENDING,
  );
});

test("promote moves only a queued followUp to the front as steer", async () => {
  const { SessionMessageQueue, QUEUE_ERROR_INVALID } = await loadSubject();
  const queue = new SessionMessageQueue();
  queue.enqueue({ lane: "followUp", text: "later" });
  const second = queue.enqueue({ lane: "followUp", text: "sooner" });
  const promoted = queue.promote(second.items[1].id, second.revision);
  assert.equal(promoted.items[0].text, "sooner");
  assert.equal(promoted.items[0].lane, "steer");
  assert.equal(promoted.items[1].text, "later");
  assert.throws(
    () => queue.promote(promoted.items[0].id, promoted.revision),
    (error) => error.code === QUEUE_ERROR_INVALID,
  );
});

test("finite count and byte limits reject before insertion", async () => {
  const {
    SessionMessageQueue,
    SESSION_QUEUE_MAX_ITEMS,
    SESSION_QUEUE_MAX_ITEM_BYTES,
    QUEUE_ERROR_FULL,
    QUEUE_ERROR_TOO_LARGE,
  } = await loadSubject();
  const queue = new SessionMessageQueue();
  for (let index = 0; index < SESSION_QUEUE_MAX_ITEMS; index += 1) {
    queue.enqueue({ lane: "followUp", text: `item-${index}` });
  }
  assert.throws(
    () => queue.enqueue({ lane: "followUp", text: "overflow" }),
    (error) => error.code === QUEUE_ERROR_FULL,
  );
  const small = new SessionMessageQueue();
  assert.throws(
    () => small.enqueue({ lane: "steer", text: "x".repeat(SESSION_QUEUE_MAX_ITEM_BYTES + 1) }),
    (error) => error.code === QUEUE_ERROR_TOO_LARGE,
  );
  assert.equal(small.getSnapshot().items.length, 0);
});

test("failSending keeps queued items and never replays in-flight entries", async () => {
  const { SessionMessageQueue, QUEUE_UNCERTAIN_HANDOFF } = await loadSubject();
  const queue = new SessionMessageQueue();
  queue.enqueue({ lane: "followUp", text: "keep" });
  const second = queue.enqueue({ lane: "steer", text: "inflight" });
  queue.markSending(second.items[1].id);
  const failed = queue.failSending(QUEUE_UNCERTAIN_HANDOFF);
  assert.equal(failed.items[0].status, "queued");
  assert.equal(failed.items[1].status, "failed");
  assert.equal(failed.items[1].error, QUEUE_UNCERTAIN_HANDOFF);
  assert.equal(queue.selectDispatchCandidate("steer"), undefined);
  assert.equal(queue.selectDispatchCandidate("followUp")?.text, "keep");
});
