import { isRecord } from "./type-guards";
import type { AgentMessage, AssistantMessage, CustomMessage, UserMessage } from "./types";

/** Schema version for the bounded, display-only remote session replica. */
export const REMOTE_REPLICA_VERSION = 1 as const;
/** The replica never retains more than the newest 50 safe display messages. */
export const REMOTE_REPLICA_MAX_MESSAGES = 50;
/** Bound each copied text value so a single transcript entry cannot fill storage. */
export const REMOTE_REPLICA_MAX_TEXT_CHARS = 4_000;
const REMOTE_REPLICA_MAX_ID_CHARS = 256;
const REMOTE_REPLICA_MAX_ORIGIN_CHARS = 512;
const REMOTE_REPLICA_STORAGE_PREFIX = "ompgui:remote-replica:v1:";

/**
 * The only message roles that are copied into the replica. Tool/process and
 * system-slot roles are intentionally excluded: even their text can contain
 * command output, filesystem contents, credentials, or other runtime data.
 */
export const REMOTE_REPLICA_DISPLAY_ROLES = ["user", "assistant", "custom"] as const;
export type RemoteReplicaDisplayRole = (typeof REMOTE_REPLICA_DISPLAY_ROLES)[number];

// session-reader folds these upstream roles into `custom` for the live UI.
// Keep their generated code/output/path text out of the offline replica too.
const UNSAFE_CUSTOM_TYPE: Record<string, true> = {
  developer: true,
  "python-execution": true,
  "file-mention": true,
  "xdev-mount-notice": true,
};

/** A text-only message suitable for rendering without runtime authority. */
export interface RemoteReplicaMessage {
  role: RemoteReplicaDisplayRole;
  text: string;
  timestamp?: number;
}

export interface RemoteReplicaSession {
  id: string;
  title?: string;
  cwd?: string;
  leafId?: string;
  messages: RemoteReplicaMessage[];
}

/** Schema v1 persisted by the browser/native adapter. */
export interface RemoteReplicaSnapshot {
  version: typeof REMOTE_REPLICA_VERSION;
  origin: string;
  updatedAt: number;
  session: RemoteReplicaSession;
}

export interface RemoteReplicaSessionInput {
  id: string;
  /** `title` is the public snapshot spelling; `name` accepts SessionInfo. */
  title?: string;
  name?: string;
  cwd?: string;
}

export interface RemoteReplicaProjectInput {
  origin: string;
  session: RemoteReplicaSessionInput;
  leafId?: string | null;
  messages: readonly AgentMessage[];
  updatedAt?: number;
}

/** Native bridge exposed by the Android shell when it is present. */
export interface OmpguiRemoteReplicaBridge {
  storeSnapshot(json: string): void;
  getSnapshot?: () => string | null;
  getOrigin?: () => string | null;
  setOrigin?: (origin: string) => boolean;
}

declare global {
  interface Window {
    OmpguiRemoteReplica?: OmpguiRemoteReplicaBridge;
  }
}

function boundedString(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.slice(0, maxChars);
}

function boundedIdentifier(value: unknown): string | undefined {
  return boundedString(value, REMOTE_REPLICA_MAX_ID_CHARS);
}

/**
 * Keep origins stable for storage keys while refusing an origin that embeds
 * credentials. Arbitrary non-empty strings remain accepted for pure projector
 * callers/tests; browser location origins are normal URLs in production.
 */
export function normalizeRemoteReplicaOrigin(value: unknown): string | null {
  const origin = boundedString(value, REMOTE_REPLICA_MAX_ORIGIN_CHARS);
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    if (parsed.username || parsed.password || parsed.origin === "null") return null;
    return parsed.origin;
  } catch {
    return origin;
  }
}

function cleanDisplayText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Keep line breaks/tabs (they are renderable), but remove control bytes that
  // can make a text-only cached view behave like a terminal or corrupt JSON.
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!text) return undefined;
  return text.slice(0, REMOTE_REPLICA_MAX_TEXT_CHARS);
}

