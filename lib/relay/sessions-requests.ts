import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { allowFileRoot, getAllowedFileRoots, isExistingFilePathAllowed } from "../file-access";
import { ToolResultImagesTooLargeError, validateAgentImages } from "../image-attachments";
import { extractSubagentHistory, readCompletionArtifact, readSubagentTranscriptPage, resolveSubagentArtifact } from "../subagent-history";
import { deriveSessionTitleFromFirstMessage, sanitizeSessionTitle } from "../session-title";
import { getRpcSession, mapPresetToolNames, startRpcSession, WebRpcError } from "../rpc-manager";
import { RpcCommandError } from "../omp/rpc-process";
import {
  buildSessionContext,
  getSessionDocument,
  getSessionEntries,
  getToolResultImagesForEntry,
  invalidateSessionListCache,
  resolveSessionPath,
} from "../session-reader";
import { getLeafEntryId, materializeSessionEntries, scanSessionInfo, setSessionTitle } from "../omp/session-files";
import { validateProjectPath, ProjectPathError } from "../project-registry";
import { removeWorktree } from "../worktree";
import { addRelayWorktree, listRelayWorktrees } from "./workspace";
import { asNumber, asString } from "../type-guards";
import { RELAY_MAX_PROMPT_CHARS } from "./protocol";
import type { RelayRequestContext } from "./request-types";
import {
  archiveRelaySession,
  deleteRelaySession,
  importRelaySession,
  listRelayArchives,
  renameRelaySession,
  restoreRelayArchive,
} from "./session-actions";
import {
  closeRelayExportTransfer,
  exportRelaySession,
  listRelayBranches,
  listRelaySessions,
  readRelayExportChunk,
  RelaySessionError,
  sendRelayCommand,
  snapshotRelayLeaf,
} from "./session-runtime";

const SESSION_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const SUBAGENT_ID_RE = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
const THINKING_LEVELS = new Set(["auto", "minimal", "low", "medium", "high", "xhigh", "max", "off"]);

/**
 * Strict finite desktop-supported runtime command allowlist for the sessions
 * `command` action. Reuses the omp RPC boundary via sendRelayCommand; never an
 * arbitrary RPC tunnel. Unsupported UI-only commands fail with a coded error
 * instead of executing.
 */
export const SESSIONS_COMMAND_ALLOWLIST = [
  "prompt",
  "steer",
  "follow_up",
  "abort",
  "abort_and_prompt",
  "get_state",
  "set_model",
  "set_thinking_level",
  "set_fast_mode",
  "fork",
  "new_session",
  "switch_session",
  "compact",
  "abort_compaction",
  "set_session_name",
  "get_session_stats",
  "get_last_assistant_text",
  "get_commands",
  "reload",
  "extension_ui_response",
  "bash",
  "set_steering_mode",
  "set_follow_up_mode",
  "set_interrupt_mode",
  "set_auto_compaction",
  "set_auto_retry",
  "abort_retry",
  "abort_bash",
  "set_todos",
  "handoff",
  "get_subagents",
  "get_subagent_messages",
  "set_subagent_subscription",
  "get_messages",
  "get_messages_page",
  "get_branch_messages",
  "export_html",
  "cycle_model",
  "cycle_thinking_level",
] as const;

const COMMAND_SET = new Set<string>(SESSIONS_COMMAND_ALLOWLIST);

const UNSUPPORTED_COMMANDS: Record<string, string> = {
  navigate_tree: "Branch navigation is not supported over the omp RPC protocol",
  clear_queue: "Recalling queued messages is not supported over the omp RPC protocol",
  get_tools: "Per-session tool listing is not supported over the omp RPC protocol",
  set_tools: "Changing tools on a running session is not supported over the omp RPC protocol; tool presets apply to new sessions",
  extension_ui_input: "Extension custom UI is not supported over the omp RPC protocol",
};

export const SESSIONS_REQUEST_ACTIONS = [
  "list",
  "create",
  "delete",
  "archive",
  "rename",
  "restore",
  "archives",
  "import",
  "branches",
  "leaf",
  "history",
  "thinking",
  "media",
  "subagents",
  "subagentTranscript",
  "subagentCompletion",
  "stats",
  "state",
  "systemPrompt",
  "autoname",
  "export",
  "exportChunk",
  "exportClose",
  "command",
  "worktrees.list",
  "worktrees.add",
  "worktrees.remove",
] as const;

