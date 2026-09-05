import { Server as HttpServer, type IncomingMessage } from "node:http";
import { Server as HttpsServer } from "node:https";
import type { Duplex } from "node:stream";
import { attachRelayConnection } from "./connection";
import { completeRelayUpgrade, isRelayUpgradePath } from "./websocket";

const MAX_RELAY_CONNECTIONS = 8;
const PING_INTERVAL_MS = 30_000;

declare global {
  var __ompguiRelayGatewayAttached: boolean | undefined;
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
  const ws = completeRelayUpgrade(req, socket, head, {
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
}

function patchServerEmit(ServerCtor: typeof HttpServer | typeof HttpsServer): void {
  const original = ServerCtor.prototype.emit;
  if ((original as { __ompguiRelay?: boolean }).__ompguiRelay) return;

  function emit(this: HttpServer, event: string | symbol, ...args: unknown[]): boolean {
    if (event === "upgrade") {
      const req = args[0] as IncomingMessage;
      if (isRelayUpgradePath(req.url)) {
        handleRelayUpgrade(req, args[1] as Duplex, (args[2] as Buffer) ?? Buffer.alloc(0));
        return true;
      }
    }
    return original.call(this, event, ...args);
  }
  (emit as { __ompguiRelay?: boolean }).__ompguiRelay = true;
  ServerCtor.prototype.emit = emit as typeof original;
}

export function attachRelayGateway(): void {
  if (globalThis.__ompguiRelayGatewayAttached) return;
  globalThis.__ompguiRelayGatewayAttached = true;
  patchServerEmit(HttpServer);
  patchServerEmit(HttpsServer);
}
