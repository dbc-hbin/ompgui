import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildPairingUri } = await jiti.import("./pairing-uri.ts");

test("pairing offer keeps encoded endpoint and credentials in its fragment", () => {
  const uri = new URL(buildPairingUri({
    version: 1,
    url: "wss://mac.example.ts.net/relay?key=a&other=b",
    serverId: "s_abcDEF1234567890",
    secret: "sekritvalue_0123456789abcdefghijk",
  }));
  assert.equal(uri.protocol, "ompgui:");
  assert.equal(uri.host, "pair");
  assert.equal(uri.search, "");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(uri.hash.slice(1))), {
    v: "1", url: "wss://mac.example.ts.net/relay?key=a&other=b",
    sid: "s_abcDEF1234567890", secret: "sekritvalue_0123456789abcdefghijk",
  });
});
