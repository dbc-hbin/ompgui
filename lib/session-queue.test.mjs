import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

async function loadSubject() {
  const jiti = createJiti(import.meta.url);
  return jiti.import("./session-queue.ts");
}

const IMAGE = Object.freeze({ type: "image", mimeType: "image/png", data: "AQID" });
// Share the encoded payload across images and tests rather than allocating 100MiB fixtures.
const TEN_MIB_DATA = Buffer.alloc(10 * 1024 * 1024).toString("base64");
const TEN_MIB_IMAGE = Object.freeze({ ...IMAGE, data: TEN_MIB_DATA });
const FULL_IMAGES = Array(10).fill(TEN_MIB_IMAGE);

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test("image-only and mixed entries expose metadata publicly and restore private payloads", async () => {
  const { SessionMessageQueue, toQueueSnapshotEvent } = await loadSubject();
  const queue = new SessionMessageQueue();
  const input = [{ ...IMAGE }];
  const first = queue.enqueue({ lane: "followUp", text: "", images: input });
  const firstId = first.items[0].id;
  input[0].data = "BAUG";
  input.push({ ...IMAGE });
  const mixed = queue.enqueue({ lane: "steer", text: "describe this", images: [IMAGE] });
  assert.deepEqual(mixed.items.map(({ text, attachments }) => ({ text, attachments })), [
    { text: "", attachments: [{ mimeType: "image/png", bytes: 3 }] },
    { text: "describe this", attachments: [{ mimeType: "image/png", bytes: 3 }] },
  ]);
  for (const item of mixed.items) {
    assert.equal("images" in item, false);
    assert.equal("data" in item.attachments[0], false);
  }
  assert.equal(JSON.stringify(toQueueSnapshotEvent(mixed)).includes(IMAGE.data), false);
  assert.deepEqual(queue.getImages(firstId), [IMAGE]);
  const recalled = queue.recall(firstId, mixed.revision);
  assert.equal(recalled.item.text, "");
  assert.deepEqual(recalled.item.images, [IMAGE]);
  assert.deepEqual(recalled.snapshot.items.map((item) => item.id), [mixed.items[1].id]);
  assert.equal(queue.getImages(firstId), undefined);
  assert.deepEqual(queue.getImages(mixed.items[1].id), [IMAGE]);
});

test("invalid images reject atomically without consuming capacity", async () => {
  const { SessionMessageQueue, QUEUE_ERROR_INVALID } = await loadSubject();
  const queue = new SessionMessageQueue();
  const before = queue.enqueue({ lane: "followUp", text: "existing" });
  const oversized = { ...IMAGE, data: `${TEN_MIB_DATA.slice(0, -4)}AAA=` };
  const invalid = [
    null, {}, [null], [{ ...IMAGE, type: "text" }],
    [{ type: "image", source: { type: "base64", media_type: "image/png", data: IMAGE.data } }],
    [{ ...IMAGE, mimeType: "text/plain" }], [{ ...IMAGE, data: "not base64!" }],
    [{ ...IMAGE, data: "" }], Array(11).fill(IMAGE), [oversized], [IMAGE, { ...IMAGE, data: "!" }],
  ];
  for (const images of invalid) {
    assert.throws(() => queue.enqueue({ lane: "followUp", text: "bad", images }),
      (error) => error.code === QUEUE_ERROR_INVALID);
    assert.equal(queue.getSnapshot(), before);
  }
  const full = queue.enqueue({ lane: "followUp", text: "", images: FULL_IMAGES });
  assert.deepEqual(full.items[1].attachments, Array(10).fill({ mimeType: "image/png", bytes: 10 * 1024 * 1024 }));
  assert.deepEqual(queue.getImages(full.items[1].id), FULL_IMAGES);
});

