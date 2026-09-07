import { NextResponse, type NextRequest } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { daemonCommand } from "@/lib/daemon";
import { isApiRequestOriginAllowed } from "@/lib/request-security";
import { isValidWebSession, isWebPasswordEnabled, OMPGUI_SESSION_COOKIE, OMP_WEB_SESSION_COOKIE } from "@/lib/web-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorize(request: NextRequest) {
  if (!isApiRequestOriginAllowed(request)) return NextResponse.json({ error: "Cross-origin API requests are not allowed" }, { status: 403 });
  if (isWebPasswordEnabled() && !isValidWebSession(request.cookies.get(OMPGUI_SESSION_COOKIE)?.value ?? request.cookies.get(OMP_WEB_SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: "Password required", code: "password_required" }, { status: 401 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await daemonCommand("status"), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Service status unavailable" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await parseJsonWithinLimit<unknown>(request, 1024);
  } catch (error) {
    return NextResponse.json({ error: "Invalid service request" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }
  if (typeof body !== "object" || body === null || !("action" in body) || Object.keys(body).some((key) => key !== "action") ||
    (body.action !== "install" && body.action !== "uninstall" && body.action !== "enable" && body.action !== "disable" && body.action !== "start" && body.action !== "stop" && body.action !== "restart")) {
    return NextResponse.json({ error: "Unknown service action" }, { status: 400 });
  }
  try {
    const result = await daemonCommand(body.action);
    return NextResponse.json(result, { status: !result.supported ? 501 : result.error ? 409 : result.accepted ? 202 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Service action failed" }, { status: 503 });
  }
}
