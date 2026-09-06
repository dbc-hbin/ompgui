import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { encodeRelayFrames, RelayChunkAssembler } = await jiti.import("./chunks.ts");

const PART = 48 * 1024;
const LIMIT = 16 * 1024 * 1024;
const invalid = { code: "relay_chunk_invalid" };

function chunk(transfer, index, count, bytes = Buffer.from("x")) {
  return { op: "chunk", transfer, index, count, data: bytes.toString("base64") };
}

test("physical and logical limits measure UTF-8 bytes, preserving split Unicode", () => {
  const boundary = "a".repeat(256 * 1024 - 2);
  assert.deepEqual(encodeRelayFrames(boundary), [JSON.stringify(boundary)]);
  const value = "😀".repeat(100_000);
  const frames = encodeRelayFrames(value);
  const assembler = new RelayChunkAssembler();
  for (const [index, text] of frames.entries()) {
    assert.ok(Buffer.byteLength(text) <= 256 * 1024);
    const frame = JSON.parse(text);
    assert.equal(assembler.accept(frame), index === frames.length - 1 ? JSON.stringify(value) : null);
  }
  const maximum = "x".repeat(LIMIT - 2);
  const maxFrames = encodeRelayFrames(maximum);
  assert.equal(maxFrames.length, 342);
  let complete = null;
  for (const frame of maxFrames) complete = assembler.accept(JSON.parse(frame));
  assert.equal(complete, JSON.stringify(maximum));
  assert.throws(() => encodeRelayFrames("x".repeat(LIMIT - 1)), { code: "relay_frame_too_large" });
  assert.throws(() => encodeRelayFrames("😀".repeat(LIMIT / 4)), { code: "relay_frame_too_large" });
});

test("strict schema rejects malformed identifiers, counters, and noncanonical base64", () => {
  const base = chunk("valid", 0, 2);
  for (const frame of [
    null, [], {}, { ...base, extra: true }, { ...base, op: "other" },
    { ...base, transfer: "" }, { ...base, transfer: "a".repeat(65) }, { ...base, transfer: "a.b" },
    { ...base, index: -1 }, { ...base, index: 0.5 }, { ...base, index: 2 },
    { ...base, count: 0 }, { ...base, count: 343 }, { ...base, count: Number.MAX_SAFE_INTEGER + 1 },
    { ...base, data: "" }, { ...base, data: "eA" }, { ...base, data: "eA==\n" },
    { ...base, data: "eB==" }, { ...base, data: "____" },
    chunk("large", 0, 2, Buffer.alloc(PART + 1)),
  ]) assert.throws(() => new RelayChunkAssembler().accept(frame), invalid);
});

test("rejects missing, duplicate, reordered, and changed-count parts", () => {
  const assembler = new RelayChunkAssembler();
  assert.throws(() => assembler.accept(chunk("a", 1, 3)), invalid);
  assert.equal(assembler.accept(chunk("a", 0, 3, Buffer.from('"'))), null);
  assert.throws(() => assembler.accept(chunk("a", 0, 3)), invalid);
  assert.throws(() => assembler.accept(chunk("a", 2, 3)), invalid);
  assert.throws(() => assembler.accept(chunk("a", 1, 2)), invalid);
  assert.equal(assembler.accept(chunk("a", 1, 3)), null);
  assert.equal(assembler.accept(chunk("a", 2, 3, Buffer.from('"'))), '"x"');
});

test("fixed expiry does not extend on progress and sweeping reclaims capacity", () => {
  let now = 0;
  const assembler = new RelayChunkAssembler(() => now);
  for (const id of ["a", "b", "c", "d"]) assembler.accept(chunk(id, 0, 3));
  assert.throws(() => assembler.accept(chunk("e", 0, 2)), invalid);
  now = 29_999;
  assert.equal(assembler.accept(chunk("a", 1, 3)), null);
  now = 30_000;
  assert.throws(() => assembler.accept(chunk("a", 2, 3)), invalid);
  assert.equal(assembler.accept(chunk("e", 0, 2, Buffer.from('"'))), null);
  assert.equal(assembler.accept(chunk("e", 1, 2, Buffer.from('"'))), '""');
});

test("aggregate bytes are bounded across transfers and clear releases all state", () => {
  const assembler = new RelayChunkAssembler();
  const part = Buffer.alloc(PART, 120);
  for (const id of ["a", "b", "c", "d"]) {
    for (let index = 0; index < 85; index++) assembler.accept(chunk(id, index, 342, part));
  }
  assembler.accept(chunk("a", 85, 342, Buffer.alloc(48 * 1024, 120)));
  assembler.accept(chunk("b", 85, 342, Buffer.alloc(16 * 1024, 120)));
  assert.throws(() => assembler.accept(chunk("b", 86, 342, Buffer.from("x"))), invalid);
  assembler.clear();
  assert.throws(() => assembler.accept(chunk("a", 86, 342)), invalid);
  assert.equal(assembler.accept(chunk("fresh", 0, 1, Buffer.from("{}"))), "{}");
});

test("rejects oversized logical transfers, invalid UTF-8, invalid JSON, and nested chunks", () => {
  const assembler = new RelayChunkAssembler();
  const part = Buffer.alloc(PART, 120);
  for (let index = 0; index < 341; index++) assembler.accept(chunk("large", index, 342, part));
  assert.throws(() => assembler.accept(chunk("large", 341, 342, part)), invalid);
  assembler.clear();
  for (const bytes of [Buffer.from([0x22, 0xc0, 0xaf, 0x22]), Buffer.from("not-json"), Buffer.from('{"op":"chunk"}')]) {
    assert.throws(() => assembler.accept(chunk("bad", 0, 1, bytes)), invalid);
  }
  assert.equal(assembler.accept(chunk("bad", 0, 1, Buffer.from("{}"))), "{}");
});