const ACTION_SET = new Set<string>(SESSIONS_REQUEST_ACTIONS);

class SessionsRequestError extends RelaySessionError {
  details?: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message);
    if (details !== undefined) this.details = details;
  }
}

function fail(code: string, message: string, details?: Record<string, unknown>): never {
  throw new SessionsRequestError(code, message, details);
}

function needId(value: unknown): string {
  const id = asString(value)?.trim();
  if (!id || !SESSION_ID_RE.test(id)) fail("invalid_session", "session id is required");
  return id;
}

function needCommandObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("invalid_command", "command must be an object");
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) out[key] = entry;
  return out;
}

function asOffset(value: unknown, def = 0): number {
  if (value === undefined) return def;
  const n = asNumber(value);
  if (n === undefined || !Number.isSafeInteger(n) || n < 0) fail("invalid_offset", "offset must be a non-negative integer");
  return n;
}

function asLimit(value: unknown, def: number, max: number): number {
  if (value === undefined) return def;
  const n = asNumber(value);
  if (n === undefined || !Number.isSafeInteger(n) || n < 1 || n > max) fail("invalid_limit", `limit must be 1..${max}`);
  return n;
}

function copyJsonObject(value: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) out[key] = entry;
  return out;
}

async function handleList(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const offset = asOffset(args.offset, 0);
  const limit = asLimit(args.limit, 100, 500);
  const query = asString(args.query)?.trim().toLowerCase() ?? "";
  const runningOnly = args.runningOnly === true;
  const listed = await listRelaySessions();
  const running = new Set(listed.runningIds);
  let sessions = listed.sessions;
  if (runningOnly) sessions = sessions.filter((s) => running.has(s.id));
  if (query) {
    sessions = sessions.filter((s) =>
      s.id.toLowerCase().includes(query) ||
      (s.name ?? "").toLowerCase().includes(query) ||
      s.cwd.toLowerCase().includes(query) ||
      s.firstMessage.toLowerCase().includes(query),
    );
  }
  const total = sessions.length;
  const page = sessions.slice(offset, offset + limit);
  return { sessions: page, runningIds: listed.runningIds, total, offset, limit, hasMore: offset + page.length < total };
}

async function handleCreate(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const rawCwd = asString(args.cwd)?.trim();
  if (!rawCwd) fail("cwd_required", "cwd is required");
  let cwd: string;
  try {
    cwd = validateProjectPath(rawCwd);
  } catch (error) {
    if (error instanceof ProjectPathError) fail(error.code, error.message);
    throw error;
  }
  if (!existsSync(cwd)) fail("directory_not_found", `Directory does not exist: ${cwd}`);
  const message = asString(args.message)?.trim() ?? "";
  if (message.length > RELAY_MAX_PROMPT_CHARS) fail("invalid_command", "prompt message is too long");
  const thinking = asString(args.thinkingLevel)?.trim();
  if (thinking && !THINKING_LEVELS.has(thinking)) fail("invalid_command", "Unknown thinking level");
  const provider = asString(args.provider)?.trim();
  const modelId = asString(args.modelId)?.trim();
  if ((provider && !modelId) || (!provider && modelId)) {
    fail("invalid_command", "set_model requires provider and modelId");
  }
  let toolNames: string[] | undefined;
  if (args.toolNames !== undefined) {
    const rawTools = args.toolNames;
    if (!Array.isArray(rawTools)) fail("invalid_tools", "toolNames must be an array of tool names");
    const picked: string[] = [];
    for (const entry of rawTools) {
      if (typeof entry !== "string" || !entry.trim() || entry.length > 64) {
        fail("invalid_tools", "toolNames must be an array of tool names");
      }
      const lower = entry.toLowerCase();
      if (!picked.includes(lower)) picked.push(lower);
    }
    toolNames = mapPresetToolNames(picked);
  }
  const advisor = args.advisor === true;
  const tempKey = `__new__${randomUUID()}`;
  try {
    const { session, realSessionId } = await startRpcSession(tempKey, "", cwd, toolNames, advisor);
    allowFileRoot(cwd);
    invalidateSessionListCache();
    if (provider && modelId) await session.send({ type: "set_model", provider, modelId });
    if (thinking) await session.send({ type: "set_thinking_level", level: thinking });
    if (message) await session.send({ type: "prompt", message });
    return { sessionId: realSessionId };
  } catch (error) {
    if (error instanceof WebRpcError || error instanceof RpcCommandError || error instanceof RelaySessionError) throw error;
    fail("session_create_failed", error instanceof Error ? error.message : String(error));
  }
  fail("session_create_failed", "unreachable");
}

