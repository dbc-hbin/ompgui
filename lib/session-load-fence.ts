/**
 * Return whether a client fetch still belongs to the active session load.
 * Model catalog responses use this fence so a stale cwd/session generation
 * cannot overwrite the composer after a later session switch.
 */
export function matchesSessionLoadGeneration(
  currentSessionId: string | null,
  expectedSessionId: string | null,
  currentSessionLoadGeneration: number,
  expectedSessionLoadGeneration: number,
): boolean {
  return currentSessionId === expectedSessionId
    && currentSessionLoadGeneration === expectedSessionLoadGeneration;
}

/** Runtime retries advance only the runtime generation; history generation is independent. */
export function matchesStateLoadFence(
  currentSessionId: string | null,
  expectedSessionId: string,
  currentSessionLoadGeneration: number,
  expectedSessionLoadGeneration: number,
  currentRuntimeLoadGeneration: number,
  expectedRuntimeLoadGeneration: number,
  currentRunId: number,
  expectedRunId?: number,
): boolean {
  return currentSessionId === expectedSessionId
    && currentSessionLoadGeneration === expectedSessionLoadGeneration
    && currentRuntimeLoadGeneration === expectedRuntimeLoadGeneration
    && (expectedRunId === undefined || currentRunId === expectedRunId);
}

/** Queue snapshots/events are dropped when the session load moved on, the SSE
 * connection epoch changed, or the revision is older than the last applied
 * snapshot. Revisions are per wrapper and may restart at 0 after reconnect, so
 * a reset currentRevision (< 0) accepts the first snapshot of the new epoch. */
export function matchesQueueRevision(
  currentSessionId: string | null,
  expectedSessionId: string,
  currentSessionLoadGeneration: number,
  expectedSessionLoadGeneration: number,
  currentConnectionFence: number,
  expectedConnectionFence: number,
  currentRevision: number,
  incomingRevision: number,
  mode: "event" | "fetch" = "fetch",
): boolean {
  if (currentSessionId !== expectedSessionId) return false;
  if (currentSessionLoadGeneration !== expectedSessionLoadGeneration) return false;
  if (currentConnectionFence !== expectedConnectionFence) return false;
  if (!Number.isFinite(incomingRevision)) return false;
  if (mode === "event") return currentRevision < 0 || incomingRevision > currentRevision;
  return currentRevision < 0 || incomingRevision >= currentRevision;
}
