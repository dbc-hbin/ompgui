import assert from "node:assert/strict";
import test from "node:test";

import {
  createVisibilityPausedInterval,
  delayWhileDocumentVisible,
  EVENT_STREAM_RECONNECT_MAX_MS,
  isDocumentHidden,
  nextEventStreamReconnectDelayMs,
} from "./visibility-timers.ts";

function createHost(hidden) {
  const listeners = new Set();
  return {
    hidden,
    listeners,
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
    setHidden(next) {
      this.hidden = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

test("reconnect delay doubles then caps without overflowing", () => {
  assert.equal(nextEventStreamReconnectDelayMs(0), 1_000);
  assert.equal(nextEventStreamReconnectDelayMs(1), 2_000);
  assert.equal(nextEventStreamReconnectDelayMs(2), 4_000);
  assert.equal(nextEventStreamReconnectDelayMs(10), EVENT_STREAM_RECONNECT_MAX_MS);
  assert.equal(nextEventStreamReconnectDelayMs(-3), 1_000);
});

test("hidden documents report as hidden", () => {
  assert.equal(isDocumentHidden(undefined), false);
  assert.equal(isDocumentHidden({ hidden: false }), false);
  assert.equal(isDocumentHidden({ hidden: true }), true);
});

test("visibility-paused interval does not tick while hidden", () => {
  const host = createHost(true);
  const calls = [];
  const ids = new Set();
  const stop = createVisibilityPausedInterval(
    () => {
      calls.push("tick");
    },
    10,
    host,
    {
      setInterval(fn) {
        const id = { fn };
        ids.add(id);
        return id;
      },
      clearInterval(id) {
        ids.delete(id);
      },
    },
  );

  assert.equal(ids.size, 0);
  assert.deepEqual(calls, []);

  host.setHidden(false);
  assert.equal(ids.size, 1);
  for (const id of ids) id.fn();
  assert.deepEqual(calls, ["tick"]);

  host.setHidden(true);
  assert.equal(ids.size, 0);

  stop();
  assert.equal(ids.size, 0);
});

test("visible delay pauses remaining time while hidden", async () => {
  const host = createHost(false);
  let now = 1_000;
  const pending = [];
  const finished = delayWhileDocumentVisible(40, host, {
    now: () => now,
    setTimeout(fn, ms) {
      pending.push({ fn, ms });
      return pending[pending.length - 1];
    },
    clearTimeout(id) {
      const index = pending.indexOf(id);
      if (index !== -1) pending.splice(index, 1);
    },
  });

  assert.equal(pending.length, 1);
  assert.equal(pending[0].ms, 40);

  now = 1_010;
  host.setHidden(true);
  assert.equal(pending.length, 0);

  now = 5_000;
  host.setHidden(false);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].ms, 30);
  pending[0].fn();
  await finished;
});

test("aborted hidden delay drops the listener and retains no timeout", async () => {
  const host = createHost(true);
  const pending = [];
  const controller = new AbortController();
  const finished = delayWhileDocumentVisible(40, host, {
    setTimeout(fn, ms) {
      pending.push({ fn, ms });
      return pending[pending.length - 1];
    },
    clearTimeout(id) {
      const index = pending.indexOf(id);
      if (index !== -1) pending.splice(index, 1);
    },
  }, controller.signal);

  assert.equal(host.listeners.size, 1);
  assert.equal(pending.length, 0);
  controller.abort();
  await finished;
  assert.equal(host.listeners.size, 0);
  assert.equal(pending.length, 0);
});

test("already-aborted delay never arms a listener", async () => {
  const host = createHost(true);
  const controller = new AbortController();
  controller.abort();
  await delayWhileDocumentVisible(40, host, {
    setTimeout() {
      throw new Error("timeout must not arm");
    },
    clearTimeout() {},
  }, controller.signal);
  assert.equal(host.listeners.size, 0);
});
