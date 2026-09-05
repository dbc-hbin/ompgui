import { asNumber, asString, isRecord } from "../type-guards";

export const RELAY_PROTOCOL_VERSION = 1 as const;
export const RELAY_MAX_FRAME_BYTES = 256 * 1024;
export const RELAY_MAX_PROMPT_CHARS = 32_000;
export const RELAY_MAX_LABEL_CHARS = 64;
export const RELAY_HELLO_TIMEOUT_MS = 10_000;
export const RELAY_MAX_MODEL_FIELD_CHARS = 128;
export const RELAY_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const RELAY_ALLOWED_COMMANDS = [
  "prompt",
  "abort",
  "get_state",
  "set_model",
  "set_thinking_level",
  "compact",
  "get_subagents",
  "get_available_commands",
] as const;

export type RelayAllowedCommand = (typeof RELAY_ALLOWED_COMMANDS)[number];

const ALLOWED_COMMAND_SET = new Set<string>(RELAY_ALLOWED_COMMANDS);

export type RelayClientFrame =
  | RelayHelloFrame
  | RelayRequestFrame
  | { op: "sessions.list" }
  | { op: "models.list" }
  | { op: "usage" }
  | { op: "session.open"; id: string }
  | { op: "session.close" }
  | { op: "session.create"; cwd: string; message?: string; provider?: string; modelId?: string; thinkingLevel?: string }
  | { op: "session.delete"; id: string }
  | { op: "session.archive"; id: string }
  | { op: "session.rename"; id: string; name: string }
  | { op: "session.restore"; key: string }
  | { op: "sessions.archives" }
  | { op: "projects.list" }
  | { op: "files.list"; path?: string }
  | { op: "files.read"; path: string }
  | { op: "slash.list" }
  | { op: "worktrees.list"; cwd: string }
  | { op: "worktrees.add"; cwd: string; branch: string }
  | { op: "files.write"; path: string; text: string; revision?: string; baseContentHash?: string; createIfMissing?: boolean }
  | { op: "git.status"; cwd: string }
  | { op: "git.diff"; cwd: string; path: string }
  | { op: "session.branches"; id: string }
  | { op: "session.leaf"; id: string; leafId: string }
  | { op: "session.export"; id: string }
  | { op: "skills.list"; cwd: string }
  | { op: "skills.toggle"; cwd: string; filePath: string; disableModelInvocation: boolean }
  | { op: "plugins.list"; cwd: string }
  | { op: "plugins.action"; cwd: string; action: RelayPluginAction; source?: string; scope?: "global" | "project" }
  | { op: "mcp.list"; cwd?: string }
  | { op: "mcp.delete"; cwd: string; name: string }
  | { op: "mcp.upsert"; cwd: string; name: string; type: "stdio" | "http" | "sse"; command?: string; url?: string; args?: string[] }
  | { op: "session.import"; fileName: string; content: string }
  | { op: "skills.search"; query: string; limit?: number }
  | { op: "skills.install"; package: string; scope: "global" | "project"; cwd?: string }
  | { op: "agents.list"; cwd?: string }
  | { op: "agents.save"; name: string; description: string; systemPrompt: string; scope: "user" | "project"; cwd?: string }
  | { op: "agents.delete"; name: string; scope: "user" | "project"; cwd?: string }
  | { op: "auth.providers" }
  | { op: "files.index"; cwd: string; query: string }
  | { op: "projects.add"; cwd: string }
  | { op: "projects.remove"; cwd: string }
  | { op: "settings.get" }
  | { op: "settings.update"; settings: Record<string, unknown> }
  | RelayCmdFrame;

export type RelayRequestDomain = "files" | "sessions" | "models" | "extensions" | "system";
export interface RelayRequestFrame {
  op: "request";
  req: number;
  domain: RelayRequestDomain;
  action: string;
  args: Record<string, unknown>;
}
export type RelayResultFrame =
  | { op: "result"; req: number; success: true; data: Record<string, unknown> }
  | { op: "result"; req: number; success: false; error: { code: string; message: string; details?: Record<string, unknown> } };
export type { RelayChunkFrame } from "./chunks";

export type RelayPluginAction = "install" | "remove" | "update" | "disable" | "enable";

export interface RelayHelloFrame {
  op: "hello";
  protocol: typeof RELAY_PROTOCOL_VERSION;
  deviceId?: string;
  token?: string;
  pairingSecret?: string;
  password?: string;
  label?: string;
}

