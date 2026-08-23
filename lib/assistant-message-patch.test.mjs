import test from "node:test";
import assert from "node:assert/strict";

const patch = await import("./assistant-message-patch.ts");

function assistant(content, extra = {}) {
  return { role: "assistant", model: "m", provider: "p", ...extra, content };
}

test("diff/apply appends Unicode text and thinking without mutating snapshots", () => {
  const previous = assistant([
    { type: "text", text: "안녕 🌍", textSignature: "same" },
    { type: "thinking", thinking: "考", thinkingSignature: "same" },
  ]);
  const next = assistant([
    { type: "text", text: "안녕 🌍 친구", textSignature: "same" },
    { type: "thinking", thinking: "考え中", thinkingSignature: "same" },
  ]);
  const operations = patch.diffAssistantMessage(previous, next);
  assert.deepEqual(operations, [
    { op: "append_text", index: 0, text: " 친구" },
    { op: "append_thinking", index: 1, thinking: "え中" },
  ]);
  const applied = patch.applyAssistantMessagePatch(previous, operations);
  assert.deepEqual(applied, next);
  assert.equal(previous.content[0].text, "안녕 🌍");
});

test("signature or unknown ancillary changes use set_block rather than append", () => {
  const oldText = "a".repeat(300);
  const previous = assistant([{ type: "text", text: oldText, textSignature: "old", raw: { keep: true } }]);
  const next = assistant([{ type: "text", text: `${oldText}b`, textSignature: "new", raw: { keep: true } }]);
  const operations = patch.diffAssistantMessage(previous, next);
  assert.equal(operations[0].op, "set_block");
  assert.deepEqual(patch.applyAssistantMessagePatch(previous, operations), next);
});

test("tool-call partial changes replace the complete block and preserve metadata", () => {
  const previous = assistant([{ type: "toolCall", toolCallId: "t", toolName: "read", input: { path: "/tmp/a", partial: "x" }, rawBlock: { vendor: "all" }, thoughtSignature: "sig" }]);
  const next = assistant([{ type: "toolCall", toolCallId: "t", toolName: "read", input: { path: "/tmp/a", partial: "xy" }, rawBlock: { vendor: "all" }, thoughtSignature: "sig" }]);
  const operations = patch.diffAssistantMessage(previous, next);
  assert.equal(operations[0].op, "set_block");
  assert.deepEqual(patch.applyAssistantMessagePatch(previous, operations), next);
});

test("block additions and truncation are represented atomically", () => {
  const previous = assistant([{ type: "text", text: "x".repeat(120) }, { type: "text", text: "y".repeat(120) }, { type: "text", text: "z".repeat(120) }]);
  const added = assistant([...previous.content, { type: "image", data: "blob:sha256:abc", vendor: { untouched: true } }]);
  const addOps = patch.diffAssistantMessage(previous, added);
  assert.equal(addOps.at(-1).op, "set_block");
  assert.deepEqual(patch.applyAssistantMessagePatch(previous, addOps), added);
  const shortened = assistant([previous.content[0]]);
  const truncateOps = patch.diffAssistantMessage(previous, shortened);
  assert.equal(truncateOps.at(-1).op, "truncate_content");
  assert.deepEqual(patch.applyAssistantMessagePatch(previous, truncateOps), shortened);
});

test("message metadata changes use authoritative replacement", () => {
  const previous = assistant([{ type: "text", text: "same" }], { api: "a", providerPayload: { retry: 1 } });
  const next = assistant([{ type: "text", text: "same" }], { api: "b", providerPayload: { retry: 2 } });
  assert.deepEqual(patch.diffAssistantMessage(previous, next), [{ op: "replace_message", message: next }]);
});

test("patch application rejects malformed chains atomically", () => {
  const previous = assistant([{ type: "text", text: "base", nested: { untouched: true } }]);
  const before = structuredClone(previous);
  assert.throws(() => patch.applyAssistantMessagePatch(previous, [
    { op: "append_text", index: 0, text: " partial" },
    { op: "append_text", index: 9, text: "bad" },
  ]), patch.AssistantMessagePatchError);
  assert.deepEqual(previous, before);
  assert.throws(() => patch.applyAssistantMessagePatch(previous, [{ op: "replace_message", message: assistant([]) }, { op: "truncate_content", length: 0 }]), patch.AssistantMessagePatchError);
});
