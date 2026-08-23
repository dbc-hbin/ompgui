/* Compact-v1 relay protocol. Unknown message and block fields are retained. */

export const RELAY_WIRE_VERSION = 1 as const;
export const RELAY_WIRE_VERSION_NAME = "compact-v1" as const;
export const RELAY_MAX_SESSION_ID_LENGTH = 256;
export const RELAY_MAX_MESSAGE_ID_LENGTH = 256;
export const RELAY_MAX_REASON_LENGTH = 64;
export const RELAY_MAX_PATCH_OPERATIONS = 4_096;
export const RELAY_MAX_CONTENT_BLOCKS = 16_384;
export const RELAY_MAX_STRING_LENGTH = 16 * 1024 * 1024;
export const RELAY_MAX_FRAME_BYTES = 32 * 1024 * 1024;
export const RELAY_MAX_SEQ = Number.MAX_SAFE_INTEGER;

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue }
export type RelayMessageBlock = JsonObject & { type: string };
export type RelayMessageContent = RelayMessageBlock[];
export type RelayAssistantMessage = JsonObject & { role: "assistant"; content: RelayMessageContent };

export interface RelayEnvelope { wire: typeof RELAY_WIRE_VERSION; sessionId: string; epoch: number; seq: number }
export interface RelayActiveCheckpoint { messageId: string; revision: number; message: RelayAssistantMessage }
export interface RelaySyncFrame extends RelayEnvelope {
  type: "relay_sync"; headSeq: number; commitSeq: number; requiresStateRefresh: boolean; active: RelayActiveCheckpoint | null;
}
export interface RelayEventFrame extends RelayEnvelope { type: "event"; event: JsonObject }
export interface MessageBeginFrame extends RelayEnvelope {
  type: "message_begin"; messageId: string; revision: number; message: RelayAssistantMessage;
}
export interface AppendTextOperation { op: "append_text"; index: number; text: string }
export interface AppendThinkingOperation { op: "append_thinking"; index: number; thinking: string }
export interface SetBlockOperation { op: "set_block"; index: number; block: RelayMessageBlock }
export interface TruncateContentOperation { op: "truncate_content"; length: number }
export interface ReplaceMessageOperation { op: "replace_message"; message: RelayAssistantMessage }
export type MessagePatchOperation = AppendTextOperation | AppendThinkingOperation | SetBlockOperation | TruncateContentOperation | ReplaceMessageOperation;
export interface MessagePatchFrame extends RelayEnvelope {
  type: "message_patch"; messageId: string; baseRevision: number; revision: number; operations: MessagePatchOperation[];
}
export interface MessageCommitFrame extends RelayEnvelope {
  type: "message_commit"; messageId: string; authoritative: true; message: RelayAssistantMessage;
}
export type SessionClosedReason = "destroyed" | "identity_changed" | "startup_failed";
export interface SessionClosedFrame extends RelayEnvelope { type: "session_closed"; reason: SessionClosedReason }
export type RelayFrame = RelaySyncFrame | RelayEventFrame | MessageBeginFrame | MessagePatchFrame | MessageCommitFrame | SessionClosedFrame;

export class RelayFrameValidationError extends TypeError {
  readonly path: string;
  constructor(message: string, path = "frame") { super(`${path}: ${message}`); this.name = "RelayFrameValidationError"; this.path = path; }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isFiniteSafeInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= RELAY_MAX_SEQ; }
