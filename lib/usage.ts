import {
  parseOmpJsonStdout,
  resolveOmpBin,
  runOmpCli,
} from "./omp/omp-cli";
import type {
  ProviderWindowStat,
  UsageLimit,
  UsageReport,
  UsageResponse,
  UsageWindow,
} from "./api-types";

export type CanonicalUsageWindowId = "5h" | "7d" | "monthly" | string;

const FIVE_H_MS = 5 * 60 * 60 * 1000;
const SEVEN_D_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_D_MS = 30 * 24 * 60 * 60 * 1000;
const TWENTY_FOUR_H_MS = 24 * 60 * 60 * 1000;
const WINDOW_ALIAS_LABELS = new Set(["daily", "30d", "24h"]);

/**
 * Map provider window ids/durations onto the chips the usage UI already
 * groups: daily/24h → 5h, 30d → monthly. Unknown ids stay untouched so
 * limits are not dropped the way upstream treated them as noLimits.
 */
export function canonicalizeUsageWindowId(
  windowId?: string,
  durationMs?: number,
): string | undefined {
  const trimmed = typeof windowId === "string" ? windowId.trim() : "";
  if (
    trimmed === "5h" ||
    trimmed === "7d" ||
    trimmed === "monthly" ||
    trimmed === "30d" ||
    trimmed === "daily"
  ) {
    if (trimmed === "30d") return "monthly";
    if (trimmed === "daily") return "5h";
    return trimmed;
  }
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    return undefined;
  }
  if (Math.abs(durationMs - FIVE_H_MS) <= 60_000) return "5h";
  if (Math.abs(durationMs - SEVEN_D_MS) <= 60_000) return "7d";
  if (Math.abs(durationMs - THIRTY_D_MS) <= 60 * 60 * 1000) return "monthly";
  if (Math.abs(durationMs - TWENTY_FOUR_H_MS) <= 60_000) return "5h";
  return undefined;
}

function isDailyWindowSource(windowId?: string, durationMs?: number): boolean {
  const trimmed = typeof windowId === "string" ? windowId.trim() : "";
  if (trimmed === "daily") return true;
  if (
    trimmed === "5h" ||
    trimmed === "7d" ||
    trimmed === "monthly" ||
    trimmed === "30d"
  ) {
    return false;
  }
  return (
    typeof durationMs === "number" &&
    Number.isFinite(durationMs) &&
    Math.abs(durationMs - TWENTY_FOUR_H_MS) <= 60_000
  );
}

function rewriteUsageLimit(limit: UsageLimit): UsageLimit {
  const window = limit.window;
  const scope = limit.scope;
  if (!window && !scope?.windowId) return limit;

  const canonical =
    canonicalizeUsageWindowId(scope?.windowId) ??
    canonicalizeUsageWindowId(window?.id) ??
    canonicalizeUsageWindowId(undefined, window?.durationMs);
  if (!canonical) return limit;

  const nextScope = { ...scope };
  if (scope.windowId || window?.id) {
    nextScope.windowId = canonical;
  }

  let nextWindow: UsageWindow | undefined = window;
  if (window) {
    const label = window.label;
    const shouldRelabel =
      label == null ||
      label.trim() === "" ||
      WINDOW_ALIAS_LABELS.has(label) ||
      label === window.id;
    nextWindow = {
      ...window,
      id: canonical,
      ...(shouldRelabel ? { label: canonical } : {}),
    };
  }

  return {
    ...limit,
    scope: nextScope,
    ...(nextWindow ? { window: nextWindow } : {}),
  };
}

function preferCapacityDurationMs(
  canonical: string,
  current?: number,
  incoming?: number,
): number | undefined {
  if (canonical === "5h") {
    if (current !== undefined && Math.abs(current - FIVE_H_MS) <= 60_000) {
      return current;
    }
    if (incoming !== undefined && Math.abs(incoming - FIVE_H_MS) <= 60_000) {
      return incoming;
    }
  }
  return current ?? incoming;
}

