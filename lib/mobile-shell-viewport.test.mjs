import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("viewport metadata enables IME resize without disabling zoom", async () => {
  const layout = await readFile(new URL("app/layout.tsx", root), "utf8");
  assert.match(layout, /interactiveWidget:\s*"resizes-content"/);
  assert.doesNotMatch(layout, /maximumScale\s*:/);
  assert.match(layout, /--app-viewport-height/);
  assert.match(layout, /visualViewport/);
  assert.match(layout, /offsetTop/);
  assert.match(layout, /var\(--app-viewport-height, 100dvh\)/);
});

test("PWA manifest uses the warm palette and existing icons", async () => {
  const manifest = await readFile(new URL("app/manifest.ts", root), "utf8");
  assert.match(manifest, /background_color:\s*"#FAF9F6"/);
  assert.match(manifest, /theme_color:\s*"#1B1916"/);
  assert.doesNotMatch(manifest, /#0f0a14/i);
  assert.match(manifest, /purpose:\s*"maskable"/);
});

test("Android shell expresses IME resize, IME-only insets, and ordered back", async () => {
  const manifestXml = await readFile(
    new URL("android/app/src/main/AndroidManifest.xml", root),
    "utf8",
  );
  const activity = await readFile(
    new URL("android/app/src/main/java/com/dbchbin/ompgui/remote/MainActivity.kt", root),
    "utf8",
  );
  assert.match(manifestXml, /android:windowSoftInputMode="adjustResize"/);
  assert.match(activity, /WindowInsetsCompat\.Type\.ime\(\)/);
  assert.match(activity, /ompguiConsumeBack/);
  assert.match(activity, /ShellBackPolicy\.decide/);
  assert.match(activity, /confirmExit/);
  assert.doesNotMatch(
    activity,
    /Type\.systemBars\(\) or WindowInsetsCompat\.Type\.displayCutout\(\)/,
  );
});

test("remote bootstrap uses dvh with a vh fallback", async () => {
  const css = await readFile(new URL("mobile-shell/remote-bootstrap.css", root), "utf8");
  const html = await readFile(new URL("mobile-shell/index.html", root), "utf8");
  assert.match(css, /min-height:\s*100vh/);
  assert.match(css, /min-height:\s*100dvh/);
  assert.match(css, /var\(--app-viewport-height, 100dvh\)/);
  assert.match(html, /interactive-widget=resizes-content/);
  assert.doesNotMatch(html, /maximum-scale/);
});
