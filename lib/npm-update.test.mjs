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

test("marks npm lookup failures instead of reporting up-to-date", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try {
    const status = await checkNpmUpdate(true);
    assert.equal(status.availableVersion, null);
    assert.equal(status.updateAvailable, false);
    assert.equal(status.lookupFailed, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("marks non-ok npm responses as failed lookups without caching", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response("registry down", { status: 503 });
    return new Response(JSON.stringify({ version: "99.0.0" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const failed = await checkNpmUpdate(true);
    assert.equal(failed.lookupFailed, true);
    assert.equal(failed.updateAvailable, false);
    // The failure must not be cached: a non-forced check revalidates.
    const recovered = await checkNpmUpdate(false);
    assert.equal(calls, 2);
    assert.equal(recovered.lookupFailed, false);
    assert.equal(recovered.updateAvailable, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
    assert.equal(status.lookupFailed, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

