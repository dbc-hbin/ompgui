import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { selectRelayModels } = await jiti.import("./models.ts");

test("omits disabled providers", () => {
  const models = selectRelayModels(
    [
      { provider: "openai", id: "gpt", name: "GPT" },
      { provider: "anthropic", id: "claude", name: "Claude" },
    ],
    new Set(["openai"]),
  );
  assert.deepEqual(models, [{ provider: "anthropic", id: "claude", name: "Claude" }]);
});

test("missing name falls back to id", () => {
  assert.deepEqual(selectRelayModels([{ provider: "p", id: "m-1" }]), [
    { provider: "p", id: "m-1", name: "m-1" },
  ]);
});

test("sorts by name, then provider, then id like desktop /api/models", () => {
  const models = selectRelayModels([
    { provider: "b", id: "z", name: "Model 10" },
    { provider: "a", id: "b", name: "Model 2" },
    { provider: "a", id: "a", name: "Model 2" },
    { provider: "openai", id: "gpt", name: "apple" },
    { provider: "anthropic", id: "claude", name: "Banana" },
  ]);
  assert.deepEqual(
    models.map((m) => [m.name, m.provider, m.id]),
    [
      ["apple", "openai", "gpt"],
      ["Banana", "anthropic", "claude"],
      ["Model 2", "a", "a"],
      ["Model 2", "a", "b"],
      ["Model 10", "b", "z"],
    ],
  );
});

test("caps at 80 after sort", () => {
  const raw = Array.from({ length: 90 }, (_, i) => ({
    provider: "p",
    id: `m-${89 - i}`,
    name: `model ${89 - i}`,
  }));
  const models = selectRelayModels(raw);
  assert.equal(models.length, 80);
  assert.equal(models[0].name, "model 0");
  assert.equal(models[79].name, "model 79");
});

test("non-array raw yields []", () => {
  assert.deepEqual(selectRelayModels(undefined), []);
  assert.deepEqual(selectRelayModels(null), []);
  assert.deepEqual(selectRelayModels({}), []);
  assert.deepEqual(selectRelayModels("openai/gpt"), []);
});
