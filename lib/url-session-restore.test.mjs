import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./url-session-restore.ts");
}

test("opens a URL session immediately without waiting for the list", async () => {
  const {
    shouldOpenRestoredSessionImmediately,
    pickSessionForRestore,
  } = await loadSubject();

  assert.equal(shouldOpenRestoredSessionImmediately("session-now", false), true);
  assert.equal(shouldOpenRestoredSessionImmediately("session-now", true), false);
  assert.equal(shouldOpenRestoredSessionImmediately(null, false), false);

  const stub = pickSessionForRestore("session-now", []);
  assert.equal(stub.id, "session-now");
  assert.equal(stub.path, "");
  assert.equal(stub.cwd, "");
});

test("stale list rows cannot select a previous session id", async () => {
  const { canSelectSessionFromList, pickSessionForRestore } = await loadSubject();

  assert.equal(canSelectSessionFromList("session-now", "session-old"), false);
  assert.equal(canSelectSessionFromList("session-now", "session-now"), true);
  assert.equal(canSelectSessionFromList(null, "session-old"), true);

  const listed = pickSessionForRestore("session-now", [
    {
      path: "/old.jsonl",
      id: "session-old",
      cwd: "/old",
      created: "t",
      modified: "t",
      messageCount: 1,
      firstMessage: "old",
    },
    {
      path: "/now.jsonl",
      id: "session-now",
      cwd: "/now",
      created: "t",
      modified: "t",
      messageCount: 2,
      firstMessage: "now",
      name: "Now",
    },
  ]);
  assert.equal(listed.id, "session-now");
  assert.equal(listed.name, "Now");
  assert.equal(listed.cwd, "/now");
});
