import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-utils";
import { discoverAgents, createAgent, type AgentDefinition } from "@/lib/omp/agents-service";

export const dynamic = "force-dynamic";

function statusFor(error: unknown) {
  const message = String(error).toLowerCase();
  if (message.includes("access denied") || message.includes("disallowed")) return 403;
  if (message.includes("already exists") || message.includes("exists")) return 409;
  return 400;
}

export async function GET(req: Request) {
  try {
    const cwd = new URL(req.url).searchParams.get("cwd") ?? undefined;
    return NextResponse.json({ success: true, ...(await discoverAgents(cwd)) });
  } catch (error) { return apiErrorResponse(error, statusFor(error)); }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body || (body.scope !== "user" && body.scope !== "project") || typeof body.name !== "string" ||
      typeof body.description !== "string" || typeof body.systemPrompt !== "string") {
      return apiErrorResponse("Invalid agent input", 400);
    }
    const filePath = await createAgent(body);
    const found = (await discoverAgents(body.cwd)).agents.find((a: AgentDefinition) => a.filePath === filePath);
    return NextResponse.json({ success: true, agent: found });
  } catch (error) { return apiErrorResponse(error, statusFor(error)); }
}
