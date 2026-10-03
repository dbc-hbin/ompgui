import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const connectivity = await jiti.import("./omp/model-connectivity.ts");
const { POST } = await jiti.import("../app/api/models-config/connectivity/route.ts");
const { createPairingOffer, consumePairingSecret, revokeRelayDevice } = await jiti.import("./relay/registry.ts");
const { attachRelayGateway } = await jiti.import("./relay/gateway.ts");
attachRelayGateway();

function request(body, headers = {}) {
  return new NextRequest("http://localhost/api/models-config/connectivity", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost", "x-ompgui-web-access": `local.${process.env.__OMPGUI_WEB_ACCESS_NONCE}`, ...headers },
    body: JSON.stringify(body),
  });
}

test("REST security guards reject before connectivity dispatch", async (t) => {
  const saved = { OMPGUI_PASSWORD: process.env.OMPGUI_PASSWORD, OMP_WEB_PASSWORD: process.env.OMP_WEB_PASSWORD };
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  delete process.env.OMPGUI_PASSWORD;
  delete process.env.OMP_WEB_PASSWORD;
  const dispatch = t.mock.method(connectivity, "verifyModelConnectivity", async () => {
    throw new Error("unexpected provider dispatch");
  });
  const unconfirmed = await POST(request({ confirm: false }));
  assert.equal(unconfirmed.status, 400);
  assert.equal((await unconfirmed.json()).code, "connectivity_confirmation_required");
  const crossOrigin = await POST(request({ confirm: true }, { origin: "https://untrusted.example" }));
  assert.equal(crossOrigin.status, 403);
  const oversized = await POST(request({ confirm: true, padding: "x".repeat(512 * 1024) }));
  assert.equal(oversized.status, 413);
  process.env.OMPGUI_PASSWORD = "test-only-password";
  const unauthenticated = await POST(request({ confirm: true }));
  assert.equal(unauthenticated.status, 401);
  assert.equal((await unauthenticated.json()).code, "password_required");
  assert.equal(dispatch.mock.callCount(), 0);
});

test("registered credentials reach connectivity while mid-request revocation cancels dispatch", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ompgui-connectivity-device-"));
  const saved = { PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR, OMPGUI_PASSWORD: process.env.OMPGUI_PASSWORD };
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.OMPGUI_PASSWORD = "workspace-password";
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  });
  const offer = createPairingOffer({ relayUrl: "wss://remote.example/relay" });
  const device = consumePairingSecret(offer.secret, "Registered device");
  const headers = { cookie: `ompgui_device=${device.deviceId}.${device.token}` };
  const dispatch = t.mock.method(connectivity, "verifyModelConnectivity", async (_body, options) => {
    options.assertActive();
    revokeRelayDevice(device.deviceId);
    options.assertActive();
    throw new Error("revoked request continued");
  });
  const cancelled = await POST(request({ confirm: true }, headers));
  assert.equal(cancelled.status, 409);
  assert.equal((await cancelled.json()).code, "connectivity_cancelled");
  assert.equal(dispatch.mock.callCount(), 1);
  assert.equal((await POST(request({ confirm: true }, headers))).status, 401);
  assert.equal(dispatch.mock.callCount(), 1);
});
