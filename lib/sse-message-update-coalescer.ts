// Server-side coalescing of `message_update` SSE events.
//
// omp emits the full accumulated message for every update. Keeping only the
// latest update for a short trailing window avoids serializing and enqueueing
// token-sized frames that the consumer cannot observe individually.
//
// Ordering contract:
// - A non-update event flushes a pending update synchronously before it is
//   emitted.
// - `message_end` is authoritative and therefore drops any pending update.
// - A pending update is held as one replaceable slot while the stream is under
//   backpressure. `pull` flushes it as soon as the consumer has room.

export const SSE_MESSAGE_UPDATE_WINDOW_MS = 33;

/** Schedules a callback and returns a function that cancels that callback. */
export type SseFlushScheduler = (flush: () => void, delayMs: number) => () => void;

export interface SseMessageUpdateCoalescer {
  /** Queue an event, coalescing only `message_update` events. */
  push(event: unknown): void;
  /** Flush a pending update when ReadableStream.pull reports consumer recovery. */
  pull(): boolean;
  /** Drop the pending update and cancel its timer. */
  reset(): void;
}

interface SseMessageUpdateCoalescerOptions {
  /** Emits one event, including serialization/enqueueing, and reports success. */
  emit: (event: unknown) => boolean;
  /** True while the stream must not enqueue another replaceable update. */
  isBackpressured: () => boolean;
  schedule?: SseFlushScheduler;
  windowMs?: number;
}

function defaultScheduler(flush: () => void, delayMs: number): () => void {
  const timer = setTimeout(flush, delayMs);
  return () => clearTimeout(timer);
}

function eventType(event: unknown): unknown {
  if (event === null || typeof event !== "object" || !("type" in event)) return undefined;
  return event.type;
}

export function createSseMessageUpdateCoalescer({
  emit,
  isBackpressured,
  schedule = defaultScheduler,
  windowMs = SSE_MESSAGE_UPDATE_WINDOW_MS,
}: SseMessageUpdateCoalescerOptions): SseMessageUpdateCoalescer {
  let pendingUpdate: unknown | null = null;
  let cancelScheduled: (() => void) | null = null;

  const cancel = () => {
    cancelScheduled?.();
    cancelScheduled = null;
  };

  // `force` is used for controls: ordering takes precedence over the stream's
  // replaceable-update backpressure slot. Timer/pull flushes respect pressure.
  const flushPending = (force: boolean): boolean => {
    if (pendingUpdate === null) return true;
    if (!force && isBackpressured()) return false;
    const event = pendingUpdate;
    pendingUpdate = null;
    return emit(event);
  };

  const flushScheduled = () => {
    cancelScheduled = null;
    flushPending(false);
  };

  const schedulePending = () => {
    if (!cancelScheduled) cancelScheduled = schedule(flushScheduled, windowMs);
  };

  return {
    push(event) {
      const type = eventType(event);
      if (type === "message_update") {
        // The full accumulated message makes latest-wins safe. Do not inspect,
        // stringify, or encode the update until the scheduled flush.
        pendingUpdate = event;
        schedulePending();
        return;
      }

      if (type === "message_end") {
        // The terminal event carries the authoritative complete message.
        pendingUpdate = null;
        cancel();
        emit(event);
        return;
      }

      cancel();
      if (!flushPending(true)) return;
      emit(event);
    },

    pull() {
      if (pendingUpdate === null || isBackpressured()) return false;
      cancel();
      return flushPending(false);
    },

    reset() {
      pendingUpdate = null;
      cancel();
    },
  };
}
