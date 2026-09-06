export const RELAY_PAIRING_SCHEME = "ompgui";
export const RELAY_PAIRING_HOST = "pair";

export interface RelayPairingOfferUri {
  version: 1;
  url: string;
  serverId: string;
  secret: string;
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


