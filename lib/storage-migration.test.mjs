import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { migrateStorageValue } = jiti("./storage-migration.ts");

function createStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test("copies a valid legacy value and removes its old key", () => {
  const storage = createStorage({ legacy: "dark" });
  assert.equal(migrateStorageValue(storage, "canonical", "legacy", (value) => value === "dark"), "dark");
  assert.equal(storage.values.get("canonical"), "dark");
  assert.equal(storage.values.has("legacy"), false);
});

test("keeps the canonical value and removes a stale legacy value", () => {
  const storage = createStorage({ canonical: "light", legacy: "dark" });
  assert.equal(migrateStorageValue(storage, "canonical", "legacy", () => true), "light");
  assert.equal(storage.values.has("legacy"), false);
});

test("removes invalid legacy data without creating a canonical value", () => {
  const storage = createStorage({ legacy: "invalid" });
  assert.equal(migrateStorageValue(storage, "canonical", "legacy", () => false), null);
  assert.equal(storage.values.has("canonical"), false);
  assert.equal(storage.values.has("legacy"), false);
});

test("retains and returns a valid legacy value when its copy cannot be written", () => {
  const storage = createStorage({ legacy: "ko" });
  storage.setItem = () => {
    throw new Error("quota");
  };
  assert.equal(migrateStorageValue(storage, "canonical", "legacy", (value) => value === "ko"), "ko");
  assert.equal(storage.values.has("canonical"), false);
  assert.equal(storage.values.get("legacy"), "ko");
});