async function handleHistory(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = needId(args.id);
  const filePath = await resolveSessionPath(id);
  if (!filePath) fail("session_not_found", "Session not found");
  const document = getSessionDocument(filePath);
  if (document.error === "too_large") fail("session_file_too_large", "Session file is too large to open in ompgui");
  if (!document.header) fail("session_file_malformed", "Session file is missing or malformed");
  const entries = materializeSessionEntries(document.entries, { skipToolResultImages: true });
  let leafArg: string | undefined;
  if (args.leafId !== undefined && args.leafId !== null) {
    const trimmed = asString(args.leafId)?.trim();
    if (!trimmed || trimmed.length > 200) fail("invalid_leaf", "leafId is invalid");
    leafArg = trimmed;
  }
  const persistedLeaf = getLeafEntryId(entries);
  const effectiveLeaf = leafArg ?? persistedLeaf;
  if (leafArg) {
    const ids = new Set(entries.map((e) => e.id));
    if (!ids.has(leafArg)) fail("unknown_leaf", "Unknown conversation branch");
  }
  const context = buildSessionContext(entries, effectiveLeaf ?? undefined, { deferThinking: true, deferToolResultImages: true });
  const total = context.messages.length;
  const offset = asOffset(args.offset, 0);
  const limit = asLimit(args.limit, 100, 500);
  const messages = context.messages.slice(offset, offset + limit);
  const entryIds = context.entryIds.slice(offset, offset + limit);
  return {
    id,
    leafId: effectiveLeaf ?? null,
    total,
    offset,
    limit,
    hasMore: offset + messages.length < total,
    messages,
    entryIds,
    thinkingLevel: context.thinkingLevel,
    model: context.model,
    todoPhases: context.todoPhases,
  };
}

async function handleThinking(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = needId(args.id);
  const entryId = asString(args.entryId)?.trim();
  if (!entryId || entryId.length > 200) fail("invalid_entry", "entryId is required");
  const blockIndex = asNumber(args.blockIndex);
  if (blockIndex === undefined || !Number.isSafeInteger(blockIndex) || blockIndex < 0 || blockIndex > 100) {
    fail("invalid_block_index", "A valid block index is required");
  }
  const filePath = await resolveSessionPath(id);
  if (!filePath) fail("session_not_found", "Session not found");
  const candidate = getSessionEntries(filePath).find((item) => item.id === entryId);
  if (
    candidate === undefined ||
    candidate.type !== "message" ||
    typeof candidate.message !== "object" ||
    candidate.message === null ||
    Array.isArray(candidate.message) ||
    !("role" in candidate.message) ||
    candidate.message.role !== "assistant" ||
    !("content" in candidate.message) ||
    !Array.isArray(candidate.message.content)
  ) {
    fail("assistant_message_not_found", "Assistant message not found");
  }
  const block = candidate.message.content[blockIndex];
  if (
    typeof block !== "object" ||
    block === null ||
    Array.isArray(block) ||
    !("type" in block) ||
    block.type !== "thinking" ||
    !("thinking" in block) ||
    typeof block.thinking !== "string"
  ) {
    fail("thinking_block_not_found", "Thinking block not found");
  }
  return { thinking: block.thinking };
}

async function handleMedia(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = needId(args.id);
  const entryId = asString(args.entryId)?.trim();
  if (!entryId || entryId.length > 200) fail("invalid_entry", "entryId is required");
  const filePath = await resolveSessionPath(id);
  if (!filePath) fail("session_not_found", "Session not found");
  try {
    const media = getToolResultImagesForEntry(filePath, entryId);
    if (!media) fail("tool_result_images_not_found", "Tool result images not found");
    return { images: media.images, missingCount: media.missingCount };
  } catch (error) {
    if (error instanceof ToolResultImagesTooLargeError) fail(error.code, error.message);
    throw error;
  }
  fail("media_failed", "unreachable");
}

