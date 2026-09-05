import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("agent command routes reject malformed commands and map RPC failures to 400", async () => {
  const route = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
  const newRoute = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");
  assert.match(route, /command_type_required/);
  assert.match(route, /instanceof RpcCommandError/);
  assert.match(route, /status: 400/);
  assert.match(newRoute, /command_type_required/);
  assert.match(newRoute, /newSessionErrorResponse/);
});

test("agent event streams use proxy-safe SSE headers", async () => {
  const route = await readFile(new URL("../app/api/agent/[id]/events/route.ts", import.meta.url), "utf8");
  assert.match(route, /"Content-Type": "text\/event-stream"/);
  assert.match(route, /"Cache-Control": "no-cache, no-transform"/);
  assert.match(route, /Connection: "keep-alive"/);
  assert.match(route, /"X-Accel-Buffering": "no"/);
});

test("interactive login negotiates RPC v2 before sending the login command", async () => {
  const route = await readFile(new URL("../app/api/auth/login/[provider]/route.ts", import.meta.url), "utf8");
  const waitReady = route.indexOf("await child.waitReady(READY_TIMEOUT_MS)");
  const negotiate = route.indexOf("await child.negotiateProtocol(ready)");
  const login = route.indexOf('await child.sendCommand({ type: "login"');

  assert.ok(waitReady >= 0);
  assert.ok(negotiate > waitReady);
  assert.ok(login > negotiate);
});

test("session archive route stops live children and maps missing sessions", async () => {
  const route = await readFile(new URL("../app/api/sessions/[id]/archive/route.ts", import.meta.url), "utf8");
  const utils = await readFile(new URL("../lib/api-utils.ts", import.meta.url), "utf8");
  assert.match(route, /destroyAndWait/);
  assert.match(route, /archiveSessionFileWithArtifacts/);
  // Missing-session responses now come from the shared helper.
  assert.match(route, /resolveSessionPathOr404/);
  assert.match(utils, /session_not_found/);
  assert.match(route, /session_archive_failed/);
  assert.match(route, /session_has_children/);
});

test("session archive remains keyboard-discoverable with an ARIA label", async () => {
  const source = await readFile(new URL("../components/SessionSidebar.tsx", import.meta.url), "utf8");
  assert.match(source, /api\/sessions\/\$\{encodeURIComponent\(session\.id\)\}\/archive/);
  assert.match(source, /sessionSidebar\.archiveLeafOnly/);
  assert.match(source, /sessionSidebar\.archiveConfirm/);
});

test("thinking reads reject malformed assistant message payloads", async () => {
  const route = await readFile(new URL("../app/api/sessions/[id]/entries/[entryId]/thinking/route.ts", import.meta.url), "utf8");
  assert.match(route, /isRecord\(entry\.message\)/);
  assert.match(route, /Array\.isArray\(message\.content\)/);
  assert.match(route, /assistant_message_not_found/);
  assert.match(route, /typeof block\.thinking !== "string"/);
});

test("tool result media reads resolve the session and return only images", async () => {
  const route = await readFile(new URL("../app/api/sessions/[id]/entries/[entryId]/media/route.ts", import.meta.url), "utf8");
  assert.match(route, /resolveSessionPathOr404/);
  assert.match(route, /getToolResultImagesForEntry/);
  assert.match(route, /NextResponse\.json\(media\)/);
  assert.match(route, /tool_result_images_not_found/);
  // Oversized media rejects with a stable code before serialization.
  assert.match(route, /ToolResultImagesTooLargeError/);
  assert.match(route, /status: 413/);
  // Only the normalized image array is returned — no details or blob refs.
  assert.doesNotMatch(route, /details/);
  assert.doesNotMatch(route, /blob/);
});

test("prompt controls preserve abort, steer, and follow-up RPC commands", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  assert.match(source, /case "abort":/);
  assert.match(source, /case "steer":/);
  assert.match(source, /case "follow_up":/);
  assert.match(source, /streamingBehavior/);
});

test("worktree discovery filters prunable entries and identifies the main checkout", async () => {
  const source = await readFile(new URL("./worktree.ts", import.meta.url), "utf8");
  assert.match(source, /current\.prunable/);
  assert.match(source, /isMain: worktrees\.length === 0/);
  assert.match(source, /"worktree", "list", "--porcelain"/);
});

test("OMP update route permits check and restart actions", async () => {
  const route = await readFile(new URL("../app/api/omp-update/route.ts", import.meta.url), "utf8");
  assert.match(route, /body\.action === "check"/);
  assert.match(route, /body\.action === "restart"/);
  assert.match(route, /restartAllRpcSessions/);
});

