import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isApiRequestOriginAllowed } from "@/lib/request-security";
import {
  createWebSession,
  getWebRequestAccess,
  isWebRequestAuthorized,
  isValidWebPassword,
  isWebPasswordEnabled,
  OMPGUI_SESSION_COOKIE,
  OMP_WEB_SESSION_MAX_AGE_SECONDS,
} from "@/lib/web-auth";

const MAX_PASSWORD_REQUEST_BYTES = 8 * 1024;

export async function POST(request: Request) {
  if (!isApiRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Cross-origin API requests are not allowed" }, { status: 403 });
  }
  if (getWebRequestAccess(request) !== "local" && !isWebRequestAuthorized(request)) {
    return NextResponse.json({ error: "Registered device required", code: "device_required" }, { status: 401 });
  }
  if (!isWebPasswordEnabled()) {
    return NextResponse.json({ error: "Password protection is disabled" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await parseJsonWithinLimit(request, MAX_PASSWORD_REQUEST_BYTES);
  } catch (error) {
    const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
    return NextResponse.json({ error: "Invalid password request" }, { status });
  }
  if (typeof body !== "object" || body === null || !("password" in body) ||
    typeof body.password !== "string" || Object.keys(body).some((key) => key !== "password")) {
    return NextResponse.json({ error: "Invalid password request" }, { status: 400 });
  }
  if (!isValidWebPassword(body.password)) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  response.cookies.set({
    name: OMPGUI_SESSION_COOKIE,
    value: createWebSession(process.env.OMPGUI_PASSWORD ?? process.env.OMP_WEB_PASSWORD!),
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: OMP_WEB_SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
