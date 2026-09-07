import { NextResponse, type NextRequest } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { verifyModelConnectivity } from "@/lib/omp/model-connectivity";
import { ModelVerificationError } from "@/lib/omp/model-verification";
import { isApiRequestOriginAllowed } from "@/lib/request-security";
import { isValidWebSession, isWebPasswordEnabled, OMPGUI_SESSION_COOKIE, OMP_WEB_SESSION_COOKIE } from "@/lib/web-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isApiRequestOriginAllowed(request)) {
    return NextResponse.json({ ok: false, error: "Cross-origin API requests are not allowed" }, { status: 403 });
  }
  const session = request.cookies.get(OMPGUI_SESSION_COOKIE)?.value ?? request.cookies.get(OMP_WEB_SESSION_COOKIE)?.value;
  if (isWebPasswordEnabled() && !isValidWebSession(session)) {
    return NextResponse.json({ ok: false, error: "Password required", code: "password_required" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await parseJsonWithinLimit<unknown>(request, 512 * 1024);
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Invalid connectivity request" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }
  if (typeof body !== "object" || body === null || !("confirm" in body) || body.confirm !== true) {
    return NextResponse.json({ ok: false, code: "connectivity_confirmation_required", error: "Explicit confirmation is required for a live connectivity check" }, { status: 400 });
  }
  try {
    const result = await verifyModelConnectivity(body, {
      signal: request.signal,
      assertActive: () => {
        if (isWebPasswordEnabled() && !isValidWebSession(session)) {
          throw new ModelVerificationError("connectivity_cancelled", "Connectivity request authorization expired");
        }
      },
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ModelVerificationError) {
      const status = error.code === "connectivity_timeout" ? 504
        : error.code === "connectivity_failed" ? 502
        : error.code === "connectivity_cancelled" ? 409 : 400;
      return NextResponse.json({
        ok: false,
        code: error.code,
        error: error.code === "models_config_invalid" ? "Invalid models configuration" : error.message,
        ...(error.latencyMs === undefined ? {} : { latencyMs: error.latencyMs }),
      }, { status });
    }
    return NextResponse.json({ ok: false, code: "connectivity_failed", error: "Model connectivity check failed" }, { status: 500 });
  }
}
