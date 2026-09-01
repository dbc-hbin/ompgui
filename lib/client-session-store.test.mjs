import assert from "node:assert/strict";
import test from "node:test";

import {
  getSessionListSnapshot,
  invalidateSessionList,
  loadSessionList,
  resetClientSessionStore,
  subscribeSessionList,
} from "./client-session-store.ts";

function jsonResponse(body, { status = 200, etag } = {}) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (etag) headers.set("ETag", etag);
  return new Response(JSON.stringify(body), { status, headers });
}

function session(id, name = id) {
  return {
    path: `/tmp/${id}.jsonl`,
    id,
    cwd: "/tmp",
    name,
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "hi",
  };
}

const originalFetch = globalThis.fetch;

test.beforeEach(() => {
  resetClientSessionStore();
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("shares one request between concurrent session-list consumers", async () => {
  let fetches = 0;
  let finish;
  globalThis.fetch = async () => {
    fetches += 1;
    await new Promise((resolve) => { finish = resolve; });
    return jsonResponse({ sessions: [session("a")], runningSessionIds: ["a"] }, { etag: '"etag-a"' });
  };

  const first = loadSessionList();
  const second = loadSessionList();
  assert.equal(fetches, 1);
  finish();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(left, right);
  assert.equal(left.sessions[0].id, "a");
  assert.equal(left.runningSessionIds[0], "a");
  assert.equal(left.status, "ready");
  assert.equal(fetches, 1);
});

test("sends If-None-Match and keeps the previous snapshot on 304", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), ifNoneMatch: new Headers(init?.headers).get("If-None-Match") });
    if (calls.length === 1) {
      return jsonResponse({ sessions: [session("a")], runningSessionIds: [] }, { etag: '"etag-1"' });
    }
    return new Response(null, { status: 304, headers: { ETag: '"etag-1"' } });
  };

  await loadSessionList();
  const snapshot = await loadSessionList();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].ifNoneMatch, null);
  assert.equal(calls[1].ifNoneMatch, '"etag-1"');
  assert.equal(snapshot.sessions[0].id, "a");
  assert.equal(snapshot.etag, '"etag-1"');
  assert.equal(snapshot.status, "ready");
});

test("does not let a stale response overwrite a newer invalidation", async () => {
  const resolvers = [];
  globalThis.fetch = async () => {
    const body = { sessions: [session(`n${resolvers.length}`)] };
    const etag = `"e${resolvers.length}"`;
    await new Promise((resolve) => { resolvers.push(resolve); });
    return jsonResponse(body, { etag });
  };

  const stale = loadSessionList();
  await Promise.resolve();
  invalidateSessionList();
  const fresh = loadSessionList();
  await Promise.resolve();
  assert.equal(resolvers.length, 2);

  resolvers[0]();
  await stale;
  assert.equal(getSessionListSnapshot().sessions.length, 0);

  resolvers[1]();
  const snapshot = await fresh;
  assert.equal(snapshot.sessions[0].id, "n1");
  assert.equal(getSessionListSnapshot().sessions[0].id, "n1");
});

test("keeps prior sessions when a refresh fails", async () => {
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    if (fetches === 1) return jsonResponse({ sessions: [session("kept")] }, { etag: '"etag-k"' });
    return new Response("nope", { status: 500 });
  };

  await loadSessionList();
  invalidateSessionList();
  const snapshot = await loadSessionList();
  assert.equal(snapshot.status, "error");
  assert.match(snapshot.error ?? "", /HTTP 500/);
  assert.equal(snapshot.sessions[0].id, "kept");
});

test("does not treat a first-load error as an empty result", async () => {
  globalThis.fetch = async () => new Response("nope", { status: 502 });
  const snapshots = [];
  const unsubscribe = subscribeSessionList((snapshot) => { snapshots.push(snapshot.status); });
  const snapshot = await loadSessionList();
  unsubscribe();
  assert.equal(snapshot.status, "error");
  assert.deepEqual(snapshot.sessions, []);
  assert.match(snapshot.error ?? "", /HTTP 502/);
  assert.ok(snapshots.includes("loading"));
  assert.ok(snapshots.includes("error"));
});

test("force refresh omits If-None-Match", async () => {
  const headers = [];
  globalThis.fetch = async (_url, init) => {
    headers.push(new Headers(init?.headers).get("If-None-Match"));
    return jsonResponse({ sessions: [session("b")] }, { etag: `"e${headers.length}"` });
  };
  await loadSessionList();
  await loadSessionList({ force: true });
  assert.equal(headers[0], null);
  assert.equal(headers[1], null);
});
