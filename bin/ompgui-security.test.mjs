import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("ompgui refuses unauthenticated non-loopback binds", () => {
  const result = spawnSync(process.execPath, ["bin/ompgui.js", "--hostname", "0.0.0.0", "--no-open"], { encoding:"utf8", env:{ ...process.env, OMPGUI_PASSWORD:"", OMP_WEB_PASSWORD:"", OMPGUI_HOSTNAME:undefined, OMP_WEB_HOSTNAME:undefined } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing to listen/);
});
