import test from "node:test";
import assert from "node:assert/strict";

async function loadSubject() {
  return import("./session-change-bus.ts");
}

const CHANGE = {
  type: "sessions-changed",
  sessionIds: ["session-a"],
  refreshSessionList: true,
};

test("publishes a session change to current subscribers", async () => {
  const { publishSessionChange, subscribeSessionChanges } = await loadSubject();
  const received = [];
  const unsubscribe = subscribeSessionChanges((change) => received.push(change));

  publishSessionChange(CHANGE);
  unsubscribe();
  publishSessionChange({ ...CHANGE, sessionIds: ["session-b"] });

  assert.deepEqual(received, [CHANGE]);
});

test("isolates listeners that unsubscribe or throw during delivery", async () => {
  const { publishSessionChange, subscribeSessionChanges } = await loadSubject();
  const received = [];
  let unsubscribeSecond;
  subscribeSessionChanges(() => {
    unsubscribeSecond?.();
    throw new Error("stale listener");
  });
  unsubscribeSecond = subscribeSessionChanges((change) => received.push(change));

  publishSessionChange(CHANGE);

  assert.deepEqual(received, [CHANGE]);
  unsubscribeSecond();
});
