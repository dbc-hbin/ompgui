import type { SessionInfo } from "@/lib/types";

export function createUrlRestoredSession(sessionId: string): SessionInfo {
  return {
    path: "",
    id: sessionId,
    cwd: "",
    created: "",
    modified: "",
    messageCount: 0,
    firstMessage: "",
  };
}

/** Open the URL session immediately. List rows only enrich cwd/labels later. */
export function pickSessionForRestore(sessionId: string, sessions: SessionInfo[]): SessionInfo {
  return sessions.find((session) => session.id === sessionId) ?? createUrlRestoredSession(sessionId);
}

export function shouldOpenRestoredSessionImmediately(
  sessionId: string | null | undefined,
  alreadyRestored: boolean,
): boolean {
  return Boolean(sessionId) && !alreadyRestored;
}

/** A stale or delayed list must not select a different session than the URL id. */
export function canSelectSessionFromList(
  restoredSessionId: string | null | undefined,
  candidateId: string,
): boolean {
  if (!restoredSessionId) return true;
  return candidateId === restoredSessionId;
}
