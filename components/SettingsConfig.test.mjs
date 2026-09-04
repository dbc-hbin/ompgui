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

test("SettingsConfig checks updates through the current API contracts", () => {
  assert.match(
    code,
    /fetch\("\/api\/omp-update", \{\s*method: "POST",\s*headers: \{ "Content-Type": "application\/json" \},\s*body: JSON\.stringify\(\{ action: "check" \}\)/,
  );
  assert.match(code, /fetch\(manual \? "\/api\/app-update\?force=1" : "\/api\/app-update"\)/);
  assert.match(code, /if \(!response\.ok\) \{\s*throw new Error\("Failed to check OMP updates"\)/);
  assert.match(code, /if \(!response\.ok\) \{\s*throw new Error\("Failed to check ompgui updates"\)/);
  assert.doesNotMatch(code, /\/api\/omp\/updates/);
  assert.doesNotMatch(code, /\/api\/ompgui\/updates/);
  assert.doesNotMatch(code, /settingsConfig\.latestVersion/);
});

test("SettingsConfig surfaces npm lookup failures instead of claiming up-to-date", () => {
  assert.match(code, /lookupFailed/);
  assert.match(code, /setAppUpdateError\(false\)/);
  assert.match(code, /setAppUpdateError\(true\)/);
  assert.match(code, /appUpdate\?\.currentVersion && appUpdate\?\.availableVersion/);
});

test("SettingsConfig propagates forced app updates and clears stale failures", async () => {
  assert.match(code, /onAppUpdateAvailabilityChange/);
  assert.match(
    code,
    /if \(data\.lookupFailed\) \{[\s\S]*?return;\s*\}\s*if \(onAppUpdateAvailabilityChange[\s\S]*?onAppUpdateAvailabilityChange\(data\.updateAvailable\)/,
  );
  assert.match(code, /if \(manual\) \{\s*setMessage\(null\);\s*setAppUpdateError\(false\)/);
  const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /onAppUpdateAvailabilityChange=\{setAppUpdateAvailable\}/);
});

test("SettingsConfig fences overlapping update checks", () => {
  assert.match(code, /ompCheckRef/);
  assert.match(code, /appCheckRef/);
  assert.match(code, /requestId !== ompCheckRef\.current/);
  assert.match(code, /requestId !== appCheckRef\.current/);
  assert.match(code, /requestId === ompCheckRef\.current/);
  assert.match(code, /requestId === appCheckRef\.current/);
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
