import { readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, resolveSpawnCwdResult, startRpcSession } from "@/lib/rpc-manager";
import { createSseMessageUpdateCoalescer } from "@/lib/sse-message-update-coalescer";

export const dynamic = "force-dynamic";

// GET /api/agent/[id]/events - SSE stream of agent events
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Fast path: already-running session. Otherwise only resolve the session file
  // here (cheap, and a miss must still answer 404); the omp spawn itself happens
  // inside the stream so it cannot race the client's connect timeout.
  const existing = getRpcSession(id);
  const alive = existing?.isAlive() ? existing : undefined;
  let filePath = "";
  if (!alive) {
    const resolved = await resolveSessionPath(id);
    if (!resolved) {
      return new Response("Session not found", { status: 404 });
    }
    filePath = resolved;
  }

  const url = new URL(req.url);
  const compact = url.searchParams.get("wire") === "compact-v1";
  const commitRaw = url.searchParams.get("commit");
  const lastCommitSeq = commitRaw === null || commitRaw.trim() === "" ? undefined : Number(commitRaw);
  const encoder = new TextEncoder();

  if (compact) {
    // Compact-v1 uses the Web stream's byte-aware queue. Unlike the legacy path,
    // it subscribes to the wrapper publisher only after cold startup resolves;
    // the publisher has already tracked every raw event and therefore emits a
    // current relay_sync checkpoint before any subsequent frame.
    let streamCleanup: (() => void) | null = null;
    const MAX_COMPACT_QUEUE_BYTES = 8 * 1024 * 1024;
    const stream = new ReadableStream({
      start(controller) {
        let closed = false;
        let unsubscribe: (() => void) | null = null;
        let unsubscribeDestroy: (() => void) | null = null;
        let heartbeat: ReturnType<typeof setInterval> | null = null;

        const cleanupStream = () => {
          if (closed) return;
          closed = true;
          if (heartbeat) clearInterval(heartbeat);
          heartbeat = null;
          unsubscribe?.();
          unsubscribe = null;
          unsubscribeDestroy?.();
          unsubscribeDestroy = null;
          req.signal?.removeEventListener("abort", onAbort);
          try {
            controller.close();
          } catch {
            // The stream may already have been cancelled by the client.
          }
        };
        streamCleanup = cleanupStream;

        const send = (frame: unknown): boolean => {
          if (closed) return false;

          let encoded: Uint8Array;
          try {
            encoded = encoder.encode(`data: ${JSON.stringify(frame)}\n\n`);
          } catch {
            cleanupStream();
            return false;
          }
          const desiredSize = controller.desiredSize;
          if (desiredSize === null) {
            cleanupStream();
            return false;
          }
          if (desiredSize <= 0) {
            // Relative patches cannot be discarded. Closing gives reconnect a
            // fresh checkpoint instead of silently applying a broken stream.
            cleanupStream();
            return false;
          }
          try {
            controller.enqueue(encoded);
          } catch {
            cleanupStream();
            return false;
          }
          if (typeof frame === "object" && frame !== null && (frame as { type?: unknown }).type === "session_closed") {
            cleanupStream();
          }
          return true;
        };

        const onAbort = () => cleanupStream();
        req.signal?.addEventListener("abort", onAbort);
        if (req.signal?.aborted) {
          cleanupStream();
          return;
        }

        heartbeat = setInterval(() => {
          if (closed) return;
          const desiredSize = controller.desiredSize;
          if (desiredSize === null || desiredSize <= 0) {
            cleanupStream();
            return;
          }
          try {
            controller.enqueue(encoder.encode(":\n\n"));
          } catch {
            cleanupStream();
          }
        }, 30_000);
        heartbeat.unref?.();

        void (async () => {
          let session = alive;
          if (!session) {
            try {
              const header = readSessionHeader(filePath);
              const { cwd } = resolveSpawnCwdResult(header?.cwd);
              ({ session } = await startRpcSession(id, filePath, cwd, undefined, false, header?.cwd));
            } catch {
              // Startup failures have no publisher epoch to resume. Closing
              // the SSE is safer than sending a legacy raw notice on compact.
              cleanupStream();
              return;
            }
          }
          if (closed) return;
          const publisher = session.getRelayPublisher();
          if (publisher.isClosed) {
            cleanupStream();
            return;
          }
          unsubscribe = publisher.subscribe(send, { lastCommitSeq });
          if (closed) {
            unsubscribe();
            unsubscribe = null;
            return;
          }
          unsubscribeDestroy = session.onDestroy(() => cleanupStream());
        })();
      },
      cancel() {
        streamCleanup?.();
      },
    }, {
      highWaterMark: MAX_COMPACT_QUEUE_BYTES,
      size: (chunk: Uint8Array) => chunk.byteLength,
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // Hoisted so the stream's cancel() (half-open disconnects that never fire
  // the abort signal) can release the heartbeat and the RpcProcess listener.
  let streamCleanup: (() => void) | null = null;
  let streamPull: (() => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      let unsubscribeDestroy: (() => void) | null = null;
      let cleanup: (() => void) | null = null;

      const emit = (data: unknown): boolean => {
        if (closed) return false;
        try {
          // Coalescing keeps this serialization/encoding path off the hot
          // update burst until the trailing window actually flushes.
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          return true;
        } catch {
          cleanup?.();
          if (!cleanup) closed = true;
          return false;
        }
      };

      const coalescer = createSseMessageUpdateCoalescer({
        emit,
        isBackpressured: () => {
          const desiredSize = controller.desiredSize;
          return desiredSize === null || desiredSize <= 0;
        },
      });
      streamPull = () => {
        if (!closed) coalescer.pull();
      };

      // Heartbeat every 30s to prevent server/proxy timeout (Next.js default ~120-150s).
      // Do not force a pending update through a stalled queue: pull() respects
      // the one-slot backpressure policy, and comments are skipped until the
      // consumer has room again.
      const heartbeat = setInterval(() => {
        if (closed) return;
        coalescer.pull();
        const desiredSize = controller.desiredSize;
        if (closed || desiredSize === null || desiredSize <= 0) return;
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          cleanup?.();
        }
      }, 30_000);

      const onAbort = () => cleanup?.();
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        coalescer.reset();
        req.signal?.removeEventListener("abort", onAbort);
        unsubscribe?.();
        unsubscribeDestroy?.();
        try {
          controller.close();
        } catch {
          // controller already closed
        }
      };
      streamCleanup = cleanup;

      // Detect client disconnect via abort signal
      req.signal?.addEventListener("abort", onAbort);
      if (req.signal?.aborted) {
        cleanup?.();
        return;
      }

      // Announce the stream before starting omp: a cold spawn takes seconds
      // (extensions, LSP) and the client gives up waiting for `connected` long
      // before that. Commands sent right after this frame still block on the
      // same startRpcSession lock, so nothing runs against a missing process.
      const encode = (data: unknown) => {
        if (!closed) coalescer.push(data);
      };
      encode({ type: "connected", sessionId: id });

      void (async () => {
        let session = alive;
        if (!session) {
          try {
            const header = readSessionHeader(filePath);
            const { cwd } = resolveSpawnCwdResult(header?.cwd);
            ({ session } = await startRpcSession(id, filePath, cwd, undefined, false, header?.cwd));
          } catch (error) {
            encode({ type: "notice", level: "error", message: `Failed to start agent: ${error}` });
            cleanup?.();
            return;
          }
        }
        if (closed) return;
        unsubscribe = session.onEvent((event) => encode(event));
        unsubscribeDestroy = session.onDestroy(() => {
          // An OPEN EventSource must not remain bound to a disposed wrapper:
          // the next prompt may create a replacement wrapper, and reusing this
          // stale stream would lose every event from it. Tell the client to
          // retire the source without auto-reconnecting an intentionally idle
          // session, then close after the queued notice drains.
          encode({ type: "session_closed", sessionId: id });
          cleanup?.();
        });
      })();
    },
    pull() {
      streamPull?.();
    },
    cancel() {
      streamCleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
