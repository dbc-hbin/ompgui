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
