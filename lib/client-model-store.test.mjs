import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIENT_MODELS_TTL_MS,
  getClientModelsSnapshot,
  invalidateClientModels,
  loadClientModels,
  resetClientModelStore,
} from "./client-model-store.ts";

function modelsPayload(id) {
  return {
    models: { [`provider:${id}`]: id },
    modelList: [{ id, name: id, provider: "provider" }],
    defaultModel: null,
    thinkingLevels: {},
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const originalFetch = globalThis.fetch;

test.beforeEach(() => {
  resetClientModelStore();
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("shares one request between concurrent loads for the same cwd", async () => {
  let fetches = 0;
  let finish;
  globalThis.fetch = async () => {
    fetches += 1;
    await new Promise((resolve) => { finish = resolve; });
    return jsonResponse(modelsPayload("shared"));
  };

  const first = loadClientModels("/shared");
  const second = loadClientModels("/shared");
  assert.equal(fetches, 1);
  finish();
  assert.deepEqual(await second, await first);
  assert.equal(fetches, 1);
});

test("isolates cached model responses by cwd", async () => {
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    const cwd = String(url).includes("first") ? "first" : "second";
    return jsonResponse(modelsPayload(cwd));
  };

  const first = await loadClientModels("/first");
  const second = await loadClientModels("/second");
  const firstAgain = await loadClientModels("/first");

  assert.equal(first.modelList[0].id, "first");
  assert.equal(second.modelList[0].id, "second");
  assert.equal(firstAgain, first);
  assert.deepEqual(seen, [
    "/api/models?cwd=%2Ffirst",
    "/api/models?cwd=%2Fsecond",
  ]);
});

test("does not cache a stale load that finishes after invalidation", async () => {
  const resolvers = [];
  globalThis.fetch = async () => {
    const id = resolvers.length === 0 ? "stale" : "fresh";
    await new Promise((resolve) => { resolvers.push(resolve); });
    return jsonResponse(modelsPayload(id));
  };

  const stale = loadClientModels("/race");
  await Promise.resolve();
  invalidateClientModels("/race");
  const fresh = loadClientModels("/race");
  await Promise.resolve();
  assert.equal(resolvers.length, 2);

  resolvers[0]();
  const staleData = await stale;
  assert.equal(staleData.modelList[0].id, "stale");
  assert.equal(getClientModelsSnapshot("/race").data, null);

  resolvers[1]();
  const data = await fresh;
  assert.equal(data.modelList[0].id, "fresh");
  assert.equal(getClientModelsSnapshot("/race").data?.modelList[0].id, "fresh");
});

test("does not treat a failed load as an empty success", async () => {
  globalThis.fetch = async () => new Response("nope", { status: 503 });
  await assert.rejects(loadClientModels("/failed"), /HTTP 503/);
  const snapshot = getClientModelsSnapshot("/failed");
  assert.equal(snapshot.status, "error");
  assert.equal(snapshot.data, null);
  assert.match(snapshot.error ?? "", /HTTP 503/);
});

test("serves a fresh TTL hit without refetching, then revalidates after expiry", async () => {
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    return jsonResponse(modelsPayload(`v${fetches}`));
  };

  const first = await loadClientModels("/ttl");
  const second = await loadClientModels("/ttl");
  assert.equal(second, first);
  assert.equal(fetches, 1);

  const realNow = Date.now.bind(Date);
  const originalNow = Date.now;
  Date.now = () => realNow() + CLIENT_MODELS_TTL_MS + 1;
  try {
    const revalidated = await loadClientModels("/ttl");
    assert.equal(revalidated.modelList[0].id, "v2");
    assert.notEqual(revalidated, first);
    assert.equal(fetches, 2);
    assert.equal(getClientModelsSnapshot("/ttl").data?.modelList[0].id, "v2");
  } finally {
    Date.now = originalNow;
  }
});

test("expired in-flight revalidation is shared so callers observe the fresh response", async () => {
  let fetches = 0;
  let finish;
  globalThis.fetch = async () => {
    fetches += 1;
    const id = fetches === 1 ? "v1" : "v2";
    if (fetches === 1) return jsonResponse(modelsPayload(id));
    await new Promise((resolve) => { finish = resolve; });
    return jsonResponse(modelsPayload(id));
  };

  const first = await loadClientModels("/shared-revalidate");
  const realNow = Date.now.bind(Date);
  const originalNow = Date.now;
  Date.now = () => realNow() + CLIENT_MODELS_TTL_MS + 1;
  try {
    const firstExpired = loadClientModels("/shared-revalidate");
    const secondExpired = loadClientModels("/shared-revalidate");
    assert.equal(fetches, 2);
    finish();
    const [a, b] = await Promise.all([firstExpired, secondExpired]);
    assert.equal(a.modelList[0].id, "v2");
    assert.equal(b.modelList[0].id, "v2");
    assert.notEqual(a, first);
  } finally {
    Date.now = originalNow;
  }
});
