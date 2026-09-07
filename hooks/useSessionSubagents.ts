"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import type { SessionFeatureContext } from "@/lib/agent-session-types";
import { isDocumentHidden } from "@/lib/visibility-timers";
import {
  parseSubagentActivityEvent,
  parseSubagentLifecycle,
  parseSubagentProgress,
  parseSubagentSnapshot,
  type SubagentActivityEvent,
  type SubagentHistoryEntry,
  type SubagentInfo,
  type SubagentProgress,
  type SubagentSnapshotLike,
} from "@/lib/subagent-types";
import {
  createSubagentFromProgress,
  getSubagentFreshness,
  mergeSubagentRoster,
  progressStatusToSubagentStatus,
  reconcileSubagentRosterSnapshot,
  SUBAGENT_RECONCILE_INTERVAL_MS,
} from "@/lib/subagent-hub-state";

const SUBAGENT_ACTIVITY_BUFFER_MAX = 50;
// Bound the outer maps as well as each child's activity buffer.
const SUBAGENT_ACTIVITY_MAX_IDS = 64;

/** Keep only the most recently inserted entries of an id-keyed map. */
function pruneSubagentIdMap<T>(map: Record<string, T>): Record<string, T> {
  const keys = Object.keys(map);
  if (keys.length <= SUBAGENT_ACTIVITY_MAX_IDS) return map;
  const next = { ...map };
  let over = keys.length - SUBAGENT_ACTIVITY_MAX_IDS;
  // Integer-like keys sort numerically, so their relative age is unknown.
  // Evict non-integer keys oldest-first, then integer-like keys if necessary.
  const ordered = keys.filter((key) => !/^(?:0|[1-9]\d*)$/.test(key));
  for (const key of ordered) {
    if (over <= 0) break;
    delete next[key];
    over -= 1;
  }
  if (over > 0) {
    for (const key of keys) {
      if (over <= 0) break;
      if (next[key] === undefined) continue;
      delete next[key];
      over -= 1;
    }
  }
  return next;
}

function hasSubagentRosterReconcileNeed(rows: SubagentInfo[], now = Date.now()): boolean {
  return rows.some((subagent) => {
    if (subagent.source === "history" || subagent.status !== "started") return false;
    return getSubagentFreshness(subagent, now) === "stale"
      || (subagent.missingSnapshots ?? 0) > 0
      || subagent.missingSince !== undefined;
  });
}

function hasLiveStartedSubagent(rows: SubagentInfo[]): boolean {
  return rows.some((subagent) => subagent.source !== "history" && subagent.status === "started");
}

/** Convert a recovered on-disk history entry into roster form. */
function historyEntryToSubagentInfo(entry: SubagentHistoryEntry): SubagentInfo {
  const info: SubagentInfo = {
    id: entry.id,
    agent: entry.agent,
    agentSource: entry.agentSource,
    description: entry.description,
    status: entry.status,
    task: entry.task,
    assignment: entry.assignment,
    index: entry.index,
    sessionFile: entry.sessionFile,
    source: "history",
    detached: entry.detached,
    result: entry.result,
  };
  const progress: SubagentProgress = {
    status: entry.status === "started" ? "running" : entry.status,
    task: entry.task,
    assignment: entry.assignment,
    description: entry.description,
    lastIntent: entry.lastIntent,
    toolCount: entry.toolCount,
    requests: entry.requests,
    tokens: entry.tokens,
    contextTokens: entry.contextTokens,
    contextWindow: entry.contextWindow,
    cost: entry.cost,
    durationMs: entry.durationMs,
    modelOverride: entry.modelOverride,
    modelRole: entry.modelRole,
    resolvedModel: entry.resolvedModel,
    resolvedModelIsFallback: entry.resolvedModelIsFallback,
    retryFailure: entry.retryFailure,
  };
  info.progress = progress;
  return info;
}



interface SessionSubagentOptions {
  getSessionContext(): SessionFeatureContext;
  canMutateSession(sid?: string): boolean;
}

interface SubagentEvent {
  type: string;
  payload?: unknown;
}

