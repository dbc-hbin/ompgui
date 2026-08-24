import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

async function loadSubject() {
  return jiti.import("./session-file-watcher.ts");
}

function sessionFile(id, message) {
  return [
    JSON.stringify({ type: "session", id, cwd: "/tmp", timestamp: "2026-01-01T00:00:00.000Z", version: 3 }),
    JSON.stringify({ type: "message", id: "entry-1", parentId: null, message: { role: "user", content: message } }),
    "",
  ].join("\n");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("coalesces rapid JSONL changes and stops at zero subscribers", async () => {
  const { SessionFileWatcher } = await loadSubject();
  const root = mkdtempSync(join(tmpdir(), "ompgui-session-watch-"));
  const project = join(root, "project");
  mkdirSync(project);
  const file = join(project, "session-a.jsonl");
  writeFileSync(file, sessionFile("session-a", "first"));

  const changes = [];
  const watcher = new SessionFileWatcher({ rootDir: root, debounceMs: 20, retryMs: 50 });
  const unsubscribe = watcher.subscribe((change) => changes.push(change));
  try {
    await wait(10);
    writeFileSync(file, sessionFile("session-a", "second"));
    writeFileSync(file, sessionFile("session-a", "third"));
    await wait(100);

    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0], {
      type: "sessions-changed",
      sessionIds: ["session-a"],
      refreshSessionList: true,
    });

    unsubscribe();
    writeFileSync(file, sessionFile("session-a", "after-stop"));
    await wait(60);
    assert.equal(changes.length, 1);
  } finally {
    watcher.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
