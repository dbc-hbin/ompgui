import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { authenticateDeviceToken } from "./relay/registry";

export const OMPGUI_DEVICE_COOKIE = "ompgui_device";
export const OMPGUI_WEB_ACCESS_HEADER = "x-ompgui-web-access";
export const OMPGUI_SESSION_COOKIE = "ompgui_session";
export const OMP_WEB_SESSION_COOKIE = "omp_web_session";
export const OMP_WEB_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function readWebCookie(header: string | null | undefined, name: string): string | undefined {
  let value: string | undefined;
  for (const part of header?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (part.slice(0, separator).trim() !== name) continue;
    if (value !== undefined) return ""; // Duplicate credentials are ambiguous.
    value = part.slice(separator + 1).trim();
  }
  return value;
}

export function getWebDeviceId(cookie: string | undefined): string | null {
  const match = /^((?:d_)[A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(cookie ?? "");
  return match ? authenticateDeviceToken(match[1], match[2], Date.now(), false)?.deviceId ?? null : null;
}

/** Internal admission proof; raw HTTP replaces client headers before Next runs. */
export function getWebRequestAccess(request: Request): "local" | "device" | null {
  const nonce = process.env.__OMPGUI_WEB_ACCESS_NONCE;
  const proof = request.headers.get(OMPGUI_WEB_ACCESS_HEADER);
  if (!nonce || !proof) return null;
  if (equal(proof, `local.${nonce}`)) return "local";
  if (equal(proof, `device.${nonce}`)) return "device";
  return null;
}

export function isWebRequestAuthorized(request: Request): boolean {
  const access = getWebRequestAccess(request);
  if (!access) return false; // Includes requests queued before instrumentation attached.
  const cookies = request.headers.get("cookie");
  const device = readWebCookie(cookies, OMPGUI_DEVICE_COOKIE);
  if (access === "device" || device !== undefined) return getWebDeviceId(device) !== null;
  return !isWebPasswordEnabled() || isValidWebSession(
    readWebCookie(cookies, OMPGUI_SESSION_COOKIE) ?? readWebCookie(cookies, OMP_WEB_SESSION_COOKIE),
  );
}

function hash(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function equal(left: string, right: string): boolean {
  return timingSafeEqual(hash(left), hash(right));
}

export function isWebPasswordEnabled(password: string | undefined = process.env.OMPGUI_PASSWORD ?? process.env.OMP_WEB_PASSWORD): password is string {
  return typeof password === "string" && password.length > 0;
}

export function isValidWebPassword(candidate: string, password = process.env.OMPGUI_PASSWORD ?? process.env.OMP_WEB_PASSWORD): boolean {
  return isWebPasswordEnabled(password) && equal(candidate, password);
}

export function createWebSession(password: string, now = Date.now()): string {
  const expiresAt = now + OMP_WEB_SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `v1.${expiresAt}.${randomBytes(16).toString("base64url")}`;
  const signature = createHmac("sha256", password).update(payload, "utf8").digest("base64url");
  return `${payload}.${signature}`;
}

export function isValidWebSession(session: string | undefined, password = process.env.OMPGUI_PASSWORD ?? process.env.OMP_WEB_PASSWORD, now = Date.now()): boolean {
  if (!isWebPasswordEnabled(password) || !session) return false;
  const match = /^v1\.(\d{13})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(session);
  if (!match) return false;

  const expiresAt = Number(match[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;
  const payload = session.slice(0, session.lastIndexOf("."));
  const expected = createHmac("sha256", password).update(payload, "utf8").digest("base64url");
  return equal(match[3], expected);
}
