import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { isDirectLocalRequest } = await jiti.import("./web-access.ts");
const { attachRelayGateway } = await jiti.import("./relay/gateway.ts");
const { createPairingOffer, consumePairingSecret, revokeRelayDevice } = await jiti.import("./relay/registry.ts");
const { createWebSession, getWebRequestAccess, OMPGUI_WEB_ACCESS_HEADER } = await jiti.import("./web-auth.ts");
attachRelayGateway();

async function fixture(t, handler = (_req, res) => res.end("workspace")) {
  const dir = mkdtempSync(join(tmpdir(), "ompgui-web-gate-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    const closed = once(server, "close");
    server.close();
    await closed;
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  const offer = createPairingOffer({ relayUrl: "wss://remote.example/relay" });
  const device = consumePairingSecret(offer.secret, "Phone");
  assert.ok(device.deviceId);
  return { dir, device, base: `http://127.0.0.1:${server.address().port}`, cookie: `ompgui_device=${device.deviceId}.${device.token}` };
}

const forwarded = { host: "remote.example", "x-forwarded-proto": "https" };

test("locality requires a real loopback peer, strict Host, and no proxy identity", () => {
  for (const peer of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(isDirectLocalRequest({ socket: { remoteAddress: peer }, headers: { host: "localhost:30178" } }), true);
  }
  for (const peer of [undefined, "192.168.1.2", "100.64.1.2", "127.0.0.2"]) {
    assert.equal(isDirectLocalRequest({ socket: { remoteAddress: peer }, headers: { host: "localhost" } }), false);
  }
  for (const host of [undefined, "localhost.evil", "localhost.", "localhost:65536", "localhost:0", "127.1", "localhost@evil", "[::1].evil", "remote.example"]) {
    assert.equal(isDirectLocalRequest({ socket: { remoteAddress: "127.0.0.1" }, headers: { host } }), false);
  }
  for (const key of ["forwarded", "via", "x-real-ip", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "tailscale-user-login", "tailscale-funnel-request", "x-tailscale-user-name", "x-funnel-request"]) {
    assert.equal(isDirectLocalRequest({ socket: { remoteAddress: "127.0.0.1" }, headers: { host: "localhost", [key]: "" } }), false, key);
  }
});

test("HTTP entry protects pages, APIs, images, and password login before handlers run", async (t) => {
  const { base, cookie } = await fixture(t);
  const local = await fetch(`${base}/api/sessions`);
  assert.equal(await local.text(), "workspace");
  const old = `ompgui_session=${createWebSession("secret")}`;
  for (const path of ["/api/sessions", "/api/agent/running/events", "/_next/image?url=%2Fapi%2Ffiles%2Fprivate", "/_next/data/build/index.json"]) {
    const response = await fetch(`${base}${path}`, { headers: { ...forwarded, cookie: old }, redirect: "manual" });
    assert.equal(response.status, 401, path);
    assert.equal((await response.json()).code, "device_required");
  }
  const page = await fetch(`${base}/`, { headers: forwarded, redirect: "manual" });
  assert.equal(page.status, 307);
  assert.equal(page.headers.get("location"), "/login");
  for (const path of ["/api/web-auth/session", "/login"]) {
    assert.equal((await fetch(`${base}${path}`, { method: "POST", headers: forwarded })).status, 401);
  }
  for (const path of ["/login", "/favicon.ico", "/_next/static/chunks/app.js", "/relay"]) {
    assert.equal(await (await fetch(`${base}${path}`, { headers: forwarded })).text(), "workspace", path);
  }
  assert.equal(await (await fetch(`${base}/api/web-auth/pair`, { method: "POST", headers: forwarded })).text(), "workspace");
  assert.equal(await (await fetch(`${base}/api/sessions`, { headers: { ...forwarded, cookie } })).text(), "workspace");
  for (const key of ["forwarded", "via", "x-forwarded-for", "tailscale-funnel-request", "tailscale-user-login"]) {
    assert.equal((await fetch(`${base}/api/sessions`, { headers: { [key]: "127.0.0.1" } })).status, 401, key);
  }
});

test("revocation immediately closes idle SSE and rejects subsequent cookie replay", async (t) => {
  const ready = Promise.withResolvers();
  const { base, cookie, device } = await fixture(t, (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write("data: initial\n\n");
    ready.resolve(res);
  });
  const response = await fetch(`${base}/api/events`, { headers: { ...forwarded, cookie } });
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /initial/);
  const res = await ready.promise;
  revokeRelayDevice(device.deviceId);
  assert.equal(res.destroyed, true);
  assert.equal(res.write("data: leaked\n\n"), false);
  await assert.rejects(reader.read());
  assert.equal((await fetch(`${base}/api/events`, { headers: { ...forwarded, cookie } })).status, 401);
});

test("raw admission replaces spoofed proof and never emits its secret", async (t) => {
  const { base, cookie } = await fixture(t, (req, res) => {
    res.end(getWebRequestAccess(new Request("http://localhost", { headers: req.headers })) ?? "unadmitted");
  });
  const spoof = `local.${process.env.__OMPGUI_WEB_ACCESS_NONCE}`;
  const remote = await fetch(`${base}/api/private`, { headers: { ...forwarded, [OMPGUI_WEB_ACCESS_HEADER]: spoof, cookie } });
  assert.equal(await remote.text(), "device");
  assert.equal(remote.headers.has(OMPGUI_WEB_ACCESS_HEADER), false);
  const local = await fetch(`${base}/api/private`, { headers: { [OMPGUI_WEB_ACCESS_HEADER]: "device.attacker" } });
  assert.equal(await local.text(), "local");
  const denied = await fetch(`${base}/api/private`, { headers: { ...forwarded, [OMPGUI_WEB_ACCESS_HEADER]: spoof } });
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.has(OMPGUI_WEB_ACCESS_HEADER), false);
});

for (const boundary of ["writeHead", "write", "end", "flushHeaders"]) {
  test(`persisted revocation between admission and ${boundary} cannot release a response`, async (t) => {
    const ready = Promise.withResolvers();
    const { base, cookie, dir } = await fixture(t, (_req, res) => ready.resolve(res));
    const pending = fetch(`${base}/api/private`, { headers: { ...forwarded, cookie } });
    const failure = assert.rejects(pending);
    const res = await ready.promise;
    const path = join(dir, "ompgui-relay.json");
    const registry = JSON.parse(readFileSync(path, "utf8"));
    registry.devices = [];
    writeFileSync(path, JSON.stringify(registry));
    if (boundary === "writeHead") res.writeHead(200, { "X-Private": "secret" });
    else if (boundary === "flushHeaders") res.flushHeaders();
    else res[boundary]("private workspace data");
    assert.equal(res.destroyed, true);
    await failure;
  });
}
