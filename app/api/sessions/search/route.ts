import { NextResponse } from "next/server";
import { searchSessions, SessionSearchError } from "@/lib/session-search";
import type { SessionSearchArgs } from "@/lib/session-search-types";

export const runtime = "nodejs";

// Cookie authentication and browser-origin checks are applied by proxy.ts,
// identically to the existing read-only session routes.
const HEADERS = { "Cache-Control": "no-store", Vary: "Cookie" };

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    for (const key of params.keys()) {
      if (!["query", "projectRoot", "from", "to", "limit", "cursor"].includes(key) || params.getAll(key).length !== 1) {
        return NextResponse.json({ error: "Unknown or repeated search parameter", code: "invalid_search" }, { status: 400, headers: HEADERS });
      }
    }
    const input: SessionSearchArgs = { query: params.get("query") ?? "" };
    for (const key of ["projectRoot", "from", "to", "cursor"] as const) {
      const value = params.get(key);
      if (value !== null) input[key] = value;
    }
    const limit = params.get("limit");
    if (limit !== null) {
      if (!/^\d{1,2}$/.test(limit)) {
        return NextResponse.json({ error: "limit must be an integer from 1 to 50", code: "invalid_search" }, { status: 400, headers: HEADERS });
      }
      input.limit = Number(limit);
    }
    return NextResponse.json(await searchSessions(input), { headers: HEADERS });
  } catch (error) {
    const status = error instanceof SessionSearchError ? error.status : 500;
    return NextResponse.json({
      error: error instanceof SessionSearchError ? error.message : "Session search failed",
      code: status === 400 ? "invalid_search" : "search_unavailable",
    }, { status, headers: HEADERS });
  }
}
