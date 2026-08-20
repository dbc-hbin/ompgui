import { NextResponse } from "next/server";
import { runOmpCli } from "@/lib/omp/omp-cli";
import {
  fetchCachedUsage,
  fetchUsagePayload,
  type UsageCacheState,
} from "@/lib/usage";

export const dynamic = "force-dynamic";

const USAGE_CACHE_TTL_MS = 60_000;

declare global {
  var __ompgui_usage_cache: UsageCacheState | undefined;
}

function getUsageGlobalState(): UsageCacheState {
  if (!globalThis.__ompgui_usage_cache) {
    globalThis.__ompgui_usage_cache = {};
  }
  return globalThis.__ompgui_usage_cache;
}

function errorCodeForStatus(status: number): string {
  switch (status) {
    case 503:
      return "omp_not_found";
    case 501:
      return "usage_not_supported";
    case 502:
    default:
      return "usage_fetch_failed";
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const isRefresh = url.searchParams.get("refresh") === "1";
  const state = getUsageGlobalState();

  try {
    const result = await fetchCachedUsage(state, isRefresh, {
      fetch: () => fetchUsagePayload(),
      invalidate: () =>
        runOmpCli(["usage", "invalidate"], { timeout: 15_000 }),
      ttlMs: USAGE_CACHE_TTL_MS,
    });
    if (result.ok) {
      return NextResponse.json(result.payload);
    }
    return NextResponse.json(
      { error: result.error, code: errorCodeForStatus(result.status) },
      { status: result.status },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message, code: "usage_fetch_failed" },
      { status: 502 },
    );
  }
}
