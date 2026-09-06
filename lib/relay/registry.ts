import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { getAgentDir } from "../omp/paths";
import { isRecord } from "../type-guards";
import { RELAY_MAX_LABEL_CHARS } from "./protocol";

export const RELAY_REGISTRY_FILENAME = "ompgui-relay.json";
export const RELAY_PAIRING_TTL_MS = 10 * 60 * 1000;
export const RELAY_MAX_DEVICES = 16;

export interface RelayDeviceRecord {
  id: string;
  label: string;
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface RelayPairingRecord {
  secretHash: string;
  expiresAt: number;
  relayUrl: string;
  createdAt: string;
}

export interface RelayRegistryFile {
  version: 1;
  serverId: string;
  relayUrl?: string;
  devices: RelayDeviceRecord[];
  pairing: RelayPairingRecord | null;
}

export interface RelayDevicePublic {
  id: string;
  label: string;
  createdAt: string;
  lastSeenAt: string;
}

const LOCK_TIMEOUT_MS = 3_000;
const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 25;

function sleepSync(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

function hashSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  if (a.length !== 32 || b.length !== 32) return false;
  return timingSafeEqual(a, b);
}

function randomId(prefix: string, bytes = 16): string {
  return `${prefix}${randomBytes(bytes).toString("base64url")}`;
}

function randomSecret(): string {
  return randomBytes(32).toString("base64url");
}

function sanitizeLabel(value: string | undefined): string {
  const cleaned = (value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned.slice(0, RELAY_MAX_LABEL_CHARS);
}

export function relayRegistryPath(): string {
  return resolve(getAgentDir(), RELAY_REGISTRY_FILENAME);
}

export function parseRelayRegistry(raw: string): RelayRegistryFile {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1) return emptyRegistry();
    const serverId = typeof parsed.serverId === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(parsed.serverId)
      ? parsed.serverId
      : randomId("s_");
    const devices: RelayDeviceRecord[] = [];
    if (Array.isArray(parsed.devices)) {
      for (const item of parsed.devices) {
        if (!isRecord(item)) continue;
        if (typeof item.id !== "string" || !item.id.startsWith("d_")) continue;
        if (typeof item.tokenHash !== "string" || item.tokenHash.length !== 64) continue;
        devices.push({
          id: item.id,
          label: sanitizeLabel(typeof item.label === "string" ? item.label : ""),
          tokenHash: item.tokenHash,
          createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date(0).toISOString(),
          lastSeenAt: typeof item.lastSeenAt === "string" ? item.lastSeenAt : new Date(0).toISOString(),
        });
      }
    }
    let pairing: RelayPairingRecord | null = null;
    if (isRecord(parsed.pairing)) {
      const secretHash = typeof parsed.pairing.secretHash === "string" ? parsed.pairing.secretHash : "";
      const expiresAt = typeof parsed.pairing.expiresAt === "number" ? parsed.pairing.expiresAt : 0;
      const relayUrl = typeof parsed.pairing.relayUrl === "string" ? parsed.pairing.relayUrl : "";
      const createdAt = typeof parsed.pairing.createdAt === "string" ? parsed.pairing.createdAt : new Date(0).toISOString();
      if (secretHash.length === 64 && expiresAt > 0 && relayUrl) {
        pairing = { secretHash, expiresAt, relayUrl, createdAt };
      }
    }
    const relayUrl = typeof parsed.relayUrl === "string" ? parsed.relayUrl : undefined;
    return { version: 1, serverId, ...(relayUrl ? { relayUrl } : {}), devices, pairing };
  } catch {
    return emptyRegistry();
  }
}

function emptyRegistry(): RelayRegistryFile {
  return { version: 1, serverId: randomId("s_"), devices: [], pairing: null };
}

function withRegistryLock<T>(fn: () => T): T {
  const registryPath = relayRegistryPath();
  const lockPath = `${registryPath}.lock`;
  mkdirSync(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    let fd: number | null = null;
    try {
      fd = openSync(lockPath, "wx");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for the ompgui relay device registry lock");
      }
      sleepSync(LOCK_RETRY_MS);
      continue;
    }
    try {
      writeSync(fd, String(process.pid));
    } finally {
      closeSync(fd);
    }
    try {
      return fn();
    } finally {
      try { unlinkSync(lockPath); } catch { /* already gone */ }
    }
  }
}

