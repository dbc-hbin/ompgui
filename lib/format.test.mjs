import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getCacheHitRate } = await jiti.import("./format.ts");

test("calculates provider prompt-cache hit rate", () => {
  assert.equal(getCacheHitRate(25, 75), 75);
  assert.equal(getCacheHitRate(0, 50), 100);
  assert.equal(getCacheHitRate(50, 0), 0);
  assert.equal(getCacheHitRate(0, 0), null);
});
