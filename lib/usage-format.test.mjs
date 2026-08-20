import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: true, tsconfigPaths: true });
const { formatDuration } = await jiti.import("../components/UsageConfig.tsx");

test("formatDuration matches oh-my-pi duration formatting", () => {
  const cases = [
    [0, "0ms"],
    [500, "500ms"],
    [1_500, "1.5s"],
    [61_000, "1m1s"],
    [3_661_000, "1h1m"],
    [90_061_000, "1d1h"],
    [172_800_000 + 3_660_000, "2d1h"],
  ];

  for (const [milliseconds, expected] of cases) {
    assert.equal(formatDuration(milliseconds), expected);
  }
});