test("models GET invalidates caches after external models config changes", async () => {
  const route = await readFile(new URL("../app/api/models/route.ts", import.meta.url), "utf8");
  assert.match(route, /getModelsConfigPath/);
  assert.match(route, /stat\.mtimeMs/);
  assert.match(route, /stat\.ctimeMs/);
  assert.match(route, /stat\.size/);
  assert.match(route, /:missing/);
  assert.match(route, /invalidateModelsCache\(\);/);
  assert.match(route, /disposeUtilityRpc\(\);/);
  assert.match(route, /previous !== undefined && previous !== fingerprint/);
  const getIndex = route.indexOf("export async function GET()");
  assert.ok(getIndex >= 0);
  assert.ok(route.indexOf("refreshModelsIfConfigChanged();", getIndex) < route.indexOf("loadModelsWithCache", getIndex));
});

test("settings groups runtime preferences and resource managers behind tabs", async () => {
  const settings = await readFile(new URL("../components/SettingsConfig.tsx", import.meta.url), "utf8");
  const models = await readFile(new URL("../components/ModelsConfig.tsx", import.meta.url), "utf8");
  const skills = await readFile(new URL("../components/SkillsConfig.tsx", import.meta.url), "utf8");
  const plugins = await readFile(new URL("../components/PluginsConfig.tsx", import.meta.url), "utf8");
  const agents = await readFile(new URL("../components/AgentsConfig.tsx", import.meta.url), "utf8");
  const hook = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  const appShell = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
  assert.match(settings, /settingsConfig\.runAppUpdateCommand/);
  assert.match(settings, /settingsConfig\.restartSessions/);
  assert.match(appShell, /appShell\.ompUpdateAvailable/);
  assert.match(appShell, /appShell\.appUpdateAvailable/);
  assert.match(appShell, /appShell\.updateVersion/);
  assert.match(appShell, /appShell\.copyCommand/);
  assert.match(appShell, /appShell\.commandCopied/);
  assert.match(appShell, /appShell\.commandCopyFailed/);
  assert.match(settings, /Enable Advisor for new sessions/);
  assert.match(settings, /currentTab === "models"/);
  assert.match(settings, /activeTab === "skills"/);
  assert.match(settings, /activeTab === "plugins"/);
  assert.match(settings, /<ModelsConfig key=\{modelsEditorKey\}/);
  assert.doesNotMatch(models, /embedded|onSelectTab|ModelsConfigSurface/);
  assert.doesNotMatch(skills, /embedded|onSelectTab|onClose|SkillsConfigSurface|SettingsTabs/);
  assert.doesNotMatch(plugins, /embedded|onSelectTab|onClose|PluginsConfigSurface|SettingsTabs/);
  assert.doesNotMatch(agents, /embedded|onClose/);
  assert.match(models, /from "@\/lib\/client-model-store"/);
  assert.match(models, /if \(options\?\.force\) invalidateClientModels\(\)/);
  assert.match(models, /loadClientModels\("", \{ force: options\?\.force \}\)/);
  assert.match(models, /loadRuntimeModels\(\{ force: true \}\)/);
  assert.match(hook, /from "@\/lib\/client-model-store"/);
  assert.match(hook, /loadClientModels\(modelCwd, force \? \{ force: true \} : undefined\)/);
  assert.match(hook, /modelsLoadGenerationRef\.current === modelsLoadId/);
  assert.match(hook, /&& cwdUnchanged\(\)/);
  assert.match(models, /OMP runtime models/);
});

test("agent mutations bound JSON input before parsing", async () => {
  const route = await readFile(new URL("../app/api/agents/route.ts", import.meta.url), "utf8");
  assert.match(route, /parseJsonWithinLimit/);
  assert.match(route, /MAX_AGENT_REQUEST_BYTES/);
  assert.match(route, /RequestBodyTooLargeError/);
});

test("mutating agent and MCP routes bound JSON input", async () => {
  const newAgent = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");
  const agent = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
  const mcp = await readFile(new URL("../app/api/mcp/route.ts", import.meta.url), "utf8");
  for (const route of [newAgent, agent, mcp]) {
    assert.match(route, /parseJsonWithinLimit/);
    assert.match(route, /RequestBodyTooLargeError/);
  }
  assert.match(newAgent, /status: 413/);
  assert.match(agent, /status: 413/);
  assert.match(mcp, /\? 413 : 400/);
});

test("MCP route redacts project server credentials", async () => {
  const route = await readFile(new URL("../app/api/mcp/route.ts", import.meta.url), "utf8");
  assert.match(route, /redactMcpServer\(config\)/);
});

test("relay upgrade path is a WebSocket endpoint and skips cookie auth", async () => {
  const relay = await readFile(new URL("../app/relay/route.ts", import.meta.url), "utf8");
  const proxy = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
  const instrumentation = await readFile(new URL("../instrumentation.ts", import.meta.url), "utf8");
  assert.match(relay, /status: 426/);
  assert.match(relay, /websocket_required/);
  assert.match(proxy, /pathname === "\/relay"/);
  assert.match(instrumentation, /attachRelayGateway/);
});
