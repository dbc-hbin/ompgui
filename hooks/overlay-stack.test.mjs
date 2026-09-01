import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createJiti } from "jiti";

const emitter = new EventEmitter();
globalThis.window = {
  addEventListener(type, listener) {
    emitter.on(type, listener);
  },
  removeEventListener(type, listener) {
    emitter.off(type, listener);
  },
  dispatchEvent(event) {
    emitter.emit(event.type, event);
    return !event.defaultPrevented;
  },
};

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { registerOverlay, closeTopOverlay, getOverlayDepth } = await jiti.import("./overlay-stack.ts");

test("closeTopOverlay closes only the most recently registered overlay", () => {
  const closed = [];
  const unregisterLower = registerOverlay(() => closed.push("lower"));
  const unregisterUpper = registerOverlay(() => closed.push("upper"));
  assert.equal(getOverlayDepth(), 2);
  assert.equal(closeTopOverlay(), true);
  assert.deepEqual(closed, ["upper"]);
  unregisterUpper();
  assert.equal(getOverlayDepth(), 1);
  assert.equal(closeTopOverlay(), true);
  assert.deepEqual(closed, ["upper", "lower"]);
  unregisterLower();
  assert.equal(getOverlayDepth(), 0);
  assert.equal(closeTopOverlay(), false);
});

test("ompgui:overlay-back is consumed only by the topmost overlay", () => {
  const closed = [];
  const unregisterLower = registerOverlay(() => closed.push("lower"));
  const unregisterUpper = registerOverlay(() => closed.push("upper"));

  const event = new Event("ompgui:overlay-back", { cancelable: true });
  window.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(closed, ["upper"]);
  unregisterUpper();

  const second = new Event("ompgui:overlay-back", { cancelable: true });
  window.dispatchEvent(second);
  assert.equal(second.defaultPrevented, true);
  assert.deepEqual(closed, ["upper", "lower"]);
  unregisterLower();
  assert.equal(getOverlayDepth(), 0);
});
