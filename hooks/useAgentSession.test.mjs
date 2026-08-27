import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const hookSource = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");

test("session promotion cleanup is owned by the real session id", () => {
  assert.match(
    hookSource,
    /const selectedSessionIdRef = useRef<string \| null>\(session\?\.id \?\? null\);\s+selectedSessionIdRef\.current = session\?\.id \?\? null;/,
  );
  assert.match(
    hookSource,
    /const sameSession = sessionIdRef\.current !== null\s+&& sessionIdRef\.current === selectedSessionIdRef\.current;\s+if \(sameSession\) return;/,
  );
  assert.match(hookSource, /\}, \[session\?\.id, disposeSessionResources\]\);/);
  assert.doesNotMatch(hookSource, /\}, \[loadSession, restoreRuntimeFromState\]\);/);
});

test("session switches and unmounts retain the disposal path", () => {
  assert.match(
    hookSource,
    /if \(sameSession\) return;\s+disposeSessionResources\(\);\s+sessionIdRef\.current = null;/,
  );
  assert.match(
    hookSource,
    /useEffect\(\(\) => \{\s+hookAliveRef\.current = true;\s+return \(\) => \{\s+hookAliveRef\.current = false;\s+disposeSessionResources\(\);/,
  );
});