async function handleSubagents(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = needId(args.id);
  const filePath = await resolveSessionPath(id);
  if (!filePath) {
    if (getRpcSession(id)?.isAlive()) return { subagents: [] };
    fail("session_not_found", "Session not found");
  }
  return { subagents: extractSubagentHistory(filePath) };
}

async function handleSubagentTranscript(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = needId(args.id);
  const subagentId = asString(args.subagentId)?.trim();
  if (!subagentId || subagentId.length > 100 || !SUBAGENT_ID_RE.test(subagentId)) {
    fail("invalid_subagent_id", "Invalid subagent id");
  }
  const fromByteRaw = args.fromByte === undefined ? 0 : asNumber(args.fromByte);
  if (fromByteRaw === undefined || !Number.isSafeInteger(fromByteRaw) || fromByteRaw < 0) {
    fail("invalid_offset", "fromByte must be a non-negative integer");
  }
  const filePath = await resolveSessionPath(id);
  if (!filePath) fail("session_not_found", "Session not found");
  const resolved = resolveSubagentArtifact(filePath, subagentId, ".jsonl");
  if (!resolved) fail("transcript_not_found", "Subagent transcript not found");
  const page = readSubagentTranscriptPage(resolved, fromByteRaw);
  return {
    fromByte: page.fromByte,
    nextByte: page.nextByte,
    reset: page.reset,
    messages: page.messages,
    totalBytes: page.totalBytes ?? null,
    ...(page.error ? { error: page.error } : {}),
  };
}

async function handleSubagentCompletion(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = needId(args.id);
  const subagentId = asString(args.subagentId)?.trim();
  if (!subagentId || subagentId.length > 100 || !SUBAGENT_ID_RE.test(subagentId)) {
    fail("invalid_subagent_id", "Invalid subagent id");
  }
  const filePath = await resolveSessionPath(id);
  if (!filePath) fail("session_not_found", "Session not found");
  const resolved = resolveSubagentArtifact(filePath, subagentId, ".md");
  if (!resolved) fail("transcript_not_found", "Subagent completion not found");
  const completion = readCompletionArtifact(resolved);
  if (!completion) fail("transcript_not_found", "Subagent completion not found");
  return { completion: completion.completion, truncated: completion.truncated };
}

async function handleStats(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = needId(args.id);
  try {
    const raw = await sendRelayCommand(id, { type: "get_session_stats" });
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      fail("stats_failed", "Session stats unavailable");
    }
    return copyJsonObject(raw);
  } catch (error) {
    if (error instanceof RelaySessionError || error instanceof WebRpcError || error instanceof RpcCommandError) throw error;
    fail("stats_failed", error instanceof Error ? error.message : String(error));
  }
  fail("stats_failed", "unreachable");
}

async function handleState(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = needId(args.id);
  try {
    const raw = await sendRelayCommand(id, { type: "get_state" });
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      fail("state_failed", "Session state unavailable");
    }
    return copyJsonObject(raw);
  } catch (error) {
    if (error instanceof RelaySessionError || error instanceof WebRpcError || error instanceof RpcCommandError) throw error;
    fail("state_failed", error instanceof Error ? error.message : String(error));
  }
  fail("state_failed", "unreachable");
}

async function handleSystemPrompt(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = needId(args.id);
  const raw = await sendRelayCommand(id, { type: "get_state" });
  if (
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    "systemPrompt" in raw &&
    typeof raw.systemPrompt === "string"
  ) {
    return { systemPrompt: raw.systemPrompt };
  }
  return { systemPrompt: null };
}

async function handleAutoname(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = needId(args.id);
  const rpc = getRpcSession(id);
  const running = Boolean(rpc?.isAlive?.());
  if (running && rpc !== undefined && typeof rpc.send === "function") {
    try {
      const state = await rpc.send({ type: "get_state" });
      let sessionName: string | undefined;
      if (
        typeof state === "object" &&
        state !== null &&
        !Array.isArray(state) &&
        "sessionName" in state &&
        typeof state.sessionName === "string"
      ) {
        sessionName = state.sessionName;
      }
      const liveTitle = sanitizeSessionTitle(sessionName);
      if (liveTitle) {
        invalidateSessionListCache();
        return { title: liveTitle };
      }
    } catch {
      // Fall through to on-disk title.
    }
  }
  const filePath = await resolveSessionPath(id);
  if (!filePath) fail("session_not_found", "Session not found");
  const info = scanSessionInfo(filePath, false);
  const storedTitle = sanitizeSessionTitle(info?.title);
  if (storedTitle) return { title: storedTitle };
  const derived = deriveSessionTitleFromFirstMessage(info?.firstMessage);
  if (!derived) fail("session_no_messages_to_name", "The session has no user messages to name");
  if (!running) setSessionTitle(filePath, derived, "auto");
  invalidateSessionListCache();
  return { title: derived };
}

