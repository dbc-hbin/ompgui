import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { RelayAttachmentStore, ATTACHMENT_CHUNK_BYTES, ATTACHMENT_EXPIRY_MS } = await jiti.import("./attachments.ts");
const { MAX_ATTACHED_IMAGE_BYTES, MAX_ATTACHED_IMAGES } = await jiti.import("../image-attachments.ts");

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "relay-attachments-test-"));
  let now = 1000;
  const timers = new Map();
  const schedule = (fn, delay) => {
    const token = { unref() {} };
    timers.set(token, { fn, deadline: now + delay });
    return token;
  };
  const store = new RelayAttachmentStore(() => now, schedule, token => timers.delete(token), root);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { store, root, advance(ms) {
    now += ms;
    for (const [token, timer] of timers) if (timer.deadline <= now) { timers.delete(token); timer.fn(); }
  } };
}

function upload(store, owner, bytes) {
  const { attachmentId, maxChunkBytes } = store.begin(owner, "image/png", bytes.length);
  assert.equal(maxChunkBytes, ATTACHMENT_CHUNK_BYTES);
  for (let offset = 0; offset < bytes.length; offset += maxChunkBytes) {
    const chunk = bytes.subarray(offset, offset + maxChunkBytes);
    assert.deepEqual(store.chunk(owner, attachmentId, offset, chunk.toString("base64")), { nextOffset: offset + chunk.length });
  }
  store.complete(owner, attachmentId);
  return attachmentId;
}

const code = expected => error => error.code === expected;

test("ownership, sequential canonical chunks and exact final size survive rejected operations", t => {
  const { store } = fixture(t);
  const { attachmentId: id } = store.begin("owner", "image/png", 3);
  assert.throws(() => store.chunk("other", id, 0, "YQ=="), code("invalid_attachment"));
  assert.throws(() => store.abort("other", id), code("invalid_attachment"));
  assert.throws(() => store.chunk("owner", id, 1, "YQ=="), code("invalid_offset"));
  assert.throws(() => store.chunk("owner", id, 0, "YR=="), code("invalid_chunk"));
  assert.throws(() => store.chunk("owner", id, 0, "YQ==\n"), code("invalid_chunk"));
  store.chunk("owner", id, 0, "YQ==");
  assert.throws(() => store.complete("owner", id), code("incomplete_attachment"));
  assert.throws(() => store.chunk("owner", id, 1, "YmNk"), code("invalid_chunk"));
  store.chunk("owner", id, 1, "YmM=");
  store.complete("owner", id);
  assert.throws(() => store.chunk("owner", id, 3, "ZA=="), code("invalid_offset"));
  const claim = store.claim("owner", [id]);
  assert.deepEqual(claim.materialize(), [{ type: "image", mimeType: "image/png", data: "YWJj" }]);
  assert.throws(() => store.claim("owner", [id]), code("invalid_attachment"));
  claim.dispose();
  assert.throws(() => store.complete("owner", id), code("invalid_attachment"));
});

test("claim is atomic across duplicate, incomplete and foreign batches", t => {
  const { store } = fixture(t);
  const good = upload(store, "owner", Buffer.from("a"));
  const other = upload(store, "other", Buffer.from("b"));
  const incomplete = store.begin("owner", "image/png", 1).attachmentId;
  assert.throws(() => store.claim("owner", [good, good]), code("invalid_attachment"));
  assert.throws(() => store.claim("owner", [good, other]), code("invalid_attachment"));
  assert.throws(() => store.claim("owner", [good, incomplete]), code("incomplete_attachment"));
  const claim = store.claim("owner", [good]);
  assert.equal(claim.materialize()[0].data, "YQ==");
  claim.dispose();
});

test("ten full-size images stage through bounded chunks with private permissions and exact bytes", t => {
  const { store, root } = fixture(t);
  const bytes = Buffer.alloc(MAX_ATTACHED_IMAGE_BYTES, 0xa5);
  const ids = Array.from({ length: MAX_ATTACHED_IMAGES }, () => upload(store, "owner", bytes));
  assert.throws(() => store.begin("owner", "image/png", 1), code("attachment_quota"));
  for (const directory of readdirSync(root)) {
    const path = join(root, directory, "image");
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(path).size, bytes.length);
  }
  const claim = store.claim("owner", ids);
  const images = claim.materialize();
  assert.equal(images.length, MAX_ATTACHED_IMAGES);
  for (const image of images) assert.deepEqual(Buffer.from(image.data, "base64"), bytes);
  claim.dispose();
  assert.deepEqual(readdirSync(root), []);
});

test("image, chunk, count and global reservation quotas are bounded before writing", t => {
  const { store } = fixture(t);
  for (const size of [0, -1, 1.5, MAX_ATTACHED_IMAGE_BYTES + 1]) assert.throws(() => store.begin("a", "image/png", size), code("invalid_images"));
  assert.throws(() => store.begin("a", "text/plain", 1), code("invalid_images"));
  const id = store.begin("a", "image/png", MAX_ATTACHED_IMAGE_BYTES).attachmentId;
  assert.throws(() => store.chunk("a", id, 0, Buffer.alloc(ATTACHMENT_CHUNK_BYTES + 1).toString("base64")), code("invalid_chunk"));
  for (let i = 1; i < 51; i++) store.begin(`device-${i}`, "image/png", MAX_ATTACHED_IMAGE_BYTES);
  assert.throws(() => store.begin("overflow", "image/png", MAX_ATTACHED_IMAGE_BYTES), code("attachment_quota"));
  store.abort("a", id);
  store.begin("reclaimed", "image/png", MAX_ATTACHED_IMAGE_BYTES);
});

test("expiry, disconnect and revoke cleanup invalidate even claimed images without touching unrelated files", t => {
  const { store, root, advance } = fixture(t);
  const unrelated = join(root, "user-file");
  writeFileSync(unrelated, "unchanged");
  const id = upload(store, "owner", Buffer.from("a"));
  const claim = store.claim("owner", [id]);
  advance(ATTACHMENT_EXPIRY_MS - 1);
  assert.equal(claim.materialize()[0].data, "YQ==");
  advance(1);
  assert.throws(() => claim.materialize(), code("invalid_attachment"));
  claim.dispose();
  const cancelled = upload(store, "owner", Buffer.from("b"));
  const other = upload(store, "other", Buffer.from("c"));
  const pending = store.claim("owner", [cancelled]);
  store.cleanupDevice("owner");
  assert.throws(() => pending.materialize(), code("invalid_attachment"));
  pending.dispose();
  const kept = store.claim("other", [other]);
  assert.equal(kept.materialize()[0].data, "Yw==");
  kept.dispose();
  assert.equal(readFileSync(unrelated, "utf8"), "unchanged");
  assert.deepEqual(readdirSync(root), ["user-file"]);
});
