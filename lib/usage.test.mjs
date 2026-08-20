import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  buildEmptyUsageResponse,
  fetchCachedUsage,
  fetchUsagePayload,
  resolveUsageUsedFraction,
} = await jiti.import("./usage.ts");

test("resolveUsageUsedFraction: precedence branch 1 (usedFraction)", () => {
  const limit = {
    id: "test",
    label: "Test Limit",
    scope: { provider: "test" },
    amount: {
      usedFraction: 0.42,
      used: 10,
      limit: 100,
      unit: "requests",
      remainingFraction: 0.9,
    },
  };
  assert.equal(resolveUsageUsedFraction(limit), 0.42);
});

test("resolveUsageUsedFraction: precedence branch 2 (used / limit)", () => {
  const limit = {
    id: "test",
    label: "Test Limit",
    scope: { provider: "test" },
    amount: {
      used: 25,
      limit: 100,
      unit: "requests",
      remainingFraction: 0.9,
    },
  };
  assert.equal(resolveUsageUsedFraction(limit), 0.25);
});

test("resolveUsageUsedFraction: precedence branch 3 (unit percent)", () => {
  const limit = {
    id: "test",
    label: "Test Limit",
    scope: { provider: "test" },
    amount: {
      used: 75,
      unit: "percent",
      remainingFraction: 0.1,
    },
  };
  assert.equal(resolveUsageUsedFraction(limit), 0.75);
});

test("resolveUsageUsedFraction: precedence branch 4 (inverted remainingFraction)", () => {
  const limit = {
    id: "test",
    label: "Test Limit",
    scope: { provider: "test" },
    amount: {
      unit: "tokens",
      remainingFraction: 0.3,
    },
  };
  assert.equal(resolveUsageUsedFraction(limit), 0.7);
});

test("resolveUsageUsedFraction: fallback undefined", () => {
  const limit = {
    id: "test",
    label: "Test Limit",
    scope: { provider: "test" },
    amount: {
      unit: "unknown",
    },
  };
  assert.equal(resolveUsageUsedFraction(limit), undefined);
});

test("buildEmptyUsageResponse creates proper structure", () => {
  const res = buildEmptyUsageResponse("no-credentials");
  assert.equal(res.cached, false);
  assert.deepEqual(res.reports, []);
  assert.deepEqual(res.accountsWithoutUsage, []);
  assert.deepEqual(res.disabledCredentials, []);
  assert.deepEqual(res.capacity, {});
  assert.equal(res.emptyReason, "no-credentials");
  assert.equal(typeof res.generatedAt, "number");
});

test("fetchUsagePayload: success with valid payload", async () => {
  const mockPayload = {
    generatedAt: 1234567890,
    reports: [
      {
        provider: "mock",
        fetchedAt: 1234567800,
        limits: [],
      },
    ],
    accountsWithoutUsage: [],
    disabledCredentials: [],
    capacity: {},
  };

  const executor = async () => ({
    stdout: JSON.stringify(mockPayload),
  });

  const result = await fetchUsagePayload({ executor });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.cached, false);
    assert.equal(result.payload.reports.length, 1);
    assert.equal(result.payload.emptyReason, undefined);
  }
});

test("fetchUsagePayload: accounts without usage do not imply an empty reason", async () => {
  const mockPayload = {
    generatedAt: 1234567890,
    reports: [],
    accountsWithoutUsage: [{ provider: "ollama", type: "api_key" }],
    disabledCredentials: [],
    capacity: {},
  };

  const executor = async () => ({
    stdout: JSON.stringify(mockPayload),
  });

  const result = await fetchUsagePayload({ executor });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.emptyReason, undefined);
  }
});

test("fetchUsagePayload: all empty -> emptyReason no-credentials", async () => {
  const mockPayload = {
    generatedAt: 1234567890,
    reports: [],
    accountsWithoutUsage: [],
    disabledCredentials: [],
    capacity: {},
  };

  const executor = async () => ({
    stdout: JSON.stringify(mockPayload),
  });

  const result = await fetchUsagePayload({ executor });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.emptyReason, "no-credentials");
  }
});

test("fetchUsagePayload: legacy no-usage-endpoint reason is normalized", async () => {
  const executor = async () => ({
    stdout: JSON.stringify({
      generatedAt: 1234567890,
      reports: [],
      accountsWithoutUsage: [],
      disabledCredentials: [],
      capacity: {},
      emptyReason: "no-usage-endpoint",
    }),
  });

  const result = await fetchUsagePayload({ executor });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.emptyReason, "no-credentials");
  }
});

test("fetchCachedUsage: refresh supersedes an ordinary in-flight fetch", async () => {
  let resolveOrdinary;
  const ordinaryPayload = {
    generatedAt: 1,
    reports: [],
    accountsWithoutUsage: [],
    disabledCredentials: [],
    capacity: {},
    cached: false,
    emptyReason: "no-credentials",
  };
  const refreshedPayload = { ...ordinaryPayload, generatedAt: 2 };
  const ordinaryResult = new Promise((resolve) => {
    resolveOrdinary = resolve;
  });
  let fetchCount = 0;
  let invalidateCount = 0;
  const dependencies = {
    ttlMs: 60_000,
    invalidate: async () => {
      invalidateCount += 1;
    },
    fetch: async () => {
      fetchCount += 1;
      if (fetchCount === 1) return ordinaryResult;
      assert.equal(invalidateCount, 1);
      return { ok: true, payload: refreshedPayload };
    },
  };
  const state = { entry: { at: 0, payload: ordinaryPayload } };

  const ordinaryRequest = fetchCachedUsage(state, false, dependencies);
  const refreshRequest = fetchCachedUsage(state, true, dependencies);
  const concurrentRefresh = fetchCachedUsage(state, true, dependencies);
  const requestDuringRefresh = fetchCachedUsage(state, false, dependencies);

  const [refreshResult, concurrentResult, duringResult] = await Promise.all([
    refreshRequest,
    concurrentRefresh,
    requestDuringRefresh,
  ]);
  resolveOrdinary({ ok: true, payload: ordinaryPayload });
  const ordinaryResponse = await ordinaryRequest;

  assert.equal(invalidateCount, 1);
  assert.equal(fetchCount, 2);
  assert.equal(refreshResult.payload.generatedAt, 2);
  assert.equal(concurrentResult.payload.generatedAt, 2);
  assert.equal(duringResult.payload.generatedAt, 2);
  assert.equal(ordinaryResponse.payload.generatedAt, 2);
  assert.equal(state.entry.payload.generatedAt, 2);
});

test("fetchUsagePayload: unknown command rejection -> 501", async () => {
  const executor = async () => {
    throw new Error("error: unknown command 'usage'");
  };

  const result = await fetchUsagePayload({ executor });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 501);
  }
});

test("fetchUsagePayload: invalid JSON stdout -> 501", async () => {
  const executor = async () => ({
    stdout: "Some non-json text output",
  });

  const result = await fetchUsagePayload({ executor });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 501);
  }
});

test("fetchUsagePayload: execution failure -> 502", async () => {
  const executor = async () => {
    throw new Error("Network timeout contacting auth server");
  };

  const result = await fetchUsagePayload({ executor });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 502);
    assert.match(result.error, /Network timeout/);
  }
});
