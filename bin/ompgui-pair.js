"use strict";

const { spawn } = require("child_process");
const { isPortAvailable } = require("./port-availability");

function cookieHeader(response) {
  if (typeof response.headers.getSetCookie === "function") {
    const cookies = response.headers.getSetCookie();
    if (cookies.length) return cookies.map((value) => value.split(";")[0]).join("; ");
  }
  const single = response.headers.get("set-cookie");
  return single ? single.split(";")[0] : "";
}

async function ensureLocalSession(base, password, headers) {
  if (!password) return;
  const login = await fetch(`${base}/api/web-auth/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!login.ok) {
    throw new Error("Could not sign in with the configured password. Pass --password or open /pair in the browser.");
  }
  const cookie = cookieHeader(login);
  if (cookie) headers.cookie = cookie;
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
  if (!response.ok) {
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return body;
}

function openPairPage(target) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd.exe" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", target] : [target];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // printed URL is enough
  }
}

async function runPair(options) {
  const { port, hostname, password, relayUrl, openBrowser } = options;
  if (await isPortAvailable(port, hostname)) {
    throw new Error(`ompgui is not running on ${hostname}:${port}. Start it, then run ompgui pair.`);
  }
  const base = `http://${hostname}:${port}`;
  const headers = { "content-type": "application/json" };
  await ensureLocalSession(base, password, headers);
  const body = {};
  if (relayUrl) body.url = relayUrl;
  const offer = await requestJson(`${base}/api/relay/pair`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  console.log(offer.uri);
  console.log(`Relay: ${offer.relayUrl}`);
  console.log(`Expires: ${new Date(offer.expiresAt).toISOString()}`);
  if (openBrowser) openPairPage(`${base}/pair`);
}

async function runDevices(options) {
  const { port, hostname, password, extraPositionals } = options;
  if (await isPortAvailable(port, hostname)) {
    throw new Error(`ompgui is not running on ${hostname}:${port}. Start it, then run ompgui devices.`);
  }
  const base = `http://${hostname}:${port}`;
  const headers = { "content-type": "application/json" };
  await ensureLocalSession(base, password, headers);

  if (extraPositionals[0] === "revoke") {
    const id = extraPositionals[1];
    if (!id) throw new Error("Usage: ompgui devices revoke <id>");
    await requestJson(`${base}/api/relay/devices/${encodeURIComponent(id)}`, { method: "DELETE", headers });
    console.log(`Revoked ${id}`);
    return;
  }
  if (extraPositionals.length) {
    throw new Error(`Unknown ompgui devices command: ${extraPositionals.join(" ")}`);
  }
  const listed = await requestJson(`${base}/api/relay/devices`, { headers });
  const devices = listed.devices ?? [];
  if (devices.length === 0) {
    console.log("No paired devices.");
    return;
  }
  for (const device of devices) {
    console.log(`${device.id}\t${device.label || ""}\tlastSeen ${device.lastSeenAt}`);
  }
}

async function runRelayCli(options) {
  if (options.command === "pair") return runPair(options);
  return runDevices(options);
}

module.exports = { runRelayCli, runPair, runDevices };
