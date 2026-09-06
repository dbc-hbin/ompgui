import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Duplex } from "node:stream";
import { once } from "node:events";
import { encodeMaskedFrame } from "./websocket-test-fixtures.mjs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  RelayWebSocket,
  encodeUnmaskedFrame,
  tryConsumeClientFrame,
  websocketAcceptKey,
} = await jiti.import("./websocket.ts");

test("accepted backpressure drains without rejecting or duplicating frames", async (t) => {
  let completeWrite;
  const writes = [];
  const socket = new Duplex({
    writableHighWaterMark: 1,
    read() {},
    write(chunk, _encoding, callback) { writes.push(Buffer.from(chunk)); completeWrite = callback; },
  });
  t.after(() => socket.destroy());
  let closed = 0;
  const ws = new RelayWebSocket(socket, { onText() {}, onClose() { closed++; } });
  assert.equal(ws.sendText("snapshot"), true);
  assert.equal(socket.writableNeedDrain, true);
  assert.equal(ws.bufferedAmount, encodeUnmaskedFrame(1, Buffer.from("snapshot")).length);
  const drained = once(socket, "drain");
  completeWrite();
  await drained;
  assert.equal(ws.bufferedAmount, 0);
  assert.equal(ws.sendText("next"), true);
  completeWrite();
  assert.deepEqual(writes, [encodeUnmaskedFrame(1, Buffer.from("snapshot")), encodeUnmaskedFrame(1, Buffer.from("next"))]);
  assert.equal(closed, 0);
});

test("hard pending-byte limit rejects only the unaccepted frame", (t) => {
  const socket = new Duplex({ read() {}, write() {} });
  t.after(() => socket.destroy());
  const ws = new RelayWebSocket(socket, { onText() {}, onClose() {} });
  const text = "x".repeat(250_000);
  assert.equal(ws.sendText(text), true);
  assert.equal(ws.sendText(text), true);
  assert.equal(ws.sendText(text), true);
  const pending = ws.bufferedAmount;
  assert.equal(ws.sendText(text), false);
  assert.equal(ws.bufferedAmount, pending);
});

test("consumes partial frame tails and coalesced frames before enforcing bounds", (t) => {
  const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback(); } });
  t.after(() => socket.destroy());
  const received = [];
  let closed = 0;
  const ws = new RelayWebSocket(socket, { onText(text) { received.push(text); }, onClose() { closed++; } }, 32);
  const first = encodeMaskedFrame(1, Buffer.from("a".repeat(32)), Buffer.alloc(4));
  const next = encodeMaskedFrame(1, Buffer.from("b".repeat(32)), Buffer.alloc(4));
  ws.feed(first.subarray(0, 10));
  ws.feed(Buffer.concat([first.subarray(10), next, first.subarray(0, 12)]));
  assert.deepEqual(received, ["a".repeat(32), "b".repeat(32)]);
  assert.equal(closed, 0);
  ws.feed(first.subarray(12));
  assert.deepEqual(received, ["a".repeat(32), "b".repeat(32), "a".repeat(32)]);
  ws.feed(encodeMaskedFrame(1, Buffer.from("c".repeat(33)), Buffer.alloc(4)));
  assert.equal(closed, 1);
  assert.equal(received.length, 3);
});

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