function readRegistryUnlocked(): RelayRegistryFile {
  const path = relayRegistryPath();
  if (!existsSync(path)) {
    const registry = emptyRegistry();
    saveRegistryUnlocked(registry);
    return registry;
  }
  try {
    return parseRelayRegistry(readFileSync(path, "utf8"));
  } catch {
    return emptyRegistry();
  }
}

function saveRegistryUnlocked(registry: RelayRegistryFile): void {
  const path = relayRegistryPath();
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temp, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    renameSync(temp, path);
  } catch (error) {
    try { if (existsSync(temp)) unlinkSync(temp); } catch { /* ignore */ }
    throw error;
  }
}

export function loadRelayRegistry(): RelayRegistryFile {
  return withRegistryLock(() => readRegistryUnlocked());
}

export function createPairingOffer(options: {
  relayUrl: string;
  ttlMs?: number;
  now?: number;
}): { secret: string; serverId: string; expiresAt: number; relayUrl: string } {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? RELAY_PAIRING_TTL_MS;
  const secret = randomSecret();
  return withRegistryLock(() => {
    const registry = readRegistryUnlocked();
    registry.relayUrl = options.relayUrl;
    registry.pairing = {
      secretHash: hashSecret(secret),
      expiresAt: now + ttlMs,
      relayUrl: options.relayUrl,
      createdAt: new Date(now).toISOString(),
    };
    saveRegistryUnlocked(registry);
    return {
      secret,
      serverId: registry.serverId,
      expiresAt: registry.pairing.expiresAt,
      relayUrl: options.relayUrl,
    };
  });
}

export function listRelayDevices(): RelayDevicePublic[] {
  const registry = loadRelayRegistry();
  return registry.devices.map(({ id, label, createdAt, lastSeenAt }) => ({
    id, label, createdAt, lastSeenAt,
  }));
}

export function revokeRelayDevice(deviceId: string): boolean {
  return withRegistryLock(() => {
    const registry = readRegistryUnlocked();
    const next = registry.devices.filter((device) => device.id !== deviceId);
    if (next.length === registry.devices.length) return false;
    registry.devices = next;
    saveRegistryUnlocked(registry);
    return true;
  });
}

export function getRelayPairingStatus(now = Date.now()): {
  serverId: string;
  relayUrl?: string;
  pairingExpiresAt: number | null;
  deviceCount: number;
} {
  const registry = loadRelayRegistry();
  const pairing = registry.pairing && registry.pairing.expiresAt > now ? registry.pairing : null;
  return {
    serverId: registry.serverId,
    ...(registry.relayUrl ? { relayUrl: registry.relayUrl } : {}),
    pairingExpiresAt: pairing?.expiresAt ?? null,
    deviceCount: registry.devices.length,
  };
}

export function authenticateDeviceToken(deviceId: string, token: string, now = Date.now()): {
  serverId: string;
  deviceId: string;
} | null {
  return withRegistryLock(() => {
    const registry = readRegistryUnlocked();
    const device = registry.devices.find((item) => item.id === deviceId);
    if (!device || !hashesEqual(device.tokenHash, hashSecret(token))) return null;
    device.lastSeenAt = new Date(now).toISOString();
    saveRegistryUnlocked(registry);
    return { serverId: registry.serverId, deviceId: device.id };
  });
}

export type RelayPairingConsumeResult =
  | { serverId: string; deviceId: string; token: string }
  | { error: "expired" | "invalid" | "device_limit" };

export function consumePairingSecret(secret: string, label: string | undefined, now = Date.now()): RelayPairingConsumeResult {
  return withRegistryLock(() => {
    const registry = readRegistryUnlocked();
    const pairing = registry.pairing;
    if (!pairing) return { error: "invalid" };
    if (pairing.expiresAt <= now) {
      registry.pairing = null;
      saveRegistryUnlocked(registry);
      return { error: "expired" };
    }
    if (!hashesEqual(pairing.secretHash, hashSecret(secret))) return { error: "invalid" };
    if (registry.devices.length >= RELAY_MAX_DEVICES) return { error: "device_limit" };

    const token = randomSecret();
    const device: RelayDeviceRecord = {
      id: randomId("d_"),
      label: sanitizeLabel(label) || "Phone",
      tokenHash: hashSecret(token),
      createdAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
    };
    registry.devices = [...registry.devices, device];
    registry.pairing = null;
    saveRegistryUnlocked(registry);
    return { serverId: registry.serverId, deviceId: device.id, token };
  });
}

