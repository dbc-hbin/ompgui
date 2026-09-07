import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { RpcCommandError } from "../omp/rpc-process";
import { resolveOmpBin } from "../omp/omp-cli";
import { buildSessionTree, getLeafEntryId } from "../omp/session-files";
import type { SessionEntry, SessionTreeNode } from "../types";
import type { RelayAgentState, RelayBranchItem, RelayDisplayMessage, RelaySessionListItem } from "./protocol";
import { projectOnlineTranscript } from "./online-transcript";
import type { OnlineTranscriptPage } from "./online-transcript";
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
  snapshot: OnlineTranscriptPage & {
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
  const deliver = (event: AgentEvent) => {
    if (event.type === "tool_execution_update" || event.type === "tool_execution_end") {
      const raw = event.result ?? event.partialResult;
      if (typeof raw === "object" && raw !== null) {
        const projected = projectOnlineTranscript([{ ...raw, role: "toolResult", toolCallId: event.toolCallId, toolName: event.toolName }]).messages[0];
        if (projected) {
          const pending = projected.truncated === true || (projected.deferredImages?.count ?? 0) > 0;
          const result: Record<string, unknown> = { ...projected, contentPending: pending };
          // A transient result is not yet an addressable transcript entry. The
          // final message_end supplies the real content hash/reference.
          delete result.entryId;
          if (projected.deferredImages) result.deferredImages = { count: projected.deferredImages.count };
          const bounded: AgentEvent = { ...event, contentPending: pending };
          delete bounded.result;
          delete bounded.partialResult;
          bounded[event.type === "tool_execution_end" ? "result" : "partialResult"] = result;
          emit(bounded);
          return;
        }
      }
    }
    if ((event.type === "message_start" || event.type === "message_end") && event.message) {
      const page = projectOnlineTranscript([event.message]);
      const message = page.messages[0];
      if (message) {
        emit({ ...event, entryId: message.entryId, message });
        return;
      }
    }
    emit(event);
  };
  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) {
    // OMP keeps a new session in memory until its first assistant message.
    // A live process is authoritative even before its allocated path exists.
    const live = getRpcSession(sessionId);
    if (!live?.isAlive()) throw new RelaySessionError("session_not_found", "Session not found");
    const state = await live.send({ type: "get_state" });
    const transcript = await live.send({ type: "get_messages" });
    if (typeof transcript !== "object" || transcript === null || !("messages" in transcript) || !Array.isArray(transcript.messages)) {
      throw new RelaySessionError("rpc_command_failed", "Live session transcript is unavailable");
    }
    const projected = projectOnlineTranscript(transcript.messages);
    if (!live.isAlive() || getRpcSession(sessionId) !== live) throw new RelaySessionError("session_not_found", "Session not found");
    let disposed = false;
    const unsubscribe = live.onEvent((event) => {
      if (!disposed && live.sessionId === sessionId && getRpcSession(sessionId) === live) deliver(event);
    });
    const unsubscribeDestroy = live.onDestroy(() => {
      if (!disposed && live.sessionId === sessionId) emit({ type: "session_closed", sessionId });
    });
    emit({ type: "connected", sessionId });
    return {
      snapshot: { cwd: live.cwd, leafId: null, ...projected, agent: { running: live.isRunning(), ready: true, state } },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        unsubscribe();
        unsubscribeDestroy();
      },
    };
  }

  const document = getSessionDocument(filePath);
  if (document.error === "too_large") {
    throw new RelaySessionError("session_file_too_large", "Session file is too large to open in ompgui");
  }
  if (!document.header) {
    throw new RelaySessionError("session_file_malformed", "Session file is missing or malformed");
  }

  const entries = document.entries;
  const leafId = getLeafEntryId(entries);
  const context = buildSessionContext(entries, leafId, { deferThinking: false, deferToolResultImages: false });
  const projected = projectOnlineTranscript(context.messages, context.entryIds);

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
      if (disposed || session.sessionId !== sessionId) return;
      const subscribedSession = session;
      unsubscribe = subscribedSession.onEvent((event) => {
        if (!disposed && subscribedSession.sessionId === sessionId && getRpcSession(sessionId) === subscribedSession) deliver(event);
      });
      unsubscribeDestroy = subscribedSession.onDestroy(() => {
        if (disposed || subscribedSession.sessionId !== sessionId) return;
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
      ...projected,
      agent,
    },
    dispose,
  };
}