async function handleCommand(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = needId(args.id);
  const command = needCommandObject(args.command);
  const type = asString(command.type)?.trim();
  if (!type) fail("command_type_required", "command type is required");
  if (UNSUPPORTED_COMMANDS[type]) fail("unsupported_command", UNSUPPORTED_COMMANDS[type]);
  if (!COMMAND_SET.has(type)) fail("unsupported_command", `Unsupported command: ${type}`);
  if ((type === "prompt" || type === "steer" || type === "follow_up") && command.images !== undefined) {
    const images = command.images;
    if (!Array.isArray(images)) fail("invalid_images", "images must be an array");
    const normalized = images.map((image) => {
      if (typeof image !== "object" || image === null || Array.isArray(image)) return image;
      const data = "data" in image && typeof image.data === "string" ? image.data : undefined;
      const mimeType = "mimeType" in image && typeof image.mimeType === "string" ? image.mimeType : undefined;
      return { type: "image", data, mimeType };
    });
    const complaint = validateAgentImages(normalized);
    if (complaint) fail("invalid_images", complaint);
    command.images = normalized;
  }
  if (type === "fork") {
    const entryId = asString(command.entryId)?.trim();
    if (!entryId) fail("invalid_entry", "fork requires entryId");
  }
  if (type === "bash" && command.excludeFromContext === true) {
    fail(
      "bash_exclude_unsupported",
      "omp cannot run a shell command with its output excluded from the model context (`!!`): the RPC bash command has no exclusion option, so the output would silently enter the context anyway. Run it with a single `!` to share the output with the model, or use a terminal outside ompgui.",
    );
  }
  if (type === "set_model") {
    const provider = asString(command.provider)?.trim();
    const modelId = asString(command.modelId)?.trim();
    if (!provider || !modelId) fail("invalid_command", "set_model requires provider and modelId");
  }
  if (type === "set_thinking_level") {
    const level = asString(command.level)?.trim() ?? asString(command.thinkingLevel)?.trim();
    if (!level) fail("invalid_command", "set_thinking_level requires level");
  }
  if (type === "set_session_name") {
    const name = asString(command.name)?.trim();
    if (!name) fail("invalid_command", "Session name cannot be empty");
  }
  if (type === "extension_ui_response") {
    const responseId = asString(command.id)?.trim();
    if (!responseId) fail("invalid_command", "extension_ui_response requires id");
  }
  try {
    const result = await sendRelayCommand(id, command);
    if (result === null || result === undefined) return { result: null };
    if (typeof result === "object") return { result };
    return { result: { value: result } };
  } catch (error) {
    if (error instanceof RelaySessionError || error instanceof WebRpcError || error instanceof RpcCommandError) throw error;
    fail("rpc_command_failed", error instanceof Error ? error.message : String(error));
  }
  fail("rpc_command_failed", "unreachable");
}

async function handleWorktreeRemove(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const cwd = asString(args.cwd)?.trim();
  const path = asString(args.path)?.trim();
  if (!cwd) fail("cwd_required", "cwd is required");
  if (!path) fail("path_required", "path is required");
  const roots = await getAllowedFileRoots();
  const target = resolvePath(cwd);
  if (!isExistingFilePathAllowed(target, roots)) fail("access_denied", "Path is outside allowed workspaces");
  const force = args.force === true;
  try {
    await removeWorktree(cwd, path, force);
    return { path };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/contains modified or untracked files|is dirty/i.test(message)) {
      fail("worktree_dirty", message, { dirty: true });
    }
    if (message.startsWith("Not a worktree of this repository")) fail("not_a_worktree", message);
    if (message.startsWith("Cannot remove the main worktree")) fail("cannot_remove_main_worktree", message);
    fail("worktree_remove_failed", message);
  }
  fail("worktree_remove_failed", "unreachable");
}

