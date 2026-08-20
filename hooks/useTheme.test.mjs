import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { nextThemePreference, normalizeThemePalette, resolveTheme } = await jiti.import("./useTheme.ts");

test("cycles explicit and system theme preferences", () => {
  assert.equal(nextThemePreference("light"), "dark");
  assert.equal(nextThemePreference("dark"), "system");
  assert.equal(nextThemePreference("system"), "light");
});

test("resolves system theme from the operating system preference", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});

test("normalizes stored palettes to the warm default", () => {
  assert.equal(normalizeThemePalette("omp"), "omp");
  assert.equal(normalizeThemePalette("warm"), "warm");
  assert.equal(normalizeThemePalette("unknown"), "warm");
  assert.equal(normalizeThemePalette(null), "warm");
});
