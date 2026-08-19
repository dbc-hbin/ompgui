import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-utils";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { discoverAgents, createAgent, type AgentDefinition } from "@/lib/omp/agents-service";

export const dynamic = "force-dynamic";

const MAX_AGENT_REQUEST_BYTES = 512 * 1024 * 6 + 64 * 1024;

function statusFor(error: unknown) {
  if (error instanceof RequestBodyTooLargeError) return 413;
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
    const body = await parseJsonWithinLimit<Record<string, unknown>>(req, MAX_AGENT_REQUEST_BYTES);
    if (!body || (body.scope !== "user" && body.scope !== "project") || typeof body.name !== "string" ||
      typeof body.description !== "string" || typeof body.systemPrompt !== "string") {
      return apiErrorResponse("Invalid agent input", 400);
    }
    const filePath = await createAgent(body as Parameters<typeof createAgent>[0]);
    const found = (await discoverAgents(typeof body.cwd === "string" ? body.cwd : undefined)).agents.find((a: AgentDefinition) => a.filePath === filePath);
    return NextResponse.json({ success: true, agent: found });
  } catch (error) { return apiErrorResponse(error, statusFor(error)); }
}
