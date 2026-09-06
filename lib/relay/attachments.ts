import { randomUUID } from "node:crypto";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBase64DecodedByteLength, MAX_ATTACHED_IMAGE_BYTES, MAX_ATTACHED_IMAGES } from "../image-attachments";
import type { ImageContent } from "../types";

export const ATTACHMENT_CHUNK_BYTES = 65_536;
export const ATTACHMENT_EXPIRY_MS = 15 * 60 * 1000;
export const ATTACHMENT_GLOBAL_BYTES = 512 * 1024 * 1024;

class AttachmentError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

interface StagedImage {
  id: string;
  deviceId: string;
  directory: string;
  path: string;
  mimeType: string;
  size: number;
  offset: number;
  complete: boolean;
  claimed: boolean;
  cancelled: boolean;
  expires: number;
  timer: NodeJS.Timeout;
}

/** Private transport storage: no paths or filenames originate with a client. */
export class RelayAttachmentStore {
  private readonly images = new Map<string, StagedImage>();
  private reservedBytes = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly schedule: typeof setTimeout = setTimeout,
    private readonly unschedule: typeof clearTimeout = clearTimeout,
    private readonly root: string = tmpdir(),
  ) {}

  private remove(image: StagedImage): void {
    if (this.images.get(image.id) !== image) return;
    image.cancelled = true;
    // Keep accounting intact if deletion fails; a failed cleanup cannot bypass quotas.
    rmSync(image.directory, { recursive: true, force: true });
    this.unschedule(image.timer);
    this.images.delete(image.id);
    this.reservedBytes -= image.size;
  }

  private expire(): void {
    for (const image of this.images.values()) if ((image.cancelled || image.expires <= this.now())) this.remove(image);
  }

  private owned(deviceId: string, id: unknown): StagedImage {
    this.expire();
    const image = typeof id === "string" ? this.images.get(id) : undefined;
    if (!image || image.deviceId !== deviceId || image.claimed || image.cancelled) {
      throw new AttachmentError("invalid_attachment", "Attachment is unavailable");
    }
    return image;
  }

  begin(deviceId: string, mimeType: unknown, size: unknown): { attachmentId: string; maxChunkBytes: number } {
    this.expire();
    if (typeof mimeType !== "string" || !/^image\/[A-Za-z0-9.+-]{1,100}$/.test(mimeType)) {
      throw new AttachmentError("invalid_images", "An image MIME type is required");
    }
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 || size > MAX_ATTACHED_IMAGE_BYTES) {
      throw new AttachmentError("invalid_images", `Each image must be 1 byte to ${MAX_ATTACHED_IMAGE_BYTES / (1024 * 1024)}MiB`);
    }
    let deviceCount = 0;
    for (const image of this.images.values()) if (image.deviceId === deviceId) deviceCount++;
    if (deviceCount >= MAX_ATTACHED_IMAGES || this.reservedBytes + size > ATTACHMENT_GLOBAL_BYTES || this.images.size >= 1024) {
      throw new AttachmentError("attachment_quota", "Attachment staging quota exceeded");
    }
    const id = randomUUID();
    const directory = mkdtempSync(join(this.root, "ompgui-relay-attachment-"));
    const path = join(directory, "image");
    try { closeSync(openSync(path, "wx", 0o600)); }
    catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
    const timer = this.schedule(() => {
      const image = this.images.get(id);
      if (image) {
        // Retain the reservation on an I/O failure; later operations retry expiry.
        try { this.remove(image); } catch { /* Do not throw from a timer callback. */ }
      }
    }, ATTACHMENT_EXPIRY_MS);
    timer.unref?.();
    this.images.set(id, { id, deviceId, directory, path, mimeType, size, offset: 0, complete: false, claimed: false, cancelled: false, expires: this.now() + ATTACHMENT_EXPIRY_MS, timer });
    this.reservedBytes += size;
    return { attachmentId: id, maxChunkBytes: ATTACHMENT_CHUNK_BYTES };
  }

  chunk(deviceId: string, id: unknown, offset: unknown, data: unknown): { nextOffset: number } {
    const image = this.owned(deviceId, id);
    if (image.complete || offset !== image.offset) throw new AttachmentError("invalid_offset", "Attachment chunks must be sequential");
    if (typeof data !== "string" || data.length > Math.ceil(ATTACHMENT_CHUNK_BYTES / 3) * 4) {
      throw new AttachmentError("invalid_chunk", "Attachment chunk is too large or malformed");
    }
    const length = getBase64DecodedByteLength(data);
    if (length === null || length < 1 || length > ATTACHMENT_CHUNK_BYTES || image.offset + length > image.size) {
      throw new AttachmentError("invalid_chunk", "Attachment chunk exceeds declared size or chunk limit");
    }
    const bytes = Buffer.from(data, "base64");
    if (bytes.toString("base64") !== data) throw new AttachmentError("invalid_chunk", "Attachment chunk must be canonical base64");
    const fd = openSync(image.path, "r+");
    try {
      let written = 0;
      while (written < bytes.length) {
        const count = writeSync(fd, bytes, written, bytes.length - written, image.offset + written);
        if (count === 0) throw new AttachmentError("attachment_write_failed", "Attachment storage write failed");
        written += count;
      }
      image.offset += bytes.length;
    } catch (error) {
      closeSync(fd);
      this.remove(image);
      throw error;
    }
    closeSync(fd);
    return { nextOffset: image.offset };
  }

  complete(deviceId: string, id: unknown): { attachmentId: string } {
    const image = this.owned(deviceId, id);
    if (image.offset !== image.size) throw new AttachmentError("incomplete_attachment", "Attachment byte count does not match declared size");
    image.complete = true;
    return { attachmentId: image.id };
  }

  abort(deviceId: string, id: unknown): { aborted: true } {
    this.remove(this.owned(deviceId, id));
    return { aborted: true };
  }

  claim(deviceId: string, ids: unknown): { materialize: () => ImageContent[]; dispose: () => void } {
    if (!Array.isArray(ids) || ids.length > MAX_ATTACHED_IMAGES || ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) {
      throw new AttachmentError("invalid_attachment", `attachmentIds must contain at most ${MAX_ATTACHED_IMAGES} unique IDs`);
    }
    const images = ids.map(id => this.owned(deviceId, id));
    for (const image of images) if (!image.complete) throw new AttachmentError("incomplete_attachment", "Attachment upload is incomplete");
    for (const image of images) image.claimed = true;
    return {
      materialize: () => {
        this.expire();
        return images.map(image => {
          if (image.cancelled || this.images.get(image.id) !== image) throw new AttachmentError("invalid_attachment", "Attachment expired or was cancelled");
          const bytes = readFileSync(image.path);
          if (bytes.length !== image.size) throw new AttachmentError("invalid_attachment", "Attachment byte count changed");
          return { type: "image", mimeType: image.mimeType, data: bytes.toString("base64") };
        });
      },
      dispose: () => { for (const image of images) this.remove(image); },
    };
  }

  cleanupDevice(deviceId: string): void {
    for (const image of this.images.values()) {
      if (image.deviceId !== deviceId) continue;
      try { this.remove(image); } catch { /* Cancelled reservations stay charged until cleanup succeeds. */ }
    }
  }
}

export const relayAttachments = new RelayAttachmentStore();
