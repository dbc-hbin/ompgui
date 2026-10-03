import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { NextRequest } = await import("next/server.js");
const { unstable_doesMiddlewareMatch } = await import("next/experimental/testing/server.js");
const { createWebSession, getWebDeviceId, getWebRequestAccess, isWebRequestAuthorized, readWebCookie, isValidWebPassword, isValidWebSession, isWebPasswordEnabled, OMPGUI_SESSION_COOKIE, OMPGUI_WEB_ACCESS_HEADER } = await jiti.import("./web-auth.ts");
const { config, proxy } = await jiti.import("../proxy.ts");
const { POST: pair } = await jiti.import("../app/api/web-auth/pair/route.ts");
const { POST: offerRoute } = await jiti.import("../app/api/relay/pair/route.ts");
const { createPairingOffer, listRelayDevices, revokeRelayDevice, RELAY_MAX_DEVICES } = await jiti.import("./relay/registry.ts");
const { authenticateRelayHello } = await jiti.import("./relay/auth.ts");
const daemon = await jiti.import("./daemon.ts");
const daemonRoute = await jiti.import("../app/api/daemon/route.ts");
const { POST: login } = await jiti.import("../app/api/web-auth/session/route.ts");
const { attachRelayGateway } = await jiti.import("./relay/gateway.ts");
attachRelayGateway();
const localProof = { [OMPGUI_WEB_ACCESS_HEADER]: `local.${process.env.__OMPGUI_WEB_ACCESS_NONCE}` };
const deviceProof = { [OMPGUI_WEB_ACCESS_HEADER]: `device.${process.env.__OMPGUI_WEB_ACCESS_NONCE}` };

function agentDir(t, password) {
  const dir = mkdtempSync(join(tmpdir(), "ompgui-browser-pair-"));
  const previous = { PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR, OMPGUI_PASSWORD: process.env.OMPGUI_PASSWORD, OMP_WEB_PASSWORD: process.env.OMP_WEB_PASSWORD };
  process.env.PI_CODING_AGENT_DIR = dir;
  delete process.env.OMP_WEB_PASSWORD;
  if (password) process.env.OMPGUI_PASSWORD = password;
  else delete process.env.OMPGUI_PASSWORD;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function pairingRequest(body, headers = {}) {
  return new Request("https://remote.example/api/web-auth/pair", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  });
}

test("accepts the configured password and validates signed sessions", () => {
  assert.equal(isWebPasswordEnabled("secret"), true);
  assert.equal(isValidWebPassword("secret", "secret"), true);
  assert.equal(isValidWebPassword("wrong", "secret"), false);

  const now = 1_700_000_000_000;
  const session = createWebSession("secret", now);
  assert.equal(isValidWebSession(session, "secret", now), true);
  assert.equal(isValidWebSession(session, "changed", now), false);
  assert.equal(isValidWebSession(session, "secret", now + 31 * 24 * 60 * 60 * 1000), false);
});

test("redirects browser requests to the password screen and blocks unauthenticated APIs", () => {
  const previousGuiPassword = process.env.OMPGUI_PASSWORD;
  const previousPassword = process.env.OMP_WEB_PASSWORD;
  process.env.OMPGUI_PASSWORD = "secret";
  process.env.OMP_WEB_PASSWORD = "secret";
  try {
    const pageResponse = proxy(new NextRequest("http://localhost:30177/", { headers: localProof }));
    assert.equal(pageResponse.status, 307);
    assert.equal(pageResponse.headers.get("location"), "http://localhost:30177/login");

    const apiResponse = proxy(new NextRequest("http://localhost:30177/api/sessions", { headers: localProof }));
    assert.equal(apiResponse.status, 401);

    const session = createWebSession("secret");
    const signedInResponse = proxy(new NextRequest("http://localhost:30177/", {
      headers: { ...localProof, cookie: `omp_web_session=${session}` },
    }));
    assert.equal(signedInResponse.status, 200);
    const primaryCookieResponse = proxy(new NextRequest("http://localhost:30177/", {
      headers: { ...localProof, cookie: `${OMPGUI_SESSION_COOKIE}=${session}` },
    }));
    assert.equal(primaryCookieResponse.status, 200);
  } finally {
    if (previousGuiPassword === undefined) delete process.env.OMPGUI_PASSWORD;
    else process.env.OMPGUI_PASSWORD = previousGuiPassword;
    if (previousPassword === undefined) delete process.env.OMP_WEB_PASSWORD;
    else process.env.OMP_WEB_PASSWORD = previousPassword;
  }
});

