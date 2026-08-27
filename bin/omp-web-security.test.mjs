import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("legacy omp-web launcher remains a compatibility wrapper", async () => {
  const compatSource = await readFile(new URL("./omp-web.js", import.meta.url), "utf8");
  assert.match(compatSource, /ompgui\.js/);
});
