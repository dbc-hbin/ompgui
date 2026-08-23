import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { SessionRelayPublisher } = await jiti.import("./session-relay-publisher.ts");

function message(text = "") {
  return {
    role: "assistant",
    model: "m",
    provider: "p",
    content: [{ type: "text", text, rawMetadata: { keep: true } }],
  };
}

function manualScheduler() {
  let callback = null;
  return {
    schedule(next) {
      callback = next;
      return next;
    },
    cancel(next) {
      if (callback === next) callback = null;
    },
    fire() {
      const next = callback;
      callback = null;
      next?.();
    },
    get pending() {
      return callback !== null;
    },
  };
}

function publisher(id = "session") {
  const scheduler = manualScheduler();
  const relay = new SessionRelayPublisher(id, {
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
  });
  return { relay, scheduler };
}

function raw(type, messageValue, fields = {}) {
  return { type, message: messageValue, ...fields };
}

test("coalesces cumulative assistant updates into one relative patch", () => {
  const { relay, scheduler } = publisher();
  const frames = [];
  relay.subscribe((frame) => frames.push(frame));
  relay.publish(raw("message_start", message(""), { messageId: "m" }));
  relay.publish(raw("message_update", message("a"), { messageId: "m" }));
  relay.publish(raw("message_update", message("ab"), { messageId: "m" }));
  assert.equal(frames.filter((frame) => frame.type === "message_patch").length, 0);
  assert.equal(scheduler.pending, true);
  scheduler.fire();
  assert.deepEqual(frames.at(-1), {
    wire: 1,
    sessionId: "session",
    epoch: relay.epoch,
    seq: 2,
    type: "message_patch",
    messageId: "m",
    baseRevision: 0,
    revision: 1,
    operations: [{ op: "append_text", index: 0, text: "ab" }],
  });
});

test("projects the JSON-visible form of OMP messages with undefined runtime fields", () => {
  const { relay } = publisher();
  const frames = [];
  relay.subscribe((frame) => frames.push(frame));
  const runtimeMessage = { ...message("visible"), optionalRuntimeField: undefined };
  relay.publish(raw("message_start", runtimeMessage, { messageId: "m" }));
  assert.equal(frames.at(-1).type, "message_begin");
  assert.equal("optionalRuntimeField" in frames.at(-1).message, false);
  assert.equal(frames.at(-1).message.content[0].text, "visible");
});

test("flushes a pending patch before control events", () => {
  const { relay, scheduler } = publisher();
  const frames = [];
  relay.subscribe((frame) => frames.push(frame));
  relay.publish(raw("message_start", message(""), { messageId: "m" }));
  relay.publish(raw("message_update", message("a"), { messageId: "m" }));
  relay.publish({ type: "tool_execution_start", toolCallId: "t" });
  assert.deepEqual(frames.map((frame) => frame.type), ["relay_sync", "message_begin", "message_patch", "event"]);
  assert.equal(frames.at(-1).event.type, "tool_execution_start");
  assert.equal(scheduler.pending, false);
});

test("authoritative final supersedes a pending cumulative update", () => {
  const { relay, scheduler } = publisher();
  const frames = [];
  relay.subscribe((frame) => frames.push(frame));
  const finalMessage = message("done");
  relay.publish(raw("message_start", message(""), { messageId: "m" }));
  relay.publish(raw("message_update", message("stale"), { messageId: "m" }));
  relay.publish(raw("message_end", finalMessage, { messageId: "m" }));
  scheduler.fire();
  assert.deepEqual(frames.map((frame) => frame.type), ["relay_sync", "message_begin", "message_commit"]);
  assert.deepEqual(frames.at(-1).message, finalMessage);
  assert.equal(relay.activeCheckpoint, null);
});

test("two subscribers receive identical ordered frames", () => {
  const { relay, scheduler } = publisher();
  const first = [];
  const second = [];
  relay.subscribe((frame) => first.push(frame));
  relay.subscribe((frame) => second.push(frame));
  relay.publish(raw("message_start", message(""), { messageId: "m" }));
  relay.publish(raw("message_update", message("x"), { messageId: "m" }));
  scheduler.fire();
  relay.publish(raw("message_end", message("x"), { messageId: "m" }));
  assert.deepEqual(second, first);
});

test("subscriber identities distinguish actual recipients from later joiners", () => {
  const { relay } = publisher();
  const unsubscribeFirst = relay.subscribe(() => {});
  const firstRecipients = relay.getSubscriberIds();
  assert.equal(firstRecipients.size, 1);
  const unsubscribeSecond = relay.subscribe(() => {});
  const bothRecipients = relay.getSubscriberIds();
  assert.equal(bothRecipients.size, 2);
  assert.equal([...firstRecipients].every((id) => bothRecipients.has(id)), true);
  unsubscribeFirst();
  const remaining = relay.getSubscriberIds();
  assert.equal(remaining.size, 1);
  assert.equal([...firstRecipients].some((id) => remaining.has(id)), false);
  unsubscribeSecond();
});

test("sync exposes active checkpoint and flags commit mismatch", () => {
  const { relay } = publisher();
  relay.publish(raw("message_start", message("active"), { messageId: "m" }));
  const matching = relay.createSyncFrame(0);
  assert.equal(matching.requiresStateRefresh, false);
  assert.deepEqual(matching.active, { messageId: "m", revision: 0, message: message("active") });
  const mismatch = relay.createSyncFrame(99);
  assert.equal(mismatch.requiresStateRefresh, true);
});

test("missing begin safely mints an id for update and final", () => {
  const { relay, scheduler } = publisher();
  const frames = [];
  relay.subscribe((frame) => frames.push(frame));
  relay.publish(raw("message_update", message("partial")));
  scheduler.fire();
  assert.equal(frames[1].type, "message_begin");
  assert.match(frames[1].messageId, /^session:assistant:/);
  relay.publish(raw("message_end", message("final")));
  assert.equal(frames.at(-1).type, "message_commit");
  assert.deepEqual(frames.at(-1).message, message("final"));
});

test("duplicate authoritative finals do not mint another message", () => {
  const { relay } = publisher();
  const frames = [];
  relay.subscribe((frame) => frames.push(frame));
  relay.publish(raw("message_start", message(""), { messageId: "m" }));
  relay.publish(raw("message_end", message("done"), { messageId: "m" }));
  const frameCount = frames.length;
  relay.publish(raw("message_end", message("done"), { messageId: "m" }));
  assert.equal(frames.length, frameCount);
});

test("close clears pending timer and rotate starts a fresh epoch", () => {
  const { relay, scheduler } = publisher();
  const frames = [];
  relay.subscribe((frame) => frames.push(frame));
  relay.publish(raw("message_start", message(""), { messageId: "m" }));
  relay.publish(raw("message_update", message("pending"), { messageId: "m" }));
  const oldEpoch = relay.epoch;
  relay.close("destroyed");
  scheduler.fire();
  assert.equal(frames.at(-1).type, "session_closed");
  assert.equal(relay.subscriberCount, 0);
  relay.rotate("session", "identity_changed");
  assert.ok(relay.epoch > oldEpoch);
  assert.equal(relay.headSeq, 0);
});