test("allows cross-site top-level navigation while rejecting cross-origin APIs", () => {
  const previousGuiPassword = process.env.OMPGUI_PASSWORD;
  const previousPassword = process.env.OMP_WEB_PASSWORD;
  process.env.OMPGUI_PASSWORD = "secret";
  process.env.OMP_WEB_PASSWORD = "secret";
  try {
    const navigationHeaders = {
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "cross-site",
      "sec-fetch-user": "?1",
    };
    const pageResponse = proxy(new NextRequest("http://localhost:30177/?ompguiRemote=1", {
      headers: navigationHeaders,
    }));
    assert.equal(pageResponse.status, 307);
    assert.equal(pageResponse.headers.get("location"), "http://localhost:30177/login");

    const apiResponse = proxy(new NextRequest("http://localhost:30177/api/sessions", {
      headers: { "sec-fetch-site": "cross-site" },
    }));
    assert.equal(apiResponse.status, 403);
  } finally {
    if (previousGuiPassword === undefined) delete process.env.OMPGUI_PASSWORD;
    else process.env.OMPGUI_PASSWORD = previousGuiPassword;
    if (previousPassword === undefined) delete process.env.OMP_WEB_PASSWORD;
    else process.env.OMP_WEB_PASSWORD = previousPassword;
  }
});

test("leaves Next.js build assets and the relay upgrade path outside password protection", () => {
  assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/_next/static/chunks/app.js" }), false);
  assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/_next/image" }), true);
  assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/api/sessions" }), true);
  assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/relay" }), true);

  const previousGuiPassword = process.env.OMPGUI_PASSWORD;
  const previousPassword = process.env.OMP_WEB_PASSWORD;
  process.env.OMPGUI_PASSWORD = "secret";
  process.env.OMP_WEB_PASSWORD = "secret";
  try {
    const relayResponse = proxy(new NextRequest("http://localhost:30177/relay"));
    assert.equal(relayResponse.status, 200);
  } finally {
    if (previousGuiPassword === undefined) delete process.env.OMPGUI_PASSWORD;
    else process.env.OMPGUI_PASSWORD = previousGuiPassword;
    if (previousPassword === undefined) delete process.env.OMP_WEB_PASSWORD;
    else process.env.OMP_WEB_PASSWORD = previousPassword;
  }
});

