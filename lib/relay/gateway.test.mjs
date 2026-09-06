import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { Duplex } from "node:stream";
import { encodeMaskedFrame } from "./websocket-test-fixtures.mjs";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { handleRelayUpgrade, isRelayUpgradeOriginAllowed } = await jiti.import("./gateway.ts");

const upgradeRequest = {
  url: "/relay",
  headers: {
    upgrade: "websocket", connection: "Upgrade",
    "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
  },
};

test("upgrade delivers coalesced hello after attaching connection handlers", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const priorCount = globalThis.__ompguiRelayConnectionCount;
  globalThis.__ompguiRelayConnectionCount = 2;
  const writes = [];
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, callback) { writes.push(Buffer.from(chunk)); callback(); },
  });
  t.after(() => { socket.destroy(); globalThis.__ompguiRelayConnectionCount = priorCount; });
  // A protocol mismatch must receive a hello_err immediately, not be dropped until the hello timeout.
  const hello = encodeMaskedFrame(1, Buffer.from(JSON.stringify({ op: "hello", protocol: -1 })), Buffer.alloc(4));
  handleRelayUpgrade(upgradeRequest, socket, hello);
  assert.match(writes[0].toString(), /^HTTP\/1\.1 101 Switching Protocols\r\n/);
  assert.equal(writes[1][0], 0x81);
  const offset = (writes[1][1] & 0x7f) === 126 ? 4 : 2;
  assert.equal(JSON.parse(writes[1].subarray(offset).toString()).op, "hello_err");
  assert.equal(globalThis.__ompguiRelayConnectionCount, 2);
});

for (const [name, head] of [
  ["close", encodeMaskedFrame(8, Buffer.alloc(0), Buffer.alloc(4))],
  ["invalid", Buffer.from([0x81, 0x00])],
]) {
  test(`${name} upgrade head releases its slot exactly once`, (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const priorCount = globalThis.__ompguiRelayConnectionCount;
    globalThis.__ompguiRelayConnectionCount = 2;
    const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback(); } });
    t.after(() => { socket.destroy(); globalThis.__ompguiRelayConnectionCount = priorCount; });
    handleRelayUpgrade(upgradeRequest, socket, head);
    assert.equal(globalThis.__ompguiRelayConnectionCount, 2);
    socket.emit("end");
    socket.emit("close");
    assert.equal(globalThis.__ompguiRelayConnectionCount, 2);
  });
}

test("allows native upgrades without Origin and same-host browser origins", () => {
  assert.equal(isRelayUpgradeOriginAllowed({ headers: {} }), true);
  assert.equal(isRelayUpgradeOriginAllowed({
    headers: { origin: "http://127.0.0.1:30177", host: "127.0.0.1:30177" },
  }), true);
  assert.equal(isRelayUpgradeOriginAllowed({
    headers: { origin: "https://evil.example", host: "mac.tailnet.ts.net" },
  }), false);
  assert.equal(isRelayUpgradeOriginAllowed({
    headers: { "sec-fetch-site": "cross-site" },
  }), false);
});