export interface RelayCmdFrame {
  op: "cmd";
  req: number;
  type: RelayAllowedCommand;
  message?: string;
  images?: Array<{ data: string; mimeType: string }>;
  provider?: string;
  modelId?: string;
  level?: string;
}

export type RelayServerFrame =
  | RelayResultFrame
  | {
      op: "hello_ok";
      protocol: typeof RELAY_PROTOCOL_VERSION;
      serverId: string;
      deviceId: string;
      token?: string;
    }
  | { op: "hello_err"; code: string; message: string }
  | { op: "sessions"; sessions: RelaySessionListItem[]; runningIds: string[] }
  | { op: "models"; models: RelayModelOption[] }
  | {
      op: "session.snapshot";
      id: string;
      title?: string;
      cwd?: string;
      leafId?: string | null;
      messages: RelayDisplayMessage[];
      agent: RelayAgentState;
    }
  | { op: "session.err"; id?: string; code: string; message: string }
  | { op: "event"; id: string; payload: Record<string, unknown> }
  | { op: "cmd_ok"; req: number; data: unknown }
  | { op: "cmd_err"; req: number; code: string; message: string }
  | { op: "usage"; data: unknown }
  | { op: "settings"; settings: Record<string, unknown> }
  | { op: "settings_updated"; success: boolean; settings?: Record<string, unknown>; error?: string }
  | { op: "session.created"; id: string; cwd: string }
  | { op: "session.deleted"; id: string }
  | { op: "session.archived"; id: string }
  | { op: "session.renamed"; id: string; name: string }
  | { op: "session.restored"; id: string }
  | { op: "archives"; archives: RelayArchiveItem[] }
  | { op: "projects"; projects: Array<{ path: string; name: string; addedAt?: string }> }
  | { op: "files"; path: string; entries: Array<{ name: string; path: string; dir: boolean }> }
  | {
      op: "file";
      path: string;
      name: string;
      language?: string;
      text?: string;
      truncated?: boolean;
      bytes?: number;
      mime?: string;
      encoding?: "utf8" | "base64";
    }
  | { op: "slash"; commands: Array<{ name: string; requiresArgs: boolean; hint: string }> }
  | {
      op: "worktrees";
      cwd: string;
      projectRoot: string;
      isGit: boolean;
      currentWorktreePath?: string | null;
      worktrees: Array<{ path: string; branch: string | null; isMain: boolean }>;
    }
  | { op: "worktree.added"; path: string; branch: string }
  | { op: "file.written"; path: string; bytes: number }
  | {
      op: "git.status";
      cwd: string;
      isGitRepository: boolean;
      repositoryRoot: string | null;
      files: Array<{ filePath: string; status: string; code: string }>;
    }
  | { op: "git.diff"; path: string; supported: boolean; status?: string; patch?: string; truncated?: boolean }
  | { op: "branches"; id: string; leafId: string | null; branches: RelayBranchItem[] }
  | { op: "session.exported"; id: string; fileName: string; bytes: number; transferId?: string; size?: number; html?: string }
  | { op: "skills"; cwd: string; skills: RelaySkillItem[] }
  | { op: "skill.updated"; filePath: string; disableModelInvocation: boolean }
  | { op: "plugins"; cwd: string; packages: RelayPluginItem[] }
  | { op: "mcp"; inventory: RelayMcpItem[] }
  | { op: "mcp.deleted"; name: string }
  | { op: "mcp.upserted"; name: string }
  | { op: "session.imported"; id: string; cwd: string }
  | { op: "skill.results"; query: string; results: RelaySkillSearchResult[] }
  | { op: "skill.installed"; package: string; scope: string }
  | { op: "agents"; cwd?: string; agents: RelayAgentItem[] }
  | { op: "agent.saved"; name: string; filePath?: string }
  | { op: "agent.deleted"; name: string }
  | { op: "auth.providers"; providers: RelayAuthProvider[] }
  | { op: "files.index"; cwd: string; query: string; matches: RelayFileMatch[] }
  | { op: "project.added"; path: string; name?: string }
  | { op: "project.removed"; path: string }
  | { op: "error"; code: string; message: string };

export interface RelayBranchItem {
  id: string;
  label: string;
  role?: string;
}

