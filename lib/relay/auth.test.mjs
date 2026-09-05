import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { authenticateRelayHello } = await jiti.import("./auth.ts");
const { createPairingOffer } = await jiti.import("./registry.ts");

async function withAgentDir(t) {
  const agentDir = mkdtempSync(join(tmpdir(), "ompgui-relay-auth-"));
  const previous = {
    agent: process.env.PI_CODING_AGENT_DIR,
    profile: process.env.OMP_PROFILE,
    piProfile: process.env.PI_PROFILE,
    password: process.env.OMPGUI_PASSWORD,
    legacy: process.env.OMP_WEB_PASSWORD,
  };
  process.env.PI_CODING_AGENT_DIR = agentDir;
  delete process.env.OMP_PROFILE;
  delete process.env.PI_PROFILE;
  delete process.env.OMPGUI_PASSWORD;
  delete process.env.OMP_WEB_PASSWORD;
  t.after(() => {
    if (previous.agent === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous.agent;
    if (previous.profile === undefined) delete process.env.OMP_PROFILE;
    else process.env.OMP_PROFILE = previous.profile;
    if (previous.piProfile === undefined) delete process.env.PI_PROFILE;
    else process.env.PI_PROFILE = previous.piProfile;
    if (previous.password === undefined) delete process.env.OMPGUI_PASSWORD;
    else process.env.OMPGUI_PASSWORD = previous.password;
    if (previous.legacy === undefined) delete process.env.OMP_WEB_PASSWORD;
    else process.env.OMP_WEB_PASSWORD = previous.legacy;
    rmSync(agentDir, { recursive: true, force: true });
  });
}

test("pairing requires the workspace password when one is configured", async (t) => {
  await withAgentDir(t);
  process.env.OMPGUI_PASSWORD = "secret";
  const offer = createPairingOffer({ relayUrl: "wss://mac.example.ts.net/relay" });
  const denied = authenticateRelayHello({
    op: "hello",
    protocol: 1,
    pairingSecret: offer.secret,
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "password_required");

  const allowed = authenticateRelayHello({
    op: "hello",
    protocol: 1,
    pairingSecret: offer.secret,
    password: "secret",
    label: "Pixel",
  });
  assert.equal(allowed.ok, true);
  assert.ok(allowed.token);
});
