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

import { getBase64DecodedByteLength, MAX_ATTACHED_IMAGES, MAX_ATTACHED_IMAGE_BYTES, validateAgentImages } from "./image-attachments";
import type { Base64ImageAttachment } from "./image-attachments";
import { asNumber, asString } from "./type-guards";

export type MessageQueueLane = "steer" | "followUp";
export type MessageQueueItemStatus = "queued" | "sending" | "failed";

export interface MessageQueueImage extends Base64ImageAttachment {
  type: "image";
}

export interface MessageQueueAttachment {
  mimeType: string;
  bytes: number;
}

/** Image payload is deliberately absent from snapshots and events. */
export interface MessageQueueItem {
  id: string;
  text: string;
  lane: MessageQueueLane;
  status: MessageQueueItemStatus;
  error?: string;
  attachments?: readonly MessageQueueAttachment[];
}

/** Private payload returned only by the authenticated recall command. */
export interface RecalledMessageQueueItem extends MessageQueueItem {
  images?: readonly MessageQueueImage[];
}

export interface MessageQueueSnapshot {
  revision: number;
  items: readonly MessageQueueItem[];
  nativeQueuedCount?: number;
}

/** Result of enqueue/delete/promote/get_message_queue. Not an SSE event. */
export interface QueueMutationResult {
  queue: MessageQueueSnapshot;
  recalled?: RecalledMessageQueueItem;
}

/** Result of recall_queued_message. Not an SSE event. */
export interface QueueRecallResult {
  queue: MessageQueueSnapshot;
  recalled: RecalledMessageQueueItem;
}

export const EMPTY_QUEUE_SNAPSHOT: MessageQueueSnapshot = {
  revision: 0,
  items: [],
};

const LANES = new Set<string>(["steer", "followUp"]);
const STATUSES = new Set<string>(["queued", "sending", "failed"]);

export function parseMessageQueueItem(input: unknown): MessageQueueItem | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
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
  if (value.attachments !== undefined) {
    if (!Array.isArray(value.attachments) || value.attachments.length > MAX_ATTACHED_IMAGES) return null;
    const attachments: MessageQueueAttachment[] = [];
    for (const attachment of value.attachments) {
      if (typeof attachment !== "object" || attachment === null || typeof attachment.mimeType !== "string" || !attachment.mimeType.startsWith("image/")
        || typeof attachment.bytes !== "number" || !Number.isSafeInteger(attachment.bytes)
        || attachment.bytes <= 0 || attachment.bytes > MAX_ATTACHED_IMAGE_BYTES) return null;
      attachments.push({ mimeType: attachment.mimeType, bytes: attachment.bytes });
    }
    item.attachments = attachments;
  }
  return item;
}

function parseSnapshotShape(input: unknown): MessageQueueSnapshot | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
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
export function parseMessageQueueSnapshot(input: unknown): MessageQueueSnapshot | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (value.type === "message_queue_update") return parseSnapshotShape(value.queue);
  return parseSnapshotShape(value);
}

export function snapshotFromAgentState(state: unknown): MessageQueueSnapshot | null {
  if (typeof state !== "object" || state === null || !("messageQueue" in state)) return null;
  return parseSnapshotShape(state.messageQueue);
}

export function parseRecallQueuedMessageResult(input: unknown): QueueRecallResult | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const queue = parseSnapshotShape(value.queue);
  const recalled = parseMessageQueueItem(value.recalled);
  if (!queue || !recalled || typeof value.recalled !== "object" || value.recalled === null) return null;
  const rawImages = "images" in value.recalled ? value.recalled.images : undefined;
  if (validateAgentImages(rawImages)) return null;
  const images: MessageQueueImage[] = [];
  if (Array.isArray(rawImages)) {
    for (const image of rawImages) {
      if (typeof image !== "object" || image === null || image.type !== "image" || typeof image.data !== "string" || typeof image.mimeType !== "string") return null;
      images.push({ type: "image", data: image.data, mimeType: image.mimeType });
    }
  }
  if ((recalled.attachments?.length ?? 0) !== images.length) return null;
  for (let index = 0; index < images.length; index += 1) {
    const attachment = recalled.attachments?.[index];
    const image = images[index];
    if (!attachment || attachment.mimeType !== image.mimeType || attachment.bytes !== getBase64DecodedByteLength(image.data)) return null;
  }
  return { queue, recalled: images.length ? { ...recalled, images } : recalled };
}
