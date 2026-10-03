import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isApiRequestOriginAllowed } from "@/lib/request-security";
import { authenticateRelayHello } from "@/lib/relay/auth";
import { RELAY_MAX_LABEL_CHARS, RELAY_PROTOCOL_VERSION } from "@/lib/relay/protocol";
import { OMPGUI_DEVICE_COOKIE, OMP_WEB_SESSION_MAX_AGE_SECONDS } from "@/lib/web-auth";

export async function POST(request: Request) {
  if (!isApiRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Cross-origin API requests are not allowed" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await parseJsonWithinLimit<unknown>(request, 8 * 1024);
  } catch (error) {
    return NextResponse.json({ error: "Invalid pairing request", code: "invalid_request" }, {
      status: error instanceof RequestBodyTooLargeError ? 413 : 400,
    });
  }
  if (typeof body !== "object" || body === null ||
    ("secret" in body && (typeof body.secret !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.secret))) ||
    ("deviceId" in body && (typeof body.deviceId !== "string" || !/^d_[A-Za-z0-9_-]{22}$/.test(body.deviceId))) ||
    ("token" in body && (typeof body.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.token))) ||
    ("label" in body && (typeof body.label !== "string" || body.label.length > RELAY_MAX_LABEL_CHARS)) ||
    ("password" in body && typeof body.password !== "string") ||
    Object.keys(body).some((key) => key !== "secret" && key !== "label" && key !== "password" && key !== "deviceId" && key !== "token") ||
    ("secret" in body ? "deviceId" in body || "token" in body : !("deviceId" in body) || !("token" in body))) {
    return NextResponse.json({ error: "Invalid pairing request", code: "invalid_request" }, { status: 400 });
  }
  const password = "password" in body && typeof body.password === "string" ? body.password : "";
  const label = "label" in body && typeof body.label === "string" ? body.label : "Browser";
  const token = "token" in body && typeof body.token === "string" ? body.token : undefined;
  const result = authenticateRelayHello({
    op: "hello", protocol: RELAY_PROTOCOL_VERSION, password, label, token,
    pairingSecret: "secret" in body && typeof body.secret === "string" ? body.secret : undefined,
    deviceId: "deviceId" in body && typeof body.deviceId === "string" ? body.deviceId : undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.message, code: result.code }, { status: result.code === "device_limit" ? 409 : 401 });
  }
  const credential = result.token ?? token;
  if (!credential) throw new Error("Relay authentication returned no device credential");
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set({
    name: OMPGUI_DEVICE_COOKIE,
    value: `${result.deviceId}.${credential}`,
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
    sameSite: "lax",
    maxAge: OMP_WEB_SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
