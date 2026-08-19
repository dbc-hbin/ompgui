import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-utils";
import { discoverAgents, updateAgent, deleteAgent, type AgentDefinition } from "@/lib/omp/agents-service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ name: string }> };
function statusFor(error: unknown, fallback = 400) {
  const m = String(error).toLowerCase();
  if (m.includes("not found")) return 404;
  if (m.includes("access denied") || m.includes("disallowed")) return 403;
  if (m.includes("bundled") || m.includes("extension")) return 400;
  if (m.includes("already exists") || m.includes("exists")) return 409;
  return fallback;
}

export async function GET(req: Request, { params }: Ctx) {
  try {
    const { name } = await params; const q = new URL(req.url).searchParams;
    const result = await discoverAgents(q.get("cwd") ?? undefined);
    const agent = result.agents.find((a: AgentDefinition) => a.name === name && (!q.get("scope") || a.source === q.get("scope")));
    if (!agent) return apiErrorResponse("Agent not found", 404);
    return NextResponse.json({ success: true, agent });
  } catch (error) { return apiErrorResponse(error, statusFor(error, 404)); }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { name } = await params; const body = await req.json();
    if (!body || (body.scope !== "user" && body.scope !== "project")) return apiErrorResponse("Invalid agent input", 400);
    const filePath = await updateAgent({ ...body, name });
    const agent = (await discoverAgents(body.cwd)).agents.find((a: AgentDefinition) => a.filePath === filePath);
    return NextResponse.json({ success: true, agent });
  } catch (error) { return apiErrorResponse(error, statusFor(error)); }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { name } = await params; const q = new URL(req.url).searchParams;
    const scopeParam = q.get("scope");
    const scope = scopeParam === "user" || scopeParam === "project" ? scopeParam : undefined;
    if (!scope) return apiErrorResponse("Scope must be 'user' or 'project'", 400);
    await deleteAgent({ name, scope, cwd: q.get("cwd") ?? undefined });
    return NextResponse.json({ success: true });
  } catch (error) { return apiErrorResponse(error, statusFor(error, 404)); }
}
