import { asString } from "../type-guards";

export const RELAY_PAIRING_SCHEME = "ompgui";
export const RELAY_PAIRING_HOST = "pair";

export interface RelayPairingOfferUri {
  version: 1;
  url: string;
  serverId: string;
  secret: string;
}

function isSafeToken(value: string, max = 128): boolean {
  return /^[A-Za-z0-9._~-]+$/.test(value) && value.length > 0 && value.length <= max;
}

/** Build `ompgui://pair#v=1&url=...&sid=...&secret=...` (fragment, not query). */
export function buildPairingUri(offer: RelayPairingOfferUri): string {
  const params = new URLSearchParams({
    v: "1",
    url: offer.url,
    sid: offer.serverId,
    secret: offer.secret,
  });
  return `${RELAY_PAIRING_SCHEME}://${RELAY_PAIRING_HOST}#${params.toString()}`;
}

export function parsePairingUri(input: string): RelayPairingOfferUri | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== `${RELAY_PAIRING_SCHEME}:`) return null;
  if (url.host !== RELAY_PAIRING_HOST && url.hostname !== RELAY_PAIRING_HOST) return null;
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  if (params.get("v") !== "1") return null;
  const relayUrl = asString(params.get("url"))?.trim();
  const serverId = asString(params.get("sid"))?.trim();
  const secret = asString(params.get("secret"))?.trim();
  if (!relayUrl || !serverId || !secret) return null;
  if (!isSafeToken(serverId, 64) || !isSafeToken(secret, 128)) return null;
  return { version: 1, url: relayUrl, serverId, secret };
}
