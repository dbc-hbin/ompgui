import type { MessagePatchOperation, RelayAssistantMessage, RelayMessageBlock } from "./relay-wire";

export type AssistantMessageSnapshot = RelayAssistantMessage;
export class AssistantMessagePatchError extends TypeError { constructor(message: string) { super(message); this.name = "AssistantMessagePatchError"; } }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function message(value: unknown): value is RelayAssistantMessage { return record(value) && value.role === "assistant" && Array.isArray(value.content) && value.content.every((block) => record(block) && typeof block.type === "string"); }
function block(value: unknown): value is RelayMessageBlock { return record(value) && typeof value.type === "string"; }
function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function deepEqualJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true; if (typeof a !== typeof b || a === null || b === null) return false; if (typeof a !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqualJson(v, b[i]));
  if (!record(a) || !record(b)) return false; const ak = Object.keys(a); const bk = Object.keys(b); return ak.length === bk.length && ak.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqualJson(a[k], b[k]));
}
function clone<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== "object") return value; const prior = seen.get(value as object); if (prior !== undefined) return prior as T;
  if (Array.isArray(value)) { const out: unknown[] = []; seen.set(value, out); for (const entry of value) out.push(clone(entry, seen)); return out as T; }
  const out: Record<string, unknown> = {}; seen.set(value as object, out); for (const key of Object.keys(value as object)) out[key] = clone((value as Record<string, unknown>)[key], seen); return out as T;
}
function omit(value: Record<string, unknown>, key: string): Record<string, unknown> { const out: Record<string, unknown> = {}; for (const k of Object.keys(value)) if (k !== key) out[k] = value[k]; return out; }
function ancillaryEqual(a: Record<string, unknown>, b: Record<string, unknown>, payload: string): boolean { return deepEqualJson(omit(a, payload), omit(b, payload)); }
function appendText(a: Record<string, unknown>, b: Record<string, unknown>, index: number): MessagePatchOperation | undefined {
  if (a.type !== "text" || b.type !== "text" || typeof a.text !== "string" || typeof b.text !== "string" || !b.text.startsWith(a.text) || b.text.length <= a.text.length || !ancillaryEqual(a, b, "text")) return undefined;
  return { op: "append_text", index, text: b.text.slice(a.text.length) };
}
function appendThinking(a: Record<string, unknown>, b: Record<string, unknown>, index: number): MessagePatchOperation | undefined {
  if (a.type !== "thinking" || b.type !== "thinking" || typeof a.thinking !== "string" || typeof b.thinking !== "string" || !b.thinking.startsWith(a.thinking) || b.thinking.length <= a.thinking.length || !ancillaryEqual(a, b, "thinking")) return undefined;
  return { op: "append_thinking", index, thinking: b.thinking.slice(a.thinking.length) };
}
function replacement(next: unknown): MessagePatchOperation[] { return [{ op: "replace_message", message: clone(next) as RelayAssistantMessage }]; }
function size(value: unknown): number { try { const json = JSON.stringify(value); return json === undefined ? Infinity : json.length; } catch { return Infinity; } }
export function diffAssistantMessage(previous: unknown, next: unknown): MessagePatchOperation[] {
  if (!message(previous) || !message(next)) return replacement(next); if (deepEqualJson(previous, next)) return [];
  if (!deepEqualJson(omit(previous, "content"), omit(next, "content"))) return replacement(next);
  const out: MessagePatchOperation[] = []; const before = previous.content; const after = next.content; const common = Math.min(before.length, after.length);
  for (let index = 0; index < common; index += 1) { const a = before[index]; const b = after[index]; if (deepEqualJson(a, b)) continue; const text = appendText(a, b, index); if (text) { out.push(text); continue; } const thinking = appendThinking(a, b, index); if (thinking) { out.push(thinking); continue; } out.push({ op: "set_block", index, block: clone(b) }); }
  for (let index = common; index < after.length; index += 1) out.push({ op: "set_block", index, block: clone(after[index]) });
  if (after.length < before.length) out.push({ op: "truncate_content", length: after.length });
  const replace = replacement(next); return size(out) >= size(replace) ? replace : out;
}
function assertOp(value: unknown, index: number): asserts value is MessagePatchOperation {
  if (!record(value) || typeof value.op !== "string") throw new AssistantMessagePatchError(`operation ${index} malformed`);
  switch (value.op) {
    case "append_text": if (!nonNegativeSafeInteger(value.index) || typeof value.text !== "string") throw new AssistantMessagePatchError(`operation ${index} malformed`); return;
    case "append_thinking": if (!nonNegativeSafeInteger(value.index) || typeof value.thinking !== "string") throw new AssistantMessagePatchError(`operation ${index} malformed`); return;
    case "set_block": if (!nonNegativeSafeInteger(value.index) || !block(value.block)) throw new AssistantMessagePatchError(`operation ${index} malformed`); return;
    case "truncate_content": if (!nonNegativeSafeInteger(value.length)) throw new AssistantMessagePatchError(`operation ${index} malformed`); return;
    case "replace_message": if (!message(value.message)) throw new AssistantMessagePatchError(`operation ${index} malformed`); return;
    default: throw new AssistantMessagePatchError(`operation ${index} unknown`);
  }
}
function applyOne(target: RelayAssistantMessage, op: MessagePatchOperation, index: number): RelayAssistantMessage {
  switch (op.op) {
    case "append_text": { const current = target.content[op.index]; if (!current || current.type !== "text" || typeof current.text !== "string") throw new AssistantMessagePatchError(`operation ${index} wrong text block`); current.text += op.text; return target; }
    case "append_thinking": { const current = target.content[op.index]; if (!current || current.type !== "thinking" || typeof current.thinking !== "string") throw new AssistantMessagePatchError(`operation ${index} wrong thinking block`); current.thinking += op.thinking; return target; }
    case "set_block": if (op.index > target.content.length) throw new AssistantMessagePatchError(`operation ${index} out of bounds`); target.content[op.index] = clone(op.block); return target;
    case "truncate_content": if (op.length > target.content.length) throw new AssistantMessagePatchError(`operation ${index} out of bounds`); target.content = target.content.slice(0, op.length); return target;
    case "replace_message": return clone(op.message);
  }
}
export function applyAssistantMessagePatch(input: unknown, operations: readonly unknown[]): RelayAssistantMessage {
  if (!message(input)) throw new AssistantMessagePatchError("message is not an assistant snapshot"); if (!Array.isArray(operations)) throw new AssistantMessagePatchError("operations must be an array");
  operations.forEach(assertOp); if (operations.some((op) => (op as MessagePatchOperation).op === "replace_message") && operations.length !== 1) throw new AssistantMessagePatchError("replace_message must be the sole operation");
  let out = clone(input); for (let index = 0; index < operations.length; index += 1) out = applyOne(out, operations[index] as MessagePatchOperation, index); return out;
}
export const diffAssistantMessages = diffAssistantMessage;
export const applyAssistantMessagePatches = applyAssistantMessagePatch;
