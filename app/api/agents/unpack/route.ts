import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-utils";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { unpackBundledAgents } from "@/lib/omp/agents-service";

export const dynamic = "force-dynamic";
const MAX_AGENT_REQUEST_BYTES = 512 * 1024 * 6 + 64 * 1024;

export async function POST(req: Request) {
  try {
    const body = await parseJsonWithinLimit<Record<string, unknown>>(req, MAX_AGENT_REQUEST_BYTES);
    if (!body || (body.scope !== "user" && body.scope !== "project")) return apiErrorResponse("Invalid scope", 400);
    const { targetDir, count } = await unpackBundledAgents(body as Parameters<typeof unpackBundledAgents>[0]);
    return NextResponse.json({ success: true, count, targetDir });
  } catch (error) { return apiErrorResponse(error, error instanceof RequestBodyTooLargeError ? 413 : 400); }
}
