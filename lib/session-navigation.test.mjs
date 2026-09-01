import assert from "node:assert/strict";
import test from "node:test";

test("URL restore does not wait for a delayed session list", async () => {
  const { getInitialNavigation } = await import("./initial-navigation.ts");
  const {
    pickSessionForRestore,
    shouldOpenRestoredSessionImmediately,
    canSelectSessionFromList,
  } = await import("./url-session-restore.ts");
  const { shouldFetchSessionList, nextDocumentNetworkState } = await import("./document-network-lifecycle.ts");

  const navigation = getInitialNavigation(new URLSearchParams({ session: "session-now" }));
  assert.equal(navigation.sessionId, "session-now");
  assert.equal(shouldOpenRestoredSessionImmediately(navigation.sessionId, false), true);

  const opened = pickSessionForRestore(navigation.sessionId, []);
  assert.equal(opened.id, "session-now");

  const delayedList = [
    {
      path: "/old.jsonl",
      id: "session-old",
      cwd: "/old",
      created: "t",
      modified: "t",
      messageCount: 1,
      firstMessage: "old",
    },
  ];
  assert.equal(canSelectSessionFromList(opened.id, delayedList[0].id), false);
  assert.equal(pickSessionForRestore(opened.id, delayedList).id, "session-now");

  const hidden = { visible: false, online: true };
  assert.equal(shouldFetchSessionList(hidden), false);
  assert.equal(nextDocumentNetworkState(false, { visible: true, online: true }).catchUp, true);
});
