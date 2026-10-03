import { Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server as HttpsServer } from "node:https";
import type { Duplex } from "node:stream";
import { randomBytes } from "node:crypto";
import { authorizeWebRequest, isDirectLocalRequest } from "../web-access";
import { getWebDeviceId, OMPGUI_DEVICE_COOKIE, readWebCookie } from "../web-auth";
import { attachRelayConnection } from "./connection";
import { completeRelayUpgrade, isRelayUpgradePath } from "./websocket";

const MAX_RELAY_CONNECTIONS = 8;
const PING_INTERVAL_MS = 30_000;

declare global {
  var __ompguiRelayConnectionCount: number | undefined;
}

function connectionCount(): number {
  return globalThis.__ompguiRelayConnectionCount ?? 0;
}

function setConnectionCount(value: number): void {
  globalThis.__ompguiRelayConnectionCount = value;
}

export function isRelayUpgradeOriginAllowed(req: IncomingMessage): boolean {
  const fetchSite = req.headers["sec-fetch-site"];
  if (fetchSite === "cross-site") return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function handleRelayUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  if (!isRelayUpgradePath(req.url)) {
    socket.destroy();
    return;
  }
  if (!isRelayUpgradeOriginAllowed(req)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  if (connectionCount() >= MAX_RELAY_CONNECTIONS) {
    socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  let counted = false;
  let ping: NodeJS.Timeout | undefined;
  let attached: { onText(text: string): void; onClose(): void } | null = null;
  const ws = completeRelayUpgrade(req, socket, {
    onText: (text) => attached?.onText(text),
    onClose: () => {
      clearInterval(ping);
      ping = undefined;
      if (counted) {
        counted = false;
        setConnectionCount(Math.max(0, connectionCount() - 1));
      }
      attached?.onClose();
    },
  });
  if (!ws) return;

  counted = true;
  setConnectionCount(connectionCount() + 1);
  ping = setInterval(() => ws.ping(), PING_INTERVAL_MS);
  ping.unref?.();
  attached = attachRelayConnection(ws);
  if (head.length > 0) ws.feed(head);
}

function patchServerEmit(ServerCtor: typeof HttpServer | typeof HttpsServer): void {
  const original = ServerCtor.prototype.emit;
  if ("__ompguiWebAccess" in original) return;

  function emit(this: HttpServer, event: string | symbol, ...args: unknown[]): boolean {
    if ((event === "request" || event === "checkContinue" || event === "checkExpectation") &&
      !authorizeWebRequest(args[0] as IncomingMessage, args[1] as ServerResponse)) return true;
    if (event === "upgrade") {
      const req = args[0] as IncomingMessage;
      if (isRelayUpgradePath(req.url)) {
        handleRelayUpgrade(req, args[1] as Duplex, (args[2] as Buffer) ?? Buffer.alloc(0));
        return true;
      }
      if (!isDirectLocalRequest(req) && !getWebDeviceId(readWebCookie(req.headers.cookie, OMPGUI_DEVICE_COOKIE))) {
        const socket = args[1] as Duplex;
        socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        return true;
      }
    }
    return original.call(this, event, ...args);
  }
  Object.defineProperty(emit, "__ompguiWebAccess", { value: true });
  ServerCtor.prototype.emit = emit as typeof original;
  if (ServerCtor.prototype.emit !== emit) throw new Error("Failed to attach HTTP device authorization gate");
}

export function attachRelayGateway(): void {
  // Next listens before instrumentation finishes. Its Node proxy shares this
  // process environment and rejects queued requests without a raw-gate proof.
  if (!("__ompguiWebAccess" in HttpServer.prototype.emit) || !process.env.__OMPGUI_WEB_ACCESS_NONCE) {
    process.env.__OMPGUI_WEB_ACCESS_NONCE = randomBytes(32).toString("base64url");
  }
  patchServerEmit(HttpServer);
  patchServerEmit(HttpsServer);
}
