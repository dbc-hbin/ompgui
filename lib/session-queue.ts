/**
 * Server-owned pre-dispatch message queue store.
 *
 * Shared snapshot types live in `message-queue.ts` so the frontend can parse
 * get_state and SSE without this runtime. OMP never sees an item until the
 * wrapper forwards it exactly once through `prompt` (with streamingBehavior
 * `steer` while a turn is active).
 */

import { randomUUID } from "node:crypto";
import { getBase64DecodedByteLength, validateAgentImages } from "./image-attachments";
import type { MessageQueueImage, RecalledMessageQueueItem } from "./message-queue";
import {
  EMPTY_QUEUE_SNAPSHOT,
  type MessageQueueItem,
  type MessageQueueLane,
  type MessageQueueSnapshot,
  type QueueMutationResult,
} from "./message-queue";

export type {
  MessageQueueItem,
  MessageQueueLane,
  MessageQueueItemStatus,
  MessageQueueSnapshot,
  QueueMutationResult,
} from "./message-queue";

export const QUEUE_SNAPSHOT_EVENT = "message_queue_update" as const;

export const QUEUE_COMMAND_ENQUEUE = "enqueue_message" as const;
export const QUEUE_COMMAND_RECALL = "recall_queued_message" as const;
export const QUEUE_COMMAND_DELETE = "delete_queued_message" as const;
export const QUEUE_COMMAND_PROMOTE = "promote_queued_message" as const;
export const QUEUE_COMMAND_GET = "get_message_queue" as const;

export const QUEUE_COMMANDS = [
  QUEUE_COMMAND_ENQUEUE,
  QUEUE_COMMAND_RECALL,
  QUEUE_COMMAND_DELETE,
  QUEUE_COMMAND_PROMOTE,
  QUEUE_COMMAND_GET,
] as const;

export type SessionQueueCommandType = (typeof QUEUE_COMMANDS)[number];

export const QUEUE_ERROR_STALE = "queue_stale_revision";
export const QUEUE_ERROR_MISSING = "queue_item_missing";
export const QUEUE_ERROR_SENDING = "queue_item_sending";
export const QUEUE_ERROR_FULL = "queue_full";
export const QUEUE_ERROR_TOO_LARGE = "queue_item_too_large";
export const QUEUE_ERROR_TOTAL_TOO_LARGE = "queue_too_large";
export const QUEUE_ERROR_INVALID = "queue_invalid";

export const SESSION_QUEUE_MAX_ITEMS = 32;
export const SESSION_QUEUE_MAX_ITEM_BYTES = 256 * 1024;
export const SESSION_QUEUE_MAX_TOTAL_BYTES = 1024 * 1024;
/** Decoded bytes; preserves the existing ten 10MiB images per-message allowance. */
export const SESSION_QUEUE_MAX_IMAGE_BYTES = 100 * 1024 * 1024;
export const QUEUE_ERROR_IMAGES_TOO_LARGE = "queue_images_too_large";
export const QUEUE_FORWARD_TIMEOUT_MS = 30_000;

export const QUEUE_UNCERTAIN_HANDOFF =
  "This message may already have been handed to the agent. It was not confirmed and will not be retried.";
export const QUEUE_DISCARDED_ON_TEARDOWN =
  "Queued messages were discarded because the session shut down.";
export const QUEUE_DISCARDED_ON_SWITCH =
  "Queued messages were discarded because the session changed.";

export type SessionQueueSnapshotEvent = {
  type: typeof QUEUE_SNAPSHOT_EVENT;
  queue: MessageQueueSnapshot;
};

const QUEUE_COMMAND_SET = new Set<string>(QUEUE_COMMANDS);

export class SessionQueueError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "SessionQueueError";
    this.code = code;
  }
}

export function isSessionQueueKind(value: unknown): value is MessageQueueLane {
  return value === "steer" || value === "followUp";
}

export function isSessionQueueCommandType(value: unknown): value is SessionQueueCommandType {
  return typeof value === "string" && QUEUE_COMMAND_SET.has(value);
}

export function toQueueSnapshotEvent(snapshot: MessageQueueSnapshot): SessionQueueSnapshotEvent {
  return { type: QUEUE_SNAPSHOT_EVENT, queue: snapshot };
}

export function toQueueMutationResult(
  snapshot: MessageQueueSnapshot,
  recalled?: RecalledMessageQueueItem,
): QueueMutationResult {
  return recalled ? { queue: snapshot, recalled } : { queue: snapshot };
}

export function emptyQueueSnapshot(): MessageQueueSnapshot {
  return EMPTY_QUEUE_SNAPSHOT;
}

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function freezeItem(item: MessageQueueItem): MessageQueueItem {
  const next: MessageQueueItem = {
    id: item.id,
    text: item.text,
    lane: item.lane,
    status: item.status,
    ...(item.error ? { error: item.error } : {}),
    ...(item.attachments ? { attachments: Object.freeze(item.attachments.map((attachment) => Object.freeze({ ...attachment }))) } : {}),
  };
  Object.freeze(next);
  return next;
}

