import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-utils";
import { unpackBundledAgents } from "@/lib/omp/agents-service";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body || (body.scope !== "user" && body.scope !== "project")) return apiErrorResponse("Invalid scope", 400);
    const { targetDir, count } = await unpackBundledAgents(body);
    return NextResponse.json({ success: true, count, targetDir });
  } catch (error) { return apiErrorResponse(error, 400); }
}