/**
 * Sessions domain dispatcher for the `request` envelope (domain `sessions`).
 * Validates the finite action set and args; unknown actions fail. Helpers
 * return Record<string,unknown> JSON objects and throw coded safe errors.
 */
export async function handleSessionsRequest(
  action: string,
  args: Record<string, unknown>,
  context: RelayRequestContext,
): Promise<Record<string, unknown>> {
  if (!ACTION_SET.has(action)) fail("unknown_action", `Unknown sessions action: ${action}`);
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    fail("invalid_args", "args must be an object");
  }
  const safeArgs: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(args)) safeArgs[key] = entry;
  switch (action) {
    case "list":
      return handleList(safeArgs);
    case "create":
      return handleCreate(safeArgs);
    case "delete": {
      const id = needId(safeArgs.id);
      return { ...(await deleteRelaySession(id)) };
    }
    case "archive": {
      const id = needId(safeArgs.id);
      return { ...(await archiveRelaySession(id)) };
    }
    case "rename": {
      const id = needId(safeArgs.id);
      const name = asString(safeArgs.name) ?? "";
      return { ...(await renameRelaySession(id, name)) };
    }
    case "restore": {
      const key = asString(safeArgs.key)?.trim();
      if (!key) fail("invalid_key", "archive key is required");
      return { ...(await restoreRelayArchive(key)) };
    }
    case "archives":
      return { archives: await listRelayArchives() };
    case "import": {
      const fileName = asString(safeArgs.fileName) ?? "";
      const content = asString(safeArgs.content) ?? "";
      return { ...(await importRelaySession(fileName, content)) };
    }
    case "branches": {
      const id = needId(safeArgs.id);
      return { ...(await listRelayBranches(id)) };
    }
    case "leaf": {
      const id = needId(safeArgs.id);
      const leafId = asString(safeArgs.leafId)?.trim();
      if (!leafId) fail("invalid_leaf", "leafId is required");
      return { ...(await snapshotRelayLeaf(id, leafId)) };
    }
    case "history":
      return handleHistory(safeArgs);
    case "thinking":
      return handleThinking(safeArgs);
    case "media":
      return handleMedia(safeArgs);
    case "subagents":
      return handleSubagents(safeArgs);
    case "subagentTranscript":
      return handleSubagentTranscript(safeArgs);
    case "subagentCompletion":
      return handleSubagentCompletion(safeArgs);
    case "stats":
      return handleStats(safeArgs);
    case "state":
      return handleState(safeArgs);
    case "systemPrompt":
      return handleSystemPrompt(safeArgs);
    case "autoname":
      return handleAutoname(safeArgs);
    case "export": {
      const id = needId(safeArgs.id);
      return { ...(await exportRelaySession(id, context.deviceId)) };
    }
    case "exportChunk": {
      const transferId = asString(safeArgs.transferId)?.trim();
      if (!transferId) fail("invalid_transfer", "transferId is required");
      const offset = asOffset(safeArgs.offset, 0);
      const length = safeArgs.length === undefined ? 96 * 1024 : asLimit(safeArgs.length, 96 * 1024, 96 * 1024);
      return { ...readRelayExportChunk(transferId, offset, length, context.deviceId) };
    }
    case "exportClose": {
      const transferId = asString(safeArgs.transferId)?.trim();
      if (!transferId) fail("invalid_transfer", "transferId is required");
      return { ...closeRelayExportTransfer(transferId, context.deviceId) };
    }
    case "command":
      return handleCommand(safeArgs);
    case "worktrees.list": {
      const cwd = asString(safeArgs.cwd)?.trim();
      if (!cwd) fail("cwd_required", "cwd is required");
      return { ...(await listRelayWorktrees(cwd)) };
    }
    case "worktrees.add": {
      const cwd = asString(safeArgs.cwd)?.trim();
      const branch = asString(safeArgs.branch)?.trim();
      if (!cwd) fail("cwd_required", "cwd is required");
      if (!branch) fail("branch_required", "branch is required");
      return { ...(await addRelayWorktree(cwd, branch)) };
    }
    case "worktrees.remove":
      return handleWorktreeRemove(safeArgs);
    default:
      fail("unknown_action", `Unknown sessions action: ${action}`);
  }
  fail("unknown_action", `Unknown sessions action: ${action}`);
}