function cloneItems(items: readonly MessageQueueItem[]): readonly MessageQueueItem[] {
  const cloned = items.map((item) => freezeItem(item));
  Object.freeze(cloned);
  return cloned;
}

export class SessionMessageQueue {
  private revision = 0;
  private items: MessageQueueItem[] = [];
  private readonly imagePayloads = new Map<string, readonly MessageQueueImage[]>();
  private imageBytes = 0;
  private snapshot: MessageQueueSnapshot = EMPTY_QUEUE_SNAPSHOT;

  getSnapshot(): MessageQueueSnapshot {
    return this.snapshot;
  }

  hasSending(): boolean {
    return this.items.some((item) => item.status === "sending");
  }

  selectDispatchCandidate(lane: MessageQueueLane): MessageQueueItem | undefined {
    if (this.hasSending()) return undefined;
    return this.items.find((item) => item.status === "queued" && item.lane === lane);
  }

  /** Private payload access for the canonical dispatcher only. */
  getImages(id: string): readonly MessageQueueImage[] | undefined {
    return this.imagePayloads.get(id);
  }

  enqueue(input: { lane: MessageQueueLane; text: string; images?: unknown }): MessageQueueSnapshot {
    if (!isSessionQueueKind(input.lane)) {
      throw new SessionQueueError("lane must be steer or followUp", QUEUE_ERROR_INVALID);
    }
    const imageError = validateAgentImages(input.images);
    if (imageError) throw new SessionQueueError(imageError, QUEUE_ERROR_INVALID);
    const images: MessageQueueImage[] = [];
    const attachments: { mimeType: string; bytes: number }[] = [];
    let imageBytes = 0;
    if (Array.isArray(input.images)) {
      for (const image of input.images) {
        if (typeof image !== "object" || image === null || !("data" in image) || !("mimeType" in image)
          || typeof image.data !== "string" || typeof image.mimeType !== "string") {
          throw new SessionQueueError("Each attachment must be an image", QUEUE_ERROR_INVALID);
        }
        const bytes = getBase64DecodedByteLength(image.data);
        if (bytes === null) throw new SessionQueueError("Invalid image data", QUEUE_ERROR_INVALID);
        imageBytes += bytes;
        images.push(Object.freeze({ type: "image", data: image.data, mimeType: image.mimeType }));
        attachments.push({ mimeType: image.mimeType, bytes });
      }
    }
    if (this.imageBytes + imageBytes > SESSION_QUEUE_MAX_IMAGE_BYTES) {
      throw new SessionQueueError("Queue image capacity exceeds 100MiB; remove or recall queued images first", QUEUE_ERROR_IMAGES_TOO_LARGE);
    }
    const text = this.assertText(input.text, images.length > 0);
    if (this.items.length >= SESSION_QUEUE_MAX_ITEMS) {
      throw new SessionQueueError(
        `The queue already holds ${SESSION_QUEUE_MAX_ITEMS} messages`,
        QUEUE_ERROR_FULL,
      );
    }
    this.assertTotalBytes(utf8Bytes(text));
    const item = freezeItem({
      id: randomUUID(),
      lane: input.lane,
      text,
      status: "queued",
      ...(attachments.length ? { attachments } : {}),
    });
    if (images.length) this.imagePayloads.set(item.id, Object.freeze(images));
    this.imageBytes += imageBytes;
    this.items = [...this.items, item];
    return this.publish();
  }

  /** Only a queued followUp may be promoted to steer at the front. */
  promote(id: string, expectedRevision: number): MessageQueueSnapshot {
    const item = this.requireMutable(id, expectedRevision);
    if (item.lane !== "followUp" || item.status !== "queued") {
      throw new SessionQueueError("Only a queued follow-up can be promoted to steer", QUEUE_ERROR_INVALID);
    }
    const next = freezeItem({ ...item, lane: "steer", status: "queued" });
    this.items = [next, ...this.items.filter((entry) => entry.id !== id)];
    return this.publish();
  }

