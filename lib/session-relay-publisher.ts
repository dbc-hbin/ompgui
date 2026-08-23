import { deepEqualJson, diffAssistantMessage } from "./assistant-message-patch";
import {
  isRelayAssistantMessage,
  type JsonObject,
  type RelayActiveCheckpoint,
  type RelayAssistantMessage,
  type RelayEventFrame,
  type RelayFrame,
  type MessageBeginFrame,
  type MessageCommitFrame,
  type MessagePatchFrame,
  type RelaySyncFrame,
  type SessionClosedReason,
  RELAY_WIRE_VERSION,
} from "./relay-wire";

/** Raw event shape emitted by the RPC process. */
export interface RelaySourceEvent {
  type: string;
  [key: string]: unknown;
}

export type SessionRelaySubscriber = (frame: RelayFrame) => void;

export interface SessionRelayPublisherOptions {
  /** Replace the timer in deterministic tests. */
  schedule?: (callback: () => void, delayMs: number) => unknown;
  /** Pair with `schedule` when it returns a cancellable handle. */
  cancelSchedule?: (handle: unknown) => void;
  /** Called whenever compact subscribers attach or detach. */
  onSubscriberCountChange?: (count: number) => void;
}

export interface RelaySubscribeOptions {
  /** Last commit sequence observed by the reconnecting client. */
  lastCommitSeq?: number;
}

interface ActiveState {
  messageId: string;
  revision: number;
  /** The last raw assistant snapshot represented by `revision`. */
  message: RelayAssistantMessage;
}

interface PendingState {
  messageId: string;
  message: RelayAssistantMessage;
}

declare global {
  // Keep the epoch counter on globalThis so Next hot reloads and duplicate
  // module instances cannot reuse an epoch while an old stream is alive.
  var __ompRelayEpoch: number | undefined;
}

function nextRelayEpoch(): number {
  const previous = globalThis.__ompRelayEpoch ?? 0;
  if (!Number.isSafeInteger(previous) || previous >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Compact relay epoch exhausted");
  }
  const next = previous + 1;
  globalThis.__ompRelayEpoch = next;
  return next;
}

function clone<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== "object") return value;
  const objectValue = value as object;
  const prior = seen.get(objectValue);
  if (prior !== undefined) return prior as T;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    seen.set(objectValue, out);
    for (const entry of value) out.push(clone(entry, seen));
    return out as T;
  }
  const out: Record<string, unknown> = {};
  seen.set(objectValue, out);
  for (const key of Object.keys(value as object)) {
    out[key] = clone((value as Record<string, unknown>)[key], seen);
  }
  return out as T;
}

function sourceRecord(value: unknown): value is RelaySourceEvent {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && typeof (value as { type?: unknown }).type === "string";
}

function assistantMessage(value: unknown): RelayAssistantMessage | null {
  // OMP's in-process message can carry symbol-keyed streaming state and
  // explicit `undefined` optionals. The browser's historical JSON transport
  // drops both, so validate the exact JSON-visible form rather than rejecting
  // an otherwise valid assistant message before compact projection.
  try {
    const jsonVisible = JSON.parse(JSON.stringify(value)) as unknown;
    return isRelayAssistantMessage(jsonVisible) ? jsonVisible : null;
  } catch {
    return null;
  }
}

function sourceMessage(event: RelaySourceEvent): RelayAssistantMessage | null {
  return assistantMessage(event.message);
}

