import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";
import { parseLaunchOptions } from "./ompgui-options.js";

test("parseLaunchOptions accepts pair and devices commands", () => {
  const pair = parseLaunchOptions(["pair", "--url", "wss://mac.example.ts.net/relay"], {});
  assert.equal(pair.command, "pair");
  assert.equal(pair.relayUrl, "wss://mac.example.ts.net/relay");

  const devices = parseLaunchOptions(["devices", "revoke", "d_abc"], {});
  assert.equal(devices.command, "devices");
  assert.deepEqual(devices.extraPositionals, ["revoke", "d_abc"]);
});

test("IPv6 relay commands accept bare CLI and bracketed legacy hosts", async (t) => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/relay/pair") {
      response.end(JSON.stringify({ uri: "ompgui://pair/test", relayUrl: "wss://relay.example", expiresAt: 1800000000000 }));
    } else if (request.url === "/api/relay/devices") {
      response.end(JSON.stringify({ devices: [{ id: "phone-1", label: "My phone", lastSeenAt: 42 }] }));
    } else {
      response.writeHead(404).end();
    }
  });
  t.after(() => promisify(server.close.bind(server))());
  server.listen(0, "::1");
  await once(server, "listening");
  const port = String(server.address().port);
  const env = { ...process.env, OMPGUI_HOSTNAME: "", OMP_WEB_HOSTNAME: "[::1]", OMPGUI_PASSWORD: "", OMP_WEB_PASSWORD: "" };
  delete env.OMPGUI_HOSTNAME;
  const pair = await promisify(execFile)(process.execPath, ["bin/ompgui.js", "pair", "--hostname", "::1", "--port", port, "--no-open"], { env });
  assert.match(pair.stdout, /ompgui:\/\/pair\/test/);
  const devices = await promisify(execFile)(process.execPath, ["bin/ompgui.js", "devices", "--port", port, "--no-open"], { env });
  assert.match(devices.stdout, /phone-1\tMy phone\tlastSeen 42/);
  assert.deepEqual(requests, ["POST /api/relay/pair", "GET /api/relay/devices"]);
  const options = parseLaunchOptions(["--hostname", "[::1]", "--port", port], {});
  assert.equal(options.hostname, "::1");
  assert.equal(options.baseUrl, `http://[::1]:${port}`);
});

test("ompgui pair fails when the server is not running", async () => {
  const unavailable = createServer();
  unavailable.listen(0, "127.0.0.1");
  await once(unavailable, "listening");
  const port = String(unavailable.address().port);
  await promisify(unavailable.close.bind(unavailable))();
  const result = spawnSync(process.execPath, ["bin/ompgui.js", "pair", "--no-open", "--hostname", "127.0.0.1", "-p", port], {
    encoding: "utf8",
    env: { ...process.env, OMPGUI_PASSWORD: "", OMP_WEB_PASSWORD: "" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not running/);
});
