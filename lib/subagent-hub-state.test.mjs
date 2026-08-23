import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  SUBAGENT_STALE_AFTER_MS,
  createSubagentFromProgress,
  filterSubagentHubRows,
  getSubagentFreshness,
  mergeSubagentRoster,
  pruneSubagentRosterSnapshot,
} = await jiti.import("./subagent-hub-state.ts");

function row(id, overrides = {}) {
  return {
    id,
    agent: "task",
    index: 0,
    status: "started",
    source: "live",
    ...overrides,
  };
}

test("merge precedence keeps non-terminal history behind live and settles started rows from terminal history", () => {
  const live = row("child", { task: "live task", lastUpdate: 20 });
  const nonTerminalHistory = row("child", {
    source: "history",
    task: "old disk task",
    status: "started",
  });
  assert.deepEqual(mergeSubagentRoster([live], [nonTerminalHistory]), [live]);

  const terminalHistory = row("child", {
    source: "history",
    status: "completed",
    progress: { status: "completed", task: "settled" },
    result: { exitCode: 0 },
    task: "settled task",
  });
  assert.deepEqual(mergeSubagentRoster([live], [terminalHistory]), [{
    ...live,
    ...terminalHistory,
    source: "history",
  }]);
});

test("a newly observed live row fully replaces same-id history", () => {
  const history = row("child", {
    source: "history",
    status: "completed",
    result: { exitCode: 0 },
    task: "old task",
  });
  const live = row("child", { status: "started", lastUpdate: 42 });
  assert.deepEqual(mergeSubagentRoster([history], [live]), [live]);
});

test("same-source entries enrich with newer fields and preserve omitted fields", () => {
  const previous = row("child", { task: "keep", lastUpdate: 1 });
  const incoming = row("child", { status: "completed", result: { exitCode: 0 }, lastUpdate: 2 });
  assert.deepEqual(mergeSubagentRoster([previous], [incoming]), [{
    ...previous,
    ...incoming,
  }]);
});

test("snapshot fence keeps rows updated at or after the request time", () => {
  const atFence = row("at", { lastUpdate: 100 });
  const afterFence = row("after", { lastUpdate: 101 });
  const beforeFence = row("before", { lastUpdate: 99, task: "old" });
  const snapshotAt = row("at", { task: "snapshot" });
  const snapshotBefore = row("before", { task: "snapshot" });
  const merged = mergeSubagentRoster(
    [atFence, afterFence, beforeFence],
    [snapshotAt, row("after", { task: "snapshot" }), snapshotBefore],
    { skipNewerThan: 100 },
  );
  assert.deepEqual(merged.find((entry) => entry.id === "at"), atFence);
  assert.deepEqual(merged.find((entry) => entry.id === "after"), afterFence);
  assert.equal(merged.find((entry) => entry.id === "before")?.task, "snapshot");
});

test("merge output is deterministically ordered by index then id", () => {
  const merged = mergeSubagentRoster([], [
    row("z", { index: 2 }),
    row("b", { index: 1 }),
    row("a", { index: 1 }),
    row("zero", { index: 0 }),
  ]);
  assert.deepEqual(merged.map((entry) => entry.id), ["zero", "a", "b", "z"]);
});

test("snapshot pruning keeps history, snapshot ids, and post-request live updates", () => {
  const history = row("history", { source: "history", status: "completed" });
  const present = row("present", { lastUpdate: 10 });
  const updatedAtFence = row("at", { lastUpdate: 100 });
  const updatedAfterFence = row("after", { lastUpdate: 101 });
  const missing = row("missing", { lastUpdate: 99 });
  const previous = [history, present, updatedAtFence, updatedAfterFence, missing];
  const next = pruneSubagentRosterSnapshot(previous, new Set(["present"]), 100);
  assert.deepEqual(next, [history, present, updatedAtFence, updatedAfterFence]);
  assert.equal(pruneSubagentRosterSnapshot(next, new Set(["present", "at", "after"]), 100), next);
});

test("freshness distinguishes history, stale started rows, and terminal live rows", () => {
  const now = 1_000_000;
  assert.equal(getSubagentFreshness(row("history", { source: "history" }), now), "history");
  assert.equal(getSubagentFreshness(row("missing", { lastUpdate: undefined }), now), "stale");
  assert.equal(getSubagentFreshness(row("old", { lastUpdate: now - SUBAGENT_STALE_AFTER_MS - 1 }), now), "stale");
  assert.equal(getSubagentFreshness(row("boundary", { lastUpdate: now - SUBAGENT_STALE_AFTER_MS }), now), "live");
  assert.equal(getSubagentFreshness(row("fresh", { lastUpdate: now }), now), "live");
  assert.equal(getSubagentFreshness(row("done", { status: "completed", lastUpdate: 0 }), now), "live");
  assert.equal(getSubagentFreshness(row("failed", { status: "failed", lastUpdate: 0 }), now), "live");
});

test("hub filters select active, completed, and failed/aborted rows", () => {
  const rows = [
    row("active"),
    row("completed", { status: "completed" }),
    row("failed", { status: "failed" }),
    row("aborted", { status: "aborted" }),
    row("history-started", { source: "history", status: "started" }),
  ];
  assert.deepEqual(filterSubagentHubRows(rows, "all"), rows);
  assert.deepEqual(filterSubagentHubRows(rows, "active").map((entry) => entry.id), ["active"]);
  assert.deepEqual(filterSubagentHubRows(rows, "completed").map((entry) => entry.id), ["completed"]);
  assert.deepEqual(filterSubagentHubRows(rows, "failed").map((entry) => entry.id), ["failed", "aborted"]);
});

test("progress recovery creates a live row with mapped status and required metadata", () => {
  const progress = {
    id: "recovered",
    index: -4,
    agent: "progress-agent",
    status: "running",
    task: "from progress",
    description: "progress description",
  };
  const recovered = createSubagentFromProgress({
    index: -1,
    agent: "payload-agent",
    task: "from payload",
    assignment: "assignment",
    parentToolCallId: "call-1",
    sessionFile: "/tmp/child.jsonl",
    detached: true,
  }, progress, 1234);
  assert.deepEqual(recovered, {
    id: "recovered",
    agent: "payload-agent",
    index: 0,
    status: "started",
    progress,
    lastUpdate: 1234,
    source: "live",
    task: "from payload",
    assignment: "assignment",
    description: "progress description",
    parentToolCallId: "call-1",
    sessionFile: "/tmp/child.jsonl",
    detached: true,
  });

  assert.equal(createSubagentFromProgress(undefined, { status: "completed" }, 1234), undefined);
  assert.equal(createSubagentFromProgress(undefined, { id: "done", status: "completed" }, 1234)?.status, "completed");
  assert.equal(createSubagentFromProgress(undefined, { id: "failed", status: "failed" }, 1234)?.status, "failed");
  assert.equal(createSubagentFromProgress(undefined, { id: "aborted", status: "aborted" }, 1234)?.status, "aborted");
});
