import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const reducer = await jiti.import("./relay-client-reducer.ts");

function message(text = "") {
  return { role: "assistant", model: "m", provider: "p", content: [{ type: "text", text, rawMetadata: { keep: true } }] };
}
function frame(type, seq, fields = {}, epoch = 1) {
  return { wire: 1, sessionId: "session", epoch, seq, type, ...fields };
}
function sync(seq = 0, active = null, epoch = 1, fields = {}) {
  return frame("relay_sync", seq, { headSeq: seq, commitSeq: seq, requiresStateRefresh: false, active, ...fields }, epoch);
}

test("sync establishes epoch/sequence and active checkpoint", () => {
  const checkpoint = { messageId: "m", revision: 2, message: message("checkpoint") };
  const result = reducer.reduceRelayFrame(reducer.createInitialRelayClientState("session"), sync(7, checkpoint));
  assert.equal(result.effect.type, "sync");
  assert.equal(result.state.lastSeq, 7);
  assert.equal(result.state.activeMessageId, "m");
  assert.deepEqual(result.state.activeMessage, checkpoint.message);
});

test("begin and patch fence message/revision and suppress duplicates", () => {
  let state = reducer.createInitialRelayClientState("session");
  state = reducer.reduceRelayFrame(state, sync()).state;
  const begin = frame("message_begin", 1, { messageId: "m", revision: 0, message: message("") });
  state = reducer.reduceRelayFrame(state, begin).state;
  const patch = frame("message_patch", 2, { messageId: "m", baseRevision: 0, revision: 1, operations: [{ op: "append_text", index: 0, text: "α😀" }] });
  const applied = reducer.reduceRelayFrame(state, patch);
  assert.equal(applied.effect.type, "message_patch");
  assert.equal(applied.state.activeMessage.content[0].text, "α😀");
  const duplicate = reducer.reduceRelayFrame(applied.state, patch);
  assert.equal(duplicate.effect.type, "duplicate");
  assert.equal(duplicate.state.activeRevision, 1);

  const wrongRevision = frame("message_patch", 3, { messageId: "m", baseRevision: 0, revision: 1, operations: [] });
  const rejected = reducer.reduceRelayFrame(applied.state, wrongRevision);
  assert.equal(rejected.effect.type, "desync");
  assert.equal(rejected.effect.reason, "revision_mismatch");
  assert.equal(rejected.state.activeMessage.content[0].text, "α😀");
});

test("gaps desync, then authoritative commit converges exactly", () => {
  let state = reducer.createInitialRelayClientState("session");
  state = reducer.reduceRelayFrame(state, sync()).state;
  state = reducer.reduceRelayFrame(state, frame("message_begin", 1, { messageId: "m", revision: 0, message: message("start") })).state;
  const gap = reducer.reduceRelayFrame(state, frame("message_patch", 3, { messageId: "m", baseRevision: 0, revision: 1, operations: [{ op: "append_text", index: 0, text: "lost" }] }));
  assert.equal(gap.effect.type, "desync");
  assert.equal(gap.effect.reason, "gap");
  const authoritative = message("authoritative raw result");
  const commit = reducer.reduceRelayFrame(gap.state, frame("message_commit", 5, { messageId: "m", authoritative: true, message: authoritative }));
  assert.equal(commit.effect.type, "commit");
  assert.equal(commit.effect.recoveredFromDesync, true);
  assert.deepEqual(commit.state.committedMessage, authoritative);
  assert.equal(commit.state.activeMessage, null);
});

test("epoch rotation through sync discards stale active state", () => {
  let state = reducer.createInitialRelayClientState("session");
  state = reducer.reduceRelayFrame(state, sync(0, { messageId: "old", revision: 0, message: message("old") }, 1)).state;
  state = reducer.reduceRelayFrame(state, sync(0, { messageId: "new", revision: 3, message: message("new") }, 2)).state;
  assert.equal(state.epoch, 2);
  assert.equal(state.lastSeq, 0);
  assert.equal(state.activeMessageId, "new");
  const stale = reducer.reduceRelayFrame(state, frame("event", 1, { event: { type: "stale" } }, 1));
  assert.equal(stale.effect.type, "duplicate");
});

test("sync refresh flag and session close remain explicit effects", () => {
  let state = reducer.createInitialRelayClientState("session");
  const refresh = reducer.reduceRelayFrame(state, sync(0, null, 1, { requiresStateRefresh: true }));
  assert.equal(refresh.state.requiresStateRefresh, true);
  assert.equal(refresh.state.status, "desynced");
  const closed = reducer.reduceRelayFrame(refresh.state, frame("session_closed", 1, { reason: "identity_changed" }));
  assert.equal(closed.effect.type, "session_closed");
  assert.equal(closed.state.status, "closed");
});

test("session close crosses a sequence gap and duplicate commits stay idempotent", () => {
  let state = reducer.reduceRelayFrame(reducer.createInitialRelayClientState("session"), sync()).state;
  state = reducer.reduceRelayFrame(state, frame("message_begin", 1, { messageId: "m", revision: 0, message: message("start") })).state;
  const committed = reducer.reduceRelayFrame(state, frame("message_commit", 2, { messageId: "m", authoritative: true, message: message("done") }));
  const duplicate = reducer.reduceRelayFrame(committed.state, frame("message_commit", 3, { messageId: "m", authoritative: true, message: message("done") }));
  assert.equal(duplicate.effect.type, "duplicate");
  assert.equal(duplicate.state.commitSeq, 2);

  const closed = reducer.reduceRelayFrame(duplicate.state, frame("session_closed", 5, { reason: "destroyed" }));
  assert.equal(closed.effect.type, "session_closed");
  assert.equal(closed.state.status, "closed");
});
