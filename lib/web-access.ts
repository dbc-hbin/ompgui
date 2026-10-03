import { watchFile, unwatchFile } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { onRelayDeviceRevoked, relayRegistryPath } from "./relay/registry";
import { getWebDeviceId, OMPGUI_DEVICE_COOKIE, OMPGUI_WEB_ACCESS_HEADER, readWebCookie } from "./web-auth";

/** Neither a proxy's loopback socket nor a client-supplied identity is local. */
export function isDirectLocalRequest(request: IncomingMessage): boolean {
  const peer = request.socket.remoteAddress;
  if (peer !== "127.0.0.1" && peer !== "::1" && peer !== "::ffff:127.0.0.1") return false;
  const host = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::([1-9][0-9]{0,4}))?$/.exec(request.headers.host ?? "");
  if (!host || (host[1] !== undefined && Number(host[1]) > 65535)) return false;
  return !Object.keys(request.headers).some((header) =>
    header === "forwarded" || header === "via" || header === "x-real-ip" ||
    header.startsWith("x-forwarded") || header.startsWith("tailscale-") ||
    header.startsWith("x-tailscale-") || header.startsWith("funnel-") || header.startsWith("x-funnel-"),
  );
}

/** Return false after handling a denial, before Next can read workspace data. */
export function authorizeWebRequest(request: IncomingMessage, response: ServerResponse): boolean {
  delete request.headers[OMPGUI_WEB_ACCESS_HEADER];
  if (isDirectLocalRequest(request)) {
    request.headers[OMPGUI_WEB_ACCESS_HEADER] = `local.${process.env.__OMPGUI_WEB_ACCESS_NONCE}`;
    return true;
  }
  let pathname: string;
  try {
    pathname = new URL(request.url ?? "/", "http://ompgui.invalid").pathname;
  } catch {
    response.writeHead(400).end();
    return false;
  }
  const read = request.method === "GET" || request.method === "HEAD";
  if ((read && (pathname === "/login" || pathname === "/favicon.ico" || pathname === "/relay" ||
    pathname.startsWith("/_next/static/"))) || (request.method === "POST" && pathname === "/api/web-auth/pair")) return true;

  const cookie = readWebCookie(request.headers.cookie, OMPGUI_DEVICE_COOKIE);
  const deviceId = getWebDeviceId(cookie);
  if (!deviceId) {
    response.setHeader("Cache-Control", "no-store");
    if (read && !pathname.startsWith("/api/") && !pathname.startsWith("/_next/")) {
      response.writeHead(307, { Location: "/login" }).end();
    } else {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Registered device required", code: "device_required" }));
    }
    return false;
  }
  request.headers[OMPGUI_WEB_ACCESS_HEADER] = `device.${process.env.__OMPGUI_WEB_ACCESS_NONCE}`;

  // Recheck at every output boundary, including responses created before a revoke.
  // The file watcher closes idle SSE even when another process edits the registry.
  const path = relayRegistryPath();
  const close = () => { response.destroy(); };
  const authorized = () => {
    if (!response.destroyed && getWebDeviceId(cookie) === deviceId) return true;
    close();
    return false;
  };
  const changed = () => { authorized(); };
  const unsubscribe = onRelayDeviceRevoked(deviceId, close);
  watchFile(path, { persistent: false, interval: 1_000 }, changed);
  const cleanup = () => {
    unsubscribe();
    unwatchFile(path, changed);
    response.off("close", cleanup);
    response.off("finish", cleanup);
  };
  response.once("close", cleanup);
  response.once("finish", cleanup);
  const writeHead = response.writeHead;
  const write = response.write;
  const end = response.end;
  const flushHeaders = response.flushHeaders;
  response.writeHead = function (this: ServerResponse, ...args: Parameters<ServerResponse["writeHead"]>) {
    return authorized() ? writeHead.apply(this, args) : this;
  } as ServerResponse["writeHead"];
  response.write = function (this: ServerResponse, ...args: Parameters<ServerResponse["write"]>) {
    return authorized() && write.apply(this, args);
  } as ServerResponse["write"];
  response.end = function (this: ServerResponse, ...args: Parameters<ServerResponse["end"]>) {
    return authorized() ? end.apply(this, args) : this;
  } as ServerResponse["end"];
  response.flushHeaders = function () {
    if (authorized()) flushHeaders.call(this);
  };
  // Register listeners first, then recheck: revocation cannot slip between them.
  return authorized();
}
