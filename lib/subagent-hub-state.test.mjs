import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  SUBAGENT_STALE_AFTER_MS,
  createSubagentFromProgress,
  progressStatusToSubagentStatus,
  filterSubagentHubRows,
  getSubagentFreshness,
  mergeSubagentRoster,
  reconcileSubagentRosterSnapshot,
  SUBAGENT_LOST_GRACE_MS,
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

test("a delayed nonterminal live row cannot regress same-id terminal history", () => {
  const history = row("child", {
    source: "history",
    status: "completed",
    result: { exitCode: 0 },
    task: "old task",
  });
  const live = row("child", { status: "started", lastUpdate: 42 });
  assert.deepEqual(mergeSubagentRoster([history], [live]), [history]);
});

test("a newly observed live row replaces same-id nonterminal history", () => {
  const history = row("child", {
    source: "history",
    status: "started",
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

test("first missing authoritative snapshot records metadata without fabricating a terminal state", () => {
  const previous = [row("missing", { lastUpdate: 99 })];
  const next = reconcileSubagentRosterSnapshot(previous, new Set(), 100, 1_000);
  assert.deepEqual(next, [{
    ...previous[0],
    missingSnapshots: 1,
    missingSince: 1_000,
  }]);
  assert.equal(next[0].status, "started");
});

test("presence clears missing metadata and preserves the live row", () => {
  const previous = [row("present", { lastUpdate: 99, missingSnapshots: 2, missingSince: 1_000 })];
  const next = reconcileSubagentRosterSnapshot(previous, new Set(["present"]), 100, 2_000);
  assert.deepEqual(next, [row("present", { lastUpdate: 99 })]);
  assert.equal(next[0].status, "started");
});

test("a second missing snapshot increments tracking but still honors the grace period", () => {
  const first = reconcileSubagentRosterSnapshot([row("missing", { lastUpdate: 99 })], new Set(), 100, 1_000);
  const second = reconcileSubagentRosterSnapshot(first, new Set(), 100, 5_000);
  assert.deepEqual(second, [{
    ...first[0],
    missingSnapshots: 2,
    missingSince: 1_000,
  }]);
  assert.equal(second[0].status, "started");
});

test("repeated successful absence plus the grace period marks a row lost", () => {
  const first = reconcileSubagentRosterSnapshot([row("missing", { lastUpdate: 99 })], new Set(), 100, 1_000);
  const lost = reconcileSubagentRosterSnapshot(first, new Set(), 100, 1_000 + SUBAGENT_LOST_GRACE_MS);
  assert.equal(lost[0].status, "lost");
  assert.equal(lost[0].missingSnapshots, 2);
  assert.equal(lost[0].missingSince, 1_000);
});

test("request fence protects rows observed at or after the authoritative request", () => {
  const history = row("history", { source: "history", status: "completed", missingSnapshots: 4, missingSince: 1 });
  const atFence = row("at", { lastUpdate: 100 });
  const afterFence = row("after", { lastUpdate: 101 });
  const previous = [history, atFence, afterFence];
  const next = reconcileSubagentRosterSnapshot(previous, new Set(), 100, 40_000);
  assert.equal(next, previous);
  assert.deepEqual(next, previous);
});

test("terminal and history rows survive an absent live snapshot unchanged", () => {
  const completed = row("completed", { status: "completed", lastUpdate: 1, missingSnapshots: 2, missingSince: 1 });
  const failed = row("failed", { status: "failed", lastUpdate: 1 });
  const aborted = row("aborted", { status: "aborted", lastUpdate: 1 });
  const lost = row("lost", { status: "lost", lastUpdate: 1, missingSnapshots: 2, missingSince: 1 });
  const history = row("history", { source: "history", status: "started", lastUpdate: 1 });
  const previous = [completed, failed, aborted, lost, history];
  assert.equal(reconcileSubagentRosterSnapshot(previous, new Set(), 100, 40_000), previous);
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

test("hub filters select fresh active, completed, and failed/aborted/lost rows", () => {
  const now = 1_000_000;
  const rows = [
    row("active", { lastUpdate: now }),
    row("stale", { lastUpdate: now - SUBAGENT_STALE_AFTER_MS - 1 }),
    row("completed", { status: "completed" }),
    row("failed", { status: "failed" }),
    row("aborted", { status: "aborted" }),
    row("lost", { status: "lost" }),
    row("history-started", { source: "history", status: "started", lastUpdate: now }),
  ];
  assert.deepEqual(filterSubagentHubRows(rows, "all", now), rows);
  assert.deepEqual(filterSubagentHubRows(rows, "active", now).map((entry) => entry.id), ["active"]);
  assert.deepEqual(filterSubagentHubRows(rows, "completed", now).map((entry) => entry.id), ["completed"]);
  assert.deepEqual(filterSubagentHubRows(rows, "failed", now).map((entry) => entry.id), ["failed", "aborted", "lost"]);
});

test("progress status mapping preserves terminal states and uses the fallback for missing or unknown states", () => {
  const explicitStatuses = [
    ["pending", "started"],
    ["running", "started"],
    ["completed", "completed"],
    ["failed", "failed"],
    ["aborted", "aborted"],
  ];
  for (const [status, expected] of explicitStatuses) {
    assert.equal(progressStatusToSubagentStatus(status, "started"), expected);
  }
  assert.equal(progressStatusToSubagentStatus(undefined, "started"), "started");
  assert.equal(progressStatusToSubagentStatus("future", "started"), "started");
  assert.equal(progressStatusToSubagentStatus(undefined, "failed"), "failed");
  assert.equal(progressStatusToSubagentStatus("future", "aborted"), "aborted");
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
  assert.equal(createSubagentFromProgress(undefined, { id: "missing-status" }, 1234)?.status, "started");
  assert.equal(createSubagentFromProgress(undefined, { id: "unknown-status", status: "future" }, 1234)?.status, "started");
  assert.equal(createSubagentFromProgress(undefined, { id: "done", status: "completed" }, 1234)?.status, "completed");
  assert.equal(createSubagentFromProgress(undefined, { id: "failed", status: "failed" }, 1234)?.status, "failed");
  assert.equal(createSubagentFromProgress(undefined, { id: "aborted", status: "aborted" }, 1234)?.status, "aborted");
});