function textFromContent(content: unknown): string | undefined {
  if (typeof content === "string") return cleanDisplayText(content);
  if (!Array.isArray(content)) return undefined;
  const textBlocks: string[] = [];
  for (const block of content) {
    if (!isRecord(block) || block.type !== "text") continue;
    const text = cleanDisplayText(block.text);
    if (text) textBlocks.push(text);
  }
  return cleanDisplayText(textBlocks.join("\n"));
}

function projectMessage(message: AgentMessage): RemoteReplicaMessage | null {
  let text: string | undefined;
  switch (message.role) {
    case "user":
      text = textFromContent((message as UserMessage).content);
      break;
    case "assistant":
      // Only assistant text blocks survive. Thinking, images, and tool calls
      // are deliberately not represented by placeholders or metadata.
      text = textFromContent((message as AssistantMessage).content);
      break;
    case "custom": {
      const custom = message as CustomMessage;
      // Hidden custom entries and session-reader's folded system/tool entries
      // are not safe to replay as cached text.
      if (!custom.display || UNSAFE_CUSTOM_TYPE[custom.customType] === true) return null;
      text = textFromContent(custom.content);
      break;
    }
    default:
      // toolResult, bashExecution, pythonExecution, developer, and
      // fileMention can all contain tool output, filesystem data, or system
      // instructions. The replica is display-only and excludes them wholly.
      return null;
  }
  if (!text) return null;
  const timestamp = typeof message.timestamp === "number" && Number.isFinite(message.timestamp)
    ? message.timestamp
    : undefined;
  return timestamp === undefined ? { role: message.role, text } : { role: message.role, text, timestamp };
}

function cleanSessionField(value: unknown): string | undefined {
  return boundedString(value, REMOTE_REPLICA_MAX_TEXT_CHARS);
}

/**
 * Project a live transcript into the intentionally narrow schema used by the
 * Android/browser replica. This function has no side effects and copies no
 * object from an AgentMessage, so omitted runtime fields cannot leak through.
 */
export function projectRemoteReplica(input: RemoteReplicaProjectInput): RemoteReplicaSnapshot | null {
  const origin = normalizeRemoteReplicaOrigin(input.origin);
  const id = boundedIdentifier(input.session.id);
  if (!origin || !id) return null;

  const projectedMessages = input.messages
    .map(projectMessage)
    .filter((message): message is RemoteReplicaMessage => message !== null)
    .slice(-REMOTE_REPLICA_MAX_MESSAGES);

  const title = cleanSessionField(input.session.title ?? input.session.name);
  const cwd = cleanSessionField(input.session.cwd);
  const leafId = boundedIdentifier(input.leafId);
  const updatedAt = typeof input.updatedAt === "number" && Number.isFinite(input.updatedAt)
    ? input.updatedAt
    : Date.now();
  const session: RemoteReplicaSession = { id, messages: projectedMessages };
  if (title !== undefined) session.title = title;
  if (cwd !== undefined) session.cwd = cwd;
  if (leafId !== undefined) session.leafId = leafId;
  return { version: REMOTE_REPLICA_VERSION, origin, updatedAt, session };
}

function parseMessage(value: unknown): RemoteReplicaMessage | null {
  if (!isRecord(value)) return null;
  const role = value.role;
  if (!REMOTE_REPLICA_DISPLAY_ROLES.includes(role as RemoteReplicaDisplayRole)) return null;
  const text = cleanDisplayText(value.text);
  if (!text) return null;
  const timestamp = typeof value.timestamp === "number" && Number.isFinite(value.timestamp)
    ? value.timestamp
    : undefined;
  return timestamp === undefined
    ? { role: role as RemoteReplicaDisplayRole, text }
    : { role: role as RemoteReplicaDisplayRole, text, timestamp };
}

/**
 * Validate and strip a parsed value before it can be handed to a renderer.
 * This also makes old/foreign localStorage values harmless and preserves the
 * same bounds as fresh projections.
 */
