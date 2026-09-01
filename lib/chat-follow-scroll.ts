export type FollowScrollIntent = "initial" | "user-send" | "follow-stream" | "follow-idle";
export type FollowScrollMode = "skip" | "assign" | "into-view";

export type FollowScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

export type FollowScrollDecision = {
  mode: FollowScrollMode;
  behavior?: ScrollBehavior;
};

export type FollowScrollTokenInput = {
  loading: boolean;
  messageCount: number;
  lastEntryId: string;
  streaming: boolean;
  streamRevision: number;
  agentRunning: boolean;
  agentPhase: string | null;
  widgetSignature: string;
  isCompacting: boolean;
  retrySignature: string;
  activeSubagentCount: number;
  todoSignature: string;
};

export type FollowScrollEnd = {
  scrollIntoView: (options?: ScrollIntoViewOptions) => void;
};

/** Max scrollTop that still shows the latest content. */
export function nextFollowScrollTop(metrics: FollowScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.clientHeight);
}

export function distanceFromBottom(metrics: FollowScrollMetrics): number {
  return nextFollowScrollTop(metrics) - metrics.scrollTop;
}

export function followTodoSignature(
  phases: Array<{ name?: string; tasks?: Array<{ status?: string }> }> | null | undefined,
): string {
  if (!phases?.length) return "";
  return phases.map((phase) => {
    const tasks = Array.isArray(phase.tasks) ? phase.tasks : [];
    return `${phase.name ?? ""}:${tasks.map((task) => task.status ?? "").join("")}:${tasks.length}`;
  }).join(",");
}

/** Primitive that changes only when follow-scroll may need to run. */
export function createFollowScrollToken(input: FollowScrollTokenInput): string {
  return [
    input.loading ? "1" : "0",
    String(input.messageCount),
    input.lastEntryId,
    input.streaming ? "1" : "0",
    String(input.streamRevision),
    input.agentRunning ? "1" : "0",
    input.agentPhase ?? "",
    input.widgetSignature,
    input.isCompacting ? "1" : "0",
    input.retrySignature,
    String(input.activeSubagentCount),
    input.todoSignature,
  ].join("\u001f");
}

export function decideFollowScroll(input: {
  following: boolean;
  intent: FollowScrollIntent;
  scrollTop: number;
  nextScrollTop: number;
  reducedMotion: boolean;
}): FollowScrollDecision {
  const forceFollow = input.intent === "initial" || input.intent === "user-send";
  if (!input.following && !forceFollow) return { mode: "skip" };
  if (input.scrollTop === input.nextScrollTop) return { mode: "skip" };
  // Live follow and first paint use a direct scrollTop write. Reduced motion
  // never starts a smooth chase. Idle/user-send still use scrollIntoView.
  if (
    input.intent === "follow-stream"
    || input.intent === "initial"
    || input.reducedMotion
  ) {
    return { mode: "assign" };
  }
  return { mode: "into-view", behavior: "smooth" };
}

export function applyFollowScroll(input: {
  container: FollowScrollMetrics;
  end: FollowScrollEnd;
  decision: FollowScrollDecision;
}): { wrote: boolean; method: "none" | "scrollTop" | "scrollIntoView" } {
  if (input.decision.mode === "skip") return { wrote: false, method: "none" };
  if (input.decision.mode === "assign") {
    const next = nextFollowScrollTop(input.container);
    if (input.container.scrollTop === next) return { wrote: false, method: "none" };
    input.container.scrollTop = next;
    return { wrote: true, method: "scrollTop" };
  }
  input.end.scrollIntoView({
    block: "nearest",
    behavior: input.decision.behavior ?? "smooth",
  });
  return { wrote: true, method: "scrollIntoView" };
}
