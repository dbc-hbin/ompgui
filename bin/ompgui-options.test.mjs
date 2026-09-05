import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { parseLaunchOptions } from "./ompgui-options.js";

test("parseLaunchOptions accepts pair and devices commands", () => {
  const pair = parseLaunchOptions(["pair", "--url", "wss://mac.example.ts.net/relay"], {});
  assert.equal(pair.command, "pair");
  assert.equal(pair.relayUrl, "wss://mac.example.ts.net/relay");

  const devices = parseLaunchOptions(["devices", "revoke", "d_abc"], {});
  assert.equal(devices.command, "devices");
  assert.deepEqual(devices.extraPositionals, ["revoke", "d_abc"]);
});

test("ompgui pair fails when the server is not running", () => {
  const result = spawnSync(process.execPath, ["bin/ompgui.js", "pair", "--no-open", "-p", "30179"], {
    encoding: "utf8",
    env: { ...process.env, OMPGUI_PASSWORD: "", OMP_WEB_PASSWORD: "" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not running/);
});
