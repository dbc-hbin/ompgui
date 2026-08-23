export const EVENT_STREAM_CONNECTING = 0;
export const EVENT_STREAM_OPEN = 1;
export const EVENT_STREAM_CLOSED = 2;

export type EventStreamConnectionStatus = "connected" | "timeout" | "closed";

export type EventStreamConnectionResult<Source> = {
  status: EventStreamConnectionStatus;
  source: Source;
};

export interface EventStreamSource {
  readonly readyState: number;
  close(): void;
}

export interface EventStreamConnectionHandlers {
  onOpen: () => void;
  onError: () => void;
}

export interface EventStreamConnectionManager<Source extends EventStreamSource> {
  /** Return the current session's readiness, sharing any pending attempt. */
  ensure(sessionId: string): Promise<EventStreamConnectionResult<Source>>;
  /** Return the source only when it still belongs to the requested session. */
  currentSource(sessionId: string): Source | null;
  /** Fence callbacks from replaced or invalidated sources. */
  isCurrent(sessionId: string, source: Source): boolean;
  /** Settle readiness when the stream emits its explicit connected frame. */
  markConnected(sessionId: string, source: Source): void;
  /** Invalidate the matching source, settling a pending readiness as closed. */
  invalidate(sessionId?: string, source?: Source): void;
}

export interface CreateEventStreamConnectionManagerOptions<Source extends EventStreamSource> {
  createSource: (sessionId: string, handlers: EventStreamConnectionHandlers) => Source;
  timeoutMs: number;
  /**
   * Resolve readiness from EventSource.onopen (the historical behavior).
   * Compact-v1 callers can disable this and call markConnected after the
   * first validated relay_sync, so an HTTP 200 legacy stream is not treated
   * as a usable compact connection.
   */
  readyOnOpen?: boolean;
  onFatalClose?: (sessionId: string, source: Source) => void;
}

interface ConnectionRecord<Source extends EventStreamSource> {
  sessionId: string;
  source: Source;
  promise: Promise<EventStreamConnectionResult<Source>>;
  resolve: (result: EventStreamConnectionResult<Source>) => void;
  settled: boolean;
  status: EventStreamConnectionStatus | null;
  invalidated: boolean;
  timeout: ReturnType<typeof setTimeout> | null;
}

/**
 * Own one EventSource-like connection at a time.
 *
 * The manager deliberately knows nothing about message payloads. It only owns
 * readiness and source identity so callers can keep their stream-specific
 * event handling while making connect/reconnect behavior deterministic.
 */
