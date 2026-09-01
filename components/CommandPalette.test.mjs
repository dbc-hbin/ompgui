import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});

const code = await readFile(new URL("./CommandPalette.tsx", import.meta.url), "utf8");

test("CommandPalette component exports and imports cleanly", async () => {
  const { CommandPalette } = await jiti.import("./CommandPalette.tsx");
  assert.equal(typeof CommandPalette, "function");
});

test("CommandPalette defines distinct loading, empty, and error states", () => {
  assert.match(code, /SessionLoadingSkeleton/);
  assert.match(code, /className="skeleton"/);
  assert.match(code, /role="status"/);
  assert.match(code, /\[55,\s*70,\s*45\]/);
  assert.match(code, /SessionLoadError/);
  assert.match(code, /role="alert"/);
  assert.match(code, /commandPalette\.loadFailed/);
  assert.match(code, /loadSessionList\(\{\s*force:\s*true\s*\}\)/);
  assert.match(code, /status === "idle"/);
  assert.match(code, /status === "ready"/);
  assert.match(code, /t\("commandPalette\.empty"\)/);
  assert.doesNotMatch(code, /emptyLabel/);

  const emptyBlocks = [...code.matchAll(/<Command\.Empty[\s\S]*?<\/Command\.Empty>/g)].map((match) => match[0]);
  assert.ok(emptyBlocks.length >= 1);
  for (const block of emptyBlocks) {
    assert.match(block, /commandPalette\.empty/);
    assert.doesNotMatch(block, /commandPalette\.(loading|loadFailed)/);
  }
});

test("CommandPalette preserves Cmd/Ctrl+K, mobile entry, and bottom sheet", () => {
  assert.match(code, /metaKey \|\| event\.ctrlKey/);
  assert.match(code, /ompgui:open-command-palette/);
  assert.match(code, /isMobile/);
  assert.match(code, /safe-area-inset-bottom/);
  assert.match(code, /ui-sheet-slide-up/);
  assert.match(code, /touchAction:\s*"manipulation"/);
  assert.match(code, /width:\s*44/);
  assert.match(code, /height:\s*44/);
  assert.match(code, /useModalDialog/);
  assert.match(code, /identity:\s*panelLayout/);
  assert.match(code, /const panelLayout = isMobile \? "mobile" : "desktop"/);
  assert.match(code, /useOverlayBack/);
  assert.match(code, /t\("ui\.close"\)/);
  assert.doesNotMatch(code, /aria-label="Close"/);
});
