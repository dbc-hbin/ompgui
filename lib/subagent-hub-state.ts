import type { SubagentInfo, SubagentProgress, SubagentAgentSource } from "./subagent-types";

export type SubagentHubFilter = "all" | "active" | "completed" | "failed";
export type SubagentFreshness = "live" | "stale" | "history";

export const SUBAGENT_STALE_AFTER_MS = 15_000;
/** Cadence for successful authoritative get_subagents reconciliations. */
export const SUBAGENT_RECONCILE_INTERVAL_MS = 5_000;
/** Grace period after the missing-snapshot threshold before marking a row lost. */
export const SUBAGENT_LOST_GRACE_MS = 30_000;
/** Successful authoritative snapshots that must omit a row before grace applies. */
export const SUBAGENT_MISSING_SNAPSHOTS_REQUIRED = 2;

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

/** Map a progress-frame status to the internal roster status shape. */
export function progressStatusToSubagentStatus(
  status: unknown,
  fallback: SubagentInfo["status"],
): SubagentInfo["status"] {
  switch (status) {
    case "pending":
    case "running":
      return "started";
    case "completed":
    case "failed":
    case "aborted":
      return status;
    default:
      return fallback;
  }
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

  const status = progressStatusToSubagentStatus(progress.status, "started");

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
export function filterSubagentHubRows(
  subagents: SubagentInfo[],
  filter: SubagentHubFilter,
  now = Date.now(),
): SubagentInfo[] {
  switch (filter) {
    case "active":
      return subagents.filter(
        (subagent) => subagent.source !== "history"
          && subagent.status === "started"
          && getSubagentFreshness(subagent, now) === "live",
      );
    case "completed":
      return subagents.filter((subagent) => subagent.status === "completed");
    case "failed":
      return subagents.filter(
        (subagent) => subagent.status === "failed" || subagent.status === "aborted" || subagent.status === "lost",
      );
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
 * Reconcile a successful point-in-time get_subagents snapshot with the local
 * roster. The registry removes a child as soon as its lifecycle settles, so a
 * single absence cannot distinguish a missed frame from transport loss. Keep
 * eligible live rows while two successful snapshots omit them, then require a
 * further grace period before marking them internally lost.
 *
 * The request fence protects lifecycle/progress frames observed after this
 * snapshot was requested. Terminal and history rows are never changed by the
 * live registry view.
 */
export function reconcileSubagentRosterSnapshot(
  prev: SubagentInfo[],
  liveIds: Set<string>,
  requestedAt: number,
  now = Date.now(),
): SubagentInfo[] {
  let changed = false;
  const next = prev.map((subagent) => {
    // History and terminal rows are authoritative outside the live registry;
    // an absent snapshot must not regress or erase an explicit outcome.
    if (subagent.source === "history" || subagent.status !== "started") return subagent;

    if (liveIds.has(subagent.id)) {
      // Presence is authoritative and resets only the internal absence state.
      if (subagent.missingSnapshots === undefined && subagent.missingSince === undefined) return subagent;
      const present = { ...subagent };
      delete present.missingSnapshots;
      delete present.missingSince;
      changed = true;
      return present;
    }

    // A frame observed at/after the request fence is newer than this snapshot,
    // so an absent id cannot be considered missing yet.
    if ((subagent.lastUpdate ?? 0) >= requestedAt) return subagent;

    const previousMissing = typeof subagent.missingSnapshots === "number"
      && Number.isFinite(subagent.missingSnapshots)
      && subagent.missingSnapshots >= 0
      ? Math.floor(subagent.missingSnapshots)
      : 0;
    const missingSnapshots = previousMissing + 1;
    const missingSince = typeof subagent.missingSince === "number" && Number.isFinite(subagent.missingSince)
      ? subagent.missingSince
      : now;
    const lost = missingSnapshots >= SUBAGENT_MISSING_SNAPSHOTS_REQUIRED
      && now - missingSince >= SUBAGENT_LOST_GRACE_MS;
    changed = true;
    return {
      ...subagent,
      missingSnapshots,
      missingSince,
      ...(lost ? { status: "lost" as const } : {}),
    };
  });
  return changed ? next : prev;
}
