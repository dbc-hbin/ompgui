import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-utils";
import { unpackBundledAgents } from "@/lib/omp/agents-service";
import { discoverAgents } from "@/lib/omp/agents-service";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body || (body.scope !== "user" && body.scope !== "project")) return apiErrorResponse("Invalid scope", 400);
    const targetDir = await unpackBundledAgents(body);
    const discovered = await discoverAgents(body.cwd);
    const count = discovered.agents.filter((agent) => agent.filePath?.startsWith(targetDir + "/") && agent.source === body.scope).length;
    return NextResponse.json({ success: true, count, targetDir });
  } catch (error) { return apiErrorResponse(error, 400); }
}