export interface RelaySkillItem {
  name: string;
  description: string;
  filePath: string;
  disableModelInvocation: boolean;
  scope?: string;
}

export interface RelayPluginItem {
  source: string;
  scope: string;
  status: string;
  disabled: boolean;
  version?: string;
  counts?: { extensions: number; skills: number; prompts: number; themes: number };
}

export interface RelayMcpItem {
  name: string;
  source: string;
  status: string;
  type?: string;
  enabled?: boolean;
}

export interface RelaySkillSearchResult {
  package: string;
  installs?: string;
  url?: string;
}

export interface RelayAgentItem {
  name: string;
  description: string;
  source: string;
  filePath?: string;
  systemPrompt?: string;
  disabled?: boolean;
}

export interface RelayAuthProvider {
  id: string;
  name: string;
  loggedIn: boolean;
}

export interface RelayFileMatch {
  path: string;
  isDir?: boolean;
}

export interface RelayArchiveItem {
  key: string;
  name?: string;
  id?: string;
  archivedAt?: string;
}

export interface RelayModelOption {
  provider: string;
  id: string;
  name: string;
}

export interface RelaySessionListItem {
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
}

export interface RelayDisplayMessage {
  role: "user" | "assistant" | "custom";
  text: string;
  timestamp?: number;
}

export interface RelayAgentState {
  running: boolean;
  ready: boolean;
  state?: unknown;
}

export interface RelayParseError {
  error: true;
  code: string;
  message: string;
}

const DEVICE_ID_RE = /^d_[A-Za-z0-9_-]{16,64}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{32,128}$/;
const SESSION_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

function isRelayBase64DataChar(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x2b ||
    code === 0x2f
  );
}

function relayBase64DecodedByteLength(data: string): number | null {
  if (!data || data.length % 4 !== 0) return null;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const dataEnd = data.length - padding;
  for (let index = 0; index < dataEnd; index += 1) {
    if (!isRelayBase64DataChar(data.charCodeAt(index))) return null;
  }
  for (let index = dataEnd; index < data.length; index += 1) {
    if (data[index] !== "=") return null;
  }
  return (data.length / 4) * 3 - padding;
}

export function isRelayParseError(value: unknown): value is RelayParseError {
  return isRecord(value) && value.error === true && typeof value.code === "string";
}

export function encodeRelayFrame(frame: RelayServerFrame): string {
  return JSON.stringify(frame);
}

/**
 * Sanitize one model option for the `models` server frame: provider and id are
 * preserved exactly so a `set_model` round-trip matches; entries are dropped
 * only when provider/id are empty or excessively long (> 512 chars). Only the
 * display `name` is capped at RELAY_MAX_MODEL_FIELD_CHARS. Returns null when
 * provider or id is missing/empty after trimming.
 */
export function toRelayModelOption(value: unknown): RelayModelOption | null {
  if (!isRecord(value)) return null;
  const provider = asString(value.provider)?.trim();
  const id = asString(value.id)?.trim();
  if (!provider || !id) return null;
  if (provider.length > 512 || id.length > 512) return null;
  const name = asString(value.name)?.trim() || id;
  const cap = RELAY_MAX_MODEL_FIELD_CHARS;
  return {
    provider,
    id,
    name: name.length > cap ? name.slice(0, cap) : name,
  };
}

/** Build the complete sanitized legacy model catalog. */
export function relayModelsFrame(models: unknown): { op: "models"; models: RelayModelOption[] } {
  const options: RelayModelOption[] = [];
  if (Array.isArray(models)) {
    for (const entry of models) {
      const option = toRelayModelOption(entry);
      if (option) options.push(option);
    }
  }
  return { op: "models", models: options };
}

