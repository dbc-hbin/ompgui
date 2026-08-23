/** Context-usage state shared between the RPC mirror (useAgentSession) and
 * the composer ring (ChatInput). */

export interface ContextUsageState {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

/**
 * Merge a freshly polled `get_state` contextUsage into the displayed one.
 *
 * omp resets its cached context breakdown while a turn is in flight: a
 * get_state issued mid-run can report `{ tokens: 0, percent: 0 }` even
 * though the session holds hundreds of thousands of cached tokens, which
 * collapsed the composer ring to "0%" mid-run. A zero-token snapshot while
 * the previous state already carried tokens is degenerate (compaction keeps
 * a non-zero summary, so tokens legitimately never drop straight to 0) and
 * is discarded; every other snapshot wins. A null snapshot means "no live
 * state" (dead/idle wrapper) and clears, letting the message-derived
 * fallback take over instead of the ring freezing on a stale value.
 */
/**
 * A token count slightly above the window is plausible right before the
 * provider trims the prompt; counts many times the window are data bugs
 * (omp has been observed reporting 35.7M tokens against a 128k window from
 * a stale cached breakdown — an uncapped 27843% that the UI clamped to a
 * permanently full ring).
 */
const OVERAGE_TOLERANCE = 1.1;

export function mergeContextUsage(
  prev: ContextUsageState | null,
  next: ContextUsageState | null,
): ContextUsageState | null {
  if (!next) return null;
  const tokensZero = next.tokens === 0 || next.tokens === null;
  const prevHasTokens = (prev?.tokens ?? 0) > 0;
  if (tokensZero && prevHasTokens) return prev;
  if (next.tokens != null && next.contextWindow > 0 && next.tokens > next.contextWindow * OVERAGE_TOLERANCE) {
    return prev;
  }
  const tokens = next.tokens ?? prev?.tokens ?? null;
  const percent =
    next.percent ??
    (next.contextWindow > 0 && tokens != null ? (tokens / next.contextWindow) * 100 : prev?.percent ?? null);
  return { percent, contextWindow: next.contextWindow, tokens };
}

export interface MessageUsageLike {
  role: string;
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | null;
}

/**
 * Message-derived fallback used when no live RPC state exists (idle/dead
 * wrapper). Walks backward for the last assistant message whose request
 * usage is plausible (≤ contextWindow × tolerance): orchestrated sessions
 * can end on synthetic/compacted entries whose usage carries cumulative
 * session totals (observed: 35.7M tokens) that must never drive the ring.
 * Returns null when nothing plausible exists — hiding the ring beats lying.
 */
export function deriveContextUsage(
  messages: MessageUsageLike[],
  contextWindow: number,
): ContextUsageState | null {
  if (!contextWindow || !(contextWindow > 0)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant" || !msg.usage) continue;
    const u = msg.usage;
    const tokens = (u.input ?? 0) + (u.output ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
    if (tokens <= 0) continue;
    if (tokens > contextWindow * OVERAGE_TOLERANCE) continue;
    return { tokens, contextWindow, percent: (tokens / contextWindow) * 100 };
  }
  return null;
}

/** Clamp into the 0–100 ring range, tolerating NaN from malformed frames. */
export function clampContextPercent(percent: number | null | undefined): number {
  if (percent == null || Number.isNaN(percent)) return 0;
  return Math.min(100, Math.max(0, percent));
}

/**
 * Ring label: one decimal below 10% so small real usage (a 1M-context model
 * sits at 0–5% for most of a session) stays legible instead of rounding to
 * 0%, whole percentages above that.
 */
export function formatRingPercent(clampedPercent: number): string {
  if (clampedPercent > 0 && clampedPercent < 10) {
    const v = Math.round(clampedPercent * 10) / 10;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}%`;
  }
  return `${Math.round(clampedPercent)}%`;
}
