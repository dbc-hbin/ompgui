import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { isRelayUpgradeOriginAllowed } = await jiti.import("./gateway.ts");

test("allows native upgrades without Origin and same-host browser origins", () => {
  assert.equal(isRelayUpgradeOriginAllowed({ headers: {} }), true);
  assert.equal(isRelayUpgradeOriginAllowed({
    headers: { origin: "http://127.0.0.1:30177", host: "127.0.0.1:30177" },
  }), true);
  assert.equal(isRelayUpgradeOriginAllowed({
    headers: { origin: "https://evil.example", host: "mac.tailnet.ts.net" },
  }), false);
  assert.equal(isRelayUpgradeOriginAllowed({
    headers: { "sec-fetch-site": "cross-site" },
  }), false);
});
