import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { normalizeRelayUrl, isLoopbackHost, resolveRelayUrl } = await jiti.import("./detect-url.ts");

test("normalizes Funnel and loopback relay URLs", () => {
  assert.equal(normalizeRelayUrl("mac.tailnet.ts.net"), "wss://mac.tailnet.ts.net/relay");
  assert.equal(normalizeRelayUrl("https://mac.tailnet.ts.net/relay"), "wss://mac.tailnet.ts.net/relay");
  assert.equal(normalizeRelayUrl("http://127.0.0.1:30177"), "ws://127.0.0.1:30177/relay");
  assert.equal(normalizeRelayUrl("ws://example.com/relay"), null);
  assert.equal(normalizeRelayUrl("wss://user:pass@host/relay"), null);
  assert.equal(normalizeRelayUrl("wss://host/other"), null);
});

test("treats loopback hosts as local", () => {
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("::1"), true);
  assert.equal(isLoopbackHost("example.ts.net"), false);
});

test("resolveRelayUrl prefers an explicit URL over the environment", () => {
  const previous = process.env.OMPGUI_RELAY_URL;
  process.env.OMPGUI_RELAY_URL = "wss://from-env.example.ts.net/relay";
  try {
    assert.equal(resolveRelayUrl("wss://explicit.example.ts.net/relay"), "wss://explicit.example.ts.net/relay");
    assert.equal(resolveRelayUrl(), "wss://from-env.example.ts.net/relay");
  } finally {
    if (previous === undefined) delete process.env.OMPGUI_RELAY_URL;
    else process.env.OMPGUI_RELAY_URL = previous;
  }
});