export function parseRemoteReplicaSnapshot(value: unknown): RemoteReplicaSnapshot | null {
  if (!isRecord(value) || value.version !== REMOTE_REPLICA_VERSION) return null;
  const origin = normalizeRemoteReplicaOrigin(value.origin);
  if (!origin || typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt)) return null;
  if (!isRecord(value.session)) return null;
  const id = boundedIdentifier(value.session.id);
  if (!id || !Array.isArray(value.session.messages)) return null;
  const messages = value.session.messages
    .map(parseMessage)
    .filter((message): message is RemoteReplicaMessage => message !== null)
    .slice(-REMOTE_REPLICA_MAX_MESSAGES);
  const session: RemoteReplicaSession = { id, messages };
  const title = cleanSessionField(value.session.title);
  const cwd = cleanSessionField(value.session.cwd);
  const leafId = boundedIdentifier(value.session.leafId);
  if (title !== undefined) session.title = title;
  if (cwd !== undefined) session.cwd = cwd;
  if (leafId !== undefined) session.leafId = leafId;
  return { version: REMOTE_REPLICA_VERSION, origin, updatedAt: value.updatedAt, session };
}

/** Parse a JSON payload while keeping malformed/native data best-effort. */
export function parseRemoteReplicaJson(json: unknown): RemoteReplicaSnapshot | null {
  if (typeof json !== "string" || json.length === 0) return null;
  try {
    return parseRemoteReplicaSnapshot(JSON.parse(json) as unknown);
  } catch {
    return null;
  }
}

/** Serialize only the normalized safe schema; unsafe extra fields are dropped. */
export function serializeRemoteReplicaSnapshot(snapshot: RemoteReplicaSnapshot): string | null {
  const safe = parseRemoteReplicaSnapshot(snapshot);
  if (!safe) return null;
  try {
    return JSON.stringify(safe);
  } catch {
    return null;
  }
}

/** Resolve the current origin, preferring the native configured remote origin. */
export function getRemoteReplicaOrigin(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const nativeOrigin = window.OmpguiRemoteReplica?.getOrigin?.();
    const normalizedNativeOrigin = normalizeRemoteReplicaOrigin(nativeOrigin);
    if (normalizedNativeOrigin) return normalizedNativeOrigin;
    return normalizeRemoteReplicaOrigin(window.location.origin);
  } catch {
    return normalizeRemoteReplicaOrigin(window.location.origin);
  }
}

function storageKey(origin: string, sessionId: string): string {
  return `${REMOTE_REPLICA_STORAGE_PREFIX}${encodeURIComponent(origin)}:${encodeURIComponent(sessionId)}`;
}

/**
 * Persist a safe snapshot to both browser and native storage when available.
 * Each sink is isolated so a quota/bridge failure cannot affect live chat.
 */
export function persistRemoteReplicaSnapshot(snapshot: RemoteReplicaSnapshot): boolean {
  if (typeof window === "undefined") return false;
  const safe = parseRemoteReplicaSnapshot(snapshot);
  if (!safe) return false;
  const json = serializeRemoteReplicaSnapshot(safe);
  if (!json) return false;
  let persisted = false;
  try {
    window.localStorage.setItem(storageKey(safe.origin, safe.session.id), json);
    persisted = true;
  } catch {
    // localStorage unavailable or full — keep the live path unaffected.
  }
  try {
    const bridge = window.OmpguiRemoteReplica;
    if (bridge) {
      bridge.storeSnapshot(json);
      persisted = true;
    }
  } catch {
    // Native persistence is optional and must never break the web client.
  }
  return persisted;
}

/**
 * Read a sanitized replica tail for first paint. The result is never an
 * AgentMessage list: callers must keep it in a separate preview slot.
 */
export function loadRemoteReplicaSnapshot(
  sessionId: string,
  origin: string | null = getRemoteReplicaOrigin(),
): RemoteReplicaSnapshot | null {
  if (typeof window === "undefined") return null;
  const id = boundedIdentifier(sessionId);
  const normalizedOrigin = normalizeRemoteReplicaOrigin(origin);
  if (!id || !normalizedOrigin) return null;

  let parsed: RemoteReplicaSnapshot | null = null;
  try {
    parsed = parseRemoteReplicaJson(window.localStorage.getItem(storageKey(normalizedOrigin, id)));
  } catch {
    parsed = null;
  }
  if (!parsed) {
    try {
      parsed = parseRemoteReplicaJson(window.OmpguiRemoteReplica?.getSnapshot?.() ?? null);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || parsed.origin !== normalizedOrigin || parsed.session.id !== id) return null;
  return parsed;
}
