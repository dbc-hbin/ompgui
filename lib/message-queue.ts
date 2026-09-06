/**
 * Shared pre-dispatch queue contract.
 *
 * Safe for browser imports: no Buffer, fs, or crypto. The server store and
 * command handlers live in `session-queue.ts` / `rpc-manager.ts`.
 *
 * Wire:
 * - WebSessionState.messageQueue
 * - SSE { type: "message_queue_update", queue }
 * - Commands return { queue, recalled? } (not an SSE event)
 * - recall_queued_message returns { queue, recalled } (recalled required)
 */

import { asNumber, asString, isRecord } from "./type-guards";

export type MessageQueueLane = "steer" | "followUp";
export type MessageQueueItemStatus = "queued" | "sending" | "failed";

export interface MessageQueueItem {
  id: string;
  text: string;
  lane: MessageQueueLane;
  status: MessageQueueItemStatus;
  error?: string;
}

export interface MessageQueueSnapshot {
  revision: number;
  items: readonly MessageQueueItem[];
  nativeQueuedCount?: number;
}

/** Result of enqueue/delete/promote/get_message_queue. Not an SSE event. */
export interface QueueMutationResult {
  queue: MessageQueueSnapshot;
  recalled?: MessageQueueItem;
}

/** Result of recall_queued_message. Not an SSE event. */
export interface QueueRecallResult {
  queue: MessageQueueSnapshot;
  recalled: MessageQueueItem;
}

export const EMPTY_QUEUE_SNAPSHOT: MessageQueueSnapshot = {
  revision: 0,
  items: [],
};

const LANES = new Set<string>(["steer", "followUp"]);
const STATUSES = new Set<string>(["queued", "sending", "failed"]);

export function parseMessageQueueItem(value: unknown): MessageQueueItem | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const text = asString(value.text);
  const lane = asString(value.lane);
  const status = asString(value.status);
  if (!id || text === undefined || !LANES.has(lane ?? "") || !STATUSES.has(status ?? "")) {
    return null;
  }
  const item: MessageQueueItem = {
    id,
    text,
    lane: lane as MessageQueueLane,
    status: status as MessageQueueItemStatus,
  };
  if (value.error !== undefined) {
    const error = asString(value.error);
    if (error === undefined) return null;
    item.error = error;
  }
  return item;
}

function parseSnapshotShape(value: unknown): MessageQueueSnapshot | null {
  if (!isRecord(value)) return null;
  const revision = asNumber(value.revision);
  if (revision === undefined || !Array.isArray(value.items)) return null;
  const items: MessageQueueItem[] = [];
  for (const entry of value.items) {
    const item = parseMessageQueueItem(entry);
    if (!item) return null;
    items.push(item);
  }
  const snapshot: MessageQueueSnapshot = { revision, items };
  if (value.nativeQueuedCount !== undefined) {
    const nativeQueuedCount = asNumber(value.nativeQueuedCount);
    if (nativeQueuedCount === undefined) return null;
    snapshot.nativeQueuedCount = nativeQueuedCount;
  }
  return snapshot;
}

/**
 * Parse a snapshot object, or an SSE `message_queue_update` envelope.
 * Command results are not events — unwrap `.queue`, or use
 * `parseRecallQueuedMessageResult` for recall acks.
 */
export function parseMessageQueueSnapshot(value: unknown): MessageQueueSnapshot | null {
  if (!isRecord(value)) return null;
  if (value.type === "message_queue_update") return parseSnapshotShape(value.queue);
  return parseSnapshotShape(value);
}

export function snapshotFromAgentState(state: unknown): MessageQueueSnapshot | null {
  if (!isRecord(state)) return null;
  return parseSnapshotShape(state.messageQueue);
}

export function parseRecallQueuedMessageResult(value: unknown): QueueRecallResult | null {
  if (!isRecord(value)) return null;
  const queue = parseSnapshotShape(value.queue);
  const recalled = parseMessageQueueItem(value.recalled);
  if (!queue || !recalled) return null;
  return { queue, recalled };
}