function candidateMessageId(event: RelaySourceEvent, message: RelayAssistantMessage | null): string | undefined {
  const candidates: unknown[] = [
    event.messageId,
    event.assistantMessageId,
    event.id,
    message && (message as JsonObject).messageId,
    message && (message as JsonObject).id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return undefined;
}

/**
 * Publishes compact-v1 frames for one live AgentSessionWrapper.
 *
 * The publisher is intentionally independent of SSE. It owns the one ordered
 * stream for a wrapper, while each HTTP subscriber only supplies a sink. This
 * means reconnects receive a fresh checkpoint instead of requiring a replay
 * ring, and all subscribers observe the same envelope sequence.
 */
export class SessionRelayPublisher {
  private readonly options: SessionRelayPublisherOptions;
  private readonly schedule: (callback: () => void, delayMs: number) => unknown;
  private readonly cancelSchedule: (handle: unknown) => void;
  private subscribers = new Map<number, SessionRelaySubscriber>();
  private nextSubscriberId = 1;
  private pendingTimer: unknown = null;
  private pending: PendingState | null = null;
  private active: ActiveState | null = null;
  private lastCommit: { messageId: string; message: RelayAssistantMessage } | null = null;
  private messageCounter = 0;
  private closed = false;
  private _sessionId: string;
  private _epoch: number;
  private _headSeq = 0;
  private _commitSeq = 0;

  constructor(sessionId = "session", options: SessionRelayPublisherOptions = {}) {
    this.options = options;
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelSchedule = options.cancelSchedule ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this._sessionId = sessionId || "session";
    this._epoch = nextRelayEpoch();
  }

  get sessionId(): string { return this._sessionId; }
  get epoch(): number { return this._epoch; }
  get seq(): number { return this._headSeq; }
  get headSeq(): number { return this._headSeq; }
  get commitSeq(): number { return this._commitSeq; }
  get subscriberCount(): number { return this.subscribers.size; }
  get isClosed(): boolean { return this.closed; }

  hasSubscribers(): boolean { return this.subscribers.size > 0; }
  hasCompactSubscribers(): boolean { return this.hasSubscribers(); }
  getSubscriberCount(): number { return this.subscriberCount; }
  getSubscriberIds(): Set<number> { return new Set(this.subscribers.keys()); }

  /** Current active raw checkpoint, cloned so consumers cannot mutate state. */
  getActiveCheckpoint(): RelayActiveCheckpoint | null {
    if (!this.active) return null;
    return {
      messageId: this.active.messageId,
      revision: this.active.revision,
      message: clone(this.active.message),
    };
  }

  get activeCheckpoint(): RelayActiveCheckpoint | null { return this.getActiveCheckpoint(); }

  /**
   * Build the reconnect checkpoint without consuming a sequence number. Its
   * seq is the current head so subsequent frames continue at head + 1.
   */
  createSyncFrame(lastCommitSeq?: number): RelaySyncFrame {
    const requiresStateRefresh = lastCommitSeq !== undefined && lastCommitSeq !== this._commitSeq;
    return {
      wire: RELAY_WIRE_VERSION,
      sessionId: this._sessionId,
      epoch: this._epoch,
      seq: this._headSeq,
      type: "relay_sync",
      headSeq: this._headSeq,
      commitSeq: this._commitSeq,
      requiresStateRefresh,
      active: this.getActiveCheckpoint(),
    };
  }

  getSyncFrame(lastCommitSeq?: number): RelaySyncFrame { return this.createSyncFrame(lastCommitSeq); }
  sync(lastCommitSeq?: number): RelaySyncFrame { return this.createSyncFrame(lastCommitSeq); }

  /**
   * Attach one compact subscriber. A sync checkpoint is delivered immediately
   * and is always the first frame seen by that subscriber.
   */
  subscribe(subscriber: SessionRelaySubscriber, options?: RelaySubscribeOptions | number): () => void {
    if (this.closed) return () => {};
    const lastCommitSeq = typeof options === "number" ? options : options?.lastCommitSeq;
    const subscriberId = this.nextSubscriberId++;
    this.subscribers.set(subscriberId, subscriber);
    this.options.onSubscriberCountChange?.(this.subscribers.size);
    try {
      subscriber(this.createSyncFrame(lastCommitSeq));
    } catch {
      this.subscribers.delete(subscriberId);
      this.options.onSubscriberCountChange?.(this.subscribers.size);
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.subscribers.delete(subscriberId)) this.options.onSubscriberCountChange?.(this.subscribers.size);
    };
  }

  onFrame(subscriber: SessionRelaySubscriber, options?: RelaySubscribeOptions | number): () => void {
    return this.subscribe(subscriber, options);
  }
  addSubscriber(subscriber: SessionRelaySubscriber, options?: RelaySubscribeOptions | number): () => void {
    return this.subscribe(subscriber, options);
  }

  /** Publish one raw OMP event into the ordered compact stream. */
  publish(event: unknown): void {
    if (this.closed || !sourceRecord(event)) return;
    switch (event.type) {
      case "message_start":
        this.publishMessageStart(event);
        return;
      case "message_update":
        this.publishMessageUpdate(event);
        return;
      case "message_end":
        this.publishMessageEnd(event);
        return;
      default:
        // Control events must never overtake a relative message patch.
        this.flushPending();
        this.emitEvent(event);
    }
  }

  publishEvent(event: unknown): void { this.publish(event); }
  handleEvent(event: unknown): void { this.publish(event); }

  /** Flush the one trailing cumulative update immediately. */
  flushPending(): boolean {
    this.cancelPendingTimer();
    const pending = this.pending;
    this.pending = null;
    if (!pending) return false;

    const active = this.active;
    if (!active || active.messageId !== pending.messageId) {
      // A lifecycle/control transition should normally have flushed before
      // changing active. Do not manufacture a patch against another message.
      return false;
    }
    const operations = diffAssistantMessage(active.message, pending.message);
    if (operations.length === 0) {
      active.message = clone(pending.message);
      return false;
    }
    const baseRevision = active.revision;
    const revision = baseRevision + 1;
    const frame: MessagePatchFrame = {
      wire: RELAY_WIRE_VERSION,
      sessionId: this._sessionId,
      epoch: this._epoch,
      seq: this.nextSeq(),
      type: "message_patch",
      messageId: active.messageId,
      baseRevision,
      revision,
      operations: clone(operations),
    };
    // Advance state before fan-out so a re-entrant subscriber cannot observe a
    // stale checkpoint or publish against the old revision.
    active.revision = revision;
    active.message = clone(pending.message);
    this.fanOut(frame);
    return true;
  }

  /** Close this epoch and notify all subscribers exactly once. */
  close(reason: SessionClosedReason = "destroyed"): void {
    if (this.closed) return;
    // Relative patches are never latest-wins-dropped by lifecycle teardown.
    this.flushPending();
    this.closed = true;
    const frame = this.makeEnvelope("session_closed", { reason }) as unknown as RelayFrame;
    this.fanOut(frame, true);
    this.pending = null;
    this.active = null;
    this.subscribers.clear();
    this.options.onSubscriberCountChange?.(0);
  }

  destroy(reason: SessionClosedReason = "destroyed"): void { this.close(reason); }

  /** Rotate to a fresh epoch in-place, closing old subscribers first. */
  rotate(sessionId = this._sessionId, reason: SessionClosedReason = "identity_changed"): void {
    this.close(reason);
    this._sessionId = sessionId || "session";
    this._epoch = nextRelayEpoch();
    this._headSeq = 0;
    this._commitSeq = 0;
    this.pending = null;
    this.active = null;
    this.lastCommit = null;
    this.closed = false;
    this.messageCounter = 0;
  }

  setSessionId(sessionId: string, reason: SessionClosedReason = "identity_changed"): void {
    const next = sessionId || "session";
    if (next === this._sessionId) return;
    // A placeholder can be filled before the first frame without emitting a
    // close frame for a session that never existed.
    if (this._headSeq === 0 && !this.active && !this.pending && this.subscribers.size === 0) {
      this._sessionId = next;
      return;
    }
    this.rotate(next, reason);
  }

  /** True when the publisher has not observed any frame for this epoch yet. */
  get hasPublishedFrames(): boolean { return this._headSeq > 0; }

  private publishMessageStart(event: RelaySourceEvent): void {
    const message = sourceMessage(event);
    if (!message) {
      this.flushPending();
      this.emitEvent(event);
      return;
    }
    this.flushPending();
    const messageId = candidateMessageId(event, message) ?? this.mintMessageId();
    const frame: MessageBeginFrame = {
      wire: RELAY_WIRE_VERSION,
      sessionId: this._sessionId,
      epoch: this._epoch,
      seq: this.nextSeq(),
      type: "message_begin",
      messageId,
      revision: 0,
      message: clone(message),
    };
    this.active = { messageId, revision: 0, message: clone(message) };
    this.pending = null;
    this.fanOut(frame);
  }

  private publishMessageUpdate(event: RelaySourceEvent): void {
    const message = sourceMessage(event);
    if (!message) {
      this.flushPending();
      this.emitEvent(event);
      return;
    }
    const incomingId = candidateMessageId(event, message);
    let active = this.active;
    if (!active || (incomingId !== undefined && incomingId !== active.messageId)) {
      this.flushPending();
      const messageId = incomingId ?? this.mintMessageId();
      const frame: MessageBeginFrame = {
        wire: RELAY_WIRE_VERSION,
        sessionId: this._sessionId,
        epoch: this._epoch,
        seq: this.nextSeq(),
        type: "message_begin",
        messageId,
        revision: 0,
        message: clone(message),
      };
      active = { messageId, revision: 0, message: clone(message) };
      this.active = active;
      this.fanOut(frame);
    }
    const messageId = active.messageId;
    this.pending = { messageId, message: clone(message) };
    this.schedulePendingFlush();
  }

  private publishMessageEnd(event: RelaySourceEvent): void {
    const message = sourceMessage(event);
    if (!message) {
      this.flushPending();
      this.emitEvent(event);
      return;
    }
    const incomingId = candidateMessageId(event, message);
    if (!this.active && this.lastCommit
      && (incomingId === undefined || incomingId === this.lastCommit.messageId)
      && deepEqualJson(this.lastCommit.message, message)) {
      return;
    }
    let active = this.active;
    if (!active || (incomingId !== undefined && incomingId !== active.messageId)) {
      this.flushPending();
      const messageId = incomingId ?? this.mintMessageId();
      const begin: MessageBeginFrame = {
        wire: RELAY_WIRE_VERSION,
        sessionId: this._sessionId,
        epoch: this._epoch,
        seq: this.nextSeq(),
        type: "message_begin",
        messageId,
        revision: 0,
        message: clone(message),
      };
      active = { messageId, revision: 0, message: clone(message) };
      this.active = active;
      this.fanOut(begin);
    } else {
      // message_end is authoritative and supersedes every pending cumulative
      // snapshot; a stale trailing timer must not emit after the commit.
      this.cancelPendingTimer();
      this.pending = null;
    }
    const commit: MessageCommitFrame = {
      wire: RELAY_WIRE_VERSION,
      sessionId: this._sessionId,
      epoch: this._epoch,
      seq: this.nextSeq(),
      type: "message_commit",
      messageId: active.messageId,
      authoritative: true,
      message: clone(message),
    };
    this._commitSeq = commit.seq;
    this.lastCommit = { messageId: active.messageId, message: clone(message) };
    this.active = null;
    this.fanOut(commit);
  }

  private emitEvent(event: RelaySourceEvent): void {
    const frame: RelayEventFrame = {
      wire: RELAY_WIRE_VERSION,
      sessionId: this._sessionId,
      epoch: this._epoch,
      seq: this.nextSeq(),
      type: "event",
      event: clone(event) as JsonObject,
    };
    this.fanOut(frame);
  }

  private schedulePendingFlush(): void {
    if (this.pendingTimer !== null) return;
    const timer = this.schedule(() => {
      this.pendingTimer = null;
      this.flushPending();
    }, 33);
    this.pendingTimer = timer;
    if (timer && typeof timer === "object" && "unref" in timer && typeof (timer as { unref?: unknown }).unref === "function") {
      (timer as { unref(): void }).unref();
    }
  }

  private cancelPendingTimer(): void {
    if (this.pendingTimer === null) return;
    this.cancelSchedule(this.pendingTimer);
    this.pendingTimer = null;
  }

  private mintMessageId(): string {
    this.messageCounter += 1;
    return `${this._sessionId}:assistant:${this._epoch}:${this.messageCounter}`;
  }

  private nextSeq(): number {
    if (this._headSeq >= Number.MAX_SAFE_INTEGER) throw new Error("Compact relay sequence exhausted");
    this._headSeq += 1;
    return this._headSeq;
  }

  private makeEnvelope<T extends string>(type: T, fields: Record<string, unknown>): Record<string, unknown> {
    return {
      wire: RELAY_WIRE_VERSION,
      sessionId: this._sessionId,
      epoch: this._epoch,
      seq: this.nextSeq(),
      type,
      ...fields,
    };
  }

  private fanOut(frame: RelayFrame, allowClosed = false): void {
    if (this.closed && !allowClosed) return;
    for (const subscriber of this.subscribers.values()) {
      try {
        subscriber(frame);
      } catch {
        // An overflowing/disconnected SSE sink must not starve other compact
        // subscribers. The route removes its own subscription on overflow.
      }
    }
  }
}

export const RelayPublisher = SessionRelayPublisher;
export const createSessionRelayPublisher = (sessionId?: string, options?: SessionRelayPublisherOptions) =>
  new SessionRelayPublisher(sessionId, options);