export function createEventStreamConnectionManager<Source extends EventStreamSource>({
  createSource,
  timeoutMs,
  readyOnOpen = true,
  onFatalClose,
}: CreateEventStreamConnectionManagerOptions<Source>): EventStreamConnectionManager<Source> {
  let current: ConnectionRecord<Source> | null = null;

  const isCurrentRecord = (record: ConnectionRecord<Source>): boolean => (
    current === record && !record.invalidated
  );

  const scheduleTimeout = (record: ConnectionRecord<Source>): void => {
    if (record.timeout !== null) {
      clearTimeout(record.timeout);
      record.timeout = null;
    }
    record.timeout = setTimeout(() => {
      if (isCurrentRecord(record)) settle(record, "timeout");
    }, timeoutMs);
  };

  const armReadiness = (record: ConnectionRecord<Source>): void => {
    record.promise = new Promise<EventStreamConnectionResult<Source>>((resolve) => {
      record.resolve = resolve;
    });
    record.settled = false;
    record.status = null;
    scheduleTimeout(record);
  };

  const settle = (record: ConnectionRecord<Source>, status: EventStreamConnectionStatus): void => {
    if (record.settled) return;
    record.settled = true;
    record.status = status;
    if (record.timeout !== null) {
      clearTimeout(record.timeout);
      record.timeout = null;
    }
    record.resolve({ status, source: record.source });
  };

  const invalidateRecord = (record: ConnectionRecord<Source>, closeSource: boolean): void => {
    if (record.invalidated) return;
    record.invalidated = true;
    if (current === record) current = null;
    settle(record, "closed");
    if (closeSource && record.source.readyState !== EVENT_STREAM_CLOSED) {
      record.source.close();
    }
  };

  const handleOpen = (record: ConnectionRecord<Source>): void => {
    if (!isCurrentRecord(record)) return;
    if (record.source.readyState === EVENT_STREAM_CLOSED) return;
    if (readyOnOpen) settle(record, "connected");
  };

  const handleError = (record: ConnectionRecord<Source>): void => {
    if (!isCurrentRecord(record)) return;
    if (record.source.readyState === EVENT_STREAM_CLOSED) {
      settle(record, "closed");
      // A CLOSED EventSource will not recover by itself. Remove it before the
      // callback so a new ensure cannot accidentally reuse the fatal source.
      invalidateRecord(record, false);
      onFatalClose?.(record.sessionId, record.source);
      return;
    }
    if (record.source.readyState === EVENT_STREAM_CONNECTING && record.settled) {
      // A source that was OPEN may enter CONNECTING while the browser retries
      // it. Keep that same EventSource, but make callers wait for its next
      // onopen instead of reusing the old resolved readiness promise.
      armReadiness(record);
    }
  };

  const start = (sessionId: string): Promise<EventStreamConnectionResult<Source>> => {
    let record: ConnectionRecord<Source> | null = null;
    let resolve!: (result: EventStreamConnectionResult<Source>) => void;
    const promise = new Promise<EventStreamConnectionResult<Source>>((nextResolve) => {
      resolve = nextResolve;
    });

    const source = createSource(sessionId, {
      onOpen: () => {
        if (record) handleOpen(record);
      },
      onError: () => {
        if (record) handleError(record);
      },
    });
    record = {
      sessionId,
      source,
      promise,
      resolve,
      settled: false,
      status: null,
      invalidated: false,
      timeout: null,
    };
    current = record;
    scheduleTimeout(record);

    // EventSource callbacks are normally asynchronous, but checking the
    // state after creation also handles deterministic fakes and an already
    // open source without relying on a callback race.
    if (source.readyState === EVENT_STREAM_OPEN) {
      if (readyOnOpen) settle(record, "connected");
    } else if (source.readyState === EVENT_STREAM_CLOSED) {
      handleError(record);
    }
    return record.promise;
  };

  return {
    ensure(sessionId) {
      const existing = current;
      if (existing && existing.sessionId === sessionId) {
        if (existing.source.readyState === EVENT_STREAM_OPEN) {
          // A source that reopened after a prior timeout is healthy again even
          // though its original readiness promise has already settled. In
          // frame-gated mode, however, onopen is only transport readiness;
          // callers must wait for markConnected after protocol validation.
          if (readyOnOpen) {
            if (!existing.settled) settle(existing, "connected");
            return Promise.resolve({ status: "connected", source: existing.source });
          }
          if (existing.settled) {
            if (existing.status === "connected") {
              return Promise.resolve({ status: "connected", source: existing.source });
            }
            invalidateRecord(existing, true);
            return start(sessionId);
          }
          return existing.promise;
        }
        if (existing.source.readyState === EVENT_STREAM_CONNECTING) {
          if (existing.settled) armReadiness(existing);
          return existing.promise;
        }
        invalidateRecord(existing, true);
      } else if (existing) {
        invalidateRecord(existing, true);
      }
      return start(sessionId);
    },

    currentSource(sessionId) {
      return current?.sessionId === sessionId && !current.invalidated
        ? current.source
        : null;
    },

    isCurrent(sessionId, source) {
      return current?.sessionId === sessionId
        && current.source === source
        && !current.invalidated;
    },

    markConnected(sessionId, source) {
      const existing = current;
      if (!existing || existing.sessionId !== sessionId || existing.source !== source) return;
      if (existing.source.readyState !== EVENT_STREAM_CLOSED) settle(existing, "connected");
    },

    invalidate(sessionId, source) {
      const existing = current;
      if (!existing) return;
      if (sessionId !== undefined && existing.sessionId !== sessionId) return;
      if (source !== undefined && existing.source !== source) return;
      invalidateRecord(existing, true);
    },
  };
}
