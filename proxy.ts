import { NextResponse, type NextRequest } from "next/server";
import { isApiRequestOriginAllowed, shouldCheckApiRequestOrigin } from "@/lib/request-security";
import { getWebRequestAccess, isWebRequestAuthorized } from "@/lib/web-auth";

export function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname.startsWith("/api/") &&
    shouldCheckApiRequestOrigin(request) &&
    !isApiRequestOriginAllowed(request)
  ) {
    return NextResponse.json({ error: "Cross-origin API requests are not allowed" }, { status: 403 });
  }
  const { pathname } = request.nextUrl;
  // Keep login renderable for fragment-based enrollment, even without a password.
  if (pathname === "/login" || pathname === "/api/web-auth/pair") return NextResponse.next();
  if (pathname === "/api/web-auth/session" && getWebRequestAccess(request) === "local") return NextResponse.next();
  // Device-token auth happens after the WebSocket upgrade, not via cookie.
  if (pathname === "/relay") return NextResponse.next();
  if (isWebRequestAuthorized(request)) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return getWebRequestAccess(request) === "local"
      ? NextResponse.json({ error: "Password required", code: "password_required" }, { status: 401 })
      : NextResponse.json({ error: "Registered device required", code: "device_required" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

// The sign-in screen still needs its Next.js JavaScript and CSS before a
// session exists; these are public build assets, not workspace data.
export const config = { matcher: "/((?!_next/static/|favicon.ico$).*)" };
