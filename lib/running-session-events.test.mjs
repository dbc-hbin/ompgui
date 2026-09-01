import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./running-session-events.ts");
}

test("preserves running and sessions-changed frame shapes", async () => {
  const { parseRunningEventsFrame } = await loadSubject();

  assert.deepEqual(
    parseRunningEventsFrame({
      type: "running",
      runningSessionIds: ["a", 1, "b"],
      refreshSessionList: true,
    }),
    { type: "running", runningSessionIds: ["a", "b"], refreshSessionList: true },
  );

  assert.deepEqual(
    parseRunningEventsFrame({
      type: "sessions-changed",
      sessionIds: ["s1"],
      refreshSessionList: true,
    }),
    { type: "sessions-changed", sessionIds: ["s1"], refreshSessionList: true },
  );

  assert.deepEqual(parseRunningEventsFrame({ type: "other" }), { type: "ignored" });
});
