import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { parseLaunchOptions } = require("../bin/ompgui-options.js");
test("ompgui options prefer new environment names", () => {
  const options = parseLaunchOptions([], { OMPGUI_PORT:"1234", OMP_WEB_PORT:"5678", OMPGUI_HOSTNAME:"0.0.0.0", OMP_WEB_HOSTNAME:"localhost", OMPGUI_PASSWORD:"secret" });
  assert.deepEqual(options, { command:undefined, extraPositionals:[], port:"1234", hostname:"0.0.0.0", password:"secret", relayUrl:undefined, openBrowser:true });
});
test("legacy environment names remain fallbacks", () => {
  const options = parseLaunchOptions([], { OMP_WEB_PORT:"5678", OMP_WEB_HOSTNAME:"localhost", OMP_WEB_PASSWORD:"old", OMP_WEB_NO_OPEN:"yes" });
  assert.equal(options.port, "5678"); assert.equal(options.hostname, "localhost"); assert.equal(options.password, "old"); assert.equal(options.openBrowser, false);
});
test("CLI values override environment", () => {
  const options = parseLaunchOptions(["--port","9","--hostname","localhost","--password","cli","--no-open"], { OMPGUI_PORT:"1" });
  assert.deepEqual(options, { command:undefined, extraPositionals:[], port:"9", hostname:"localhost", password:"cli", relayUrl:undefined, openBrowser:false });
});
