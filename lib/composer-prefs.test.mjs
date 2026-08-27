import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  getSubmitDuringRunBehavior,
  setSubmitDuringRunBehavior,
  subscribeSubmitDuringRunBehavior,
} = jiti("./composer-prefs.ts");

test("notifies same-page subscribers when the active-run behavior changes", () => {
  const previousWindow = globalThis.window;
  const values = new Map();
  const events = new EventTarget();
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
    addEventListener: (...args) => events.addEventListener(...args),
    removeEventListener: (...args) => events.removeEventListener(...args),
    dispatchEvent: (...args) => events.dispatchEvent(...args),
  };

  let notifications = 0;
  try {
    const unsubscribe = subscribeSubmitDuringRunBehavior(() => {
      notifications += 1;
    });
    setSubmitDuringRunBehavior("queue");
    assert.equal(getSubmitDuringRunBehavior(), "queue");
    assert.equal(notifications, 1);
    unsubscribe();
    setSubmitDuringRunBehavior("steer");
    assert.equal(notifications, 1);
  } finally {
    globalThis.window = previousWindow;
  }
});
