import { applyAssistantMessagePatch } from "./assistant-message-patch";
import {
  parseRelayFrame,
  type RelayActiveCheckpoint,
  type RelayAssistantMessage,
  type RelayEnvelope,
  type RelayEventFrame,
  type RelayFrame,
  type MessageBeginFrame,
  type MessageCommitFrame,
  type MessagePatchFrame,
  type RelaySyncFrame,
  type SessionClosedFrame,
} from "./relay-wire";

export type RelayClientStatus = "idle" | "synced" | "streaming" | "desynced" | "closed";
export interface RelayStreamState {
  sessionId: string | null;
  epoch: number | null;
  lastSeq: number;
  /** Alias useful to stream consumers. Always mirrors lastSeq. */
  lastAppliedSeq: number;
  headSeq: number;
  commitSeq: number;
  requiresStateRefresh: boolean;
  status: RelayClientStatus;
  active: RelayActiveCheckpoint | null;
  activeMessageId: string | null;
  activeRevision: number | null;
  activeMessage: RelayAssistantMessage | null;
  committedMessageId: string | null;
  committedMessage: RelayAssistantMessage | null;
  closedReason: SessionClosedFrame["reason"] | null;
}

export type RelayDesyncReason =
  | "invalid_frame"
  | "session_mismatch"
  | "epoch_mismatch"
  | "gap"
  | "message_mismatch"
  | "revision_mismatch"
  | "patch_rejected"
  | "closed";

export type RelayClientEffect =
  | { type: "none" }
  | { type: "duplicate"; frame: RelayFrame }
  | { type: "desync"; reason: RelayDesyncReason; expectedSeq?: number; receivedSeq?: number; frame?: RelayFrame }
  | { type: "sync"; frame: RelaySyncFrame; active: RelayActiveCheckpoint | null; requiresStateRefresh: boolean }
  | { type: "event"; frame: RelayEventFrame; event: RelayEventFrame["event"] }
  | { type: "message_begin"; frame: MessageBeginFrame; messageId: string; revision: number; message: RelayAssistantMessage }
  | { type: "message_patch"; frame: MessagePatchFrame; messageId: string; revision: number; message: RelayAssistantMessage }
  | { type: "commit"; frame: MessageCommitFrame; messageId: string; message: RelayAssistantMessage; authoritative: true; recoveredFromDesync: boolean }
  | { type: "session_closed"; frame: SessionClosedFrame; reason: SessionClosedFrame["reason"] };

export interface RelayReducerResult { state: RelayStreamState; effect: RelayClientEffect }

function clone<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== "object") return value;
  const previous = seen.get(value as object); if (previous !== undefined) return previous as T;
  if (Array.isArray(value)) { const out: unknown[] = []; seen.set(value, out); for (const entry of value) out.push(clone(entry, seen)); return out as T; }
  const out: Record<string, unknown> = {}; seen.set(value as object, out); for (const key of Object.keys(value as object)) out[key] = clone((value as Record<string, unknown>)[key], seen); return out as T;
}
function emptyState(sessionId: string | null): RelayStreamState {
  return { sessionId, epoch: null, lastSeq: -1, lastAppliedSeq: -1, headSeq: -1, commitSeq: -1, requiresStateRefresh: false, status: "idle", active: null, activeMessageId: null, activeRevision: null, activeMessage: null, committedMessageId: null, committedMessage: null, closedReason: null };
}
export function createInitialRelayClientState(sessionId: string | null = null): RelayStreamState { return emptyState(sessionId); }
export const createRelayClientState = createInitialRelayClientState;

function withActive(state: RelayStreamState, active: RelayActiveCheckpoint | null): RelayStreamState {
  return { ...state, active: active ? clone(active) : null, activeMessageId: active?.messageId ?? null, activeRevision: active?.revision ?? null, activeMessage: active ? clone(active.message) : null };
}
function advanced(state: RelayStreamState, frame: RelayEnvelope): RelayStreamState {
  return {
    ...state,
    sessionId: state.sessionId ?? frame.sessionId,
    epoch: state.epoch ?? frame.epoch,
    lastSeq: frame.seq,
    lastAppliedSeq: frame.seq,
    headSeq: frame.seq,
  };
}
function desync(state: RelayStreamState, reason: RelayDesyncReason, frame?: RelayFrame, expectedSeq?: number, receivedSeq?: number, consume = false): RelayReducerResult {
  const next = consume && frame ? advanced(state, frame) : { ...state };
  next.status = "desynced"; next.requiresStateRefresh = true;
  return { state: next, effect: { type: "desync", reason, expectedSeq, receivedSeq, frame } };
}
function envelopeFence(state: RelayStreamState, frame: RelayFrame): RelayReducerResult | undefined {
  if (state.sessionId !== null && frame.sessionId !== state.sessionId) return desync(state, "session_mismatch", frame);
  if (state.epoch !== null && frame.epoch < state.epoch) return { state, effect: { type: "duplicate", frame } };
  if (state.epoch !== null && frame.epoch > state.epoch && frame.type !== "relay_sync") return desync(state, "epoch_mismatch", frame);
  if (state.epoch !== null && frame.epoch === state.epoch && frame.seq <= state.lastSeq) return { state, effect: { type: "duplicate", frame } };
  if (
    state.epoch !== null
    && frame.epoch === state.epoch
    && frame.type !== "relay_sync"
    && frame.type !== "message_commit"
    && frame.type !== "session_closed"
    && frame.seq !== state.lastSeq + 1
  ) {
    return desync(state, "gap", frame, state.lastSeq + 1, frame.seq);
  }
  return undefined;
}
function acceptsSync(state: RelayStreamState, frame: RelaySyncFrame): RelayReducerResult {
  if (state.sessionId !== null && state.sessionId !== frame.sessionId) return desync(state, "session_mismatch", frame);
  if (state.status === "closed" && state.epoch === frame.epoch) {
    return desync(state, "closed", frame);
  }
  if (state.epoch !== null && frame.epoch < state.epoch) return { state, effect: { type: "duplicate", frame } };
  if (state.epoch !== null && frame.epoch === state.epoch && frame.seq <= state.lastSeq) return { state, effect: { type: "duplicate", frame } };
  if (
    state.epoch === frame.epoch
    && state.active
    && frame.active
    && state.active.messageId === frame.active.messageId
    && frame.active.revision < state.active.revision
  ) {
    return desync(state, "revision_mismatch", frame);
  }
  const active = frame.active ? clone(frame.active) : null;
  let next: RelayStreamState = { ...emptyState(frame.sessionId), epoch: frame.epoch, lastSeq: frame.seq, lastAppliedSeq: frame.seq, headSeq: frame.headSeq, commitSeq: frame.commitSeq, requiresStateRefresh: frame.requiresStateRefresh, status: frame.requiresStateRefresh ? "desynced" : "synced" };
  next = withActive(next, active);
  return { state: next, effect: { type: "sync", frame, active, requiresStateRefresh: frame.requiresStateRefresh } };
}