test("browser enrollment is the native relay hello with an HttpOnly cookie", async (t) => {
  const dir = agentDir(t, "workspace-password");
  const offer = createPairingOffer({ relayUrl: "wss://remote.example/relay" });
  const passwordDenied = await pair(pairingRequest({ secret: offer.secret }));
  assert.equal(passwordDenied.status, 401);
  assert.equal((await passwordDenied.json()).code, "password_required");
  const response = await pair(pairingRequest({ secret: offer.secret, password: "workspace-password", label: "Laptop" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  const setCookie = response.headers.get("set-cookie");
  for (const flag of [/HttpOnly/i, /Secure/i, /SameSite=lax/i, /Max-Age=2592000/]) assert.match(setCookie, flag);
  assert.ok(setCookie.includes("Path=/"));
  assert.doesNotMatch(setCookie, /Domain=/i);
  const cookie = setCookie.split(";")[0];
  const credential = readWebCookie(cookie, "ompgui_device");
  const [deviceId, token] = credential.split(".");
  assert.equal(getWebDeviceId(credential), deviceId);
  assert.equal(authenticateRelayHello({ op: "hello", protocol: 1, deviceId, token }).ok, true);
  const raw = readFileSync(join(dir, "ompgui-relay.json"), "utf8");
  assert.equal(raw.includes(token), false);
  assert.equal(raw.includes(offer.secret), false);
  assert.equal(listRelayDevices()[0].label, "Laptop");
  assert.equal((await pair(pairingRequest({ secret: offer.secret, password: "workspace-password" }))).status, 401);
  const request = new NextRequest("https://remote.example/api/sessions", { headers: { ...deviceProof, cookie } });
  assert.equal(proxy(request).status, 200);
  assert.equal(isWebRequestAuthorized(request), true);
  const reconnected = await pair(pairingRequest({ deviceId, token }));
  assert.equal(reconnected.status, 200);
  assert.equal(listRelayDevices().length, 1);
  revokeRelayDevice(deviceId);
  assert.equal(getWebDeviceId(credential), null);
  assert.equal(isWebRequestAuthorized(request), false);
  assert.equal(proxy(request).status, 401);
  assert.equal((await pair(pairingRequest({ deviceId, token }))).status, 401);
});

test("native enrollment and browser share one-use offers, tokens, and device limits", async (t) => {
  agentDir(t);
  const offer = createPairingOffer({ relayUrl: "wss://remote.example/relay" });
  const native = authenticateRelayHello({ op: "hello", protocol: 1, pairingSecret: offer.secret, label: "APK" });
  assert.equal(native.ok, true);
  assert.equal((await pair(pairingRequest({ secret: offer.secret }))).status, 401);
  assert.equal(getWebDeviceId(`${native.deviceId}.${native.token}`), native.deviceId);
  assert.equal((await pair(pairingRequest({ deviceId: native.deviceId, token: native.token }))).status, 200);
  for (let i = 1; i < RELAY_MAX_DEVICES; i++) {
    const next = createPairingOffer({ relayUrl: "wss://remote.example/relay" });
    assert.equal((await pair(pairingRequest({ secret: next.secret }))).status, 200);
  }
  const last = createPairingOffer({ relayUrl: "wss://remote.example/relay" });
  const denied = await pair(pairingRequest({ secret: last.secret }));
  assert.equal(denied.status, 409);
  assert.equal((await denied.json()).code, "device_limit");
});

test("pairing rejects malformed, oversized, cross-origin, and expired input without enrollment", async (t) => {
  agentDir(t);
  const offer = createPairingOffer({ relayUrl: "wss://remote.example/relay" });
  for (const body of [null, [], {}, { secret: 1 }, { secret: offer.secret, label: 1 }, { secret: offer.secret, password: false }, { secret: offer.secret, extra: true }, { secret: offer.secret, token: offer.secret }, { deviceId: "d_invalid", token: offer.secret }]) {
    assert.equal((await pair(pairingRequest(body))).status, 400);
  }
  assert.equal((await pair(pairingRequest({ secret: offer.secret, password: "a".repeat(8192) }))).status, 413);
  assert.equal((await pair(pairingRequest({ secret: offer.secret }, { origin: "https://evil.example" }))).status, 403);
  assert.equal(listRelayDevices().length, 0);
  const expired = createPairingOffer({ relayUrl: "wss://remote.example/relay", now: 1, ttlMs: 1 });
  const denied = await pair(pairingRequest({ secret: expired.secret }));
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).code, "pairing_expired");
  assert.equal(listRelayDevices().length, 0);
});

test("pair links keep the enrollment secret in a fragment and login remains public without password", async (t) => {
  agentDir(t);
  const response = await offerRoute(new Request("http://localhost/api/relay/pair", { method: "POST", body: JSON.stringify({ url: "wss://remote.example/relay" }) }));
  assert.equal(response.status, 200);
  const offer = await response.json();
  const url = new URL(offer.browserUrl);
  assert.equal(url.origin, "https://remote.example");
  assert.equal(url.pathname, "/login");
  assert.equal(url.search, "");
  assert.match(url.hash, /^#pair=[A-Za-z0-9_-]{43}$/);
  assert.equal(proxy(new NextRequest("https://remote.example/login")).status, 200);
  assert.equal(proxy(new NextRequest("http://localhost/", { headers: localProof })).status, 200);
  assert.equal(proxy(new NextRequest("https://remote.example/api/web-auth/pair", { method: "POST" })).status, 200);
  assert.equal(readWebCookie("ompgui_device=a; ompgui_device=b", "ompgui_device"), "");
  assert.equal(getWebDeviceId("invalid"), null);
});

test("daemon authorization accepts registered credentials and denies revoked or cross-site requests", async (t) => {
  agentDir(t, "workspace-password");
  const offer = createPairingOffer({ relayUrl: "wss://remote.example/relay" });
  const response = await pair(pairingRequest({ secret: offer.secret, password: "workspace-password" }));
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const deviceId = getWebDeviceId(readWebCookie(cookie, "ompgui_device"));
  const dispatch = t.mock.method(daemon, "daemonCommand", async () => ({ supported: true }));
  const request = new NextRequest("https://remote.example/api/daemon", { headers: { ...deviceProof, cookie } });
  assert.equal((await daemonRoute.GET(request)).status, 200);
  assert.equal(dispatch.mock.callCount(), 1);
  assert.equal((await daemonRoute.POST(new NextRequest(request.url, { method: "POST", headers: { cookie, origin: "https://evil.example" }, body: JSON.stringify({ action: "restart" }) }))).status, 403);
  revokeRelayDevice(deviceId);
  assert.equal((await daemonRoute.GET(request)).status, 401);
  assert.equal(dispatch.mock.callCount(), 1);
});

test("requests queued before raw admission cannot use localhost, password, or device credentials", async (t) => {
  agentDir(t, "workspace-password");
  const offer = createPairingOffer({ relayUrl: "wss://remote.example/relay" });
  const enrolled = authenticateRelayHello({ op: "hello", protocol: 1, pairingSecret: offer.secret, password: "workspace-password" });
  const passwordCookie = `ompgui_session=${createWebSession("workspace-password")}`;
  const deviceCookie = `ompgui_device=${enrolled.deviceId}.${enrolled.token}`;
  for (const cookie of [passwordCookie, deviceCookie]) {
    for (const proof of [undefined, "local.attacker", "device.attacker"]) {
      const headers = { cookie, host: "localhost", ...(proof ? { [OMPGUI_WEB_ACCESS_HEADER]: proof } : {}) };
      const api = new NextRequest("http://localhost/api/sessions", { headers });
      assert.equal(getWebRequestAccess(api), null);
      assert.equal(isWebRequestAuthorized(api), false);
      assert.equal(proxy(api).status, 401);
      const response = await login(new Request("http://localhost/api/web-auth/session", { method: "POST", headers, body: JSON.stringify({ password: "workspace-password" }) }));
      assert.equal(response.status, 401);
      assert.equal(response.headers.has("set-cookie"), false);
    }
  }
  const allowed = await login(new Request("http://localhost/api/web-auth/session", { method: "POST", headers: localProof, body: JSON.stringify({ password: "workspace-password" }) }));
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.has(OMPGUI_WEB_ACCESS_HEADER), false);
  delete process.env.OMPGUI_PASSWORD;
  assert.equal(proxy(new NextRequest("http://localhost/api/sessions")).status, 401);
  assert.equal(proxy(new NextRequest("http://localhost/", { headers: localProof })).status, 200);
});
