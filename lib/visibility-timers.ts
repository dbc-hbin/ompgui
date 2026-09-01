export const EVENT_STREAM_RECONNECT_BASE_MS = 1_000;
export const EVENT_STREAM_RECONNECT_MAX_MS = 30_000;

export type VisibilityHost = {
  hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
};

export type IntervalTimers = {
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
};

export type DelayTimers = {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  now?: () => number;
};

/** Exponential reconnect delay: 1s, 2s, 4s, … capped. Attempt 0 is the first retry. */
export function nextEventStreamReconnectDelayMs(
  attempt: number,
  baseMs = EVENT_STREAM_RECONNECT_BASE_MS,
  maxMs = EVENT_STREAM_RECONNECT_MAX_MS,
): number {
  const n = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return Math.min(maxMs, baseMs * (2 ** n));
}

export function isDocumentHidden(
  doc: { hidden?: boolean } | null | undefined = typeof document === "undefined" ? undefined : document,
): boolean {
  return doc?.hidden === true;
}

function defaultVisibilityHost(): VisibilityHost | null {
  return typeof document === "undefined" ? null : document;
}

/**
 * Run `tick` on an interval only while the document is visible. Hidden
 * documents clear the timer so a background tab produces no recurring work.
 */
export function createVisibilityPausedInterval(
  tick: () => void,
  intervalMs: number,
  host: VisibilityHost | null = defaultVisibilityHost(),
  timers: IntervalTimers = globalThis,
): () => void {
  let id: ReturnType<typeof setInterval> | null = null;

  const start = () => {
    if (id !== null || host?.hidden === true) return;
    id = timers.setInterval(tick, intervalMs);
  };

  const stop = () => {
    if (id === null) return;
    timers.clearInterval(id);
    id = null;
  };

  const onVisibility = () => {
    if (host?.hidden === true) stop();
    else start();
  };

  host?.addEventListener("visibilitychange", onVisibility);
  start();
  return () => {
    stop();
    host?.removeEventListener("visibilitychange", onVisibility);
  };
}

/** Wait `ms` of visible time. Hidden periods do not consume the delay. */
export function delayWhileDocumentVisible(
  ms: number,
  host: VisibilityHost | null = defaultVisibilityHost(),
  timers: DelayTimers = globalThis,
  signal?: AbortSignal | null,
): Promise<void> {
  return new Promise((resolve) => {
    let remaining = Math.max(0, ms);
    const now = () => (timers.now ? timers.now() : Date.now());
    let last = now();
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeout !== null) timers.clearTimeout(timeout);
      timeout = null;
      host?.removeEventListener("visibilitychange", onVisibility);
      signal?.removeEventListener("abort", onAbort);
    };

    const finish = () => {
      cleanup();
      resolve();
    };

    const onAbort = () => {
      finish();
    };

    const arm = () => {
      if (host?.hidden === true) return;
      last = now();
      timeout = timers.setTimeout(finish, remaining);
    };

    const onVisibility = () => {
      if (host?.hidden === true) {
        if (timeout !== null) {
          remaining = Math.max(0, remaining - (now() - last));
          timers.clearTimeout(timeout);
          timeout = null;
        }
        return;
      }
      arm();
    };

    if (signal?.aborted) {
      resolve();
      return;
    }
    signal?.addEventListener("abort", onAbort);
    host?.addEventListener("visibilitychange", onVisibility);
    if (host?.hidden === true) return;
    arm();
  });
}
