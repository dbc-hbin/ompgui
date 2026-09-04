import type { ImageContent } from "./types";

export const MAX_ATTACHED_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHED_IMAGES = 10;

export interface Base64ImageAttachment {
  data: string;
  mimeType: string;
}

function isBase64DataChar(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a)
    || (code >= 0x61 && code <= 0x7a)
    || (code >= 0x30 && code <= 0x39)
    || code === 0x2b
    || code === 0x2f;
}

export function getBase64DecodedByteLength(data: string): number | null {
  if (!data || data.length % 4 !== 0) return null;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const dataEnd = data.length - padding;
  for (let index = 0; index < dataEnd; index += 1) {
    if (!isBase64DataChar(data.charCodeAt(index))) return null;
  }
  for (let index = dataEnd; index < data.length; index += 1) {
    if (data[index] !== "=") return null;
  }
  return (data.length / 4) * 3 - padding;
}

export function isBase64ImageWithinLimits(value: unknown): value is Base64ImageAttachment {
  if (!value || typeof value !== "object") return false;
  const image = value as Partial<Base64ImageAttachment>;
  if (typeof image.data !== "string" || typeof image.mimeType !== "string" || !image.mimeType.startsWith("image/")) {
    return false;
  }
  const bytes = getBase64DecodedByteLength(image.data);
  return bytes !== null && bytes <= MAX_ATTACHED_IMAGE_BYTES;
}

/** Return an API-safe error for prompt, steering, and follow-up image arrays. */
export function validateAgentImages(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return "images must be an array";
  if (value.length > MAX_ATTACHED_IMAGES) {
    return `A message can include at most ${MAX_ATTACHED_IMAGES} images`;
  }
  for (const image of value) {
    if (!image || typeof image !== "object" || (image as { type?: unknown }).type !== "image") {
      return "Each attachment must be an image";
    }
    if (!isBase64ImageWithinLimits(image)) {
      return `Each image must be valid base64 image data of ${MAX_ATTACHED_IMAGE_BYTES / (1024 * 1024)}MB or smaller`;
    }
  }
  return null;
}

/**
 * Normalize one unknown value to a canonical flat base64 image block.
 * Accepts the flat omp shape `{data, mimeType}` (with or without `type`) and
 * the legacy nested Anthropic-style `source: {type: "base64", data,
 * media_type}` shape. URL-source images and malformed values return null.
 */
function normalizeImageBlock(value: unknown): ImageContent | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const source = record.source;
  // Nested legacy shape carries the payload under `source`.
  if (typeof source === "object" && source !== null && !Array.isArray(source)) {
    const nested = source as Record<string, unknown>;
    if (nested.type === "base64" && typeof nested.data === "string") {
      const mediaType = typeof nested.media_type === "string" ? nested.media_type : "";
      if (!mediaType.toLowerCase().startsWith("image/")) return null;
      return { type: "image", data: nested.data, mimeType: mediaType };
    }
  }
  // Flat shape: `type` is optional here so bare generate_image
  // `details.images` payloads (which omit it) still normalize.
  if (typeof record.data === "string" && typeof record.mimeType === "string") {
    if (!record.mimeType.toLowerCase().startsWith("image/")) return null;
    return { type: "image", data: record.data, mimeType: record.mimeType };
  }
  return null;
}

export const MAX_TOOL_RESULT_IMAGES = MAX_ATTACHED_IMAGES;
export const MAX_TOOL_RESULT_IMAGE_BYTES = MAX_ATTACHED_IMAGE_BYTES;
export const MAX_TOOL_RESULT_IMAGES_TOTAL_BYTES = 25 * 1024 * 1024;
export const TOOL_RESULT_IMAGES_TOO_LARGE_CODE = "tool_result_images_too_large";

export type ToolResultImagesLimitReason = "count" | "per_image" | "total";

export class ToolResultImagesTooLargeError extends Error {
  readonly code = TOOL_RESULT_IMAGES_TOO_LARGE_CODE;
  readonly reason: ToolResultImagesLimitReason;
  constructor(reason: ToolResultImagesLimitReason) {
    super(
      reason === "count"
        ? `Tool result images exceed the limit of ${MAX_TOOL_RESULT_IMAGES} images`
        : reason === "per_image"
          ? `Tool result image exceeds the per-image limit of ${MAX_TOOL_RESULT_IMAGE_BYTES / (1024 * 1024)}MB`
          : `Tool result images exceed the total limit of ${MAX_TOOL_RESULT_IMAGES_TOTAL_BYTES / (1024 * 1024)}MB`,
    );
    this.name = "ToolResultImagesTooLargeError";
    this.reason = reason;
  }
}

/** Decoded byte length for an inline base64 payload, with a length-based fallback for malformed data. */
export function getInlineToolResultImageBytes(data: string): number {
  return getBase64DecodedByteLength(data) ?? Math.floor(data.length * 3 / 4);
}

/** Enforce count, per-image, and aggregate limits on decoded image byte sizes. */
export function assertToolResultImageSizesWithinLimits(sizes: number[]): void {
  if (sizes.length > MAX_TOOL_RESULT_IMAGES) throw new ToolResultImagesTooLargeError("count");
  for (const size of sizes) {
    if (size > MAX_TOOL_RESULT_IMAGE_BYTES) throw new ToolResultImagesTooLargeError("per_image");
  }
  let total = 0;
  for (const size of sizes) total += size;
  if (total > MAX_TOOL_RESULT_IMAGES_TOTAL_BYTES) throw new ToolResultImagesTooLargeError("total");
}

/**
 * Collect the presentable images for a toolResult from both the canonical
 * content image blocks and OMP `details.images` (generate_image). Returns
 * deduplicated normalized flat `ImageContent[]` (canonical content images keep
 * their normalized form; URL-source blocks are skipped since they carry no
 * base64 payload). Tolerates malformed input by returning [].
 */
export function collectToolResultImages(input: { content?: unknown; details?: unknown }): ImageContent[] {
  const seen = new Set<string>();
  const images: ImageContent[] = [];
  const push = (image: ImageContent | null) => {
    if (!image || typeof image.data !== "string" || typeof image.mimeType !== "string") return;
    const key = `${image.mimeType}\0${image.data}`;
    if (seen.has(key)) return;
    seen.add(key);
    images.push(image);
  };
  try {
    if (input && typeof input === "object" && Array.isArray(input.content)) {
      for (const block of input.content) {
        if (typeof block !== "object" || block === null || Array.isArray(block)) continue;
        // Canonical content image blocks carry `type: "image"`.
        if ((block as Record<string, unknown>).type !== "image") continue;
        push(normalizeImageBlock(block));
      }
    }
    const details = input && typeof input === "object" ? input.details : undefined;
    if (typeof details === "object" && details !== null && !Array.isArray(details)) {
      const nested = (details as Record<string, unknown>).images;
      if (Array.isArray(nested)) {
        for (const raw of nested) push(normalizeImageBlock(raw));
      }
    }
  } catch {
    // Defensive: one malformed block must never break history projection.
  }
  return images;
}
