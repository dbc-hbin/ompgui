import test from "node:test";
import assert from "node:assert/strict";

async function loadSubject() {
  return import("./sse-message-update-coalescer.ts");
}

function manualScheduler() {
  const entries = [];
  let cancelledCount = 0;
  const schedule = (flush, delayMs) => {
    const entry = { flush, delayMs, cancelled: false };
    entries.push(entry);
    return () => {
      if (entry.cancelled) return;
      entry.cancelled = true;
      cancelledCount += 1;
    };
  };
  const fire = () => {
    for (const entry of entries.splice(0)) {
      if (!entry.cancelled) entry.flush();
    }
  };
  return {
    entries,
    schedule,
    fire,
    get cancelledCount() {
      return cancelledCount;
    },
  };
}

function subject({ desiredSize = 1, scheduler = manualScheduler() } = {}) {
  const emitted = [];
  let serializations = 0;
  const coalescerPromise = loadSubject().then(({ createSseMessageUpdateCoalescer }) => {
    const coalescer = createSseMessageUpdateCoalescer({
      emit(event) {
        serializations += 1;
        emitted.push(JSON.stringify(event));
        return true;
      },
      isBackpressured() {
        return desiredSize <= 0;
      },
      schedule: scheduler.schedule,
    });
    return {
      coalescer,
      emitted,
      get serializations() {
        return serializations;
      },
      set desiredSize(value) {
        desiredSize = value;
      },
    };
  });
  return coalescerPromise;
}

test("coalesces a burst into the latest update after one 33ms window", async () => {
  const scheduler = manualScheduler();
  const { coalescer, emitted, serializations } = await subject({ scheduler });

  coalescer.push({ type: "message_update", seq: 1 });
  coalescer.push({ type: "message_update", seq: 2 });
  coalescer.push({ type: "message_update", seq: 3 });

  assert.equal(scheduler.entries.length, 1);
  assert.equal(scheduler.entries[0].delayMs, 33);
  assert.equal(serializations, 0);

  scheduler.fire();
  assert.deepEqual(emitted, ['{"type":"message_update","seq":3}']);
});

test("flushes a pending update before a control event", async () => {
  const scheduler = manualScheduler();
  const { coalescer, emitted } = await subject({ desiredSize: 0, scheduler });

  coalescer.push({ type: "message_update", seq: 1 });
  coalescer.push({ type: "tool_execution_start", toolCallId: "t1" });

  assert.deepEqual(emitted, [
    '{"type":"message_update","seq":1}',
    '{"type":"tool_execution_start","toolCallId":"t1"}',
  ]);
  scheduler.fire();
  assert.equal(emitted.length, 2);
});

test("message_end drops pending updates and emits the authoritative final event", async () => {
  const scheduler = manualScheduler();
  const { coalescer, emitted } = await subject({ scheduler });

  coalescer.push({ type: "message_update", seq: 1 });
  coalescer.push({ type: "message_update", seq: 2 });
  coalescer.push({ type: "message_end", seq: 3 });

  assert.deepEqual(emitted, ['{"type":"message_end","seq":3}']);
  scheduler.fire();
  assert.equal(emitted.length, 1);
});

test("pull flushes one latest update as soon as desiredSize recovers", async () => {
  const scheduler = manualScheduler();
  const state = await subject({ desiredSize: 0, scheduler });

  state.coalescer.push({ type: "message_update", seq: 1 });
  state.coalescer.push({ type: "message_update", seq: 2 });
  assert.equal(state.serializations, 0);

  state.desiredSize = 1;
  assert.equal(state.coalescer.pull(), true);
  assert.deepEqual(state.emitted, ['{"type":"message_update","seq":2}']);

  scheduler.fire();
  assert.equal(state.emitted.length, 1);
});

test("reset cancels the timer and drops a pending update", async () => {
  const scheduler = manualScheduler();
  const { coalescer, emitted } = await subject({ scheduler });

  coalescer.push({ type: "message_update", seq: 1 });
  coalescer.reset();
  scheduler.fire();

  assert.deepEqual(emitted, []);
  assert.equal(scheduler.cancelledCount, 1);
});
