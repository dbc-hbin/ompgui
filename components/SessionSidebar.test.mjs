import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sidebarSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

test("initial URL restore retries continue after unchanged list snapshots", () => {
  assert.match(sidebarSource, /const \[restoreRetryEpoch, setRestoreRetryEpoch\] = useState\(0\);/);
  assert.match(sidebarSource, /const restoreRetryAliveRef = useRef\(true\);/);
  assert.match(sidebarSource, /const restoreRetryScopeRef = useRef\(0\);/);
  assert.match(
    sidebarSource,
    /const scope = restoreRetryScopeRef\.current;\s+restoreRetryTimerRef\.current = setTimeout\(\(\) => \{\s+restoreRetryTimerRef\.current = null;\s+void Promise\.resolve\(loadSessions\(false\)\)\.finally\(\(\) => \{\s+if \(!restoreRetryAliveRef\.current \|\| restoreRetryScopeRef\.current !== scope\) return;\s+setRestoreRetryEpoch\(\(epoch\) => epoch \+ 1\);/,
  );
  assert.match(sidebarSource, /\}, \[initialSessionId, skipInitialProjectSelection\]\);/);
  assert.match(sidebarSource, /restoreRetryRef\.current < INITIAL_RESTORE_MAX_ATTEMPTS/);
  assert.match(sidebarSource, /sessionList\.status, restoreRetryEpoch\]/);
});

test("relative session times refresh immediately when the tab becomes visible", () => {
  assert.match(
    sidebarSource,
    /if \(!interval\) interval = setInterval\(\(\) => setRelativeTimeNow\(Date\.now\(\)\), 60_000\);\s+setRelativeTimeNow\(Date\.now\(\)\);/,
  );
});
