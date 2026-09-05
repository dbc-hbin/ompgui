import { asNumber, asString, isRecord } from "../type-guards";

export const RELAY_PROTOCOL_VERSION = 1 as const;
export const RELAY_MAX_FRAME_BYTES = 256 * 1024;
export const RELAY_MAX_PROMPT_CHARS = 32_000;
export const RELAY_MAX_LABEL_CHARS = 64;
export const RELAY_HELLO_TIMEOUT_MS = 10_000;
export const RELAY_MAX_MODELS = 80;
export const RELAY_MAX_MODEL_FIELD_CHARS = 128;
export const RELAY_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const RELAY_ALLOWED_COMMANDS = ["prompt", "abort", "get_state", "set_model"] as const;

export type RelayAllowedCommand = (typeof RELAY_ALLOWED_COMMANDS)[number];

const ALLOWED_COMMAND_SET = new Set<string>(RELAY_ALLOWED_COMMANDS);

export type RelayClientFrame =
  | RelayHelloFrame
  | { op: "sessions.list" }
  | { op: "models.list" }
  | { op: "usage" }
  | { op: "session.open"; id: string }
  | { op: "session.close" }
  | { op: "settings.get" }
  | { op: "settings.update"; settings: Record<string, unknown> }
  | RelayCmdFrame;

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
}

export type RelayServerFrame =
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
  | { op: "error"; code: string; message: string };

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

/** Build the `models` server frame: sanitized, capped at RELAY_MAX_MODELS. */
export function relayModelsFrame(models: unknown): { op: "models"; models: RelayModelOption[] } {
  const options: RelayModelOption[] = [];
  if (Array.isArray(models)) {
    for (const entry of models) {
      if (options.length >= RELAY_MAX_MODELS) break;
      const option = toRelayModelOption(entry);
      if (option) options.push(option);
    }
  }
  return { op: "models", models: options };
}

export function parseClientFrame(raw: string): RelayClientFrame | RelayParseError {
  if (typeof raw !== "string" || raw.length === 0) {
    return { error: true, code: "invalid_json", message: "Empty frame" };
  }
  if (Buffer.byteLength(raw, "utf8") > RELAY_MAX_FRAME_BYTES) {
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
  }
}
