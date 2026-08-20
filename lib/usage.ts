import {
  parseOmpJsonStdout,
  resolveOmpBin,
  runOmpCli,
} from "./omp/omp-cli";
import type {
  UsageLimit,
  UsageResponse,
} from "./api-types";

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

  const reports = Array.isArray(parsed.reports) ? parsed.reports : [];
  const accountsWithoutUsage = Array.isArray(parsed.accountsWithoutUsage)
    ? parsed.accountsWithoutUsage
    : [];
  const disabledCredentials = Array.isArray(parsed.disabledCredentials)
    ? parsed.disabledCredentials
    : [];
  const capacity =
    parsed.capacity && typeof parsed.capacity === "object" ? parsed.capacity : {};
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
