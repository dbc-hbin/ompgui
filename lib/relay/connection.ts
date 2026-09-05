import { createSseMessageUpdateCoalescer } from "../sse-message-update-coalescer";
import { isRecord } from "../type-guards";
import { authenticateRelayHello } from "./auth";
import {
  commandFromRelayCmd,
  encodeRelayFrame,
  isRelayParseError,
  parseClientFrame,
  relayModelsFrame,
  RELAY_HELLO_TIMEOUT_MS,
  RELAY_PROTOCOL_VERSION,
  type RelayClientFrame,
  type RelayHelloFrame,
  type RelayModelOption,
  type RelayServerFrame,
  type RelaySessionListItem,
} from "./protocol";
import { listRelayModels } from "./models";
import { openRelaySession, sendRelayCommand, listRelaySessions } from "./session-runtime";
import { fetchUsagePayload, type UsageFetchResult } from "../usage";
import { invalidateModelsCache } from "../models-cache";
import { disposeUtilityRpc } from "../omp/rpc-utility";
import { mergeNativeSettings, readNativeSettings, writeNativeSettings, type NativeSettings } from "../omp/settings-config";

export interface RelaySocket {
  sendText(text: string): boolean;
  close(code?: number, reason?: string): void;
  get bufferedAmount(): number;
}