function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return value === null || typeof value === "boolean" || typeof value === "string" && value.length <= RELAY_MAX_STRING_LENGTH || typeof value === "number" && Number.isFinite(value);
}
function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 64) return false;
  if (isJsonPrimitive(value)) return true;
  if (Array.isArray(value)) return value.length <= RELAY_MAX_CONTENT_BLOCKS && value.every((entry) => isJsonValue(entry, depth + 1));
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length <= RELAY_MAX_CONTENT_BLOCKS * 4 && keys.every((key) => isJsonValue(value[key], depth + 1));
}
function requireString(value: unknown, name: string, maxLength: number): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) throw new RelayFrameValidationError(`expected non-empty string (max ${maxLength})`, name);
}
function requireSequence(value: unknown, name: string): asserts value is number {
  if (!isFiniteSafeInteger(value)) throw new RelayFrameValidationError("expected a non-negative safe integer", name);
}
function validateEnvelope(value: unknown): asserts value is RelayEnvelope {
  if (!isRecord(value)) throw new RelayFrameValidationError("expected an object");
  if (value.wire !== RELAY_WIRE_VERSION) throw new RelayFrameValidationError(`wire must be ${RELAY_WIRE_VERSION}`, "frame.wire");
  requireString(value.sessionId, "frame.sessionId", RELAY_MAX_SESSION_ID_LENGTH);
  requireSequence(value.epoch, "frame.epoch"); requireSequence(value.seq, "frame.seq");
}
function validateMessageBlock(value: unknown, path: string): asserts value is RelayMessageBlock {
  if (!isRecord(value)) throw new RelayFrameValidationError("expected an object", path);
  requireString(value.type, `${path}.type`, RELAY_MAX_SESSION_ID_LENGTH);
  if (!isJsonValue(value)) throw new RelayFrameValidationError("contains a non-JSON value", path);
}
export function validateAssistantMessage(value: unknown, path = "message"): asserts value is RelayAssistantMessage {
  if (!isRecord(value)) throw new RelayFrameValidationError("expected an object", path);
  if (value.role !== "assistant") throw new RelayFrameValidationError('role must be "assistant"', `${path}.role`);
  if (!Array.isArray(value.content) || value.content.length > RELAY_MAX_CONTENT_BLOCKS) throw new RelayFrameValidationError("content must be an array within bounds", `${path}.content`);
  if (!isJsonValue(value)) throw new RelayFrameValidationError("contains a non-JSON value", path);
  value.content.forEach((block, index) => validateMessageBlock(block, `${path}.content[${index}]`));
}
export function isRelayAssistantMessage(value: unknown): value is RelayAssistantMessage { try { validateAssistantMessage(value); return true; } catch { return false; } }
function validateCheckpoint(value: unknown, path: string): asserts value is RelayActiveCheckpoint {
  if (!isRecord(value)) throw new RelayFrameValidationError("expected an object", path);
  requireString(value.messageId, `${path}.messageId`, RELAY_MAX_MESSAGE_ID_LENGTH); requireSequence(value.revision, `${path}.revision`); validateAssistantMessage(value.message, `${path}.message`);
}
function validatePatchOperation(value: unknown, path: string): asserts value is MessagePatchOperation {
  if (!isRecord(value)) throw new RelayFrameValidationError("expected an object", path);
  switch (value.op) {
    case "append_text":
      if (!isFiniteSafeInteger(value.index)) throw new RelayFrameValidationError("index must be a non-negative safe integer", `${path}.index`);
      if (typeof value.text !== "string" || value.text.length > RELAY_MAX_STRING_LENGTH) throw new RelayFrameValidationError("text must be a bounded string", `${path}.text`); return;
    case "append_thinking":
      if (!isFiniteSafeInteger(value.index)) throw new RelayFrameValidationError("index must be a non-negative safe integer", `${path}.index`);
      if (typeof value.thinking !== "string" || value.thinking.length > RELAY_MAX_STRING_LENGTH) throw new RelayFrameValidationError("thinking must be a bounded string", `${path}.thinking`); return;
    case "set_block":
      if (!isFiniteSafeInteger(value.index)) throw new RelayFrameValidationError("index must be a non-negative safe integer", `${path}.index`); validateMessageBlock(value.block, `${path}.block`); return;
    case "truncate_content":
      if (!isFiniteSafeInteger(value.length)) throw new RelayFrameValidationError("length must be a non-negative safe integer", `${path}.length`); return;
    case "replace_message": validateAssistantMessage(value.message, `${path}.message`); return;
    default: throw new RelayFrameValidationError("unknown patch operation", `${path}.op`);
  }
}
export function isMessagePatchOperation(value: unknown): value is MessagePatchOperation { try { validatePatchOperation(value, "operation"); return true; } catch { return false; } }
export function validateMessagePatchOperations(value: unknown, path = "frame.operations"): asserts value is MessagePatchOperation[] {
  if (!Array.isArray(value) || value.length > RELAY_MAX_PATCH_OPERATIONS) throw new RelayFrameValidationError("expected an array within bounds", path);
  value.forEach((operation, index) => validatePatchOperation(operation, `${path}[${index}]`));
}
function validateFrame(value: unknown): asserts value is RelayFrame {
  validateEnvelope(value);
  if (!isJsonValue(value)) throw new RelayFrameValidationError("contains a non-JSON value", "frame");
  const frame = value as Record<string, unknown>;
  switch (frame.type) {
    case "relay_sync":
      requireSequence(frame.headSeq, "frame.headSeq"); requireSequence(frame.commitSeq, "frame.commitSeq");
      if (frame.seq !== frame.headSeq) throw new RelayFrameValidationError("sync seq must equal headSeq", "frame.seq");
      if (frame.commitSeq > frame.headSeq) throw new RelayFrameValidationError("commitSeq cannot exceed headSeq", "frame.commitSeq");
      if (typeof frame.requiresStateRefresh !== "boolean") throw new RelayFrameValidationError("expected a boolean", "frame.requiresStateRefresh");
      if (frame.active !== null) validateCheckpoint(frame.active, "frame.active"); return;
    case "event":
      if (!isRecord(frame.event) || !isJsonValue(frame.event)) throw new RelayFrameValidationError("event must be a JSON object", "frame.event"); return;
    case "message_begin":
      requireString(frame.messageId, "frame.messageId", RELAY_MAX_MESSAGE_ID_LENGTH); requireSequence(frame.revision, "frame.revision"); validateAssistantMessage(frame.message, "frame.message"); return;
    case "message_patch":
      requireString(frame.messageId, "frame.messageId", RELAY_MAX_MESSAGE_ID_LENGTH); requireSequence(frame.baseRevision, "frame.baseRevision"); requireSequence(frame.revision, "frame.revision");
      if (frame.revision <= frame.baseRevision) throw new RelayFrameValidationError("revision must be greater than baseRevision", "frame.revision");
      validateMessagePatchOperations(frame.operations, "frame.operations"); return;
    case "message_commit":
      requireString(frame.messageId, "frame.messageId", RELAY_MAX_MESSAGE_ID_LENGTH); if (frame.authoritative !== true) throw new RelayFrameValidationError("authoritative must be true", "frame.authoritative"); validateAssistantMessage(frame.message, "frame.message"); return;
    case "session_closed":
      if (frame.reason !== "destroyed" && frame.reason !== "identity_changed" && frame.reason !== "startup_failed") throw new RelayFrameValidationError("unknown close reason", "frame.reason"); return;
    default: throw new RelayFrameValidationError("unknown frame type", "frame.type");
  }
}
export function parseRelayFrame(value: unknown): RelayFrame { validateFrame(value); return value; }
export const validateRelayFrame = parseRelayFrame;
export function isRelayFrame(value: unknown): value is RelayFrame { try { parseRelayFrame(value); return true; } catch { return false; } }
export function safeParseRelayFrame(value: unknown): { ok: true; frame: RelayFrame } | { ok: false; error: RelayFrameValidationError } {
  try { return { ok: true, frame: parseRelayFrame(value) }; } catch (error) { return { ok: false, error: error instanceof RelayFrameValidationError ? error : new RelayFrameValidationError(error instanceof Error ? error.message : "invalid frame") }; }
}
export function relayEnvelopeIdentity(value: Pick<RelayEnvelope, "sessionId" | "epoch" | "seq">): string { return `${value.sessionId}:${value.epoch}:${value.seq}`; }
export function sameRelayEnvelope(left: Pick<RelayEnvelope, "sessionId" | "epoch" | "seq"> | null | undefined, right: Pick<RelayEnvelope, "sessionId" | "epoch" | "seq"> | null | undefined): boolean {
  return left?.sessionId === right?.sessionId && left?.epoch === right?.epoch && left?.seq === right?.seq;
}
export function sameRelayEpoch(left: Pick<RelayEnvelope, "sessionId" | "epoch"> | null | undefined, right: Pick<RelayEnvelope, "sessionId" | "epoch"> | null | undefined): boolean {
  return left?.sessionId === right?.sessionId && left?.epoch === right?.epoch;
}

export const envelopeIdentity = relayEnvelopeIdentity;
export const sameEnvelope = sameRelayEnvelope;
export const isSameRelayEnvelope = sameRelayEnvelope;
