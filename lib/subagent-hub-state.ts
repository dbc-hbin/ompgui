import type { SubagentInfo, SubagentProgress, SubagentAgentSource } from "./subagent-types";

export type SubagentHubFilter = "all" | "active" | "completed" | "failed";
export type SubagentFreshness = "live" | "stale" | "history";

export const SUBAGENT_STALE_AFTER_MS = 15_000;

/**
 * The parent fields that can accompany a progress snapshot on the wire. The
 * progress object itself is parsed before it reaches this helper, so this
 * shape intentionally contains only trusted primitive values.
 */
export interface SubagentProgressRecoveryPayload {
  index?: number;
  agent?: string;
  agentSource?: SubagentAgentSource;
  task?: string;
  assignment?: string;
  description?: string;
  parentToolCallId?: string;
  sessionFile?: string;
  detached?: boolean;
}

/**
 * Build the roster row that is missing when a progress frame beats its
 * lifecycle frame to the UI. A progress id is required; callers should keep
 * id-less frames on their existing fallback-update path.
 */
export function createSubagentFromProgress(
  payload: SubagentProgressRecoveryPayload | undefined,
  progress: SubagentProgress,
  now = Date.now(),
): SubagentInfo | undefined {
  const id = progress.id;
  if (!id) return undefined;

  const payloadIndex = payload?.index;
  const progressIndex = progress.index;
  const index = (typeof payloadIndex === "number" && Number.isFinite(payloadIndex) && payloadIndex >= 0)
    ? payloadIndex
    : (typeof progressIndex === "number" && Number.isFinite(progressIndex) && progressIndex >= 0 ? progressIndex : 0);

  const status: SubagentInfo["status"] = progress.status === "pending" || progress.status === "running"
    ? "started"
    : progress.status === "failed"
      ? "failed"
      : progress.status === "aborted"
        ? "aborted"
        : "completed";

  const info: SubagentInfo = {
    id,
    agent: payload?.agent || progress.agent || "task",
    index,
    status,
    progress,
    lastUpdate: now,
    source: "live",
  };

  const agentSource = payload?.agentSource ?? progress.agentSource;
  if (agentSource !== undefined) info.agentSource = agentSource;
  const task = payload?.task?.trim() ? payload.task : progress.task;
  if (task !== undefined) info.task = task;
  const assignment = payload?.assignment ?? progress.assignment;
  if (assignment !== undefined) info.assignment = assignment;
  const description = payload?.description ?? progress.description;
  if (description !== undefined) info.description = description;
  if (payload?.parentToolCallId !== undefined) info.parentToolCallId = payload.parentToolCallId;
  if (payload?.sessionFile !== undefined) info.sessionFile = payload.sessionFile;
  if (payload?.detached !== undefined) info.detached = payload.detached;
  return info;
}

/** Return the row's current presentation freshness. */
export function getSubagentFreshness(subagent: SubagentInfo, now = Date.now()): SubagentFreshness {
  if (subagent.source === "history") return "history";
  if (subagent.status !== "started") return "live";
  if (subagent.lastUpdate === undefined || now - subagent.lastUpdate > SUBAGENT_STALE_AFTER_MS) return "stale";
  return "live";
}

/** Apply the hub's status filter without changing row identity or order. */
export function filterSubagentHubRows(subagents: SubagentInfo[], filter: SubagentHubFilter): SubagentInfo[] {
  switch (filter) {
    case "active":
      return subagents.filter((subagent) => subagent.source !== "history" && subagent.status === "started");
    case "completed":
      return subagents.filter((subagent) => subagent.status === "completed");
    case "failed":
      return subagents.filter((subagent) => subagent.status === "failed" || subagent.status === "aborted");
    case "all":
    default:
      return subagents;
  }
}

function rosterSource(subagent: SubagentInfo): "live" | "history" {
  return subagent.source === "history" ? "history" : "live";
}

function isTerminal(subagent: SubagentInfo): boolean {
  return subagent.status !== "started";
}

/**
 * Merge live snapshots/events and persisted terminal history into one roster.
 * Live data wins over non-terminal history, while a terminal disk record is
 * allowed to settle a live started row after the registry has deleted it.
 */
export function mergeSubagentRoster(
  prev: SubagentInfo[],
  incoming: SubagentInfo[],
  options?: { skipNewerThan?: number },
): SubagentInfo[] {
  if (incoming.length === 0) return prev;

  const byId = new Map<string, SubagentInfo>();
  for (const entry of prev) byId.set(entry.id, entry);
  const skipNewerThan = options?.skipNewerThan;

  for (const entry of incoming) {
    const existing = byId.get(entry.id);
    if (!existing) {
      byId.set(entry.id, entry);
      continue;
    }
    if (skipNewerThan !== undefined && (existing.lastUpdate ?? 0) >= skipNewerThan) continue;

    const existingSource = rosterSource(existing);
    const incomingSource = rosterSource(entry);

    if (incomingSource === "history" && existingSource === "live") {
      // Non-terminal disk records are stale while a live row exists. A
      // terminal record, however, is the durable result after registry
      // deletion and must settle/enrich a started live row.
      if (!isTerminal(entry)) continue;
      const settled = { ...existing } as SubagentInfo & Record<string, unknown>;
      for (const [key, value] of Object.entries(entry)) {
        if (value !== undefined) settled[key] = value;
      }
      settled.source = "history";
      byId.set(entry.id, settled);
      continue;
    }

    // A newly observed live row is newer than any same-id disk history. This
    // also handles a live snapshot arriving after a prior terminal history
    // hydration during a resumed run.
    if (incomingSource === "live" && existingSource === "history") {
      byId.set(entry.id, entry);
      continue;
    }

    // A terminal disk result must not regress if a later history refresh is
    // partial or still reports the original started state.
    if (incomingSource === "history" && !isTerminal(entry) && isTerminal(existing)) continue;

    // Within one source, entries are delivered in observation order; incoming
    // fields are newer, while the spread preserves fields omitted by a
    // partial snapshot/frame.
    byId.set(entry.id, { ...existing, ...entry, source: incomingSource });
  }

  return [...byId.values()].sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
}

/**
 * Remove live rows absent from a point-in-time get_subagents snapshot. Rows
 * updated at or after the request fence survive because they are newer than
 * the snapshot, and history rows are never pruned by the live registry view.
 */
export function pruneSubagentRosterSnapshot(
  prev: SubagentInfo[],
  liveIds: Set<string>,
  requestedAt: number,
): SubagentInfo[] {
  let changed = false;
  const next = prev.filter((subagent) => {
    if (subagent.source === "history") return true;
    const keep = liveIds.has(subagent.id) || (subagent.lastUpdate ?? 0) >= requestedAt;
    if (!keep) changed = true;
    return keep;
  });
  return changed ? next : prev;
}
