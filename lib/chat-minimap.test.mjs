import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { minimapMeasureKey } = await jiti.import("../components/ChatMinimap.tsx");

test("equal-size render window shifts invalidate minimap measurements", () => {
  const messageCount = 80;
  const current = minimapMeasureKey(messageCount, 100, 150);
  const shifted = minimapMeasureKey(messageCount, 50, 100);
  assert.notEqual(shifted, current);
  assert.equal(minimapMeasureKey(messageCount, 100, 150), current);
});
