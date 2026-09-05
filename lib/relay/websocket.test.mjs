import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  encodeMaskedFrame,
  encodeUnmaskedFrame,
  tryConsumeClientFrame,
  websocketAcceptKey,
} = await jiti.import("./websocket.ts");

test("RFC 6455 sample accept key", () => {
  assert.equal(websocketAcceptKey("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});

test("round-trips a masked text frame", () => {
  const payload = Buffer.from("hello", "utf8");
  const mask = randomBytes(4);
  const encoded = encodeMaskedFrame(1, payload, mask);
  const result = tryConsumeClientFrame(encoded);
  assert.equal(result.status, "ok");
  assert.equal(result.frame.opcode, 1);
  assert.equal(result.frame.payload.toString("utf8"), "hello");
  assert.equal(result.rest.length, 0);
});

test("rejects unmasked client frames and oversized payloads", () => {
  const unmasked = encodeUnmaskedFrame(1, Buffer.from("nope"));
  assert.equal(tryConsumeClientFrame(unmasked).status, "error");
  const huge = Buffer.alloc(200);
  huge[0] = 0x81;
  huge[1] = 0xfe;
  huge.writeUInt16BE(2000, 2);
  randomBytes(4).copy(huge, 4);
  assert.equal(tryConsumeClientFrame(huge, 100).code, 1009);
});

test("accept key is SHA-1 of key plus GUID", () => {
  const key = "x".repeat(24);
  const expected = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  assert.equal(websocketAcceptKey(key), expected);
});
