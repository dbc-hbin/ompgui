import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createVisibilityPausedInterval } from "../lib/visibility-timers.ts";

const LIVE_STREAM_STATS_INTERVAL_MS = 1_000;

test("live stream stats use a visibility-aware 1s cadence", async () => {
  const source = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");
  assert.match(source, /LIVE_STREAM_STATS_INTERVAL_MS = 1_000/);
  assert.match(source, /createVisibilityPausedInterval\(tick, LIVE_STREAM_STATS_INTERVAL_MS\)/);
  assert.doesNotMatch(source, /setInterval\(tick, 300\)/);
});

test("hidden documents do not tick live stream stats", () => {
  const host = {
    hidden: true,
    listeners: new Set(),
    addEventListener(_type, listener) {
      this.listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      this.listeners.delete(listener);
    },
  };
  let ticks = 0;
  const ids = new Set();
  const stop = createVisibilityPausedInterval(
    () => {
      ticks += 1;
    },
    LIVE_STREAM_STATS_INTERVAL_MS,
    host,
    {
      setInterval(fn, ms) {
        assert.equal(ms, 1_000);
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
  assert.equal(ticks, 0);
  host.hidden = false;
  for (const listener of host.listeners) listener();
  assert.equal(ids.size, 1);
  for (const id of ids) id.fn();
  assert.equal(ticks, 1);
  stop();
});
