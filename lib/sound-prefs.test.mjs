import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getSoundEnabled, setSoundEnabled, SOUND_STORAGE_KEY } = await jiti.import("./sound-prefs.ts");
const legacyKey = SOUND_STORAGE_KEY.replace("ompgui", "omp");

function installStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const storage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: storage };
  return {
    values,
    restore() {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    },
  };
}

test("migrates a valid legacy sound preference once", () => {
  const state = installStorage({ [legacyKey]: "false" });
  try {
    assert.equal(getSoundEnabled(), false);
    assert.equal(state.values.get(SOUND_STORAGE_KEY), "false");
    assert.equal(state.values.has(legacyKey), false);
  } finally {
    state.restore();
  }
});

test("ignores and removes invalid legacy sound values", () => {
  const state = installStorage({ [legacyKey]: "maybe" });
  try {
    assert.equal(getSoundEnabled(), true);
    assert.equal(state.values.has(legacyKey), false);
    assert.equal(state.values.has(SOUND_STORAGE_KEY), false);
  } finally {
    state.restore();
  }
});

test("sound writes use the canonical key", () => {
  const state = installStorage();
  try {
    setSoundEnabled(false);
    assert.equal(state.values.get(SOUND_STORAGE_KEY), "false");
    assert.equal(state.values.has(legacyKey), false);
  } finally {
    state.restore();
  }
});
