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
  assert.match(hookSource, /\}, \[session\?\.id, disposeSessionResources, resetSubagentRoster\]\);/);
  assert.doesNotMatch(hookSource, /\}, \[loadSession, restoreRuntimeFromState\]\);/);
});

test("session switches and unmounts retain the disposal path", () => {
  assert.match(
    hookSource,
    /if \(sameSession\) return;\s+resetSubagentRoster\(\);\s+disposeSessionResources\(\);\s+setReplicaPreview\(null\);\s+sessionIdRef\.current = null;/,
  );
  assert.match(
    hookSource,
    /useEffect\(\(\) => \{\s+hookAliveRef\.current = true;\s+return \(\) => \{\s+hookAliveRef\.current = false;\s+disposeSessionResources\(\);/,
  );
});

test("follow-scroll depends on a derived token and cheap assignment helpers", () => {
  assert.match(hookSource, /createFollowScrollToken\(/);
  assert.match(hookSource, /applyConversationFollow\(/);
  assert.match(hookSource, /decideFollowScroll\(/);
  assert.match(hookSource, /applyFollowScroll\(/);
  assert.match(hookSource, /streamRevision: streamState\.revision,/);
  assert.match(hookSource, /revision: state\.revision \+ 1/);
  assert.match(hookSource, /useReducer\(streamReducer, \{ isStreaming: false, streamingMessage: null, revision: 0 \}\)/);
  assert.doesNotMatch(hookSource, /followStreamExtent/);
  assert.doesNotMatch(hookSource, /followUnknownExtent/);
  assert.match(hookSource, /\}, \[followScrollToken, applyConversationFollow\]\);/);
  assert.doesNotMatch(hookSource, /scrollIntoView\(\{ block: "nearest"/);
  assert.doesNotMatch(
    hookSource,
    /\[messages, streamState, agentRunning, agentPhase, extensionWidgets, isCompacting, retryInfo, activeSubagentCount, todoPhases, scrollToBottom, loading\]/,
  );
});

test("hidden documents pause recurring intervals and resume through ensureEventsConnected", () => {
  assert.match(hookSource, /createVisibilityPausedInterval\(\(\) => \{/);
  assert.match(hookSource, /AGENT_STATE_RECONCILE_MS/);
  assert.match(hookSource, /void ensureEventsConnected\(sid\);/);
  assert.match(
    hookSource,
    /if \(agentRunningRef\.current \|\| bashRunningRef\.current \|\| liveSource\) \{\s+void ensureEventsConnected\(sid\);/,
  );
  assert.match(hookSource, /window\.addEventListener\("online", resumeVisibleSession\)/);
  assert.match(hookSource, /document\.addEventListener\("visibilitychange", onVisible\)/);
  assert.match(hookSource, /visibilityDelayAbortRef\.current\.signal/);
  assert.match(hookSource, /visibilityDelayAbortRef\.current\.abort\(\);/);
  assert.match(
    hookSource,
    /const delaySignal = visibilityDelayAbortRef\.current\.signal;\s+await delayWhileDocumentVisible\(\s+BASH_STATE_RECONCILE_MS,\s+undefined,\s+undefined,\s+delaySignal,\s+\);\s+if \(\s+delaySignal\.aborted\s+\|\| !bashRunningRef\.current\s+\|\| bashRecoveryIdRef\.current !== recoveryId\s+\|\| sessionIdRef\.current !== sid\s+\) return;/,
  );
  assert.doesNotMatch(hookSource, /await delayWhileDocumentVisible\(BASH_STATE_RECONCILE_MS\)/);
  assert.doesNotMatch(hookSource, /setInterval\(reconcile, AGENT_STATE_RECONCILE_MS\)/);
});

test("runtime restore does not arm a roster timer while the document is hidden", () => {
  assert.match(hookSource, /const scheduleInitialRosterRefresh = useCallback\(\(sid: string\) => \{/);
  assert.match(hookSource, /if \(isDocumentHidden\(\)\) \{\s+rosterRefreshDeferredRef\.current = true;\s+return;/);
  assert.match(hookSource, /if \(isDocumentHidden\(\)\) \{\s+rosterRefreshDeferredRef\.current = true;\s+return;\s+\}\s+if \(sessionIdRef\.current !== sid \|\| !runtimeReadyRef\.current\) return;/);
  assert.match(hookSource, /if \(rosterRefreshTimerKindRef\.current === "initial"\) \{\s+rosterRefreshDeferredRef\.current = true;/);
  assert.match(hookSource, /if \(rosterRefreshDeferredRef\.current\) scheduleInitialRosterRefresh\(sid\);/);
  assert.match(hookSource, /scheduleInitialRosterRefresh\(sid\);/);
  assert.match(
    hookSource,
    /\}, \[connectEvents, registerHostTools, registerHostUriSchemes, scheduleInitialRosterRefresh, waitForBashSettlement, waitForPromptSettlement\]\);/,
  );
  assert.doesNotMatch(
    hookSource,
    /\}, \[connectEvents, refreshSubagentRoster, registerHostTools, registerHostUriSchemes, scheduleInitialRosterRefresh, waitForBashSettlement, waitForPromptSettlement\]\);/,
  );
  assert.match(
    hookSource,
    /sessionIdRef\.current !== sid\s+\|\| subagentRosterGenerationRef\.current !== generation\s+\|\| isDocumentHidden\(\)/,
  );
});

test("event stream reconnect uses capped backoff and a single EventSource owner", () => {
  assert.match(hookSource, /nextEventStreamReconnectDelayMs\(reconnectAttemptRef\.current\)/);
  assert.match(hookSource, /if \(!agentRunningRef\.current \|\| isDocumentHidden\(\)\) return;/);
  assert.match(hookSource, /createEventStreamConnectionManager<EventSource>/);
  assert.match(hookSource, /new EventSource\(`\/api\/agent\/\$\{encodeURIComponent\(sid\)\}\/events`\)/);
  assert.equal(hookSource.split("new EventSource(").length - 1, 1);
});

test("replica preview is display-only and replaced by authoritative history", () => {
  assert.match(hookSource, /setReplicaPreview\(replica && replica\.session\.id === sid \? replica : null\)/);
  assert.match(hookSource, /setMessages\(d\.context\.messages\);\s+setReplicaPreview\(null\);/);
  assert.match(hookSource, /setError\(String\(e\)\);\s+setReplicaPreview\(null\);/);
  assert.doesNotMatch(hookSource, /setMessages\([^\n]*replica/);
  assert.doesNotMatch(hookSource, /restoreRuntimeFromState\([^\n]*replica/);
});

test("model catalog applies only when this models load still owns the request", () => {
  assert.match(hookSource, /const d = await loadClientModels\(modelCwd, force \? \{ force: true \} : undefined\);/);
  assert.match(hookSource, /const cwdUnchanged = \(\) => \(newSessionCwd \?\? session\?\.cwd \?\? ""\) === modelCwd;/);
  assert.match(
    hookSource,
    /const ownsModelsLoad = \(\) =>\s+!signal\?\.aborted\s+&& modelsLoadGenerationRef\.current === modelsLoadId\s+&& cwdUnchanged\(\);/,
  );
  assert.match(hookSource, /if \(!ownsModelsLoad\(\)\) return;\s+setModelNames\(d\.models\);/);
  assert.match(hookSource, /if \(isNew\) \{\s+const match = d\.defaultModel/);
  assert.match(hookSource, /if \(!ownsModelsLoad\(\)\) return;\s+setModelsLoading\(false\);/);
  assert.match(hookSource, /\}, \[isNew, newSessionCwd, session\?\.cwd\]\);/);
  assert.doesNotMatch(hookSource, /const sessionUnchanged = \(\) => sessionIdRef\.current === sid;/);
  assert.doesNotMatch(
    hookSource,
    /loadModels = useCallback\(async \(signal\?: AbortSignal, force = false\) => \{[\s\S]*sessionIdRef\.current === sid/,
  );
  assert.doesNotMatch(
    hookSource,
    /loadModels = useCallback\(async \(signal\?: AbortSignal, force = false\) => \{[\s\S]*matchesSessionLoadGeneration/,
  );
});

test("follow token includes widget line contents rather than only line counts", () => {
  assert.match(
    hookSource,
    /widgetSignature: extensionWidgets\.map\(\(widget\) => `\$\{widget\.key\}:\$\{widget\.lines\.join\("\\n"\)\}`\)\.join\(","\),/,
  );
  assert.doesNotMatch(
    hookSource,
    /widgetSignature: extensionWidgets\.map\(\(widget\) => `\$\{widget\.key\}:\$\{widget\.lines\.length\}`\)/,
  );
});