export async function sendRelayCommand(
  sessionId: string,
  command: Record<string, unknown>,
  prepareCommand?: () => Record<string, unknown>,
): Promise<unknown> {
  const existing = getRpcSession(sessionId);
  if (existing?.isAlive()) return existing.send(prepareCommand ? prepareCommand() : command);
  if (command.type === "extension_ui_response") {
    throw new RelaySessionError("dialog_not_pending", "This dialog is no longer pending in this session");
  }

  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) throw new RelaySessionError("session_not_found", "Session not found");
  const header = readSessionHeader(filePath);
  const { cwd } = resolveSpawnCwdResult(header?.cwd);
  try {
    const { session } = await startRpcSession(sessionId, filePath, cwd, undefined, false, header?.cwd);
    return await session.send(prepareCommand ? prepareCommand() : command);
  } catch (error) {
    if (error instanceof WebRpcError || error instanceof RpcCommandError || error instanceof RelaySessionError) {
      throw error;
    }
    throw new RelaySessionError("rpc_command_failed", error instanceof Error ? error.message : String(error));
  }
}

const execFileAsync = promisify(execFile);
const BRANCH_CAP = 40;
const EXPORT_HTML_INLINE_CHARS = 80_000;

function messagePreview(entry: SessionEntry): { label: string; role?: string } {
  if (entry.type !== "message" || !("message" in entry) || !entry.message) {
    return { label: entry.type };
  }
  const content: unknown = "content" in entry.message ? entry.message.content : undefined;
  let text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
        .filter((block): block is { type: "text"; text: string } => {
          if (typeof block !== "object" || block === null) return false;
          if (!("type" in block) || block.type !== "text") return false;
          return "text" in block && typeof block.text === "string";
        })
        .map((block) => block.text)
        .join(" ")
      : "";
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > 40) text = `${text.slice(0, 40)}…`;
  const role = entry.message.role === "user" || entry.message.role === "assistant" ? entry.message.role : undefined;
  if (!text) text = role === "assistant" ? "assistant" : "message";
  return { label: text, ...(role ? { role } : {}) };
}

function collectLeaves(nodes: SessionTreeNode[], out: RelayBranchItem[]): void {
  for (const node of nodes) {
    if (out.length >= BRANCH_CAP) return;
    if (node.children.length === 0) {
      const preview = messagePreview(node.entry);
      out.push({
        id: node.entry.id,
        label: (node.label?.trim() || preview.label).slice(0, 40),
        ...(preview.role ? { role: preview.role } : {}),
      });
      continue;
    }
    collectLeaves(node.children, out);
  }
}

async function loadRelaySessionEntries(sessionId: string) {
  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) throw new RelaySessionError("session_not_found", "Session not found");
  const document = getSessionDocument(filePath);
  if (document.error === "too_large") {
    throw new RelaySessionError("session_file_too_large", "Session file is too large to open in ompgui");
  }
  if (!document.header) {
    throw new RelaySessionError("session_file_malformed", "Session file is missing or malformed");
  }
  const entries = document.entries;
  return { filePath, document, entries };
}

export async function listRelayBranches(sessionId: string): Promise<{
  id: string;
  leafId: string | null;
  branches: RelayBranchItem[];
}> {
  const { entries } = await loadRelaySessionEntries(sessionId);
  const branches: RelayBranchItem[] = [];
  collectLeaves(buildSessionTree(entries), branches);
  return { id: sessionId, leafId: getLeafEntryId(entries), branches };
}

export async function snapshotRelayLeaf(sessionId: string, leafId: string): Promise<OnlineTranscriptPage & {
  title?: string;
  cwd?: string;
  leafId: string | null;
  messages: RelayDisplayMessage[];
  agent: RelayAgentState;
}> {
  const { document, entries } = await loadRelaySessionEntries(sessionId);
  const ids = new Set(entries.map((entry) => entry.id));
  if (!ids.has(leafId)) throw new RelaySessionError("unknown_leaf", "Unknown conversation branch");
  const context = buildSessionContext(entries, leafId, { deferThinking: false, deferToolResultImages: false });
  const projected = projectOnlineTranscript(context.messages, context.entryIds);
  const agent: RelayAgentState = { running: false, ready: false };
  return {
    ...(document.header?.title ? { title: document.header.title } : {}),
    ...(document.header?.cwd ? { cwd: document.header.cwd } : {}),
    leafId,
    ...projected,
    agent,
  };
}

