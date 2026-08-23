import test from "node:test";
import assert from "node:assert/strict";

async function loadSubject() {
  return import("./event-stream-connection.ts");
}

class FakeSource {
  readyState = 0;
  closed = false;
  handlers;

  constructor(handlers) {
    this.handlers = handlers;
  }

  open() {
    this.readyState = 1;
    this.handlers.onOpen();
  }

  reconnecting() {
    this.readyState = 0;
    this.handlers.onError();
  }

  fatal() {
    this.readyState = 2;
    this.handlers.onError();
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }
}

function makeManager(createEventStreamConnectionManager) {
  const sources = [];
  const manager = createEventStreamConnectionManager({
    timeoutMs: 60_000,
    createSource: (_sessionId, handlers) => {
      const source = new FakeSource(handlers);
      sources.push(source);
      return source;
    },
  });
  return { manager, sources };
}

test("reuses an OPEN source for repeated ensures", async () => {
  const { createEventStreamConnectionManager } = await loadSubject();
  const { manager, sources } = makeManager(createEventStreamConnectionManager);

  const firstReadiness = manager.ensure("session-1");
  assert.equal(sources.length, 1);
  sources[0].open();
  assert.deepEqual(await firstReadiness, { status: "connected", source: sources[0] });

  const secondReadiness = manager.ensure("session-1");
  assert.equal(sources.length, 1);
  assert.deepEqual(await secondReadiness, { status: "connected", source: sources[0] });
});

test("shares one CONNECTING readiness promise", async () => {
  const { createEventStreamConnectionManager } = await loadSubject();
  const { manager, sources } = makeManager(createEventStreamConnectionManager);

  const firstReadiness = manager.ensure("session-1");
  const secondReadiness = manager.ensure("session-1");
  assert.strictEqual(secondReadiness, firstReadiness);
  assert.equal(sources.length, 1);

  sources[0].open();
  assert.equal((await firstReadiness).status, "connected");
});

test("reuses the source while waiting for browser auto-reconnect", async () => {
  const { createEventStreamConnectionManager } = await loadSubject();
  const { manager, sources } = makeManager(createEventStreamConnectionManager);

  const initialReadiness = manager.ensure("session-1");
  sources[0].open();
  await initialReadiness;
  sources[0].reconnecting();

  const reconnectReadiness = manager.ensure("session-1");
  const concurrentReadiness = manager.ensure("session-1");
  assert.strictEqual(concurrentReadiness, reconnectReadiness);
  assert.equal(sources.length, 1);

  sources[0].open();
  assert.equal((await reconnectReadiness).status, "connected");
});

test("session switch invalidates old readiness and fences stale callbacks", async () => {
  const { createEventStreamConnectionManager } = await loadSubject();
  const { manager, sources } = makeManager(createEventStreamConnectionManager);

  const oldReadiness = manager.ensure("old-session");
  const oldSource = sources[0];
  const newReadiness = manager.ensure("new-session");
  assert.equal(oldSource.closed, true);
  assert.equal((await oldReadiness).status, "closed");

  oldSource.open();
  assert.equal(manager.isCurrent("old-session", oldSource), false);
  assert.equal(manager.currentSource("new-session"), sources[1]);

  sources[1].open();
  assert.equal((await newReadiness).status, "connected");
});

test("fatal CLOSED invalidates the source and the next ensure creates a new one", async () => {
  const { createEventStreamConnectionManager } = await loadSubject();
  const { manager, sources } = makeManager(createEventStreamConnectionManager);

  const firstReadiness = manager.ensure("session-1");
  const firstSource = sources[0];
  firstSource.fatal();
  assert.equal((await firstReadiness).status, "closed");
  assert.equal(manager.currentSource("session-1"), null);

  const secondReadiness = manager.ensure("session-1");
  assert.equal(sources.length, 2);
  assert.notEqual(sources[1], firstSource);
  sources[1].open();
  assert.equal((await secondReadiness).status, "connected");
});

test("cleanup invalidates a pending attempt", async () => {
  const { createEventStreamConnectionManager } = await loadSubject();
  const { manager, sources } = makeManager(createEventStreamConnectionManager);

  const readiness = manager.ensure("session-1");
  manager.invalidate();
  assert.equal(sources[0].closed, true);
  assert.equal((await readiness).status, "closed");
  assert.equal(manager.currentSource("session-1"), null);
});
