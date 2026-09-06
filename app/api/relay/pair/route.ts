import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { buildPairingUri } from "@/lib/relay/pairing-uri";
import { createPairingOffer, getRelayPairingStatus, RELAY_PAIRING_TTL_MS } from "@/lib/relay/registry";
import { resolveRelayUrl } from "@/lib/relay/detect-url";

export const dynamic = "force-dynamic";

const MAX_PAIR_REQUEST_BYTES = 8 * 1024;
const MIN_TTL_MS = 60_000;
const MAX_TTL_MS = 30 * 60 * 1000;

export async function GET() {
  const status = getRelayPairingStatus();
  return NextResponse.json(status);
}

export async function POST(request: Request) {
  let body: { url?: unknown; ttlSeconds?: unknown } = {};
  try {
    if (request.headers.get("content-length") !== "0") {
      body = await parseJsonWithinLimit(request, MAX_PAIR_REQUEST_BYTES);
    }
  } catch (error) {
    const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
    return NextResponse.json({ error: "Invalid pairing request", code: "invalid_json" }, { status });
  }

  const ttlSeconds = typeof body.ttlSeconds === "number" && Number.isFinite(body.ttlSeconds)
    ? body.ttlSeconds
    : undefined;
  const ttlMs = ttlSeconds === undefined
    ? RELAY_PAIRING_TTL_MS
    : Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, Math.floor(ttlSeconds * 1000)));

  const url = typeof body.url === "string" ? resolveRelayUrl(body.url) : resolveRelayUrl();
  if (!url) {
    return NextResponse.json(
      { error: "Set a Funnel URL (wss://name.ts.net/relay) or OMPGUI_RELAY_URL", code: "relay_url_required" },
      { status: 400 },
    );
  }

  try {
    const offer = createPairingOffer({ relayUrl: url, ttlMs });
    return NextResponse.json({
      uri: buildPairingUri({ version: 1, url: offer.relayUrl, serverId: offer.serverId, secret: offer.secret }),
      expiresAt: offer.expiresAt,
      relayUrl: offer.relayUrl,
      serverId: offer.serverId,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error), code: "pair_failed" },
      { status: 500 },
    );
  }
}
