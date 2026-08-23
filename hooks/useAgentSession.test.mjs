import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");

test("useAgentSession opens the compact-v1 SSE with the commit cursor", () => {
  assert.match(source, /new URLSearchParams\(\{ wire: "compact-v1" \}\)/);
  assert.match(source, /params\.set\("commit", String\(relayCommitSeqRef\.current\)\)/);
  assert.match(source, /events\?\$\{params\.toString\(\)\}/);
  assert.match(source, /source\.onmessage = \(eventMessage\) =>/);
  assert.match(source, /Install the protocol handler before returning the source/);
});

test("compact frames bypass the latest-wins message coalescer", () => {
  assert.match(source, /safeParseRelayFrame\(input\)/);
  assert.match(source, /reduceRelayFrame\(relayStateRef\.current, parsed\.frame\)/);
  assert.doesNotMatch(source, /eventCoalescer/);
});

test("compact effects map snapshots, nested events, and authoritative commits", () => {
  assert.match(source, /type: "message_start"/);
  assert.match(source, /type: "message_update"/);
  assert.match(source, /effect\.event as AgentEvent/);
  assert.match(source, /__relayAuthoritative: true/);
  assert.match(source, /__relayMessageId: effect\.messageId/);
});

test("invalid, desynchronized, and refresh-required frames fence and reconnect", () => {
  assert.match(source, /safeParseRelayFrame\(input\)/);
  assert.match(source, /effect\.requiresStateRefresh/);
  assert.match(source, /effect\.type === "desync"/);
  assert.match(source, /eventConnectionManager\.invalidate\(sid, source\)/);
  assert.match(source, /loadSession\(sid, false, true, runId\)/);
});

test("Strict Mode effect replay restores the hook liveness fence", () => {
  assert.match(source, /hookAliveRef\.current = true;\s*\n\s*return \(\) => \{\s*\n\s*hookAliveRef\.current = false;/);
});
