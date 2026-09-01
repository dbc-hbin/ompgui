export type RunningEventsFrame =
  | {
    type: "sessions-changed";
    sessionIds: string[];
    refreshSessionList: boolean;
  }
  | {
    type: "running";
    runningSessionIds: string[];
    refreshSessionList: boolean;
  }
  | {
    type: "ignored";
  };

function stringIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/** Parse the running EventSource payload without changing wire frame shapes. */
export function parseRunningEventsFrame(data: unknown): RunningEventsFrame {
  if (!data || typeof data !== "object") return { type: "ignored" };
  const frame = data as {
    type?: unknown;
    sessionIds?: unknown;
    runningSessionIds?: unknown;
    refreshSessionList?: unknown;
  };
  if (frame.type === "sessions-changed") {
    return {
      type: "sessions-changed",
      sessionIds: stringIds(frame.sessionIds),
      refreshSessionList: frame.refreshSessionList === true,
    };
  }
  if (frame.type === "running") {
    return {
      type: "running",
      runningSessionIds: stringIds(frame.runningSessionIds),
      refreshSessionList: frame.refreshSessionList === true,
    };
  }
  return { type: "ignored" };
}