  recall(id: string, expectedRevision: number, maxResponseBytes?: number): { item: RecalledMessageQueueItem; snapshot: MessageQueueSnapshot } {
    const item = this.requireMutable(id, expectedRevision);
    const images = this.imagePayloads.get(id);
    if (maxResponseBytes !== undefined) {
      if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
        throw new SessionQueueError("Invalid recall response capacity", QUEUE_ERROR_INVALID);
      }
      // The pre-removal snapshot is a conservative upper bound. Count base64
      // directly (ASCII with no JSON escapes), never serialize its large payload.
      let responseBytes = utf8Bytes(JSON.stringify({ queue: this.snapshot, recalled: item })) + 256;
      for (const image of images ?? []) {
        responseBytes += image.data.length + utf8Bytes(JSON.stringify({ type: "image", data: "", mimeType: image.mimeType })) + 1;
      }
      if (responseBytes > maxResponseBytes) {
        throw new SessionQueueError(
          "These queued images exceed the remote recall transfer limit. Recall them from the web app instead; the queued message has not changed.",
          "queue_recall_too_large",
        );
      }
    }
    this.releaseImages(item);
    this.items = this.items.filter((entry) => entry.id !== id);
    return { item: images ? { ...item, images } : item, snapshot: this.publish() };
  }

  delete(id: string, expectedRevision: number): MessageQueueSnapshot {
    const item = this.requireMutable(id, expectedRevision);
    this.releaseImages(item);
    this.items = this.items.filter((entry) => entry.id !== id);
    return this.publish();
  }

  markSending(id: string): MessageQueueSnapshot {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) {
      throw new SessionQueueError("Queued message was not found", QUEUE_ERROR_MISSING);
    }
    if (item.status !== "queued") {
      throw new SessionQueueError("Queued message is already being sent", QUEUE_ERROR_SENDING);
    }
    this.replace(id, { ...item, status: "sending" });
    return this.publish();
  }

  markFailed(id: string, error: string): MessageQueueSnapshot {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) return this.snapshot;
    this.replace(id, { ...item, status: "failed", error });
    return this.publish();
  }

  remove(id: string): MessageQueueSnapshot {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) return this.snapshot;
    this.releaseImages(item);
    this.items = this.items.filter((entry) => entry.id !== id);
    return this.publish();
  }

  failSending(error: string): MessageQueueSnapshot {
    if (!this.hasSending()) return this.snapshot;
    this.items = this.items.map((item) => (
      item.status === "sending" ? freezeItem({ ...item, status: "failed", error }) : item
    ));
    return this.publish();
  }

  reset(): MessageQueueSnapshot {
    this.imagePayloads.clear();
    this.imageBytes = 0;
    this.items = [];
    this.revision = 0;
    this.snapshot = EMPTY_QUEUE_SNAPSHOT;
    return this.snapshot;
  }

  private releaseImages(item: MessageQueueItem): void {
    if (!this.imagePayloads.delete(item.id)) return;
    for (const attachment of item.attachments ?? []) this.imageBytes -= attachment.bytes;
  }

  private requireMutable(id: string, expectedRevision: number): MessageQueueItem {
    this.assertCas(expectedRevision);
    const item = this.items.find((entry) => entry.id === id);
    if (!item) {
      throw new SessionQueueError("Queued message was not found", QUEUE_ERROR_MISSING);
    }
    if (item.status === "sending") {
      throw new SessionQueueError("Queued message is already being sent", QUEUE_ERROR_SENDING);
    }
    return item;
  }

  private assertCas(expectedRevision: unknown): void {
    if (typeof expectedRevision !== "number" || expectedRevision !== this.revision) {
      throw new SessionQueueError("Queue revision is stale; reload the queue and retry", QUEUE_ERROR_STALE);
    }
  }

  private assertText(value: unknown, hasImages: boolean): string {
    if (typeof value !== "string") {
      throw new SessionQueueError("Message text is required", QUEUE_ERROR_INVALID);
    }
    if (!hasImages && value.trim().length === 0) {
      throw new SessionQueueError("Message text cannot be empty", QUEUE_ERROR_INVALID);
    }
    const bytes = utf8Bytes(value);
    if (bytes > SESSION_QUEUE_MAX_ITEM_BYTES) {
      throw new SessionQueueError(
        `Message exceeds ${SESSION_QUEUE_MAX_ITEM_BYTES} bytes`,
        QUEUE_ERROR_TOO_LARGE,
      );
    }
    return value;
  }

  private assertTotalBytes(additional: number): void {
    let total = additional;
    for (const item of this.items) total += utf8Bytes(item.text);
    if (total > SESSION_QUEUE_MAX_TOTAL_BYTES) {
      throw new SessionQueueError(
        `Queue exceeds ${SESSION_QUEUE_MAX_TOTAL_BYTES} bytes`,
        QUEUE_ERROR_TOTAL_TOO_LARGE,
      );
    }
  }

  private replace(id: string, next: MessageQueueItem): void {
    this.items = this.items.map((item) => (item.id === id ? freezeItem(next) : item));
  }

  private publish(): MessageQueueSnapshot {
    this.revision += 1;
    const snapshot: MessageQueueSnapshot = {
      revision: this.revision,
      items: cloneItems(this.items),
    };
    Object.freeze(snapshot);
    this.snapshot = snapshot;
    return snapshot;
  }
}