/** Purely reduce one validated or raw relay frame into next state plus effect. */
export function reduceRelayFrame(state: RelayStreamState, input: unknown): RelayReducerResult {
  let frame: RelayFrame;
  try { frame = parseRelayFrame(input); } catch { return desync(state, "invalid_frame"); }
  if (frame.type === "relay_sync") return acceptsSync(state, frame);
  const commitAcrossGap = (
    frame.type === "message_commit"
    && state.epoch !== null
    && frame.epoch === state.epoch
    && frame.seq !== state.lastSeq + 1
  );
  const fenced = envelopeFence(state, frame); if (fenced) return fenced;
  if (state.status === "closed") return desync(state, "closed", frame);
  if (state.status === "desynced" && frame.type !== "message_commit" && frame.type !== "session_closed") {
    return desync(state, "gap", frame, state.lastSeq + 1, frame.seq);
  }
  if (state.epoch === null) return desync(state, "epoch_mismatch", frame);
  const next = advanced(state, frame);

  switch (frame.type) {
    case "event":
      next.status = next.active ? "streaming" : "synced";
      return { state: next, effect: { type: "event", frame, event: clone(frame.event) } };
    case "message_begin": {
      const active = { messageId: frame.messageId, revision: frame.revision, message: clone(frame.message) };
      const begun = withActive(next, active); begun.status = "streaming"; begun.requiresStateRefresh = false;
      return { state: begun, effect: { type: "message_begin", frame, messageId: active.messageId, revision: active.revision, message: clone(active.message) } };
    }
    case "message_patch": {
      if (!next.active || frame.messageId !== next.active.messageId) return desync(state, "message_mismatch", frame);
      if (frame.baseRevision !== next.active.revision || frame.revision !== frame.baseRevision + 1) return desync(state, "revision_mismatch", frame);
      let patched: RelayAssistantMessage;
      try { patched = applyAssistantMessagePatch(next.active.message, frame.operations); } catch { return desync(state, "patch_rejected", frame); }
      const active = { messageId: frame.messageId, revision: frame.revision, message: patched };
      const patchedState = withActive(next, active); patchedState.status = "streaming"; patchedState.requiresStateRefresh = false;
      return { state: patchedState, effect: { type: "message_patch", frame, messageId: frame.messageId, revision: frame.revision, message: clone(patched) } };
    }
    case "message_commit": {
      if (state.committedMessageId === frame.messageId && !state.active) {
        return { state: next, effect: { type: "duplicate", frame } };
      }
      if (next.active && frame.messageId !== next.active.messageId) return desync(state, "message_mismatch", frame);
      const committed = clone(frame.message);
      const recoveredFromDesync = state.status === "desynced" || commitAcrossGap;
      const committedState = withActive(next, null); committedState.committedMessageId = frame.messageId; committedState.committedMessage = committed; committedState.commitSeq = frame.seq; committedState.status = recoveredFromDesync ? "desynced" : "synced"; committedState.requiresStateRefresh = recoveredFromDesync;
      return { state: committedState, effect: { type: "commit", frame, messageId: frame.messageId, message: clone(committed), authoritative: true, recoveredFromDesync } };
    }
    case "session_closed":
      next.status = "closed"; next.closedReason = frame.reason; next.active = null; next.activeMessage = null; next.activeMessageId = null; next.activeRevision = null;
      return { state: next, effect: { type: "session_closed", frame, reason: frame.reason } };
  }
}

export function createRelayClientReducer(): (state: RelayStreamState, frame: unknown) => RelayReducerResult {
  return (state, frame) => reduceRelayFrame(state, frame);
}
export const relayClientReducer = reduceRelayFrame;
export const reduceRelayClientState = reduceRelayFrame;
export type RelayClientState = RelayStreamState;
export function reduceRelayFrameFromFrame(frame: unknown, state: RelayStreamState): RelayReducerResult { return reduceRelayFrame(state, frame); }