test("stale, sending and duplicate actions preserve the correct private payload", async () => {
  const { SessionMessageQueue, QUEUE_ERROR_STALE, QUEUE_ERROR_SENDING, QUEUE_ERROR_INVALID, QUEUE_ERROR_MISSING } = await loadSubject();
  const queue = new SessionMessageQueue();
  const first = queue.enqueue({ lane: "followUp", text: "same", images: [IMAGE] });
  const otherImage = { ...IMAGE, data: "BAUG" };
  const second = queue.enqueue({ lane: "followUp", text: "same", images: [otherImage] });
  const id = first.items[0].id;
  for (const action of ["recall", "delete", "promote"]) {
    assert.throws(() => queue[action](id, first.revision), (error) => error.code === QUEUE_ERROR_STALE);
    assert.equal(queue.getSnapshot(), second);
    assert.deepEqual(queue.getImages(id), [IMAGE]);
  }
  const promoted = queue.promote(id, second.revision);
  assert.deepEqual(queue.getImages(id), [IMAGE]);
  assert.throws(() => queue.promote(id, promoted.revision), (error) => error.code === QUEUE_ERROR_INVALID);
  const sending = queue.markSending(id);
  for (const action of ["recall", "delete", "promote"]) {
    assert.throws(() => queue[action](id, sending.revision), (error) => error.code === QUEUE_ERROR_SENDING);
  }
  assert.throws(() => queue.markSending(id), (error) => error.code === QUEUE_ERROR_SENDING);
  assert.equal(queue.getSnapshot(), sending);
  assert.deepEqual(queue.getImages(id), [IMAGE]);
  const failed = queue.failSending("uncertain handoff");
  assert.equal(queue.selectDispatchCandidate("steer"), undefined);
  const recalled = queue.recall(id, failed.revision);
  assert.deepEqual(recalled.item.images, [IMAGE]);
  for (const action of ["recall", "delete", "promote"]) {
    assert.throws(() => queue[action](id, recalled.snapshot.revision), (error) => error.code === QUEUE_ERROR_MISSING);
  }
  assert.equal(queue.getSnapshot(), recalled.snapshot);
  assert.deepEqual(queue.getImages(second.items[1].id), [otherImage]);
});

test("aggregate decoded-image capacity is restored by recall, delete, remove and reset", async () => {
  const { SessionMessageQueue, QUEUE_ERROR_IMAGES_TOO_LARGE } = await loadSubject();
  for (const action of ["recall", "delete", "remove", "reset"]) {
    const queue = new SessionMessageQueue();
    const first = queue.enqueue({ lane: "followUp", text: "", images: FULL_IMAGES.slice(0, 5) });
    const full = queue.enqueue({ lane: "followUp", text: "", images: FULL_IMAGES.slice(5) });
    const id = first.items[0].id;
    assert.throws(() => queue.enqueue({ lane: "steer", text: "", images: [IMAGE] }),
      (error) => error.code === QUEUE_ERROR_IMAGES_TOO_LARGE);
    assert.equal(queue.getSnapshot(), full);
    assert.deepEqual(queue.getImages(id), FULL_IMAGES.slice(0, 5));
    const result = queue[action](id, full.revision);
    if (action === "recall") assert.deepEqual(result.item.images, FULL_IMAGES.slice(0, 5));
    assert.equal(queue.getImages(id), undefined);
    if (action === "reset") assert.equal(queue.getImages(full.items[1].id), undefined);
    const replacement = queue.enqueue({ lane: "followUp", text: "", images: action === "reset" ? FULL_IMAGES : FULL_IMAGES.slice(0, 5) });
    assert.deepEqual(queue.getImages(replacement.items.at(-1).id), action === "reset" ? FULL_IMAGES : FULL_IMAGES.slice(0, 5));
    assert.throws(() => queue.enqueue({ lane: "steer", text: "", images: [IMAGE] }),
      (error) => error.code === QUEUE_ERROR_IMAGES_TOO_LARGE);
    const textOnly = queue.enqueue({ lane: "followUp", text: "text needs no image capacity" });
    assert.equal(textOnly.items.at(-1).text, "text needs no image capacity");
  }
});

test("bounded recall rejects oversized acknowledgements without losing images", async () => {
  const { SessionMessageQueue } = await loadSubject();
  const queue = new SessionMessageQueue();
  const sevenMiBImage = { ...IMAGE, data: Buffer.alloc(7 * 1024 * 1024).toString("base64") };
  const images = [sevenMiBImage, sevenMiBImage];
  const before = queue.enqueue({ lane: "followUp", text: "restore both", images });
  const id = before.items[0].id;
  assert.throws(() => queue.recall(id, before.revision, 15 * 1024 * 1024),
    (error) => error.code === "queue_recall_too_large");
  assert.equal(queue.getSnapshot(), before);
  assert.deepEqual(queue.getImages(id), images);
  const recalled = queue.recall(id, before.revision);
  assert.deepEqual(recalled.item.images, images);
  assert.equal(queue.getImages(id), undefined);
  assert.deepEqual(recalled.snapshot.items, []);
  const small = queue.enqueue({ lane: "followUp", text: "", images: [IMAGE] });
  const bounded = queue.recall(small.items[0].id, small.revision, 15 * 1024 * 1024);
  assert.deepEqual(bounded.item.images, [IMAGE]);
  assert.deepEqual(bounded.snapshot.items, []);
});

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
