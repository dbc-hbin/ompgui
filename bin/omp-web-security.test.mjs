import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("launcher refuses unauthenticated non-loopback binds", async () => {
  const launcherSource = await readFile(new URL("./ompgui.js", import.meta.url), "utf8");
  assert.match(launcherSource, /Refusing to listen on/);
  assert.match(launcherSource, /password/);

  const compatSource = await readFile(new URL("./omp-web.js", import.meta.url), "utf8");
  assert.match(compatSource, /ompgui\.js/);
});