export function useSessionSubagents({ getSessionContext, canMutateSession }: SessionSubagentOptions) {
  const [subagents, setSubagents] = useState<SubagentInfo[]>([]);
  const [subagentEvents, setSubagentEvents] = useState<Record<string, SubagentActivityEvent[]>>({});
  const [subagentTranscriptVersions, setSubagentTranscriptVersions] = useState<Record<string, number>>({});
  let activeSubagentCount = 0;
  for (const subagent of subagents) {
    if (subagent.source !== "history" && subagent.status === "started") activeSubagentCount += 1;
  }
  // Raw child-session events stream at token rate; coalesce the per-subagent
  // revision bumps to one per animation frame so an open dialog only re-pages
  // once per frame instead of per event.
  const subagentVersionFlushRef = useRef<Set<string> | null>(null);
  const subagentActivityFlushRef = useRef<Map<string, SubagentActivityEvent[]> | null>(null);
  const subagentVersionFlushFrameRef = useRef<number | null>(null);
  // Delayed live-roster hydration after mount/reconnect and the bounded stale
  // reconciliation loop share one timer so refreshes cannot overlap.
  const rosterRefreshTimerRef = useRef<number | null>(null);
  const rosterRefreshTimerKindRef = useRef<"initial" | "reconcile" | null>(null);
  const rosterRefreshDeferredRef = useRef(false);
  const rosterRefreshInFlightRef = useRef<Promise<boolean> | null>(null);
  const rosterRefreshRequestIdRef = useRef(0);
  const refreshSubagentRosterRef = useRef<((sid: string) => Promise<boolean>) | null>(null);
  const subagentsRef = useRef<SubagentInfo[]>([]);
  subagentsRef.current = subagents;
  // In-flight roster/history responses and deferred child-event flushes are
  // fenced by the selected session and this generation. Parent prompt turns do
  // not advance it: detached children outlive agent_end.
  const subagentRosterGenerationRef = useRef(0);

  // Merge a batch of roster entries through the shared precedence/fence
  // implementation. `skipNewerThan` protects live frames observed after a
  // point-in-time get_subagents request.
  const mergeSubagents = useCallback((incoming: SubagentInfo[], options?: {
    skipNewerThan?: number;
    sessionId?: string;
    rosterGeneration?: number;
  }) => {
    setSubagents((prev) => {
      const context = getSessionContext();
      if (
        options?.sessionId !== undefined
        && (
          !context.alive
          || context.sessionId !== options.sessionId
          || (options.rosterGeneration !== undefined && subagentRosterGenerationRef.current !== options.rosterGeneration)
        )
      ) return prev;
      const next = mergeSubagentRoster(prev, incoming, options);
      subagentsRef.current = next;
      return next;
    });
  }, [getSessionContext]);

  // Recover the ON-DISK roster from the parent session's task toolResults.
  // Survives page reloads and shows finished runs from previous sessions.
  const refreshSubagentHistory = useCallback(async (sid: string, loadGeneration = getSessionContext().loadGeneration): Promise<boolean> => {
    const generation = subagentRosterGenerationRef.current;
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sid)}/subagents`);
      if (!res.ok) return false;
      const data = await res.json() as { subagents?: SubagentHistoryEntry[] };
      const context = getSessionContext();
      // Fence AFTER the awaited json: the session or roster generation may
      // have changed while the response was in flight.
      if (
        context.sessionId !== sid
        || subagentRosterGenerationRef.current !== generation
        || (loadGeneration !== undefined && context.loadGeneration !== loadGeneration)
      ) return false;
      const entries = (data.subagents ?? []).map(historyEntryToSubagentInfo);
      mergeSubagents(entries, { sessionId: sid, rosterGeneration: generation });
      return true;
    } catch {
      // Best effort; live frames take precedence while a run is active.
      return false;
    }
  }, [getSessionContext, mergeSubagents]);

  // Schedule at most one bounded reconciliation timer while a live started
  // row is stale or has been absent from an authoritative snapshot. The
  // callback uses a ref because refreshSubagentRoster is declared below.
  const scheduleSubagentRosterReconcile = useCallback((sid: string) => {
    const context = getSessionContext();
    if (
      !context.alive
      || context.sessionId !== sid
      || !context.runtimeReady
      || !hasLiveStartedSubagent(subagentsRef.current)
      || isDocumentHidden()
    ) return;
    if (rosterRefreshTimerRef.current || rosterRefreshInFlightRef.current) return;

    const generation = subagentRosterGenerationRef.current;
    rosterRefreshTimerKindRef.current = "reconcile";
    rosterRefreshTimerRef.current = window.setTimeout(() => {
      rosterRefreshTimerRef.current = null;
      rosterRefreshTimerKindRef.current = null;
      const context = getSessionContext();
      if (
        !context.alive
        || context.sessionId !== sid
        || subagentRosterGenerationRef.current !== generation
        || isDocumentHidden()
      ) return;
      if (hasSubagentRosterReconcileNeed(subagentsRef.current)) {
        void refreshSubagentRosterRef.current?.(sid);
      } else {
        scheduleSubagentRosterReconcile(sid);
      }
    }, SUBAGENT_RECONCILE_INTERVAL_MS);
  }, [getSessionContext]);

  // Hydrate the LIVE roster from get_subagents. The registry only holds
  // currently-running subagents, so this fills gaps after an SSE reconnect or
  // a missed lifecycle frame; it never reports finished runs.
  const refreshSubagentRoster = useCallback((sid: string): Promise<boolean> => {
    if (!canMutateSession(sid)) return Promise.resolve(false);
    const inFlight = rosterRefreshInFlightRef.current;
    if (inFlight) return inFlight;

    const requestedAt = Date.now();
    const generation = subagentRosterGenerationRef.current;
    const requestId = ++rosterRefreshRequestIdRef.current;
    const requestPromise = (async () => {
      try {
        const result = await sendAgentCommand<{ subagents?: SubagentSnapshotLike[] }>(sid, { type: "get_subagents" });
        const context = getSessionContext();
        // Fence: the request may resolve after the user switched sessions or
        // the roster was cleared. Parent prompts do not fence this snapshot:
        // detached children and their registry remain authoritative after
        // agent_end.
        if (
          !context.alive
          || context.sessionId !== sid
          || subagentRosterGenerationRef.current !== generation
        ) return false;
        const snapshots = (result?.subagents ?? [])
          .map(parseSubagentSnapshot)
          .filter((subagent): subagent is SubagentInfo => subagent !== undefined);
        // The snapshot is a point-in-time view: never overwrite entries that
        // live frames updated after the request was made (their state is newer).
        const liveIds = new Set(snapshots.map((s) => s.id));
        const now = Date.now();
        setSubagents((prev) => {
          const context = getSessionContext();
          if (
            !context.alive
            || context.sessionId !== sid
            || subagentRosterGenerationRef.current !== generation
          ) return prev;
          const merged = mergeSubagentRoster(prev, snapshots, { skipNewerThan: requestedAt });
          const next = reconcileSubagentRosterSnapshot(merged, liveIds, requestedAt, now);
          subagentsRef.current = next;
          return next;
        });
        // Mid-run disk history can gain completed task calls that live frames
        // missed (a child finishing before the subscription attached is deleted
        // from the registry) — re-check so such children appear before agent_end.
        void refreshSubagentHistory(sid);
        return true;
      } catch {
        // Request failures must not advance absence metadata; the next
        // scheduled tick retries through the same refresh machinery.
        return false;
      } finally {
        if (rosterRefreshRequestIdRef.current === requestId) {
          rosterRefreshInFlightRef.current = null;
          scheduleSubagentRosterReconcile(sid);
        }
      }
    })();
    rosterRefreshInFlightRef.current = requestPromise;
    return requestPromise;
  }, [canMutateSession, getSessionContext, refreshSubagentHistory, scheduleSubagentRosterReconcile]);
  refreshSubagentRosterRef.current = refreshSubagentRoster;

  // State updates from lifecycle/progress frames can make a row stale or
  // expose absence metadata without a registry refresh of their own.
  useEffect(() => {
    const sid = getSessionContext().sessionId;
    if (sid && hasLiveStartedSubagent(subagents)) {
      scheduleSubagentRosterReconcile(sid);
    } else if (rosterRefreshTimerKindRef.current === "reconcile" && rosterRefreshTimerRef.current) {
      clearTimeout(rosterRefreshTimerRef.current);
      rosterRefreshTimerRef.current = null;
      rosterRefreshTimerKindRef.current = null;
    }
  }, [getSessionContext, scheduleSubagentRosterReconcile, subagents]);

  // Activity is scoped to the selected session rather than a parent prompt.
  // A detached child may continue emitting frames after agent_end, so only a
  // session switch/unmount clears this bounded UI cache.
  const resetSubagentActivityState = useCallback(() => {
    if (subagentVersionFlushFrameRef.current !== null) {
      cancelAnimationFrame(subagentVersionFlushFrameRef.current);
      subagentVersionFlushFrameRef.current = null;
    }
    subagentVersionFlushRef.current = null;
    subagentActivityFlushRef.current = null;
    setSubagentEvents({});
    setSubagentTranscriptVersions({});
  }, []);

  const resetSubagentRoster = useCallback(() => {
    subagentsRef.current = [];
    setSubagents([]);
    subagentRosterGenerationRef.current += 1;
    resetSubagentActivityState();
  }, [resetSubagentActivityState]);

  const scheduleInitialRosterRefresh = useCallback((sid: string) => {
    const context = getSessionContext();
    clearTimeout(rosterRefreshTimerRef.current ?? undefined);
    rosterRefreshTimerRef.current = null;
    if (
      !context.alive
      || context.sessionId !== sid
      || !context.runtimeReady
    ) return;
    if (isDocumentHidden()) {
      rosterRefreshDeferredRef.current = true;
      return;
    }
    rosterRefreshDeferredRef.current = false;
    rosterRefreshTimerKindRef.current = "initial";
    rosterRefreshTimerRef.current = window.setTimeout(() => {
      rosterRefreshTimerRef.current = null;
      rosterRefreshTimerKindRef.current = null;
      const context = getSessionContext();
      if (isDocumentHidden()) {
        rosterRefreshDeferredRef.current = true;
        return;
      }
      if (context.sessionId !== sid || !context.runtimeReady) return;
      void refreshSubagentRoster(sid);
    }, 600);
  }, [getSessionContext, refreshSubagentRoster]);

  const handleEvent = useCallback((event: SubagentEvent) => {
    switch (event.type) {
      case "subagent_lifecycle": {
        // Child lifecycle frames are session-scoped, not parent-turn-scoped:
        // detached children can settle after the parent's agent_end. Capture
        // the selected-session roster generation so a queued frame from a
        // previous session cannot repopulate a cleared roster.
        const context = getSessionContext();
        const eventSessionId = context.sessionId;
        const eventRosterGeneration = subagentRosterGenerationRef.current;
        if (!context.alive || !eventSessionId) break;
        // Roster fed by omp's subagent_lifecycle frames. Payload mirrors
        // SubagentLifecyclePayload (oh-my-pi task/types.ts); defensive
        // parsing degrades to ignoring the frame, never breaking the run.
        const info = parseSubagentLifecycle(event.payload);
        if (!info) break;
        mergeSubagents([info], { sessionId: eventSessionId, rosterGeneration: eventRosterGeneration });
        break;
      }
      case "subagent_progress": {
        // Progress frames are session-scoped, not parent-turn-scoped. Detached
        // children can continue after agent_end, while this fence rejects a
        // queued frame from a session/roster that has since been cleared.
        const context = getSessionContext();
        const eventSessionId = context.sessionId;
        const eventRosterGeneration = subagentRosterGenerationRef.current;
        if (!context.alive || !eventSessionId) break;
        // Progress frames carry the full AgentProgress snapshot (throttled to
        // one per 150ms and flushed at terminal). The reliable key is
        // progress.id; parentToolCallId/index are fallbacks.
        const payload = event.payload as {
          index?: unknown;
          agent?: unknown;
          agentSource?: unknown;
          task?: unknown;
          assignment?: unknown;
          description?: unknown;
          parentToolCallId?: unknown;
          sessionFile?: unknown;
          detached?: unknown;
          progress?: unknown;
        } | undefined;
        const progress = parseSubagentProgress(payload?.progress);
        const progressId = progress?.id;
        const index = typeof payload?.index === "number" && Number.isFinite(payload.index)
          ? payload.index
          : (progress?.index ?? -1);
        const parentToolCallId = typeof payload?.parentToolCallId === "string" ? payload.parentToolCallId : null;
        const task = typeof payload?.task === "string" && payload.task.trim() ? payload.task : (progress?.task ?? null);
        const assignment = typeof payload?.assignment === "string" ? payload.assignment : progress?.assignment;
        if (!progressId && !task && !parentToolCallId && index < 0) break;
        setSubagents((prev) => {
          const context = getSessionContext();
          if (
            !context.alive
            || context.sessionId !== eventSessionId
            || subagentRosterGenerationRef.current !== eventRosterGeneration
          ) return prev;
          let target = -1;
          if (progressId) {
            // A valid progress frame names its subagent; if that id is gone,
            // recover it directly rather than falling back to a different
            // child that happens to share a parent or index.
            target = prev.findIndex((subagent) => subagent.id === progressId);
            if (target === -1 && progress) {
              const recovered = createSubagentFromProgress({
                index: typeof payload?.index === "number" && Number.isFinite(payload.index) ? payload.index : undefined,
                agent: typeof payload?.agent === "string" ? payload.agent : undefined,
                agentSource:
                  typeof payload?.agentSource === "string"
                    && (payload.agentSource === "bundled" || payload.agentSource === "user" || payload.agentSource === "project")
                    ? payload.agentSource
                    : undefined,
                task: typeof payload?.task === "string" ? payload.task : undefined,
                assignment,
                description: typeof payload?.description === "string" ? payload.description : undefined,
                parentToolCallId: parentToolCallId ?? undefined,
                sessionFile: typeof payload?.sessionFile === "string" ? payload.sessionFile : undefined,
                detached: typeof payload?.detached === "boolean" ? payload.detached : undefined,
              }, progress);
              return recovered ? mergeSubagentRoster(prev, [recovered]) : prev;
            }
          } else {
            // ID-less fallback frames: prefer the exact (parent, index) pair
            // (batch children share parentToolCallId), then each key alone.
            if (parentToolCallId && index >= 0) {
              target = prev.findIndex((subagent) => subagent.parentToolCallId === parentToolCallId && subagent.index === index);
            }
            if (target === -1 && parentToolCallId) target = prev.findIndex((subagent) => subagent.parentToolCallId === parentToolCallId);
            if (target === -1 && index >= 0) target = prev.findIndex((subagent) => subagent.index === index);
          }
          if (target === -1) return prev;
          const current = prev[target];
          // A delayed running/pending snapshot must not resurrect a child
          // whose lifecycle/history already supplied a terminal outcome.
          const nextStatus = progressStatusToSubagentStatus(progress?.status, current.status);
          if (current.status !== "started" && nextStatus === "started") return prev;
          const nextEntry: SubagentInfo = {
            ...current,
            // Progress snapshots own lifecycle state once a row exists. A
            // frame without status is a partial update and must preserve the
            // current row status instead of fabricating a transition.
            status: nextStatus,
            agent: typeof payload?.agent === "string" ? payload.agent : current.agent,
            // The snapshot's agent-source literal lives in payload.agentSource,
            // not payload.agent (which holds the agent name).
            agentSource:
              typeof payload?.agentSource === "string"
                && (payload.agentSource === "bundled" || payload.agentSource === "user" || payload.agentSource === "project")
                ? payload.agentSource
                : current.agentSource,
            ...(typeof payload?.sessionFile === "string" ? { sessionFile: payload.sessionFile } : {}),
            ...(typeof payload?.detached === "boolean" ? { detached: payload.detached } : {}),
            ...(task ? { task } : {}),
            ...(assignment !== undefined ? { assignment } : {}),
            ...(progress ? { progress } : {}),
            lastUpdate: Date.now(),
            source: current.source === "history" && current.status !== "started" ? "history" : "live",
          };
          // Progress frames arrive every ~150ms; skip rerender when no displayed field changed.
          // Avoid double JSON.stringify on hot path — field compare is cheaper than serializing whole entries.
          if (
            current.agent === nextEntry.agent &&
            current.agentSource === nextEntry.agentSource &&
            current.sessionFile === nextEntry.sessionFile &&
            current.detached === nextEntry.detached &&
            current.task === nextEntry.task &&
            current.assignment === nextEntry.assignment &&
            JSON.stringify(current.progress) === JSON.stringify(nextEntry.progress)
          ) return prev;
          const next = [...prev];
          next[target] = nextEntry;
          return next;
        });
        break;
      }
      case "subagent_event": {
        // Child-session activity is session-scoped, not parent-turn-scoped.
        // Keep collecting detached-child events after agent_end, while the
        // selected-session roster generation fences queued flush callbacks.
        const context = getSessionContext();
        const eventSessionId = context.sessionId;
        const eventRosterGeneration = subagentRosterGenerationRef.current;
        if (!context.alive || !eventSessionId) break;
        // An events-level subscription embeds raw child-session events here.
        // The transcript remains paged on the server; a per-child revision
        // tells an open dialog to fetch only the appended byte range. Also
        // keep a bounded live-activity buffer for the transcript dialog.
        const payload = event.payload as { id?: unknown; event?: unknown } | undefined;
        const subagentId = typeof payload?.id === "string" ? payload.id : null;
        if (subagentId) {
          const pendingVersions = subagentVersionFlushRef.current ?? (subagentVersionFlushRef.current = new Set());
          pendingVersions.add(subagentId);

          const activity = parseSubagentActivityEvent(payload);
          if (activity) {
            const pendingActivities = subagentActivityFlushRef.current ?? (subagentActivityFlushRef.current = new Map());
            const queuedEvents = pendingActivities.get(subagentId);
            if (queuedEvents) {
              if (queuedEvents.length >= SUBAGENT_ACTIVITY_BUFFER_MAX) queuedEvents.shift();
              queuedEvents.push(activity);
              // Re-key so the pending map preserves updated-id recency for the
              // outer 64-id prune when the frame is eventually flushed.
              pendingActivities.delete(subagentId);
              pendingActivities.set(subagentId, queuedEvents);
            } else {
              pendingActivities.set(subagentId, [activity]);
            }
          }

          if (subagentVersionFlushFrameRef.current === null) {
            subagentVersionFlushFrameRef.current = requestAnimationFrame(() => {
              subagentVersionFlushFrameRef.current = null;
              const context = getSessionContext();
              if (
                !context.alive
                || context.sessionId !== eventSessionId
                || subagentRosterGenerationRef.current !== eventRosterGeneration
              ) {
                subagentVersionFlushRef.current = null;
                subagentActivityFlushRef.current = null;
                return;
              }
              const queuedVersions = subagentVersionFlushRef.current;
              subagentVersionFlushRef.current = null;
              const queuedActivities = subagentActivityFlushRef.current;
              subagentActivityFlushRef.current = null;
              const hasVersions = queuedVersions !== null && queuedVersions.size > 0;
              const hasActivities = queuedActivities !== null && queuedActivities.size > 0;
              if (!hasVersions && !hasActivities) return;

              if (queuedVersions && queuedVersions.size > 0) {
                setSubagentTranscriptVersions((prev) => {
                  let next = prev;
                  for (const id of queuedVersions) next = { ...next, [id]: (next[id] ?? 0) + 1 };
                  return pruneSubagentIdMap(next);
                });
              }
              if (queuedActivities && queuedActivities.size > 0) {
                setSubagentEvents((prev) => {
                  let next = prev;
                  for (const [id, activities] of queuedActivities) {
                    const existing = prev[id] ?? [];
                    const combined = existing.length === 0
                      ? (activities.length <= SUBAGENT_ACTIVITY_BUFFER_MAX ? activities : activities.slice(-SUBAGENT_ACTIVITY_BUFFER_MAX))
                      : [...existing, ...activities].slice(-SUBAGENT_ACTIVITY_BUFFER_MAX);
                    if (next === prev) next = { ...prev };
                    // Re-key first so pruning evicts the LEAST recently UPDATED
                    // ids (a plain spread keeps an existing key at its original
                    // position and can evict an actively-updated early id).
                    delete next[id];
                    next[id] = combined;
                  }
                  return pruneSubagentIdMap(next);
                });
              }
            });
          }
        }
        break;
      }
    }
  }, [getSessionContext, mergeSubagents]);

  const pauseHiddenTimers = useCallback(() => {
    if (!isDocumentHidden()) return;
    if (rosterRefreshTimerRef.current) {
      if (rosterRefreshTimerKindRef.current === "initial") {
        rosterRefreshDeferredRef.current = true;
      }
      clearTimeout(rosterRefreshTimerRef.current);
      rosterRefreshTimerRef.current = null;
      rosterRefreshTimerKindRef.current = null;
    }
  }, []);

  const resumeVisibleSession = useCallback((sid: string) => {
    scheduleSubagentRosterReconcile(sid);
    if (rosterRefreshDeferredRef.current) scheduleInitialRosterRefresh(sid);
  }, [scheduleInitialRosterRefresh, scheduleSubagentRosterReconcile]);

  const dispose = useCallback(() => {
    clearTimeout(rosterRefreshTimerRef.current ?? undefined);
    rosterRefreshTimerRef.current = null;
    rosterRefreshTimerKindRef.current = null;
    rosterRefreshInFlightRef.current = null;
    rosterRefreshRequestIdRef.current += 1;
    if (subagentVersionFlushFrameRef.current !== null) {
      cancelAnimationFrame(subagentVersionFlushFrameRef.current);
      subagentVersionFlushFrameRef.current = null;
    }
    subagentVersionFlushRef.current = null;
    subagentActivityFlushRef.current = null;
  }, []);

  return {
    subagents,
    subagentEvents,
    subagentTranscriptVersions,
    activeSubagentCount,
    handleEvent,
    reset: resetSubagentRoster,
    dispose,
    refreshHistory: refreshSubagentHistory,
    refreshRoster: refreshSubagentRoster,
    scheduleInitialRosterRefresh,
    pauseHiddenTimers,
    resumeVisibleSession,
  };
}
