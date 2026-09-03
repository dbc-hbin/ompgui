import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { isPortaledMobileSheetTarget, shouldDismissComposerMenu } = await jiti.import("./composer-menus.ts");

function sheetTarget() {
  const overlay = { closest: (selector) => selector === ".mobile-sheet-overlay" ? overlay : null };
  return overlay;
}

function outsideTarget() {
  return { nodeType: 1, closest: () => null };
}

test("detects clicks inside a portaled mobile sheet overlay", () => {
  assert.equal(isPortaledMobileSheetTarget(sheetTarget()), true);
  assert.equal(isPortaledMobileSheetTarget(outsideTarget()), false);
  assert.equal(isPortaledMobileSheetTarget(null), false);
});

test("does not dismiss composer menus for portaled mobile sheet clicks", () => {
  const trigger = { contains: () => false };
  const panel = { contains: () => false };
  assert.equal(shouldDismissComposerMenu(sheetTarget(), trigger, panel), false);
});

test("does not dismiss when the desktop panel is not mounted (mobile sheet path)", () => {
  const trigger = { contains: () => false };
  assert.equal(shouldDismissComposerMenu(outsideTarget(), trigger, null), false);
});

test("does not dismiss clicks inside the trigger or desktop panel", () => {
  const inside = outsideTarget();
  assert.equal(shouldDismissComposerMenu(inside, { contains: (node) => node === inside }, { contains: () => false }), false);
  assert.equal(shouldDismissComposerMenu(inside, { contains: () => false }, { contains: (node) => node === inside }), false);
});

test("dismisses desktop menus on true outside clicks", () => {
  const trigger = { contains: () => false };
  const panel = { contains: () => false };
  assert.equal(shouldDismissComposerMenu(outsideTarget(), trigger, panel), true);
});