function rewriteCapacity(
  capacity: Record<string, ProviderWindowStat[]>,
): Record<string, ProviderWindowStat[]> {
  const rewritten: Record<string, ProviderWindowStat[]> = {};
  for (const [provider, stats] of Object.entries(capacity)) {
    if (!Array.isArray(stats)) {
      rewritten[provider] = stats;
      continue;
    }
    const merged = new Map<string, ProviderWindowStat>();
    const passthrough: ProviderWindowStat[] = [];
    for (const stat of stats) {
      const canonical = canonicalizeUsageWindowId(stat.window, stat.durationMs);
      if (!canonical) {
        passthrough.push(stat);
        continue;
      }
      const durationMs = isDailyWindowSource(stat.window, stat.durationMs)
        ? FIVE_H_MS
        : stat.durationMs;
      const existing = merged.get(canonical);
      if (!existing) {
        merged.set(canonical, {
          ...stat,
          window: canonical,
          ...(durationMs !== undefined ? { durationMs } : {}),
        });
        continue;
      }
      merged.set(canonical, {
        ...existing,
        accounts: existing.accounts + stat.accounts,
        usedAccounts: existing.usedAccounts + stat.usedAccounts,
        remainingAccounts: existing.remainingAccounts + stat.remainingAccounts,
        durationMs: preferCapacityDurationMs(
          canonical,
          existing.durationMs,
          durationMs,
        ),
      });
    }
    rewritten[provider] = [...merged.values(), ...passthrough];
  }
  return rewritten;
}

function rewriteUsageReports(reports: UsageReport[]): UsageReport[] {
  return reports.map((report) => {
    if (!Array.isArray(report.limits)) return report;
    return {
      ...report,
      limits: report.limits.map(rewriteUsageLimit),
    };
  });
}

/**
 * Resolve a limit's used fraction (0..1; >1 means overage) from whichever
 * amount fields the provider populated. Precedence mirrors the usage UIs:
 * explicit fraction > used/limit > percent-unit used > inverted remaining.
 */
export function resolveUsageUsedFraction(limit: UsageLimit): number | undefined {
  const amount = limit.amount;
  if (amount.usedFraction !== undefined) return amount.usedFraction;
  if (amount.used !== undefined && amount.limit !== undefined && amount.limit > 0) {
    return amount.used / amount.limit;
  }
  if (amount.unit === "percent" && amount.used !== undefined) return amount.used / 100;
  if (amount.remainingFraction !== undefined) return Math.max(0, 1 - amount.remainingFraction);
  return undefined;
}

export type UsageFetchResult =
  | { ok: true; payload: UsageResponse }
  | { ok: false; status: 503 | 501 | 502; error: string };

export interface UsageCacheEntry {
  at: number;
  payload: UsageResponse;
}

interface UsageReadFlight {
  generation: number;
  promise: Promise<UsageFetchResult>;
}

export interface UsageCacheState {
  entry?: UsageCacheEntry | null;
  readFlight?: UsageReadFlight | null;
  refreshFlight?: Promise<UsageFetchResult> | null;
  refreshGeneration?: number;
  latestRefresh?: { generation: number; result: UsageFetchResult } | null;
}

interface UsageCacheDependencies {
  fetch: () => Promise<UsageFetchResult>;
  invalidate: () => Promise<unknown>;
  now?: () => number;
  ttlMs: number;
}

export async function fetchCachedUsage(
  state: UsageCacheState,
  isRefresh: boolean,
  dependencies: UsageCacheDependencies,
): Promise<UsageFetchResult> {
  const now = dependencies.now ?? Date.now;

  if (isRefresh) {
    if (state.refreshFlight) return state.refreshFlight;

    const generation = (state.refreshGeneration ?? 0) + 1;
    state.refreshGeneration = generation;
    state.entry = null;
    state.readFlight = null;

    const refreshFlight = (async () => {
      try {
        await dependencies.invalidate();
      } catch {
        // Invalidation is best-effort, but it is always attempted before fetching.
      }
      const result = await dependencies.fetch();
      if (result.ok) state.entry = { at: now(), payload: result.payload };
      state.latestRefresh = { generation, result };
      return result;
    })();
    state.refreshFlight = refreshFlight;

    try {
      return await refreshFlight;
    } finally {
      if (state.refreshFlight === refreshFlight) state.refreshFlight = null;
    }
  }

  if (state.refreshFlight) return state.refreshFlight;
  if (state.entry && now() - state.entry.at < dependencies.ttlMs) {
    return { ok: true, payload: { ...state.entry.payload, cached: true } };
  }

  const generation = state.refreshGeneration ?? 0;
  let readFlight = state.readFlight;
  if (!readFlight) {
    readFlight = { generation, promise: dependencies.fetch() };
    state.readFlight = readFlight;
  }

  try {
    const result = await readFlight.promise;
    const currentGeneration = state.refreshGeneration ?? 0;
    if (readFlight.generation !== currentGeneration) {
      if (state.refreshFlight) return state.refreshFlight;
      const latestRefresh = state.latestRefresh;
      if (latestRefresh?.generation === currentGeneration) return latestRefresh.result;
    }
    if (result.ok) state.entry = { at: now(), payload: result.payload };
    return result;
  } finally {
    if (state.readFlight === readFlight) state.readFlight = null;
  }
}

