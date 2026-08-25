/**
 * Return whether a state response still belongs to the active session load.
 * Runtime retries advance only the runtime generation, so the session/history
 * generation must be checked independently of it.
 */
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
