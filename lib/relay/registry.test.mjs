import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  authenticateDeviceToken,
  consumePairingSecret,
  createPairingOffer,
  listRelayDevices,
  parseRelayRegistry,
  revokeRelayDevice,
} = await jiti.import("./registry.ts");

async function withAgentDir(t) {
  const agentDir = mkdtempSync(join(tmpdir(), "ompgui-relay-registry-"));
  const previous = {
    agent: process.env.PI_CODING_AGENT_DIR,
    profile: process.env.OMP_PROFILE,
    piProfile: process.env.PI_PROFILE,
  };
  process.env.PI_CODING_AGENT_DIR = agentDir;
  delete process.env.OMP_PROFILE;
  delete process.env.PI_PROFILE;
  t.after(() => {
    if (previous.agent === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous.agent;
    if (previous.profile === undefined) delete process.env.OMP_PROFILE;
    else process.env.OMP_PROFILE = previous.profile;
    if (previous.piProfile === undefined) delete process.env.PI_PROFILE;
    else process.env.PI_PROFILE = previous.piProfile;
    rmSync(agentDir, { recursive: true, force: true });
  });
  return agentDir;
}

test("parses a valid registry and skips corrupt device rows", () => {
  const parsed = parseRelayRegistry(JSON.stringify({
    version: 1,
    serverId: "s_abcdefghijklmnopqrstuv",
    devices: [
      null,
      { id: "nope" },
      {
        id: "d_abcdefghijklmnopqrstuv",
        label: "Phone",
        tokenHash: "a".repeat(64),
        createdAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    pairing: null,
  }));
  assert.equal(parsed.devices.length, 1);
  assert.equal(parsed.devices[0].id, "d_abcdefghijklmnopqrstuv");
});

test("pairing secret is one-time and never stored in plaintext", async (t) => {
  const agentDir = await withAgentDir(t);
  const offer = createPairingOffer({ relayUrl: "wss://mac.example.ts.net/relay", now: 1_000 });
  const raw = readFileSync(join(agentDir, "ompgui-relay.json"), "utf8");
  assert.equal(raw.includes(offer.secret), false);

  const first = consumePairingSecret(offer.secret, "Pixel", 1_001);
  assert.equal("deviceId" in first, true);
  assert.equal(listRelayDevices().length, 1);

  const second = consumePairingSecret(offer.secret, "Pixel", 1_002);
  assert.deepEqual(second, { error: "invalid" });

  const path = join(agentDir, "ompgui-relay.json");
  const before = readFileSync(path, "utf8");
  const modified = statSync(path).mtimeMs;
  assert.ok(authenticateDeviceToken(first.deviceId, first.token, 1_003, false));
  assert.equal(authenticateDeviceToken(first.deviceId, "wrong-token-value_0123456789abcdefghi", 1_003, false), null);
  assert.equal(readFileSync(path, "utf8"), before);
  assert.equal(statSync(path).mtimeMs, modified);
  assert.equal(existsSync(`${path}.lock`), false);
  assert.ok(authenticateDeviceToken(first.deviceId, first.token, 2_000));
  assert.equal(listRelayDevices()[0].lastSeenAt, new Date(2_000).toISOString());
  assert.notEqual(readFileSync(path, "utf8"), before);
  assert.equal(revokeRelayDevice(first.deviceId), true);
  assert.equal(authenticateDeviceToken(first.deviceId, first.token), null);
  assert.equal(listRelayDevices().length, 0);
});

test("expired pairing offers are consumed as expired", async (t) => {
  await withAgentDir(t);
  const offer = createPairingOffer({
    relayUrl: "wss://mac.example.ts.net/relay",
    ttlMs: 10,
    now: 1_000,
  });
  assert.deepEqual(consumePairingSecret(offer.secret, "Pixel", 2_000), { error: "expired" });
});

test("credential validation fails closed without creating or repairing files", async (t) => {
  const dir = await withAgentDir(t);
  const path = join(dir, "ompgui-relay.json");
  assert.equal(authenticateDeviceToken("d_missing", "token", 1_000, false), null);
  assert.equal(existsSync(path), false);
  writeFileSync(path, "broken");
  assert.equal(authenticateDeviceToken("d_missing", "token", 1_000, false), null);
  assert.equal(readFileSync(path, "utf8"), "broken");
});
