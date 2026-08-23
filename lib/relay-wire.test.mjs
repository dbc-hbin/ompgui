import test from "node:test";
import assert from "node:assert/strict";

const wire = await import("./relay-wire.ts");

const message = {
  role: "assistant",
  model: "model",
  provider: "provider",
  responseId: "raw-response",
  content: [{ type: "text", text: "hello", textSignature: "sig", providerMetadata: { nested: [1, true] } }],
};
const envelope = { wire: 1, sessionId: "s", epoch: 2, seq: 4 };

 test("parses compact-v1 frames and preserves unknown raw metadata", () => {
  const frame = {
    ...envelope,
    type: "message_commit",
    messageId: "m",
    authoritative: true,
    message,
    futureField: { preserved: "yes" },
  };
  const parsed = wire.parseRelayFrame(frame);
  assert.equal(parsed, frame);
  assert.equal(parsed.message.responseId, "raw-response");
  assert.deepEqual(parsed.futureField, { preserved: "yes" });
  assert.equal(wire.relayEnvelopeIdentity(frame), "s:2:4");
  assert.equal(wire.sameRelayEnvelope(frame, { ...frame }), true);
});

test("validates sync, event, patch, begin, commit, and close discriminants", () => {
  const frames = [
    { ...envelope, type: "relay_sync", headSeq: 4, commitSeq: 3, requiresStateRefresh: false, active: null },
    { ...envelope, type: "event", event: { type: "message_update", unknown: { keep: true } } },
    { ...envelope, type: "message_begin", messageId: "m", revision: 0, message },
    { ...envelope, type: "message_patch", messageId: "m", baseRevision: 0, revision: 1, operations: [{ op: "append_text", index: 0, text: "!" }] },
    { ...envelope, type: "message_commit", messageId: "m", authoritative: true, message },
    { ...envelope, type: "session_closed", reason: "destroyed" },
  ];
  for (const frame of frames) assert.equal(wire.isRelayFrame(frame), true, frame.type);
});

test("rejects wrong wire, unsafe sequence, malformed operation, and non-authoritative commit", () => {
  assert.throws(() => wire.parseRelayFrame({ ...envelope, wire: 2, type: "event", event: {} }), wire.RelayFrameValidationError);
  assert.throws(() => wire.parseRelayFrame({ ...envelope, seq: -1, type: "event", event: {} }), wire.RelayFrameValidationError);
  assert.throws(() => wire.parseRelayFrame({ ...envelope, type: "message_patch", messageId: "m", baseRevision: 0, revision: 1, operations: [{ op: "append_text", index: 0, text: 1 }] }), wire.RelayFrameValidationError);
  assert.equal(wire.safeParseRelayFrame({ ...envelope, type: "message_commit", messageId: "m", authoritative: false, message }).ok, false);
  assert.throws(
    () => wire.parseRelayFrame({ ...envelope, type: "relay_sync", headSeq: 3, commitSeq: 3, requiresStateRefresh: false, active: null }),
    wire.RelayFrameValidationError,
  );
});