export function parseClientFrame(raw: string, assembled = false): RelayClientFrame | RelayParseError {
  if (typeof raw !== "string" || raw.length === 0) {
    return { error: true, code: "invalid_json", message: "Empty frame" };
  }
  if (Buffer.byteLength(raw, "utf8") > (assembled ? 16 * 1024 * 1024 : RELAY_MAX_FRAME_BYTES)) {
    return { error: true, code: "frame_too_large", message: "Frame is too large" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { error: true, code: "invalid_json", message: "Frame is not JSON" };
  }
  if (!isRecord(parsed)) {
    return { error: true, code: "invalid_frame", message: "Frame must be a JSON object" };
  }

  const op = asString(parsed.op);
  if (!op) return { error: true, code: "invalid_frame", message: "op is required" };

  switch (op) {
    case "request": {
      const { req, domain, action, args } = parsed;
      if (typeof req !== "number" || !Number.isSafeInteger(req) || req <= 0
        || (domain !== "files" && domain !== "sessions" && domain !== "models" && domain !== "extensions" && domain !== "system")
        || typeof action !== "string" || !/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(action)
        || typeof args !== "object" || args === null || Array.isArray(args)) {
        return { error: true, code: "invalid_request", message: "Invalid request envelope" };
      }
      return { op: "request", req, domain, action, args: args as Record<string, unknown> };
    }
    case "hello":
      return parseHello(parsed);
    case "sessions.list":
      return { op: "sessions.list" };
    case "models.list":
      return { op: "models.list" };
    case "usage":
      return { op: "usage" };
    case "session.open": {
      const id = asString(parsed.id)?.trim();
      if (!id || !SESSION_ID_RE.test(id)) {
        return { error: true, code: "invalid_session", message: "session id is required" };
      }
      return { op: "session.open", id };
    }
    case "session.close":
      return { op: "session.close" };
    case "session.create": {
      const cwd = asString(parsed.cwd)?.trim();
      if (!cwd || cwd.length > 1024) {
        return { error: true, code: "invalid_cwd", message: "cwd is required" };
      }
      const created: Extract<RelayClientFrame, { op: "session.create" }> = { op: "session.create", cwd };
      const message = asString(parsed.message);
      if (message !== undefined) {
        if (message.length > RELAY_MAX_PROMPT_CHARS) {
          return { error: true, code: "invalid_command", message: "prompt message is too long" };
        }
        created.message = message;
      }
      const provider = asString(parsed.provider)?.trim();
      const modelId = asString(parsed.modelId)?.trim();
      if (provider) created.provider = provider.slice(0, 512);
      if (modelId) created.modelId = modelId.slice(0, 512);
      const thinkingLevel = asString(parsed.thinkingLevel)?.trim();
      if (thinkingLevel) created.thinkingLevel = thinkingLevel.slice(0, 32);
      return created;
    }
    case "projects.list":
      return { op: "projects.list" };
    case "files.list": {
      const path = asString(parsed.path)?.trim();
      if (path && path.length > 1024) {
        return { error: true, code: "invalid_path", message: "path is too long" };
      }
      return path ? { op: "files.list", path } : { op: "files.list" };
    }
    case "slash.list":
      return { op: "slash.list" };
    case "files.read": {
      const path = asString(parsed.path)?.trim();
      if (!path || path.length > 1024) {
        return { error: true, code: "invalid_path", message: "path is required" };
      }
      return { op: "files.read", path };
    }
    case "session.delete":
    case "session.archive": {
      const id = asString(parsed.id)?.trim();
      if (!id || !SESSION_ID_RE.test(id)) {
        return { error: true, code: "invalid_session", message: "session id is required" };
      }
      return op === "session.delete" ? { op: "session.delete", id } : { op: "session.archive", id };
    }
    case "session.rename": {
      const id = asString(parsed.id)?.trim();
      const name = asString(parsed.name)?.trim();
      if (!id || !SESSION_ID_RE.test(id)) {
        return { error: true, code: "invalid_session", message: "session id is required" };
      }
      if (!name || name.length > 200) {
        return { error: true, code: "invalid_name", message: "name is required" };
      }
      return { op: "session.rename", id, name };
    }
    case "sessions.archives":
      return { op: "sessions.archives" };
    case "session.restore": {
      const key = asString(parsed.key)?.trim();
      if (!key || key.length > 1024) {
        return { error: true, code: "invalid_key", message: "archive key is required" };
      }
      return { op: "session.restore", key };
    }
    case "worktrees.list": {
      const cwd = asString(parsed.cwd)?.trim();
      if (!cwd || cwd.length > 1024) {
        return { error: true, code: "invalid_cwd", message: "cwd is required" };
      }
      return { op: "worktrees.list", cwd };
    }
    case "worktrees.add": {
      const cwd = asString(parsed.cwd)?.trim();
      const branch = asString(parsed.branch)?.trim();
      if (!cwd || cwd.length > 1024) {
        return { error: true, code: "invalid_cwd", message: "cwd is required" };
      }
      if (!branch || branch.length > 128) {
        return { error: true, code: "invalid_branch", message: "branch is required" };
      }
      return { op: "worktrees.add", cwd, branch };
    }
    case "files.write": {
      const path = asString(parsed.path)?.trim();
      const text = asString(parsed.text);
      if (!path || path.length > 1024) {
        return { error: true, code: "invalid_path", message: "path is required" };
      }
      if (text === undefined) {
        return { error: true, code: "invalid_text", message: "text is required" };
      }
      if (text.length > 80_000) {
        return { error: true, code: "invalid_text", message: "text is too long" };
      }
      return { op: "files.write", path, text,
        ...(typeof parsed.revision === "string" ? { revision: parsed.revision } : {}),
        ...(typeof parsed.baseContentHash === "string" ? { baseContentHash: parsed.baseContentHash } : {}),
        ...(parsed.createIfMissing === true ? { createIfMissing: true } : {}),
      };
    }
    case "git.status": {
      const cwd = asString(parsed.cwd)?.trim();
      if (!cwd || cwd.length > 1024) {
        return { error: true, code: "invalid_cwd", message: "cwd is required" };
      }
      return { op: "git.status", cwd };
    }
    case "git.diff": {
      const cwd = asString(parsed.cwd)?.trim();
      const path = asString(parsed.path)?.trim();
      if (!cwd || cwd.length > 1024) {
        return { error: true, code: "invalid_cwd", message: "cwd is required" };
      }
      if (!path || path.length > 1024) {
        return { error: true, code: "invalid_path", message: "path is required" };
      }
      return { op: "git.diff", cwd, path };
    }
    case "session.branches":
    case "session.export": {
      const id = asString(parsed.id)?.trim();
      if (!id || !SESSION_ID_RE.test(id)) {
        return { error: true, code: "invalid_session", message: "session id is required" };
      }
      return op === "session.branches" ? { op: "session.branches", id } : { op: "session.export", id };
    }
    case "session.leaf": {
      const id = asString(parsed.id)?.trim();
      const leafId = asString(parsed.leafId)?.trim();
      if (!id || !SESSION_ID_RE.test(id)) {
        return { error: true, code: "invalid_session", message: "session id is required" };
      }
      if (!leafId || leafId.length > 200) {
        return { error: true, code: "invalid_leaf", message: "leafId is required" };
      }
      return { op: "session.leaf", id, leafId };
    }
    case "skills.list":
    case "plugins.list": {
      const cwd = asString(parsed.cwd)?.trim();
      if (!cwd || cwd.length > 1024) {
        return { error: true, code: "invalid_cwd", message: "cwd is required" };
      }
      return op === "skills.list" ? { op: "skills.list", cwd } : { op: "plugins.list", cwd };
    }
    case "skills.toggle": {
      const cwd = asString(parsed.cwd)?.trim();
      const filePath = asString(parsed.filePath)?.trim();
      if (!cwd || cwd.length > 1024) {
        return { error: true, code: "invalid_cwd", message: "cwd is required" };
      }
      if (!filePath || filePath.length > 1024) {
        return { error: true, code: "invalid_path", message: "filePath is required" };
      }
      if (typeof parsed.disableModelInvocation !== "boolean") {
        return { error: true, code: "invalid_flag", message: "disableModelInvocation must be a boolean" };
      }
      return { op: "skills.toggle", cwd, filePath, disableModelInvocation: parsed.disableModelInvocation };
    }
    case "plugins.action": {
      const cwd = asString(parsed.cwd)?.trim();
      const action = asString(parsed.action)?.trim();
      if (!cwd || cwd.length > 1024) {
        return { error: true, code: "invalid_cwd", message: "cwd is required" };
      }
      if (action !== "install" && action !== "remove" && action !== "update" && action !== "disable" && action !== "enable") {
        return { error: true, code: "invalid_action", message: "plugin action is required" };
      }
      const source = asString(parsed.source)?.trim();
      if (action !== "update" && (!source || source.length > 512)) {
        return { error: true, code: "invalid_source", message: "source is required" };
      }
      if (source && source.length > 512) {
        return { error: true, code: "invalid_source", message: "source is too long" };
      }
      const scopeRaw = asString(parsed.scope)?.trim();
      const scope = scopeRaw === "project" ? "project" as const : scopeRaw === "global" ? "global" as const : undefined;
      return {
        op: "plugins.action",
        cwd,
        action,
        ...(source ? { source } : {}),
        ...(scope ? { scope } : {}),
      };
    }
    case "mcp.list": {
      const cwd = asString(parsed.cwd)?.trim();
      if (cwd && cwd.length > 1024) {
        return { error: true, code: "invalid_cwd", message: "cwd is too long" };
      }
      return cwd ? { op: "mcp.list", cwd } : { op: "mcp.list" };
    }
    case "mcp.delete": {
      const cwd = asString(parsed.cwd)?.trim();
      const name = asString(parsed.name)?.trim();
      if (!cwd || cwd.length > 1024) {
        return { error: true, code: "invalid_cwd", message: "cwd is required" };
      }
      if (!name || name.length > 128) {
        return { error: true, code: "invalid_name", message: "name is required" };
      }
      return { op: "mcp.delete", cwd, name };
    }
    case "mcp.upsert": {
      const cwd = asString(parsed.cwd)?.trim();
      const name = asString(parsed.name)?.trim();
      const type = asString(parsed.type)?.trim();
      if (!cwd || cwd.length > 1024) {
        return { error: true, code: "invalid_cwd", message: "cwd is required" };
      }
      if (!name || name.length > 128) {
        return { error: true, code: "invalid_name", message: "name is required" };
      }
      if (type !== "stdio" && type !== "http" && type !== "sse") {
        return { error: true, code: "invalid_type", message: "type must be stdio, http, or sse" };
      }
      const command = asString(parsed.command)?.trim();
      const url = asString(parsed.url)?.trim();
      if (command && command.length > 1024) {
        return { error: true, code: "invalid_command", message: "command is too long" };
      }
      if (url && url.length > 1024) {
        return { error: true, code: "invalid_url", message: "url is too long" };
      }
      const upsert: Extract<RelayClientFrame, { op: "mcp.upsert" }> = { op: "mcp.upsert", cwd, name, type };
      if (command) upsert.command = command;
      if (url) upsert.url = url;
      if (Array.isArray(parsed.args)) {
        const args: string[] = [];
        for (const entry of parsed.args) {
          if (typeof entry !== "string") {
            return { error: true, code: "invalid_args", message: "args must be strings" };
          }
          if (entry.length > 256) {
            return { error: true, code: "invalid_args", message: "arg is too long" };
          }
          args.push(entry);
          if (args.length > 16) {
            return { error: true, code: "invalid_args", message: "too many args" };
          }
        }
        if (args.length > 0) upsert.args = args;
      } else if (parsed.args != null) {
        return { error: true, code: "invalid_args", message: "args must be an array" };
      }
      return upsert;
    }
    case "session.import": {
      const fileName = asString(parsed.fileName)?.trim();
      const content = asString(parsed.content);
      if (!fileName || fileName.length > 200 || fileName.includes("/") || fileName.includes("\\")) {
        return { error: true, code: "invalid_file_name", message: "fileName is required" };
      }
      if (content === undefined || !content.trim()) {
        return { error: true, code: "invalid_content", message: "content is required" };
      }
      if (content.length > 180_000) {
        return { error: true, code: "invalid_content", message: "content is too long" };
      }
      return { op: "session.import", fileName, content };
    }
    case "skills.search": {
      const query = asString(parsed.query)?.trim();
      if (!query || query.length > 200) {
        return { error: true, code: "invalid_query", message: "query is required" };
      }
      const rawLimit = parsed.limit;
      if (rawLimit === undefined) return { op: "skills.search", query };
      const limit = asNumber(rawLimit);
      if (limit === undefined || !Number.isInteger(limit) || limit < 1 || limit > 20) {
        return { error: true, code: "invalid_limit", message: "limit must be 1-20" };
      }
      return { op: "skills.search", query, limit };
    }
    case "skills.install": {
      const pkg = asString(parsed.package)?.trim();
      const scope = asString(parsed.scope)?.trim();
      const cwd = asString(parsed.cwd)?.trim();
      if (!pkg || pkg.length > 256) {
        return { error: true, code: "invalid_package", message: "package is required" };
      }
      if (scope !== "global" && scope !== "project") {
        return { error: true, code: "invalid_scope", message: "scope must be global or project" };
      }
      if (cwd && cwd.length > 1024) {
        return { error: true, code: "invalid_cwd", message: "cwd is too long" };
      }
      return {
        op: "skills.install",
        package: pkg,
        scope,
        ...(cwd ? { cwd } : {}),
      };
    }
    case "agents.list": {
      const cwd = asString(parsed.cwd)?.trim();
      if (cwd && cwd.length > 1024) {
        return { error: true, code: "invalid_cwd", message: "cwd is too long" };
      }
      return cwd ? { op: "agents.list", cwd } : { op: "agents.list" };
    }
    case "agents.save": {
      const name = asString(parsed.name)?.trim();
      const description = asString(parsed.description)?.trim();
      const systemPrompt = asString(parsed.systemPrompt);
      const scope = asString(parsed.scope)?.trim();
      const cwd = asString(parsed.cwd)?.trim();
      if (!name || name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
        return { error: true, code: "invalid_name", message: "name must be kebab-case" };
      }
      if (description === undefined || !description || description.length > 500) {
        return { error: true, code: "invalid_description", message: "description is required" };
      }
      if (systemPrompt === undefined || systemPrompt.length > 20_000) {
        return { error: true, code: "invalid_prompt", message: "systemPrompt is required" };
      }
      if (scope !== "user" && scope !== "project") {
        return { error: true, code: "invalid_scope", message: "scope must be user or project" };
      }
      if (cwd && cwd.length > 1024) {
        return { error: true, code: "invalid_cwd", message: "cwd is too long" };
      }
      return {
        op: "agents.save",
        name,
        description,
        systemPrompt,
        scope,
        ...(cwd ? { cwd } : {}),
      };
    }
    case "agents.delete": {
      const name = asString(parsed.name)?.trim();
      const scope = asString(parsed.scope)?.trim();
      const cwd = asString(parsed.cwd)?.trim();
      if (!name || name.length > 64) {
        return { error: true, code: "invalid_name", message: "name is required" };
      }
      if (scope !== "user" && scope !== "project") {
        return { error: true, code: "invalid_scope", message: "scope must be user or project" };
      }
      if (cwd && cwd.length > 1024) {
        return { error: true, code: "invalid_cwd", message: "cwd is too long" };
      }
      return {
        op: "agents.delete",
        name,
        scope,
        ...(cwd ? { cwd } : {}),
      };
    }
    case "auth.providers":
      return { op: "auth.providers" };
    case "files.index": {
      const cwd = asString(parsed.cwd)?.trim();
      const query = asString(parsed.query);
      if (!cwd || cwd.length > 1024) {
        return { error: true, code: "invalid_cwd", message: "cwd is required" };
      }
      if (query === undefined || query.length > 100) {
        return { error: true, code: "invalid_query", message: "query is required" };
      }
      return { op: "files.index", cwd, query };
    }
    case "projects.add":
    case "projects.remove": {
      const cwd = asString(parsed.cwd)?.trim();
      if (!cwd || cwd.length > 1024) {
        return { error: true, code: "invalid_cwd", message: "cwd is required" };
      }
      return op === "projects.add" ? { op: "projects.add", cwd } : { op: "projects.remove", cwd };
    }
    case "settings.get":
      return { op: "settings.get" };
    case "settings.update": {
      if (!isRecord(parsed.settings)) {
        return { error: true, code: "invalid_settings", message: "settings must be an object" };
      }
      return { op: "settings.update", settings: parsed.settings as Record<string, unknown> };
    }
    case "cmd":
      return parseCmd(parsed);
    default:
      return { error: true, code: "unknown_op", message: `Unknown op: ${op}` };
  }
}

function parseHello(parsed: Record<string, unknown>): RelayHelloFrame | RelayParseError {
  const protocol = asNumber(parsed.protocol);
  if (protocol !== RELAY_PROTOCOL_VERSION) {
    return { error: true, code: "protocol", message: "Unsupported relay protocol" };
  }

  const hello: RelayHelloFrame = { op: "hello", protocol: RELAY_PROTOCOL_VERSION };
  const pairingSecret = asString(parsed.pairingSecret)?.trim();
  const deviceId = asString(parsed.deviceId)?.trim();
  const token = asString(parsed.token)?.trim();
  const password = asString(parsed.password);
  const label = asString(parsed.label)?.trim();

  if (pairingSecret) {
    if (!SECRET_RE.test(pairingSecret)) {
      return { error: true, code: "unauthorized", message: "Invalid pairing secret" };
    }
    hello.pairingSecret = pairingSecret;
  } else if (deviceId && token) {
    if (!DEVICE_ID_RE.test(deviceId) || !SECRET_RE.test(token)) {
      return { error: true, code: "unauthorized", message: "Invalid device credentials" };
    }
    hello.deviceId = deviceId;
    hello.token = token;
  } else {
    return { error: true, code: "unauthorized", message: "Pairing secret or device token is required" };
  }

  if (password !== undefined) hello.password = password;
  if (label) hello.label = label.slice(0, RELAY_MAX_LABEL_CHARS);
  return hello;
}

function parseCmd(parsed: Record<string, unknown>): RelayCmdFrame | RelayParseError {
  const req = asNumber(parsed.req);
  if (req === undefined || !Number.isInteger(req) || req < 1 || req > 2_147_483_647) {
    return { error: true, code: "invalid_req", message: "cmd.req must be a positive integer" };
  }
  const type = asString(parsed.type)?.trim();
  if (!type || !ALLOWED_COMMAND_SET.has(type)) {
    return { error: true, code: "unsupported_command", message: "Command is not allowed on the relay" };
  }

  const cmd: RelayCmdFrame = { op: "cmd", req, type: type as RelayAllowedCommand };
  if (type === "prompt") {
    const message = asString(parsed.message);
    if (message === undefined) {
      return { error: true, code: "invalid_command", message: "prompt message is required" };
    }
    if (message.length > RELAY_MAX_PROMPT_CHARS) {
      return { error: true, code: "invalid_command", message: "prompt message is too long" };
    }
    if ("images" in parsed && parsed.images != null) {
      const rawImages = parsed.images;
      if (!Array.isArray(rawImages)) {
        return { error: true, code: "invalid_command", message: "images must be an array" };
      }
      const images: Array<{ data: string; mimeType: string }> = [];
      for (const entry of rawImages) {
        if (!isRecord(entry)) {
          return { error: true, code: "invalid_command", message: "Each image must have data and mimeType" };
        }
        const data = asString(entry.data);
        const mimeType = asString(entry.mimeType)?.trim();
        if (!data || !mimeType) {
          return { error: true, code: "invalid_command", message: "Each image must have data and mimeType" };
        }
        if (!mimeType.startsWith("image/")) {
          return { error: true, code: "invalid_command", message: "Each image mimeType must be an image type" };
        }
        const bytes = relayBase64DecodedByteLength(data);
        if (bytes === null || bytes === 0) {
          return { error: true, code: "invalid_command", message: "Each image must be valid base64 data" };
        }
        if (bytes > RELAY_MAX_IMAGE_BYTES) {
          return { error: true, code: "invalid_command", message: "Each image must be 4MB or smaller" };
        }
        images.push({ data, mimeType });
      }
      if (images.length > 0) cmd.images = images;
    }
    cmd.message = message;
  }
  if (type === "set_model") {
    const provider = asString(parsed.provider)?.trim();
    const modelId = asString(parsed.modelId)?.trim();
    if (!provider || !modelId) {
      return { error: true, code: "invalid_command", message: "set_model requires provider and modelId" };
    }
    cmd.provider = provider;
    cmd.modelId = modelId;
  }
  if (type === "set_thinking_level") {
    const level = asString(parsed.level)?.trim();
    if (!level) {
      return { error: true, code: "invalid_command", message: "set_thinking_level requires level" };
    }
    cmd.level = level.slice(0, 32);
  }
  return cmd;
}

export function commandFromRelayCmd(frame: RelayCmdFrame): Record<string, unknown> {
  switch (frame.type) {
    case "prompt":
      return { type: "prompt", message: frame.message ?? "", ...(frame.images ? { images: frame.images } : {}) };
    case "abort":
      return { type: "abort" };
    case "get_state":
      return { type: "get_state" };
    case "set_model":
      return { type: "set_model", provider: frame.provider, modelId: frame.modelId };
    case "set_thinking_level":
      return { type: "set_thinking_level", level: frame.level };
    case "compact":
      return { type: "compact" };
    case "get_subagents":
      return { type: "get_subagents" };
    case "get_available_commands":
      return { type: "get_available_commands" };
  }
}
