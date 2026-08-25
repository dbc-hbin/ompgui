import assert from "node:assert/strict";
import test from "node:test";

const { matchesStateLoadFence } = await import("./session-load-fence.ts");

function stateLoadFence(overrides = {}) {
  return {
    currentSessionId: "session-a",
    expectedSessionId: "session-a",
    currentSessionLoadGeneration: 8,
    expectedSessionLoadGeneration: 8,
    currentRuntimeLoadGeneration: 13,
    expectedRuntimeLoadGeneration: 13,
    currentRunId: 4,
    expectedRunId: undefined,
    ...overrides,
  };
}

function fenceMatches(overrides) {
  const fence = stateLoadFence(overrides);
  return matchesStateLoadFence(
    fence.currentSessionId,
    fence.expectedSessionId,
    fence.currentSessionLoadGeneration,
    fence.expectedSessionLoadGeneration,
    fence.currentRuntimeLoadGeneration,
    fence.expectedRuntimeLoadGeneration,
    fence.currentRunId,
    fence.expectedRunId,
  );
}

test("rejects stale state success and failure after a newer history load", () => {
  // A history-only load advances the session generation but deliberately does
  // not replace the runtime generation. Both state response paths use this
  // same fence before applying or reporting their result.
  assert.equal(fenceMatches({ currentSessionLoadGeneration: 9 }), false);
  assert.equal(fenceMatches({ currentSessionLoadGeneration: 9, expectedRunId: 4 }), false);
});

test("keeps a runtime-only retry valid without a newer history load", () => {
  assert.equal(fenceMatches({ currentRuntimeLoadGeneration: 14, expectedRuntimeLoadGeneration: 14 }), true);
  assert.equal(fenceMatches({ currentRuntimeLoadGeneration: 14, expectedRuntimeLoadGeneration: 14, expectedRunId: 3 }), false);
});
