import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { MAX_RPC_FRAME_BYTES, MAX_RPC_REASSEMBLED_BYTES, RpcFrameDecoder } = await jiti.import("./rpc-frame.ts");

function nativeOutputChunks(frame) {
  const bytes = Buffer.from(JSON.stringify(frame));
  const size = 256 * 1024;
  return Array.from({ length: Math.ceil(bytes.length / size) }, (_, index) => ({
    type: "rpc_chunk", chunkId: "native-output", index,
    count: Math.ceil(bytes.length / size), byteLength: bytes.length,
    data: bytes.subarray(index * size, (index + 1) * size).toString("base64"),
  }));
}

test("RPC v2 reassembles native output across UTF-8 chunk boundaries", () => {
  const frame = { type: "message_end", text: "𐐀".repeat(MAX_RPC_FRAME_BYTES / 4) };
  const decoder = new RpcFrameDecoder();
  let decoded;
  for (const chunk of nativeOutputChunks(frame)) decoded = decoder.push(chunk);
  assert.deepEqual(decoded, frame);
});

test("RPC v2 rejects reordered and interrupted native output", () => {
  const chunks = nativeOutputChunks({ type: "message_end", text: "x".repeat(MAX_RPC_FRAME_BYTES) });
  assert.throws(() => new RpcFrameDecoder().push(chunks[1]), /start at index 0/);
  const decoder = new RpcFrameDecoder();
  assert.equal(decoder.push(chunks[0]), undefined);
  assert.throws(() => decoder.push({ type: "message_end" }), /interrupted/);
});

test("RPC v2 retains output reassembly and chunk payload bounds", () => {
  const chunk = {
    type: "rpc_chunk", chunkId: "oversized", index: 0, count: 2,
    byteLength: MAX_RPC_REASSEMBLED_BYTES + 1, data: "eA==",
  };
  assert.throws(() => new RpcFrameDecoder().push(chunk), /invalid RPC chunk metadata/);
  assert.throws(() => new RpcFrameDecoder().push({
    ...chunk, byteLength: MAX_RPC_FRAME_BYTES,
    data: Buffer.alloc(256 * 1024 + 1).toString("base64"),
  }), /payload exceeds the transport limit/);
});
