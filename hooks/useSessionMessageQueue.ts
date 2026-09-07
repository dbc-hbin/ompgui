"use client";

import { useCallback, useRef, useState } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import type { AttachedImage, SessionFeatureContext } from "@/lib/agent-session-types";
import { translate } from "@/lib/i18n";
import { asNumber } from "@/lib/type-guards";
import { matchesSessionLoadGeneration, matchesQueueRevision } from "@/lib/session-load-fence";
import {
  EMPTY_QUEUE_SNAPSHOT,
  parseMessageQueueSnapshot,
  parseRecallQueuedMessageResult,
  snapshotFromAgentState,
  type MessageQueueLane,
  type MessageQueueSnapshot,
  type QueueMutationResult,
  type QueueRecallResult,
} from "@/lib/message-queue";

interface SessionMessageQueueOptions {
  getSessionContext: () => SessionFeatureContext;
  canMutateSession: (sid?: string) => boolean;
  addNotice: (notice: { type: "error"; message: string }) => void;
}

/** Command results are `{ queue, recalled? }`. Unwrap `.queue`; recall acks
 * require `recalled` via parseRecallQueuedMessageResult. Not an SSE event. */
function unwrapQueueCommandResult(value: unknown): QueueMutationResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("queue" in value)) return null;
  const queue = parseMessageQueueSnapshot(value.queue);
  if (!queue) return null;
  if (!("recalled" in value) || value.recalled === undefined || value.recalled === null) return { queue };
  return parseRecallQueuedMessageResult(value);
}

