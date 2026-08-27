import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { modelsConfigFingerprint } = await jiti.import("./ModelsConfig.tsx");

test("dirty fingerprints are stable across object key order and change with edits", () => {
  const loaded = {
    providers: {
      example: { api: "future-api", models: [{ id: "model", contextWindow: 8192 }] },
    },
  };
  const reordered = {
    providers: {
      example: { models: [{ contextWindow: 8192, id: "model" }], api: "future-api" },
    },
  };
  assert.equal(modelsConfigFingerprint(loaded), modelsConfigFingerprint(reordered));
  assert.notEqual(
    modelsConfigFingerprint(loaded),
    modelsConfigFingerprint({ ...loaded, providers: { example: { ...loaded.providers.example, api: "changed-api" } } }),
  );
});

test("save completion preserves a late draft and only reloads an unchanged draft", () => {
  const source = readFileSync(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
  const submitted = { providers: { example: { api: "openai-completions", models: [{ id: "before" }] } } };
  const lateEdit = { providers: { example: { api: "openai-completions", models: [{ id: "after" }] } } };
  const submittedFingerprint = modelsConfigFingerprint(submitted);

  assert.notEqual(modelsConfigFingerprint(lateEdit), submittedFingerprint, "a late edit must be observable");
  assert.equal(modelsConfigFingerprint({ ...submitted, providers: { ...submitted.providers, example: { ...submitted.providers.example } } }), submittedFingerprint);
  assert.match(source, /const currentConfigRef = useRef\(config\)/);
  assert.match(source, /const submittedDraftFingerprint = modelsConfigFingerprint\(submittedDraft\)/);
  assert.match(source, /modelsConfigFingerprint\(currentConfigRef\.current\) !== submittedDraftFingerprint/);
  assert.match(source, /lastLoadedConfigRef\.current = submittedFingerprint[\s\S]*?const liveDraftChanged/);
  assert.match(source, /if \(!liveDraftChanged\)[\s\S]*?onDirtyChange\?\.\(false\)[\s\S]*?await loadConfig\(submittedFingerprint\)/);
  assert.match(source, /onSaved\?\.\(\)[\s\S]*?if \(liveDraftChanged\) onDirtyChange\?\.\(true\)/);
  assert.match(source, /setConfig\(saveableConfig\)[\s\S]*?await loadConfig\(submittedFingerprint\)/);
  assert.match(source, /fetch\("\/api\/models-config\?mode=full"/);
  assert.match(source, /originalName/);
  assert.match(source, /originalId/);
});
