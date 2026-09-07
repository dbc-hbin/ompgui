import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { isPortAvailable } = require("../bin/port-availability.js");

test("reports a port occupied by another server", async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen({ host: "127.0.0.1", port: 0 }, resolve));
  const { port } = server.address();

  try {
    assert.equal(await isPortAvailable(port, "127.0.0.1"), false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  assert.equal(await isPortAvailable(port, "127.0.0.1"), true);
});

for (const protocol of ["TCP", "HTTP"]) {
  test(`CLI rejects an unrelated ${protocol} listener rather than reporting ompgui running`, async (t) => {
    const server = protocol === "HTTP"
      ? http.createServer((_request, response) => { response.writeHead(200); response.end("unrelated service"); })
      : net.createServer((socket) => socket.end());
    const listening = once(server, "listening");
    server.listen({ host: "127.0.0.1", port: 0 });
    await listening;
    t.after(async () => {
      const closed = once(server, "close");
      server.close();
      await closed;
    });
    const child = spawn(process.execPath, [fileURLToPath(new URL("../bin/ompgui.js", import.meta.url)), "--hostname", "127.0.0.1", "--port", String(server.address().port), "--no-open"], { stdio: ["ignore", "pipe", "pipe"] });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    const [code, signal] = await once(child, "close");
    assert.equal(signal, null);
    assert.equal(code, 1);
    assert.match(stderr, /port .*already in use/i);
    assert.doesNotMatch(stdout, /ompgui is already running/i);
  });
}
