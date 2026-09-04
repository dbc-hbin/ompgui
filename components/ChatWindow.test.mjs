import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const windowSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("⌘/Ctrl+Alt+M cannot cycle the model while the session is busy", () => {
  // The model shortcut must not fire its RPC mid-turn (same contract as the
  // composer model picker, which is disabled while streaming).
  assert.match(
    windowSource,
    /if \(key === "m"\) \{\s+e\.preventDefault\(\);\s+if \(sessionBusy\) return;\s+void handleCycleModel\(\);/,
  );
  assert.match(windowSource, /\[session, sessionBusy, handleCycleModel, handleCycleThinkingLevel\]/);
});

test("⌘/Ctrl+Alt+T stays usable mid-run like the reasoning picker", () => {
  // The reasoning picker is explicitly usable mid-run, so the thinking-level
  // shortcut must not gain a busy guard: assert the exact unguarded shape.
  assert.match(
    windowSource,
    /\} else if \(key === "t"\) \{\s+e\.preventDefault\(\);\s+void handleCycleThinkingLevel\(\);/,
  );
});
