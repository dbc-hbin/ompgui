import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { checkNpmUpdate, isNewerVersion } = jiti("./npm-update.ts");

test("recognizes newer npm package versions", () => {
  assert.equal(isNewerVersion("0.2.1", "0.2.0"), true);
  assert.equal(isNewerVersion("1.0.0", "0.9.9"), true);
  assert.equal(isNewerVersion("0.2.0", "0.2.0"), false);
  assert.equal(isNewerVersion("0.1.9", "0.2.0"), false);
});

test("only treats a stable build as newer than the matching prerelease", () => {
  assert.equal(isNewerVersion("0.2.0", "0.2.0-beta.1"), true);
  assert.equal(isNewerVersion("0.2.0-beta.2", "0.2.0-beta.1"), false);
  assert.equal(isNewerVersion("0.2.0-beta.1", "0.2.0"), false);
});

test("reports ompgui update as the canonical self-update command", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ version: "99.0.0" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  try {
    const status = await checkNpmUpdate(true);
    assert.equal(status.updateCommand, "ompgui update");
    assert.equal(status.updateAvailable, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

