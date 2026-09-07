import { createHash } from "node:crypto";
import type { RelayDisplayMessage } from "./protocol";

export interface OnlineTranscriptPage {
  messages: RelayDisplayMessage[];
  total: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number;
}

// Authentication protects this projection. Never persist it as an offline replica.
export function onlineMessage(value: unknown, entryId?: string): RelayDisplayMessage | null {
  if (typeof value !== "object" || value === null || !("role" in value) || typeof value.role !== "string") return null;
  const raw: Record<string, unknown> = { ...value };
  if (!["user", "assistant", "toolResult", "custom", "bashExecution"].includes(value.role) || (value.role === "custom" && raw.customType === "xdev-mount-notice")) return null;
  const content: Record<string, unknown>[] = [];
  let imageCount = 0;
  if (typeof raw.content === "string") content.push({ type: "text", text: raw.content });
  else if (Array.isArray(raw.content)) for (const block of raw.content) {
    if (typeof block !== "object" || block === null || !("type" in block)) continue;
    if (block.type === "image") {
      imageCount++;
      content.push({ type: "image", deferred: true, ...("mimeType" in block && typeof block.mimeType === "string" ? { mimeType: block.mimeType } : {}) });
    } else if (block.type === "toolCall") {
      const b: Record<string, unknown> = { ...block };
      content.push({ type: "toolCall", toolCallId: b.toolCallId ?? b.id ?? "", toolName: b.toolName ?? b.name ?? "", input: b.input ?? b.arguments ?? {} });
    } else if (block.type === "text" || block.type === "thinking") content.push({ ...block });
  }
  if (typeof raw.output === "string") content.push({ type: "text", text: raw.output });
  const stableId = entryId ?? `live:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
  const message: RelayDisplayMessage = {
    role: value.role, entryId: stableId, content,
    text: content.filter(block => block.type === "text" && typeof block.text === "string").map(block => block.text).join("\n"),
  };
  if (typeof raw.timestamp === "number") message.timestamp = raw.timestamp;
  if (typeof raw.toolCallId === "string") message.toolCallId = raw.toolCallId;
  if (typeof raw.toolName === "string") message.toolName = raw.toolName;
  if (typeof raw.isError === "boolean") message.isError = raw.isError;
  if (typeof raw.details === "object" && raw.details !== null && "images" in raw.details) {
    const { images, ...details } = raw.details;
    if (Array.isArray(images)) imageCount += images.length;
    message.details = details;
  } else if (raw.details !== undefined) message.details = raw.details;
  if (value.role === "bashExecution") {
    message.toolName = "bash";
    message.isError = typeof raw.exitCode === "number" && raw.exitCode !== 0;
    message.details = { command: raw.command, exitCode: raw.exitCode, cancelled: raw.cancelled, truncated: raw.truncated };
  }
  if (typeof raw.errorMessage === "string") message.errorMessage = raw.errorMessage;
  if (typeof raw.stopReason === "string") message.stopReason = raw.stopReason;
  const deferred = raw.deferredImages;
  if (typeof deferred === "object" && deferred !== null && "count" in deferred && typeof deferred.count === "number") imageCount += deferred.count;
  if (imageCount) message.deferredImages = { entryId: stableId, count: imageCount };
  return message;
}

export function projectOnlineTranscript(values: readonly unknown[], entryIds: readonly string[] = [], requestedOffset?: number, limit = 100): OnlineTranscriptPage {
  const total = values.length;
  const offset = requestedOffset ?? Math.max(0, total - Math.min(limit, 100));
  const messages: RelayDisplayMessage[] = [];
  let consumed = 0;
  let bytes = 0;
  for (let index = offset; index < total && consumed < limit; index++) {
    let message = onlineMessage(values[index], entryIds[index]);
    if (message) {
      let size = Buffer.byteLength(JSON.stringify(message));
      if (size > 64 * 1024) {
        const preview = message.text.slice(0, 16000);
        const calls = message.content?.filter(block => block.type === "toolCall").slice(0, 100).map(block => ({ type: "toolCall", toolCallId: String(block.toolCallId).slice(0, 200), toolName: String(block.toolName).slice(0, 200), input: {} })) ?? [];
        message = { ...message, text: preview, content: [{ type: "text", text: preview }, ...calls], toolCallId: message.toolCallId?.slice(0, 200), toolName: message.toolName?.slice(0, 200), errorMessage: message.errorMessage?.slice(0, 1000), stopReason: message.stopReason?.slice(0, 100), details: undefined, truncated: true };
        size = Buffer.byteLength(JSON.stringify(message));
      }
      if (bytes + size > 4 * 1024 * 1024 && consumed > 0) break;
      bytes += size;
      messages.push(message);
    }
    consumed++;
  }
  return { messages, total, offset, nextOffset: offset + consumed, hasMore: offset + consumed < total };
}