export interface RelayConnectionDeps {
  authenticate(hello: RelayHelloFrame, now: number): ReturnType<typeof authenticateRelayHello>;
  listSessions(): Promise<{ sessions: RelaySessionListItem[]; runningIds: string[] }>;
  listModels(): Promise<RelayModelOption[]>;
  fetchUsage(): Promise<UsageFetchResult>;
  openSession: typeof openRelaySession;
  sendCommand: typeof sendRelayCommand;
  now?: () => number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

const defaultDeps: RelayConnectionDeps = {
  authenticate: authenticateRelayHello,
  listSessions: listRelaySessions,
  listModels: listRelayModels,
  fetchUsage: fetchUsagePayload,
  openSession: openRelaySession,
  sendCommand: sendRelayCommand,
};

export function attachRelayConnection(socket: RelaySocket, deps: Partial<RelayConnectionDeps> = {}): {
  onText(raw: string): void;
  onClose(): void;
} {
  const resolved: RelayConnectionDeps = { ...defaultDeps, ...deps };
  const now = resolved.now ?? Date.now;
  const schedule = resolved.setTimeout ?? setTimeout;
  const cancel = resolved.clearTimeout ?? clearTimeout;

  let authed = false;
  let closed = false;
  let openedSessionId: string | null = null;
  let disposeSession: (() => void) | null = null;
  let handling = Promise.resolve();

  const send = (frame: RelayServerFrame): boolean => {
    if (closed) return false;
    return socket.sendText(encodeRelayFrame(frame));
  };

  const failHello = (code: string, message: string) => {
    cancel(helloTimer);
    send({ op: "hello_err", code, message });
    socket.close(1008, message);
  };

  const helloTimer = schedule(() => {
    if (!authed && !closed) failHello("hello_timeout", "hello was not received in time");
  }, RELAY_HELLO_TIMEOUT_MS);

  const coalescer = createSseMessageUpdateCoalescer({
    emit: (event) => {
      if (!openedSessionId || !isRecord(event)) return true;
      return send({ op: "event", id: openedSessionId, payload: event });
    },
    isBackpressured: () => socket.bufferedAmount > 256_000,
  });

  const dispose = () => {
    if (closed) return;
    closed = true;
    cancel(helloTimer);
    coalescer.reset();
    disposeSession?.();
    disposeSession = null;
    openedSessionId = null;
  };

  const handle = async (frame: RelayClientFrame) => {
    if (closed) return;
    if (!authed) {
      if (frame.op !== "hello") {
        failHello("unauthorized", "hello is required");
        return;
      }
      const result = resolved.authenticate(frame, now());
      if (!result.ok) {
        failHello(result.code, result.message);
        return;
      }
      authed = true;
      cancel(helloTimer);
      send({
        op: "hello_ok",
        protocol: RELAY_PROTOCOL_VERSION,
        serverId: result.serverId,
        deviceId: result.deviceId,
        ...(result.token ? { token: result.token } : {}),
      });
      return;
    }

    switch (frame.op) {
      case "hello":
        send({ op: "error", code: "already_authed", message: "Already authenticated" });
        return;
      case "sessions.list": {
        const listed = await resolved.listSessions();
        send({ op: "sessions", sessions: listed.sessions, runningIds: listed.runningIds });
        return;
      }
      case "models.list": {
        const models = await resolved.listModels();
        send(relayModelsFrame(models));
        return;
      }
      case "usage": {
        const result = await resolved.fetchUsage();
        if (result.ok) {
          send({ op: "usage", data: result.payload });
          return;
        }
        send({ op: "usage", data: { error: result.error, status: result.status } });
        return;
      }
      case "session.close":
        disposeSession?.();
        disposeSession = null;
        openedSessionId = null;
        coalescer.reset();
        return;
      case "settings.get": {
        try {
          const data = readNativeSettings();
          send({ op: "settings", settings: data.settings as Record<string, unknown> });
        } catch (error) {
          send({ op: "error", code: "settings_read_failed", message: String(error) });
        }
        return;
      }
      case "settings.update": {
        try {
          const current = readNativeSettings();
          const next = mergeNativeSettings(current.settings, frame.settings as NativeSettings);
          writeNativeSettings(next);
          const patchRecord = frame.settings as Record<string, unknown>;
          const registryInvalidated = patchRecord.enabledModels !== undefined
            || patchRecord.disabledProviders !== undefined
            || patchRecord.modelProviderOrder !== undefined;
          if (registryInvalidated) {
            invalidateModelsCache();
            disposeUtilityRpc();
          }
          const updated = readNativeSettings();
          send({ op: "settings_updated", success: true, settings: updated.settings as Record<string, unknown> });
        } catch (error) {
          send({ op: "settings_updated", success: false, error: String(error) });
        }
        return;
      }
      case "session.open": {
        disposeSession?.();
        disposeSession = null;
        coalescer.reset();
        openedSessionId = frame.id;
        try {
          const opened = await resolved.openSession(frame.id, (event) => coalescer.push(event));
          if (closed || openedSessionId !== frame.id) {
            opened.dispose();
            return;
          }
          disposeSession = opened.dispose;
          const snapshotSent = send({
            op: "session.snapshot",
            id: frame.id,
            ...(opened.snapshot.title ? { title: opened.snapshot.title } : {}),
            ...(opened.snapshot.cwd ? { cwd: opened.snapshot.cwd } : {}),
            leafId: opened.snapshot.leafId,
            messages: opened.snapshot.messages,
            agent: opened.snapshot.agent,
          });
          if (!snapshotSent) {
            send({ op: "session.err", id: frame.id, code: "snapshot_too_large", message: "Session snapshot exceeded maximum frame size" });
          }
        } catch (error) {
          openedSessionId = null;
          const message = error instanceof Error ? error.message : String(error);
          const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
            ? error.code
            : "session_open_failed";
          send({ op: "session.err", id: frame.id, code, message });
        }
        return;
      }
      case "cmd": {
        if (!openedSessionId) {
          send({ op: "cmd_err", req: frame.req, code: "session_not_open", message: "Open a session first" });
          return;
        }
        try {
          const data = await resolved.sendCommand(openedSessionId, commandFromRelayCmd(frame));
          send({ op: "cmd_ok", req: frame.req, data: data ?? null });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
            ? error.code
            : "rpc_command_failed";
          send({ op: "cmd_err", req: frame.req, code, message });
        }
      }
    }
  };

  return {
    onText(raw: string) {
      if (closed) return;
      const parsed = parseClientFrame(raw);
      if (isRelayParseError(parsed)) {
        if (!authed) {
          failHello(parsed.code, parsed.message);
          return;
        }
        send({ op: "error", code: parsed.code, message: parsed.message });
        return;
      }
      handling = handling.then(() => handle(parsed)).catch((error) => {
        send({ op: "error", code: "internal_error", message: error instanceof Error ? error.message : String(error) });
      });
    },
    onClose() {
      dispose();
    },
  };
}
