import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildPairingUri, parsePairingUri } = await jiti.import("./pairing-uri.ts");

test("round-trips a pairing URI with the secret in the fragment", () => {
  const uri = buildPairingUri({
    version: 1,
    url: "wss://mac.example.ts.net/relay",
    serverId: "s_abcDEF1234567890",
    secret: "sekritvalue_0123456789abcdefghijk",
  });
  assert.equal(uri.startsWith("ompgui://pair#"), true);
  assert.equal(uri.includes("?"), false);
  const parsed = parsePairingUri(uri);
  assert.deepEqual(parsed, {
    version: 1,
    url: "wss://mac.example.ts.net/relay",
    serverId: "s_abcDEF1234567890",
    secret: "sekritvalue_0123456789abcdefghijk",
  });
});

test("rejects foreign schemes and missing fragment fields", () => {
  assert.equal(parsePairingUri("https://pair#v=1&url=wss://x/relay&sid=s_ab&secret=sekritvalue_0123456789abcdefghijk"), null);
  assert.equal(parsePairingUri("ompgui://pair#v=1&url=wss://x/relay&sid=s_ab"), null);
});
