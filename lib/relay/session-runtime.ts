import { RpcCommandError } from "../omp/rpc-process";
import { getLeafEntryId, materializeSessionEntries } from "../omp/session-files";
import { projectRemoteReplica } from "../remote-replica";
import {
  getRpcSession,
  getRunningRpcSessionIds,
  resolveSpawnCwdResult,
  startRpcSession,
  WebRpcError,
  type AgentEvent,
} from "../rpc-manager";
import {
  buildSessionContext,
  getSessionDocument,
  listAllSessions,
  readSessionHeader,
  resolveSessionPath,
} from "../session-reader";
import type { RelayAgentState, RelayDisplayMessage, RelaySessionListItem } from "./protocol";

export class RelaySessionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RelaySessionError";
    this.code = code;
  }
}

export function toRelaySessionListItem(session: {
  id: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  parentSessionId?: string;
  projectRoot?: string;
  projectKey?: string;
  worktreeBranch?: string;
}): RelaySessionListItem {
  return {
    id: session.id,
    cwd: session.cwd,
    ...(session.name ? { name: session.name } : {}),
    created: session.created,
    modified: session.modified,
    messageCount: session.messageCount,
    firstMessage: session.firstMessage,
    ...(session.parentSessionId ? { parentSessionId: session.parentSessionId } : {}),
    ...(session.projectRoot ? { projectRoot: session.projectRoot } : {}),
    ...(session.projectKey ? { projectKey: session.projectKey } : {}),
    ...(session.worktreeBranch ? { worktreeBranch: session.worktreeBranch } : {}),
  };
}

export async function listRelaySessions(): Promise<{
  sessions: RelaySessionListItem[];
  runningIds: string[];
}> {
  const sessions = await listAllSessions();
  return {
    sessions: sessions.map(toRelaySessionListItem),
    runningIds: getRunningRpcSessionIds(),
  };
}

export interface RelayOpenResult {
  snapshot: {
    title?: string;
    cwd?: string;
    leafId: string | null;
    messages: RelayDisplayMessage[];
    agent: RelayAgentState;
  };
  dispose: () => void;
}

export async function openRelaySession(
  sessionId: string,
  emit: (event: AgentEvent) => void,
): Promise<RelayOpenResult> {
  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) throw new RelaySessionError("session_not_found", "Session not found");

  const document = getSessionDocument(filePath);
  if (document.error === "too_large") {
    throw new RelaySessionError("session_file_too_large", "Session file is too large to open in ompgui");
  }
  if (!document.header) {
    throw new RelaySessionError("session_file_malformed", "Session file is missing or malformed");
  }

  const entries = materializeSessionEntries(document.entries, { skipToolResultImages: true });
  const leafId = getLeafEntryId(entries);
  const context = buildSessionContext(entries, leafId, { deferThinking: true, deferToolResultImages: true });
  const projected = projectRemoteReplica({
    origin: "https://ompgui.relay",
    session: { id: sessionId, title: document.header.title, cwd: document.header.cwd },
    leafId,
    messages: context.messages,
  });
  const messages = projected?.session.messages ?? [];

  const existing = getRpcSession(sessionId);
  const ready = Boolean(existing?.isAlive());
  let agent: RelayAgentState = { running: Boolean(existing?.isRunning()), ready };
  if (existing?.isAlive()) {
    try {
      agent = { running: existing.isRunning(), ready: true, state: await existing.send({ type: "get_state" }) };
    } catch {
      agent = { running: existing.isRunning(), ready: true };
    }
  }

  let unsubscribe: (() => void) | null = null;
  let unsubscribeDestroy: (() => void) | null = null;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe?.();
    unsubscribeDestroy?.();
  };

  emit({ type: "connected", sessionId });

  void (async () => {
    try {
      let session = existing?.isAlive() ? existing : undefined;
      if (!session) {
        const header = readSessionHeader(filePath);
        const { cwd } = resolveSpawnCwdResult(header?.cwd);
        ({ session } = await startRpcSession(sessionId, filePath, cwd, undefined, false, header?.cwd));
      }
      if (disposed) return;
      unsubscribe = session.onEvent((event) => {
        if (!disposed) emit(event);
      });
      unsubscribeDestroy = session.onDestroy(() => {
        if (disposed) return;
        emit({ type: "session_closed", sessionId });
      });
    } catch (error) {
      if (!disposed) {
        emit({
          type: "notice",
          level: "error",
          message: `Failed to start agent: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  })();

  return {
    snapshot: {
      ...(document.header.title ? { title: document.header.title } : {}),
      ...(document.header.cwd ? { cwd: document.header.cwd } : {}),
      leafId,
      messages,
      agent,
    },
    dispose,
  };
}

export async function sendRelayCommand(sessionId: string, command: Record<string, unknown>): Promise<unknown> {
  const existing = getRpcSession(sessionId);
  if (existing?.isAlive()) return existing.send(command);

  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) throw new RelaySessionError("session_not_found", "Session not found");
  const header = readSessionHeader(filePath);
  const { cwd } = resolveSpawnCwdResult(header?.cwd);
  try {
    const { session } = await startRpcSession(sessionId, filePath, cwd, undefined, false, header?.cwd);
    return await session.send(command);
  } catch (error) {
    if (error instanceof WebRpcError || error instanceof RpcCommandError || error instanceof RelaySessionError) {
      throw error;
    }
    throw new RelaySessionError("rpc_command_failed", error instanceof Error ? error.message : String(error));
  }
}
