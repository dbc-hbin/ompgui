import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const code = await readFile(new URL("./SettingsConfig.tsx", import.meta.url), "utf8");

test("SettingsConfig loads and saves via GET/PUT /api/omp-settings {settings}", () => {
  assert.match(code, /fetch\("\/api\/omp-settings"\)/);
  assert.match(code, /fetch\("\/api\/omp-settings", \{\s*method: "PUT"/);
  assert.match(code, /JSON\.stringify\(\{ settings: nativeSettingsRef\.current \}\)/);
  assert.doesNotMatch(code, /\/api\/omp\/settings/);
  assert.doesNotMatch(code, /method: "PATCH"/);
});

test("SettingsConfig serializes saves against a latest-state ref and fences stale responses", () => {
  assert.match(code, /nativeSettingsRef/);
  assert.match(code, /settingsGenerationRef/);
  assert.match(code, /saveChainRef/);
  assert.match(code, /mountedRef/);
  assert.match(code, /mergeClientNativeSettings\(nativeSettingsRef\.current, patch\)/);
  assert.match(code, /shouldApplyRemoteSettings/);
});

test("appearance controls use existing themeMode and palette i18n keys", () => {
  assert.match(code, /settingsConfig\.themeMode/);
  assert.match(code, /settingsConfig\.themeModeSystem/);
  assert.match(code, /settingsConfig\.themeModeLight/);
  assert.match(code, /settingsConfig\.themeModeDark/);
  assert.match(code, /settingsConfig\.paletteWarm/);
  assert.match(code, /settingsConfig\.paletteOmp/);
  assert.doesNotMatch(code, /settingsConfig\.colorMode/);
  assert.doesNotMatch(code, /settingsConfig\.themeSystem/);
  assert.doesNotMatch(code, /settingsConfig\.palettePaper/);
  assert.doesNotMatch(code, /settingsConfig\.paletteBirch/);
});

test("search highlight timeout replaces the prior timer and clears on unmount", () => {
  assert.match(code, /highlightTimerRef/);
  assert.match(code, /if \(highlightTimerRef\.current\) clearTimeout\(highlightTimerRef\.current\)/);
  assert.match(code, /setTimeout\(\(\) => \{\s*highlightTimerRef\.current = null;\s*setHighlightSettingId\(null\);\s*\}, 2500\)/);
  assert.match(code, /mountedRef\.current = false;\s+if \(highlightTimerRef\.current\) \{\s+clearTimeout\(highlightTimerRef\.current\)/);
});
