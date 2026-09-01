import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./document-network-lifecycle.ts");
}

test("hidden mode does not allow polling or list requests", async () => {
  const { shouldFetchSessionList, readDocumentNetworkStatus, nextDocumentNetworkState } = await loadSubject();

  const hidden = readDocumentNetworkStatus({ visibilityState: "hidden" }, { onLine: true });
  assert.equal(shouldFetchSessionList(hidden), false);
  assert.deepEqual(nextDocumentNetworkState(true, hidden), { active: false, catchUp: false });

  const offline = readDocumentNetworkStatus({ visibilityState: "visible" }, { onLine: false });
  assert.equal(shouldFetchSessionList(offline), false);
});

test("visible and online catches up once after pause", async () => {
  const { nextDocumentNetworkState, readDocumentNetworkStatus } = await loadSubject();

  const hidden = readDocumentNetworkStatus({ visibilityState: "hidden" }, { onLine: true });
  const paused = nextDocumentNetworkState(true, hidden);
  assert.equal(paused.active, false);
  assert.equal(paused.catchUp, false);

  const visible = readDocumentNetworkStatus({ visibilityState: "visible" }, { onLine: true });
  const resume = nextDocumentNetworkState(paused.active, visible);
  assert.equal(resume.active, true);
  assert.equal(resume.catchUp, true);

  const alreadyVisible = nextDocumentNetworkState(true, visible);
  assert.equal(alreadyVisible.catchUp, false);
});
