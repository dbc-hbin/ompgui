import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("globals.css defines --app-viewport-height, touch-action, and compact token-based composer controls", async () => {
  const css = await readFile(new URL("app/globals.css", root), "utf8");
  assert.match(css, /--app-viewport-height:\s*100dvh;/);
  assert.match(css, /height:\s*var\(--app-viewport-height,\s*100dvh\);/);
  assert.match(css, /touch-action:\s*manipulation;/);
  assert.match(css, /-webkit-tap-highlight-color:\s*transparent;/);
  assert.match(css, /@keyframes ui-sheet-slide-up/);
  assert.match(css, /@keyframes ui-sheet-backdrop-in/);
  assert.match(css, /--shell-topbar-height:\s*calc\(44px \+ env\(safe-area-inset-top,\s*0px\)\);/);
  // Composer attach/send are deliberately compact on both breakpoints:
  // 28px ghost attach, 32px circular primary send (Paseo-style hierarchy).
  assert.match(css, /--composer-attachment-w:\s*var\(--control-height-sm\);/);
  assert.match(css, /--composer-send-size:\s*var\(--control-height\);/);
  assert.match(css, /\.composer-primary-action\s*\{[^}]*border-radius:\s*50%;/s);
  assert.match(css, /--control-touch:\s*44px;/);
});

test("AppShell binds visualViewport to --app-viewport-height and exposes window.ompguiConsumeBack", async () => {
  const appShell = await readFile(new URL("components/AppShell.tsx", root), "utf8");
  assert.match(appShell, /visualViewport/);
  assert.match(appShell, /--app-viewport-height/);
  assert.match(appShell, /ompguiConsumeBack/);
  assert.match(appShell, /CommandPalette/);
  assert.match(appShell, /Search/);
});

test("consumeBack asks open descendant overlays via cancelable ompgui:overlay-back before shell layers", async () => {
  const appShell = await readFile(new URL("components/AppShell.tsx", root), "utf8");
  const consumeBack = appShell.slice(
    appShell.indexOf("const consumeBack = useCallback"),
    appShell.indexOf("}, [commandPaletteOpen, settingsTab, usageOpen, activeTopPanel, isMobile, sidebarOpen, rightPanelOpen]);"),
  );
  assert.match(consumeBack, /new Event\("ompgui:overlay-back", \{ cancelable: true \}\)/);
  assert.ok(
    consumeBack.indexOf('new Event("ompgui:overlay-back"') < consumeBack.indexOf("if (commandPaletteOpen)"),
    "overlay-back must run before command palette / AppShell modals",
  );
  assert.match(consumeBack, /if \(overlayBack\.defaultPrevented\) \{\s*return true;/);
});

test("MobileSheet uses modal focus restoration and shared overlay-back registration", async () => {
  const mobileSheet = await readFile(new URL("components/ui/mobile-sheet.tsx", root), "utf8");
  assert.match(mobileSheet, /useModalDialog/);
  assert.match(mobileSheet, /useOverlayBack/);
  assert.match(mobileSheet, /t\("ui\.close"\)/);
  assert.match(mobileSheet, /tabIndex=\{-1\}/);
  assert.match(mobileSheet, /safe-area-inset-left/);
  assert.match(mobileSheet, /safe-area-inset-right/);
  assert.match(mobileSheet, /safe-area-inset-bottom/);
});

test("ChatInput and CommandPalette render bottom sheets for mobile pickers", async () => {
  const chatInput = await readFile(new URL("components/ChatInput.tsx", root), "utf8");
  const commandPalette = await readFile(new URL("components/CommandPalette.tsx", root), "utf8");
  const mobileSheet = await readFile(new URL("components/ui/mobile-sheet.tsx", root), "utf8");

  assert.match(chatInput, /MobileSheet/);
  assert.match(commandPalette, /isMobile/);
  assert.match(commandPalette, /ui-sheet-slide-up/);
  assert.match(mobileSheet, /createPortal/);
  assert.match(mobileSheet, /safe-area-inset-bottom/);
});

test("shared Dialog registers overlay-back and mobile surfaces consume side safe-area", async () => {
  const primitives = await readFile(new URL("components/ui/primitives.tsx", root), "utf8");
  const css = await readFile(new URL("app/globals.css", root), "utf8");
  const mainActivity = await readFile(new URL("android/app/src/main/java/com/dbchbin/ompgui/remote/MainActivity.kt", root), "utf8");
  const settings = await readFile(new URL("components/SettingsConfig.tsx", root), "utf8");
  const chatInput = await readFile(new URL("components/ChatInput.tsx", root), "utf8");

  assert.match(primitives, /useOverlayBack\(open, \(\) => onOpenChange\(false\)\)/);
  assert.match(css, /\.sidebar-container \{[\s\S]*padding-top:\s*env\(safe-area-inset-top/);
  assert.match(css, /\.right-panel-container\.right-panel-open \{[\s\S]*padding-top:\s*env\(safe-area-inset-top/);
  assert.match(css, /max\(var\(--space-5\),\s*env\(safe-area-inset-right/);
  assert.match(css, /\.chat-action-btn:focus-visible \{[\s\S]*outline:\s*2px solid var\(--focus-ring-color\)/);
  assert.match(mainActivity, /view\.setPadding\(imeInsets\.left, imeInsets\.top, imeInsets\.right, imeInsets\.bottom\)/);
  assert.match(settings, /const selected = preference === mode;/);
  assert.match(chatInput, /safe-area-inset-left/);
  assert.match(chatInput, /safe-area-inset-right/);
});

test("TabBar exposes 44px hit targets and touch manipulation on mobile", async () => {
  const tabbar = await readFile(new URL("components/TabBar.tsx", root), "utf8");
  const css = await readFile(new URL("app/globals.css", root), "utf8");
  assert.match(tabbar, /touchAction:\s*"manipulation"/);
  assert.match(css, /\.tabbar-close\s*\{\s*width:\s*44px\s*!important;\s*height:\s*44px\s*!important;/);
});