export function useSessionMessageQueue({ getSessionContext, canMutateSession, addNotice }: SessionMessageQueueOptions) {
  const [queuedMessages, setQueuedMessages] = useState<MessageQueueSnapshot>(() => ({
    ...EMPTY_QUEUE_SNAPSHOT, items: [], nativeQueuedCount: undefined,
  }));
  const [queueEnqueuePending, setQueueEnqueuePending] = useState(false);
  // Revisions belong to the wrapper; the fence drops responses from prior epochs.
  const queueRevisionRef = useRef(-1);
  const queueRequestFenceRef = useRef(0);

  const beginQueueEpoch = useCallback(() => {
    queueRequestFenceRef.current += 1;
    queueRevisionRef.current = -1;
    setQueuedMessages({ ...EMPTY_QUEUE_SNAPSHOT, items: [], nativeQueuedCount: undefined });
  }, []);

  const applyQueueSnapshot = useCallback((
    snapshot: MessageQueueSnapshot,
    sid: string,
    sessionLoadGeneration: number,
    connectionFence: number,
    mode: "event" | "fetch",
    nativeQueuedCount?: number,
  ): boolean => {
    const context = getSessionContext();
    if (!context.alive) return false;
    if (
      !matchesQueueRevision(
        context.sessionId,
        sid,
        context.loadGeneration,
        sessionLoadGeneration,
        queueRequestFenceRef.current,
        connectionFence,
        queueRevisionRef.current,
        snapshot.revision,
        mode,
      )
    ) return false;
    queueRevisionRef.current = snapshot.revision;
    const overlayNative = nativeQueuedCount ?? snapshot.nativeQueuedCount;
    setQueuedMessages({
      ...snapshot,
      nativeQueuedCount: overlayNative,
    });
    return true;
  }, [getSessionContext]);

  const applyNativeQueuedCount = useCallback((
    count: number | undefined,
    sid: string,
    sessionLoadGeneration: number,
    connectionFence: number,
  ) => {
    const context = getSessionContext();
    if (count === undefined || !context.alive) return;
    if (context.sessionId !== sid) return;
    if (context.loadGeneration !== sessionLoadGeneration) return;
    if (queueRequestFenceRef.current !== connectionFence) return;
    setQueuedMessages((prev) => {
      if (prev.nativeQueuedCount === count) return prev;
      return { ...prev, nativeQueuedCount: count };
    });
  }, [getSessionContext]);

  const applyQueueFromAgentState = useCallback((
    state: { queuedMessageCount?: number; messageQueue?: unknown } | undefined,
    sid: string,
    sessionLoadGeneration: number,
  ) => {
    const connectionFence = queueRequestFenceRef.current;
    const nativeQueuedCount = asNumber(state?.queuedMessageCount);
    const snapshot = snapshotFromAgentState(state);
    if (snapshot) {
      applyQueueSnapshot(snapshot, sid, sessionLoadGeneration, connectionFence, "fetch", nativeQueuedCount);
      return;
    }
    applyNativeQueuedCount(nativeQueuedCount, sid, sessionLoadGeneration, connectionFence);
  }, [applyNativeQueuedCount, applyQueueSnapshot]);

  const fetchMessageQueue = useCallback(async (sid: string) => {
    const context = getSessionContext();
    const sessionLoadGeneration = context.loadGeneration;
    const runtimeLoadGeneration = context.runtimeGeneration;
    const connectionFence = queueRequestFenceRef.current;
    try {
      const data = await sendAgentCommand<unknown>(sid, { type: "get_message_queue" });
      const current = getSessionContext();
      if (
        !current.alive
        || !matchesSessionLoadGeneration(current.sessionId, sid, current.loadGeneration, sessionLoadGeneration)
        || current.runtimeGeneration !== runtimeLoadGeneration
        || queueRequestFenceRef.current !== connectionFence
      ) return;
      const result = unwrapQueueCommandResult(data);
      if (result) applyQueueSnapshot(result.queue, sid, sessionLoadGeneration, connectionFence, "fetch");
    } catch {
      // Older runtimes without get_message_queue keep get_state's native count.
    }
  }, [applyQueueSnapshot, getSessionContext]);

  // Queued (undelivered) messages live in the queue panel only; the chat gets
  // the real user message when pi delivers it (user message_end event). An
  // optimistic chat bubble here would duplicate the queue panel and turn into
  // a ghost message if the queue is recalled.
  const enqueueMessage = useCallback(async (
    message: string,
    behavior: "steer" | "followUp",
    images: AttachedImage[] | undefined,
    ensureEventsConnected: (sid: string) => Promise<void>,
  ): Promise<boolean> => {
    const sid = getSessionContext().sessionId;
    if (!sid || !canMutateSession(sid)) return false;
    const lane: MessageQueueLane = behavior === "steer" ? "steer" : "followUp";
    setQueueEnqueuePending(true);
    try {
      await ensureEventsConnected(sid);
      const current = getSessionContext();
      const sessionLoadGeneration = current.loadGeneration;
      const connectionFence = queueRequestFenceRef.current;
      if (
        !matchesSessionLoadGeneration(current.sessionId, sid, current.loadGeneration, sessionLoadGeneration)
        || !canMutateSession(sid)
      ) return false;
      const data = await sendAgentCommand<unknown>(sid, {
        type: "enqueue_message",
        message,
        lane,
        ...(images?.length ? { images: images.map(({ data, mimeType }) => ({ type: "image" as const, data, mimeType })) } : {}),
      });
      if (queueRequestFenceRef.current !== connectionFence) {
        void fetchMessageQueue(sid);
        return true;
      }
      const result = unwrapQueueCommandResult(data);
      if (result) applyQueueSnapshot(result.queue, sid, sessionLoadGeneration, connectionFence, "fetch");
      else await fetchMessageQueue(sid);
      return true;
    } catch (e) {
      console.error("Failed to queue prompt:", e);
      addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
      void fetchMessageQueue(sid);
      return false;
    } finally {
      setQueueEnqueuePending(false);
    }
  }, [addNotice, applyQueueSnapshot, canMutateSession, fetchMessageQueue, getSessionContext]);

  const failQueueMutation = useCallback((sid: string, error: unknown) => {
    addNotice({
      type: "error",
      message: error instanceof Error ? error.message : translate("chatInput.queuedOpFailed"),
    });
    void fetchMessageQueue(sid);
  }, [addNotice, fetchMessageQueue]);

  const handleRecallQueuedMessage = useCallback(async (id: string): Promise<QueueRecallResult["recalled"] | null> => {
    const context = getSessionContext();
    const sid = context.sessionId;
    if (!sid || !id || !canMutateSession(sid)) return null;
    const sessionLoadGeneration = context.loadGeneration;
    const connectionFence = queueRequestFenceRef.current;
    const expectedRevision = queueRevisionRef.current;
    if (expectedRevision < 0) {
      failQueueMutation(sid, new Error(translate("chatInput.queuedOpFailed")));
      return null;
    }
    try {
      const data = await sendAgentCommand<unknown>(sid, {
        type: "recall_queued_message",
        id,
        expectedRevision,
      });
      // Recall is destructive: an acknowledged payload belongs to its caller
      // even if reconnect/history loading has made the queue snapshot stale.
      // applyQueueSnapshot independently fences the non-destructive UI update.
      const result = parseRecallQueuedMessageResult(data);
      if (!result) {
        failQueueMutation(sid, new Error(translate("chatInput.queuedOpFailed")));
        return null;
      }
      applyQueueSnapshot(result.queue, sid, sessionLoadGeneration, connectionFence, "fetch");
      return result.recalled;
    } catch (e) {
      failQueueMutation(sid, e);
      return null;
    }
  }, [applyQueueSnapshot, canMutateSession, failQueueMutation, getSessionContext]);

  const handleDeleteQueuedMessage = useCallback(async (id: string): Promise<boolean> => {
    const context = getSessionContext();
    const sid = context.sessionId;
    if (!sid || !id || !canMutateSession(sid)) return false;
    const sessionLoadGeneration = context.loadGeneration;
    const connectionFence = queueRequestFenceRef.current;
    const expectedRevision = queueRevisionRef.current;
    if (expectedRevision < 0) {
      failQueueMutation(sid, new Error(translate("chatInput.queuedOpFailed")));
      return false;
    }
    try {
      const data = await sendAgentCommand<unknown>(sid, {
        type: "delete_queued_message",
        id,
        expectedRevision,
      });
      const current = getSessionContext();
      if (
        !matchesSessionLoadGeneration(current.sessionId, sid, current.loadGeneration, sessionLoadGeneration)
        || queueRequestFenceRef.current !== connectionFence
      ) {
        return false;
      }
      const result = unwrapQueueCommandResult(data);
      if (!result) {
        failQueueMutation(sid, new Error(translate("chatInput.queuedOpFailed")));
        return false;
      }
      applyQueueSnapshot(result.queue, sid, sessionLoadGeneration, connectionFence, "fetch");
      return true;
    } catch (e) {
      failQueueMutation(sid, e);
      return false;
    }
  }, [applyQueueSnapshot, canMutateSession, failQueueMutation, getSessionContext]);

  const handlePromoteQueuedMessage = useCallback(async (id: string): Promise<boolean> => {
    const context = getSessionContext();
    const sid = context.sessionId;
    if (!sid || !id || !canMutateSession(sid)) return false;
    const sessionLoadGeneration = context.loadGeneration;
    const connectionFence = queueRequestFenceRef.current;
    const expectedRevision = queueRevisionRef.current;
    if (expectedRevision < 0) {
      failQueueMutation(sid, new Error(translate("chatInput.queuedOpFailed")));
      return false;
    }
    try {
      const data = await sendAgentCommand<unknown>(sid, {
        type: "promote_queued_message",
        id,
        expectedRevision,
      });
      const current = getSessionContext();
      if (
        !matchesSessionLoadGeneration(current.sessionId, sid, current.loadGeneration, sessionLoadGeneration)
        || queueRequestFenceRef.current !== connectionFence
      ) {
        return false;
      }
      const result = unwrapQueueCommandResult(data);
      if (!result) {
        failQueueMutation(sid, new Error(translate("chatInput.queuedOpFailed")));
        return false;
      }
      applyQueueSnapshot(result.queue, sid, sessionLoadGeneration, connectionFence, "fetch");
      return true;
    } catch (e) {
      failQueueMutation(sid, e);
      return false;
    }
  }, [applyQueueSnapshot, canMutateSession, failQueueMutation, getSessionContext]);

  const handleQueueEvent = useCallback((queue: unknown) => {
    const context = getSessionContext();
    if (!context.sessionId) return;
    const snapshot = parseMessageQueueSnapshot(queue);
    if (snapshot) {
      applyQueueSnapshot(snapshot, context.sessionId, context.loadGeneration, queueRequestFenceRef.current, "event");
    }
  }, [applyQueueSnapshot, getSessionContext]);

  const disposeQueue = useCallback(() => {
    beginQueueEpoch();
    setQueueEnqueuePending(false);
  }, [beginQueueEpoch]);

  return {
    queuedMessages,
    queueEnqueuePending,
    beginQueueEpoch,
    disposeQueue,
    applyQueueFromAgentState,
    fetchMessageQueue,
    handleQueueEvent,
    enqueueMessage,
    handleRecallQueuedMessage,
    handleDeleteQueuedMessage,
    handlePromoteQueuedMessage,
  };
}
