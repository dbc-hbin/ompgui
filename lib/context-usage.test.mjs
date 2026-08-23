import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  clampContextPercent,
  deriveContextUsage,
  formatContextWindow,
  formatPercent,
  formatRingPercent,
  mergeContextUsage,
  resolveContextWindow,
} = await jiti.import("./context-usage.ts");

test("live context windows win over the selected model catalog", () => {
  const models = [{ id: "gpt-5", provider: "openai", contextWindow: 128_000 }];
  assert.equal(resolveContextWindow(models, { provider: "openai", modelId: "gpt-5" }, 1_000_000), 1_000_000);
});

test("selected provider and model resolve from the catalog", () => {
  const models = [{ id: "gpt-5", provider: "openai", contextWindow: 128_000 }];
  assert.equal(resolveContextWindow(models, { provider: "openai", modelId: "gpt-5" }), 128_000);
});

test("mismatched providers do not resolve a model window", () => {
  const models = [{ id: "gpt-5", provider: "openai", contextWindow: 128_000 }];
  assert.equal(resolveContextWindow(models, { provider: "anthropic", modelId: "gpt-5" }), 0);
});

test("invalid and zero windows are ignored", () => {
  const models = [
    { id: "zero", provider: "test", contextWindow: 0 },
    { id: "invalid", provider: "test", contextWindow: Number.NaN },
  ];
  assert.equal(resolveContextWindow(models, { provider: "test", modelId: "zero" }, 0), 0);
  assert.equal(resolveContextWindow(models, { provider: "test", modelId: "invalid" }, Number.POSITIVE_INFINITY), 0);
});

test("context windows use compact units without trailing .0", () => {
  assert.equal(formatContextWindow(1_000_000), "1M");
  assert.equal(formatContextWindow(128_000), "128k");
  assert.equal(formatContextWindow(200_000), "200k");
});

test("mid-turn zero-token snapshots preserve the previous state", () => {
  const prev = { percent: 2.19, contextWindow: 1_000_000, tokens: 21_878 };
  assert.equal(mergeContextUsage(prev, { tokens: 0, contextWindow: 1_000_000, percent: 0 }), prev);
  assert.equal(mergeContextUsage(prev, { tokens: null, contextWindow: 1_000_000, percent: null }), prev);
});

test("null next state clears, letting the derived fallback take over", () => {
  const prev = { percent: 2.19, contextWindow: 1_000_000, tokens: 21_878 };
  assert.equal(mergeContextUsage(prev, null), null);
});

test("a real growth snapshot wins", () => {
  const prev = { percent: 2, contextWindow: 1_000_000, tokens: 20_000 };
  const next = { tokens: 30_000, contextWindow: 1_000_000, percent: 3 };
  assert.deepEqual(mergeContextUsage(prev, next), next);
});

test("impossible snapshots (tokens many times the window) are discarded", () => {
  const sane = { percent: 50, contextWindow: 128_000, tokens: 64_000 };
  // Observed real-world corruption: 35.7M tokens reported against a 128k
  // window (uncapped 27843% that the UI clamped to a perma-full ring).
  assert.equal(mergeContextUsage(sane, { tokens: 35_700_000, contextWindow: 128_000, percent: 27_843.75 }, ), sane);
  // With no previous live value the discard yields null → derived fallback.
  assert.equal(mergeContextUsage(null, { tokens: 35_700_000, contextWindow: 128_000, percent: 27_843.75 }), null);
  // A modest overage right before provider-side trimming is plausible.
  assert.deepEqual(
    mergeContextUsage(null, { tokens: 130_000, contextWindow: 128_000, percent: 101.5 }),
    { tokens: 130_000, contextWindow: 128_000, percent: 101.5 },
  );
});

test("deriveContextUsage skips cumulative/synthetic tail entries", () => {
  const messages = [
    { role: "user", usage: null },
    { role: "assistant", usage: { input: 1_000, output: 100, cacheRead: 40_000, cacheWrite: 0 } },
    { role: "toolResult", usage: null },
    // Synthetic tail entry carrying per-session cumulative totals (35.7M).
    { role: "assistant", usage: { input: 15_000_000, output: 700_000, cacheRead: 20_000_000, cacheWrite: 0 } },
  ];
  const derived = deriveContextUsage(messages, 128_000);
  assert.equal(derived?.tokens, 41_100);
  assert.equal(derived?.contextWindow, 128_000);
  assert.ok(Math.abs((derived?.percent ?? 0) - 41_100 / 1280) < 1e-9);
});

test("deriveContextUsage hides the ring when nothing is plausible", () => {
  assert.equal(
    deriveContextUsage([{ role: "assistant", usage: { input: 10_000_000 } }], 128_000),
    null,
  );
  assert.equal(deriveContextUsage([{ role: "assistant", usage: { input: 1_000 } }], 0), null);
  assert.equal(deriveContextUsage([], 128_000), null);
});

test("missing percent is derived from tokens/contextWindow", () => {
  const merged = mergeContextUsage(null, { tokens: 50_000, contextWindow: 200_000, percent: null });
  assert.equal(merged?.percent, 25);
  assert.equal(merged?.tokens, 50_000);
});

test("tokens fall back to the previous value when missing and no window", () => {
  const prev = { percent: 12, contextWindow: 100_000, tokens: 12_000 };
  const merged = mergeContextUsage(prev, { tokens: null, contextWindow: 100_000, percent: null });
  assert.equal(merged?.tokens, 12_000);
  assert.equal(merged?.percent, 12);
});

test("clamping tolerates NaN and out-of-range values", () => {
  assert.equal(clampContextPercent(undefined), 0);
  assert.equal(clampContextPercent(Number.NaN), 0);
  assert.equal(clampContextPercent(-4), 0);
  assert.equal(clampContextPercent(130), 100);
});

test("popup percent keeps one decimal without trailing .0", () => {
  assert.equal(formatPercent(34.2), "34.2%");
  assert.equal(formatPercent(20), "20%");
});

test("ring label keeps one decimal below 10%", () => {
  assert.equal(formatPercent(2.19), "2.2%");
  assert.equal(formatRingPercent(2.19), "2.2%");
  assert.equal(formatRingPercent(0), "0%");
  assert.equal(formatRingPercent(9.96), "10%");
  assert.equal(formatRingPercent(24.6), "25%");
});
