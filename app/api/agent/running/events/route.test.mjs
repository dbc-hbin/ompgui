import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeSource = await readFile(new URL("./route.ts", import.meta.url), "utf8");

test("running events disable proxy buffering", () => {
  assert.match(routeSource, /"X-Accel-Buffering": "no"/);
});