/**
 * The CLI excludes credentials for providers without usage endpoints before
 * producing this payload, so `no-usage-endpoint` cannot be inferred here.
 */
export function buildEmptyUsageResponse(
  reason?: "no-credentials",
): UsageResponse {
  return {
    generatedAt: Date.now(),
    reports: [],
    accountsWithoutUsage: [],
    disabledCredentials: [],
    capacity: {},
    cached: false,
    ...(reason ? { emptyReason: reason } : {}),
  };
}

export async function fetchUsagePayload(
  opts: {
    executor?: (
      args: string[],
      o: { timeout: number },
    ) => Promise<{ stdout: string; stderr?: string }>;
  } = {},
): Promise<UsageFetchResult> {
  const executor = opts.executor ?? runOmpCli;
  if (!opts.executor && !resolveOmpBin()) {
    return { ok: false, status: 503, error: "omp binary not found" };
  }

  let stdout: string;
  try {
    const result = await executor(["usage", "--json"], { timeout: 30_000 });
    stdout = result.stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    const isUnsupported =
      lower.includes("unknown command") ||
      lower.includes("unknown flag") ||
      lower.includes("unrecognized command") ||
      lower.includes("unrecognized option") ||
      lower.includes("invalid command") ||
      /error:\s*(unknown|unrecognized)\s+(command|option|flag)/i.test(message) ||
      /\bcommand not found\b/i.test(message);

    if (isUnsupported) {
      return {
        ok: false,
        status: 501,
        error: "usage command not supported by installed omp version",
      };
    }
    return {
      ok: false,
      status: 502,
      error: message,
    };
  }

  if (!stdout || !stdout.trim()) {
    return {
      ok: false,
      status: 501,
      error: "usage command not supported by installed omp version",
    };
  }

  const parsed = parseOmpJsonStdout<Omit<UsageResponse, "cached">>(stdout);
  if (!parsed || typeof parsed !== "object") {
    return {
      ok: false,
      status: 501,
      error: "usage command not supported by installed omp version",
    };
  }

  const reports = rewriteUsageReports(
    Array.isArray(parsed.reports) ? parsed.reports : [],
  );
  const accountsWithoutUsage = Array.isArray(parsed.accountsWithoutUsage)
    ? parsed.accountsWithoutUsage
    : [];
  const disabledCredentials = Array.isArray(parsed.disabledCredentials)
    ? parsed.disabledCredentials
    : [];
  const capacity = rewriteCapacity(
    parsed.capacity && typeof parsed.capacity === "object"
      ? parsed.capacity
      : {},
  );
  const generatedAt =
    typeof parsed.generatedAt === "number" ? parsed.generatedAt : Date.now();

  // Providers without usage endpoints are filtered by the CLI, so that
  // condition is unreachable from this payload and must not be derived here.
  const emptyReason =
    parsed.emptyReason === "no-credentials" ||
    (reports.length === 0 &&
      accountsWithoutUsage.length === 0 &&
      disabledCredentials.length === 0)
      ? "no-credentials"
      : undefined;

  const payload: UsageResponse = {
    generatedAt,
    reports,
    accountsWithoutUsage,
    disabledCredentials,
    capacity,
    cached: false,
    ...(emptyReason ? { emptyReason } : {}),
  };

  return { ok: true, payload };
}
