import { randomBytes } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import type { ClientRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Socket } from "node:net";

/** Preserve native endpoint routing before its host is hidden by the loopback gate. */
export function resolveModelProbeEndpoint(baseUrl: string, api: string, modelId: string): URL {
  const endpoint = new URL(baseUrl);
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, "");
  if (api === "anthropic-messages" && endpoint.pathname.endsWith("/v1")) {
    endpoint.pathname = endpoint.pathname.slice(0, -3);
  }
  if (api === "openai-completions" && endpoint.hostname.endsWith(".openai.azure.com")) {
    if (!endpoint.pathname.includes("/deployments/")) {
      endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/deployments/${encodeURIComponent(modelId)}`;
    }
    // Native createRequestSetup defaults to this version. Environment overrides
    // and deployment maps are deliberately unavailable to submitted-only probes.
    endpoint.searchParams.set("api-version", "2024-10-21");
  }
  return endpoint;
}

/** A private, single-dispatch transport for native adapters that retry internally. */
export async function createModelProbeDispatch(
  targetBaseUrl: string,
  options: {
    assertActive?: () => void;
    authorizeDispatch?: () => void;
    signal?: AbortSignal;
    expectedPath?: string;
    upstreamHeaders?: Record<string, string>;
  } = {},
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  let target: URL;
  try {
    target = new URL(targetBaseUrl);
  } catch {
    throw new Error("Invalid model probe endpoint");
  }
  if (
    (target.protocol !== "http:" && target.protocol !== "https:") ||
    target.hash
  ) throw new Error("Unsupported model probe endpoint");
  if (options.signal?.aborted) throw new Error("Model probe cancelled");
  try {
    options.assertActive?.();
  } catch {
    throw new Error("Model probe cancelled");
  }
  const prefix = `/model-probe-${randomBytes(24).toString("hex")}`;
  // URL.pathname invents '/' for a bare origin; only preserve a slash the
  // caller actually supplied, or concatenated adapter paths become '//...'.
  const trailingSlash = targetBaseUrl.split("?", 1)[0].endsWith("/");
  const targetQuery = new URLSearchParams(target.search);
  target.search = "";
  const upstreamBase = target.href.replace(/\/+$/, "");
  const sockets = new Set<Socket>();
  const socketClosures = new Set<Promise<void>>();
  let dispatched = false;
  let closed = false;
  let upstream: ClientRequest | undefined;
  let upstreamClosed: Promise<void> | undefined;
  let closing: Promise<void> | undefined;

  const trackSocket = (socket: Socket) => {
    const closure = Promise.withResolvers<void>();
    sockets.add(socket);
    socketClosures.add(closure.promise);
    socket.once("close", () => {
      sockets.delete(socket);
      socketClosures.delete(closure.promise);
      closure.resolve();
    });
    if (closed) socket.destroy();
  };

  const server = createServer((incoming, outgoing) => {
    const path = incoming.url ?? "";
    const queryStart = path.indexOf("?");
    const pathname = queryStart < 0 ? path : path.slice(0, queryStart);
    const expectedPath = options.expectedPath;
    if (
      dispatched || closed || incoming.method !== "POST" ||
      !(path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`)) ||
      (expectedPath !== undefined && pathname !== `${prefix}/${expectedPath.replace(/^\/+/, "")}`)
    ) {
      outgoing.writeHead(403, { connection: "close" });
      outgoing.end();
      incoming.resume();
      return;
    }

    try {
      const destination = new URL(upstreamBase + path.slice(prefix.length));
      for (const [name, value] of targetQuery) destination.searchParams.set(name, value);
      const headers = { ...incoming.headers };
      for (const [name, value] of Object.entries(options.upstreamHeaders ?? {})) {
        headers[name.toLowerCase()] = value;
      }
      headers.host = destination.host;
      headers.connection = "close";
      if (options.signal?.aborted || closed) throw new Error("Model probe cancelled");
      options.authorizeDispatch?.();
      // No asynchronous gap is permitted between this checkpoint and dispatch.
      options.assertActive?.();
      if (options.signal?.aborted || closed) throw new Error("Model probe cancelled");
      // Discovery or rejected checkpoints must not consume the probe request.
      // Reserve synchronously so concurrent native retries cannot dispatch.
      dispatched = true;
      upstream = (destination.protocol === "https:" ? httpsRequest : httpRequest)(destination, {
        method: incoming.method,
        headers,
        agent: false,
      });
      const completion = Promise.withResolvers<void>();
      upstreamClosed = completion.promise;
      upstream.once("close", () => completion.resolve());
      upstream.on("socket", trackSocket);
      upstream.on("error", () => {
        if (outgoing.headersSent) outgoing.destroy();
        else {
          outgoing.writeHead(502, { connection: "close" });
          outgoing.end();
        }
      });
      upstream.on("response", (response) => {
        response.on("error", () => outgoing.destroy());
        // Native fetch implementations may follow Location outside this gate.
        // Fail closed rather than let a redirect escape the dispatch budget.
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
          outgoing.writeHead(502, { connection: "close" });
          outgoing.end();
          response.destroy();
          return;
        }
        outgoing.writeHead(response.statusCode ?? 502, response.statusMessage, response.rawHeaders);
        response.pipe(outgoing);
        outgoing.once("close", () => response.destroy());
      });
      incoming.on("error", () => upstream?.destroy());
      incoming.once("aborted", () => upstream?.destroy());
      outgoing.once("close", () => upstream?.destroy());
      incoming.pipe(upstream);
    } catch {
      upstream?.destroy();
      outgoing.writeHead(502, { connection: "close" });
      outgoing.end();
      incoming.resume();
    }
  });
  server.on("connection", trackSocket);
  server.on("clientError", (_error, socket) => socket.destroy());

  const close = (): Promise<void> => {
    if (closing) return closing;
    closed = true;
    options.signal?.removeEventListener("abort", onAbort);
    const completion = Promise.withResolvers<void>();
    closing = completion.promise;
    upstream?.destroy();
    for (const socket of sockets) socket.destroy();
    const stopped = Promise.withResolvers<void>();
    server.close(() => stopped.resolve());
    void Promise.all([stopped.promise, upstreamClosed, ...socketClosures]).then(() => completion.resolve());
    return closing;
  };
  const onAbort = () => { void close(); };

  const listening = Promise.withResolvers<void>();
  server.once("error", () => listening.reject(new Error("Model probe transport unavailable")));
  server.listen(0, "127.0.0.1", () => listening.resolve());
  try {
    await listening.promise;
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) throw new Error("Model probe cancelled");
    options.assertActive?.();
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Model probe transport unavailable");
    return {
      baseUrl: `http://127.0.0.1:${address.port}${prefix}${trailingSlash ? "/" : ""}`,
      close,
    };
  } catch {
    await close();
    throw new Error("Model probe transport unavailable");
  }
}