export async function exportRelaySession(sessionId: string, deviceId: string): Promise<{
  id: string;
  fileName: string;
  bytes: number;
  html?: string;
  transferId?: string;
  size?: number;
}> {
  let ownerEpoch = relayExportOwnerEpochs.get(deviceId);
  if (ownerEpoch === undefined) {
    ownerEpoch = Symbol();
    relayExportOwnerEpochs.set(deviceId, ownerEpoch);
  }
  const { filePath } = await loadRelaySessionEntries(sessionId);
  const html = await renderRelayExportHtml(filePath);
  if (relayExportOwnerEpochs.get(deviceId) !== ownerEpoch) {
    throw new RelaySessionError("export_cancelled", "Export owner disconnected or was revoked");
  }
  const bytes = Buffer.byteLength(html, "utf8");
  const sessionBase = basename(filePath, ".jsonl");
  const fileName = `omp-session-${sessionBase}.html`;
  if (bytes <= EXPORT_HTML_INLINE_CHARS) {
    return { id: sessionId, fileName, bytes, html };
  }
  const transfer = registerRelayExportTransfer({ deviceId, fileName, html, bytes });
  return { id: sessionId, fileName, bytes, transferId: transfer.transferId, size: bytes };
}

const RELAY_EXPORT_CHUNK_BYTES = 96 * 1024;
const RELAY_EXPORT_TTL_MS = 15 * 60 * 1000;

interface RelayExportTransfer {
  deviceId: string;
  transferId: string;
  fileName: string;
  bytes: Uint8Array;
  size: number;
  expiresAt: number;
}

const relayExportTransfers = new Map<string, RelayExportTransfer>();
const relayExportOwnerEpochs = new Map<string, symbol>();

function pruneRelayExportTransfers(now = Date.now()): void {
  for (const [transferId, transfer] of relayExportTransfers) {
    if (transfer.expiresAt <= now) relayExportTransfers.delete(transferId);
  }
  while (relayExportTransfers.size >= 8) {
    const oldest = relayExportTransfers.keys().next();
    if (oldest.done) break;
    relayExportTransfers.delete(oldest.value);
  }
}

async function renderRelayExportHtml(filePath: string): Promise<string> {
  const bin = resolveOmpBin();
  if (!bin) throw new RelaySessionError("omp_not_found", "omp binary not found. Install oh-my-pi or set OMP_WEB_OMP_BIN.");
  const tempDir = join(tmpdir(), "ompgui-export");
  mkdirSync(tempDir, { recursive: true });
  const outputPath = join(tempDir, `${randomUUID()}.html`);
  try {
    await execFileAsync(bin, ["--export", filePath, outputPath], {
      cwd: tmpdir(),
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return readFileSync(outputPath, "utf8");
  } finally {
    rmSync(outputPath, { force: true });
  }
}

function registerRelayExportTransfer(input: { deviceId: string; fileName: string; html: string; bytes: number }): { transferId: string } {
  pruneRelayExportTransfers();
  const transferId = randomUUID();
  relayExportTransfers.set(transferId, {
    deviceId: input.deviceId,
    transferId,
    fileName: input.fileName,
    bytes: Buffer.from(input.html, "utf8"),
    size: input.bytes,
    expiresAt: Date.now() + RELAY_EXPORT_TTL_MS,
  });
  return { transferId };
}

export function readRelayExportChunk(transferId: string, offset: number, length: number, deviceId: string): {
  transferId: string;
  offset: number;
  data: string;
  bytes: number;
  nextOffset: number;
  complete: boolean;
  size: number;
} {
  const transfer = relayExportTransfers.get(transferId);
  if (!transfer || transfer.deviceId !== deviceId || transfer.expiresAt <= Date.now()) {
    if (transfer?.expiresAt !== undefined && transfer.expiresAt <= Date.now()) relayExportTransfers.delete(transferId);
    throw new RelaySessionError("unknown_transfer", "Unknown or expired export transfer");
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > transfer.size) {
    throw new RelaySessionError("invalid_offset", "Invalid export offset");
  }
  if (!Number.isSafeInteger(length) || length <= 0 || length > RELAY_EXPORT_CHUNK_BYTES) {
    throw new RelaySessionError("invalid_length", "Invalid export chunk length");
  }
  const slice = transfer.bytes.subarray(offset, Math.min(transfer.size, offset + length));
  const nextOffset = offset + slice.length;
  return {
    transferId,
    offset,
    data: Buffer.from(slice).toString("base64"),
    bytes: slice.length,
    nextOffset,
    complete: nextOffset >= transfer.size,
    size: transfer.size,
  };
}

export function closeRelayExportTransfer(transferId: string, deviceId: string): { closed: boolean } {
  const transfer = relayExportTransfers.get(transferId);
  if (!transfer || transfer.deviceId !== deviceId) return { closed: false };
  return { closed: relayExportTransfers.delete(transferId) };
}

export function clearSessionExportTransfers(deviceId?: string): void {
  if (deviceId === undefined) {
    relayExportOwnerEpochs.clear();
    relayExportTransfers.clear();
    return;
  }
  relayExportOwnerEpochs.delete(deviceId);
  for (const [transferId, transfer] of relayExportTransfers) {
    if (transfer.deviceId === deviceId) relayExportTransfers.delete(transferId);
  }
}
