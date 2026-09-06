import { execFileSync } from "node:child_process";
import { isIP } from "node:net";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (LOOPBACK_HOSTS.has(host) || LOOPBACK_HOSTS.has(hostname.trim().toLowerCase())) return true;
  const ipVersion = isIP(host);
  if (ipVersion === 4) return host.startsWith("127.");
  if (ipVersion === 6) return host === "::1";
  return false;
}

/**
 * Normalize a user-supplied relay URL to `wss://host/relay` (or `ws://` on
 * loopback for local tests). Credentials, extra paths, and query strings are
 * rejected so a pairing QR cannot point at an unexpected endpoint.
 */
export function normalizeRelayUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 512 || trimmed.includes("\\")) return null;
  let candidate = trimmed;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) candidate = `wss://${candidate}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol !== "wss:" && url.protocol !== "ws:") return null;
  if (url.protocol === "ws:" && !isLoopbackHost(url.hostname)) return null;
  if (url.pathname === "" || url.pathname === "/") url.pathname = "/relay";
  if (url.pathname !== "/relay") return null;
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function runTailscaleJson(args: string[]): unknown | null {
  try {
    const output = execFileSync("tailscale", args, {
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(output) as unknown;
  } catch {
    return null;
  }
}

function dnsNameFromStatus(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const self = "Self" in value ? value.Self : undefined;
  if (!self || typeof self !== "object" || Array.isArray(self)) return null;
  const dnsName = "DNSName" in self && typeof self.DNSName === "string" ? self.DNSName.trim() : "";
  if (!dnsName) return null;
  return dnsName.replace(/\.$/, "").toLowerCase();
}

/**
 * Best-effort Funnel / MagicDNS URL for this Mac. Returns null when Tailscale
 * is missing or has no DNS name — callers must not silently fall back to
 * loopback because a phone cannot reach 127.0.0.1 on the Mac.
 */
export function detectTailscaleRelayUrl(): string | null {
  const status = runTailscaleJson(["status", "--json"]);
  const dnsName = dnsNameFromStatus(status);
  if (!dnsName || dnsName.includes("/") || dnsName.includes(":")) return null;
  return normalizeRelayUrl(`wss://${dnsName}/relay`);
}

export function resolveRelayUrl(explicit?: string | null): string | null {
  if (explicit) return normalizeRelayUrl(explicit);
  const fromEnv = process.env.OMPGUI_RELAY_URL ?? process.env.OMP_WEB_RELAY_URL;
  if (fromEnv) return normalizeRelayUrl(fromEnv);
  return detectTailscaleRelayUrl();
}
