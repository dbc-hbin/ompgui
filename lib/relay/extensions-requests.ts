/**
 * Relay `extensions` domain handler (ExtensionsParity owns this file).
 *
 * Finite domain dispatch — NOT a generic RPC tunnel. Every action validates
 * its args; unknown actions throw `unknown_action`. All successes resolve to
 * a JSON object; all failures throw an error carrying a stable `code` (plus
 * safe, secret-free details) for TransportParity to surface as
 * `{op:'result',req,success:false,error:{code,message,...}}`.
 *
 * Reuses the exact desktop services/routes as authority:
 * - skills: `loadSkillsWithInstallInfo`/`getSkillScanRootDirs`/`setDisableModelInvocation`
 *   (mirrors `/api/skills` GET+PATCH), `checkSkillUpdates`/`buildSkillUpdateArgs`
 *   (mirrors `/api/skills/check` + `/api/skills/update`), `runNpx skills find/add`
 *   (mirrors `/api/skills/search` + `/api/skills/install`).
 * - plugins: `runOmpCli plugin ...` (mirrors `/api/plugins`; omp is the SDK).
 * - agents: `discoverAgents`/`createAgent`/`updateAgent`/`deleteAgent`/`unpackBundledAgents`
 *   + task-section settings (mirrors `/api/agents`, `/api/agents/[name]`,
 *   `/api/agents/unpack`, `/api/omp-settings` task maps).
 * - mcp: `readMcpConfig`/`writeMcpServer`/`deleteMcpServer`/`redactMcpServer`/
 *   `validateMcpServer` (mirrors `/api/mcp` GET+POST+PUT+DELETE; omitted
 *   env/headers preserve, null clears, reads expose only `envConfigured` /
 *   `headersConfigured` flags — never values).
 *
 * Action table (domain `extensions`), exact schemas for TransportParity /
 * ExtensionSettingsPanel (parent-owned):
 * - skills.list {cwd,offset?=0,limit?=50} -> {cwd,skills:[{name,description,filePath,disableModelInvocation,scope?,source?,install?}],total,offset,limit,hasMore}
 * - skills.get {cwd,filePath} -> {name,description,filePath,disableModelInvocation,scope?,source?,install?,frontmatter,contentPreview,contentTruncated}
 * - skills.toggle {cwd,filePath,disableModelInvocation} -> {filePath,disableModelInvocation}
 * - skills.search {query,limit?=10} -> {query,results:[{package,installs?,url?}]}
 * - skills.install {package,scope:global|project,cwd?} -> {package,scope}
 * - skills.check {cwd,package?,scope?} -> {updates:[{package,scope,state,currentVersion?,latestVersion?,message?}]}
 * - skills.update {cwd,package,scope} -> {success:true,output,skill?}
 * - plugins.list {cwd,offset?=0,limit?=50} -> {cwd,packages,total,offset,limit,hasMore}
 * - plugins.action {cwd,action:install|remove|update|disable|enable,source?,scope?:global|project} -> {cwd,packages,output}
 * - agents.list {cwd?,offset?=0,limit?=50,scope?,query?} -> {cwd?,agents:[{name,description,source,filePath?,disabled?}],total,offset,limit,hasMore} (no prompts in list)
 * - agents.get {name,scope?:user|project,cwd?} -> {name,description,source,filePath?,tools?,model?,thinkingLevel?,prewalk?,advisor?,systemPrompt,disabled?,isShadowed?} (FULL prompt)
 * - agents.save {name,description,systemPrompt,scope:user|project,cwd?,tools?,model?,thinkingLevel?,prewalk?,advisor?,blocking?} -> {name,filePath?}
 * - agents.delete {name,scope:user|project,cwd?} -> {name}
 * - agents.unpack {scope:user|project,cwd?,force?} -> {targetDir,count}
 * - agents.setDisabled {name,disabled} -> {name,disabled} (task.disabledAgents via merge/writeNativeSettings)
 * - agents.setOverride {name,kind:model|prewalk|advisor,value?} -> {name,kind} (undefined clears)
 * - mcp.list {cwd?,offset?=0,limit?=50} -> {inventory:[{name,source,status,type?,enabled?}],total,offset,limit,hasMore}
 * - mcp.get {cwd,name} -> {name,source:'project',config(redacted),envConfigured,headersConfigured,path}
 * - mcp.validate {name,server} -> {ok:true}
 * - mcp.save {cwd,name,server,previousName?} -> {name} (server: {type,command?,url?,args?,env?,headers?,cwd?,enabled?,timeout?,requestIdFormat?}; omitted env/headers preserve, null clears)
 * - mcp.delete {cwd,name} -> {name}
 */
import { getAllowedFileRoots, isExistingFilePathAllowed } from "../file-access";
import {
  mergeNativeSettings,
  readNativeSettings,
  writeNativeSettings,
  type NativeSettings,
} from "../omp/settings-config";
import { asString } from "../type-guards";
import type { RelayRequestContext } from "./request-types";
import { RelaySessionError } from "./session-runtime";
import {
  checkRelaySkillUpdates,
  deleteRelayAgent,
  deleteRelayMcp,
  getRelayAgent,
  getRelayMcp,
  getRelaySkillDetail,
  installRelaySkill,
  listRelayAgents,
  listRelayMcp,
  listRelayPlugins,
  listRelaySkills,
  runRelayPluginAction,
  saveRelayAgent,
  searchRelaySkills,
  toggleRelaySkill,
  unpackRelayAgents,
  updateRelaySkill,
  saveRelayMcpServer,
  validateRelayMcp,
} from "./extensions";

/** Finite action set for the `extensions` domain. */
export const EXTENSIONS_REQUEST_ACTIONS = [
  "skills.list",
  "skills.get",
  "skills.toggle",
  "skills.search",
  "skills.install",
  "skills.check",
  "skills.update",
  "plugins.list",
  "plugins.action",
  "agents.list",
  "agents.get",
  "agents.save",
  "agents.delete",
  "agents.unpack",
  "agents.setDisabled",
  "agents.setOverride",
  "mcp.list",
  "mcp.get",
  "mcp.validate",
  "mcp.save",
  "mcp.delete",
] as const;

export type ExtensionsRequestAction = (typeof EXTENSIONS_REQUEST_ACTIONS)[number];

function requireAction(action: string): ExtensionsRequestAction {
  if (!(EXTENSIONS_REQUEST_ACTIONS as readonly string[]).includes(action)) {
    throw new RelaySessionError("unknown_action", `Unknown extensions action "${action}"`);
  }
  return action as ExtensionsRequestAction;
}

function requireCwd(value: unknown): string {
  const cwd = asString(value)?.trim();
  if (!cwd || cwd.length > 1024) throw new RelaySessionError("invalid_cwd", "cwd is required");
  return cwd;
}

function optionalCwd(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const cwd = asString(value)?.trim();
  if (!cwd) return undefined;
  if (cwd.length > 1024) throw new RelaySessionError("invalid_cwd", "cwd is too long");
  return cwd;
}

function requireName(value: unknown, field = "name"): string {
  const name = asString(value)?.trim();
  if (!name || name.length > 128) throw new RelaySessionError("invalid_name", `${field} is required`);
  return name;
}

function pageOf(total: number, offset: unknown, limit: unknown, fallbackLimit: number): { offset: number; limit: number } {
  const off = offset === undefined ? 0 : Number(offset);
  const lim = limit === undefined ? fallbackLimit : Number(limit);
  if (!Number.isInteger(off) || off < 0 || off > 100_000) throw new RelaySessionError("invalid_args", "offset must be an integer >= 0");
  if (!Number.isInteger(lim) || lim < 1 || lim > 200) throw new RelaySessionError("invalid_args", "limit must be an integer 1-200");
  void total;
  return { offset: off, limit: lim };
}

function toAgentListItem(agent: {
  name: string;
  description: string;
  source: string;
  filePath?: string;
  disabled?: boolean;
}): Record<string, unknown> {
  return {
    name: agent.name,
    description: agent.description,
    source: agent.source,
    ...(agent.filePath ? { filePath: agent.filePath } : {}),
    ...(agent.disabled ? { disabled: true } : {}),
  };
}

function skillListItem(skill: {
  name: string;
  description: string;
  filePath: string;
  disableModelInvocation: boolean;
  scope?: string;
  sourceInfo?: { source?: string; scope?: string };
  install?: unknown;
}): Record<string, unknown> {
  return {
    name: skill.name,
    description: skill.description,
    filePath: skill.filePath,
    disableModelInvocation: skill.disableModelInvocation,
    ...(skill.scope ? { scope: skill.scope } : skill.sourceInfo?.scope ? { scope: skill.sourceInfo.scope } : {}),
    ...(skill.sourceInfo?.source ? { source: skill.sourceInfo.source } : {}),
    ...(skill.install ? { install: skill.install } : {}),
  };
}

async function assertAllowedCwdRef(rawCwd: string): Promise<string> {
  const cwd = rawCwd.trim();
  const roots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, roots)) {
    throw new RelaySessionError("access_denied", "Path is outside allowed workspaces");
  }
  return cwd;
}

function parseAgentScope(value: unknown): "user" | "project" {
  if (value === "user" || value === "project") return value;
  throw new RelaySessionError("invalid_scope", "scope must be user or project");
}

function parseSkillScope(value: unknown): "global" | "project" {
  if (value === "global" || value === "project") return value;
  throw new RelaySessionError("invalid_scope", "scope must be global or project");
}

/**
 * Handle one `extensions`-domain request. Returns a JSON object on success;
 * throws a coded error (never a raw credential) on failure.
 */
export async function handleExtensionsRequest(
  action: string,
  args: Record<string, unknown>,
  context: RelayRequestContext,
): Promise<Record<string, unknown>> {
  void context;
  if (typeof args !== "object" || args === null || Array.isArray(args)) throw new RelaySessionError("invalid_args", "args must be an object");
  switch (requireAction(action)) {
    case "skills.list": {
      const cwd = await assertAllowedCwdRef(requireCwd(args.cwd));
      const listed = await listRelaySkills(cwd);
      const { offset, limit } = pageOf(listed.skills.length, args.offset, args.limit, 50);
      const items = listed.skills.map((skill) => skillListItem(skill));
      return {
        cwd: listed.cwd,
        skills: items.slice(offset, offset + limit),
        total: items.length,
        offset,
        limit,
        hasMore: offset + limit < items.length,
      };
    }
    case "skills.get": {
      const cwd = requireCwd(args.cwd);
      const filePath = asString(args.filePath)?.trim();
      if (!filePath || filePath.length > 1024) throw new RelaySessionError("invalid_path", "filePath is required");
      return getRelaySkillDetail(cwd, filePath);
    }
    case "skills.toggle": {
      const cwd = requireCwd(args.cwd);
      const filePath = asString(args.filePath)?.trim();
      if (!filePath || filePath.length > 1024) throw new RelaySessionError("invalid_path", "filePath is required");
      if (typeof args.disableModelInvocation !== "boolean") {
        throw new RelaySessionError("invalid_flag", "disableModelInvocation must be a boolean");
      }
      return toggleRelaySkill(cwd, filePath, args.disableModelInvocation);
    }
    case "skills.search": {
      const query = asString(args.query)?.trim();
      if (!query || query.length > 200) throw new RelaySessionError("invalid_query", "query is required");
      const rawLimit = args.limit;
      const limit = rawLimit === undefined ? 10 : Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
        throw new RelaySessionError("invalid_limit", "limit must be 1-20");
      }
      return searchRelaySkills(query, limit);
    }
    case "skills.install": {
      const pkg = asString(args.package)?.trim();
      if (!pkg || pkg.length > 256) throw new RelaySessionError("invalid_package", "package is required");
      const scope = parseSkillScope(args.scope);
      const cwd = optionalCwd(args.cwd);
      return installRelaySkill(pkg, scope, cwd);
    }
    case "skills.check": {
      const cwd = requireCwd(args.cwd);
      const pkg = args.package === undefined ? undefined : asString(args.package)?.trim();
      const scope = args.scope === undefined ? undefined : parseSkillScope(args.scope);
      if ((pkg && !scope) || (!pkg && scope)) {
        throw new RelaySessionError("invalid_args", "package and scope must be provided together");
      }
      return checkRelaySkillUpdates({ cwd, ...(pkg ? { package: pkg, scope: scope as "global" | "project" } : {}) });
    }
    case "skills.update": {
      const cwd = requireCwd(args.cwd);
      const pkg = asString(args.package)?.trim();
      if (!pkg) throw new RelaySessionError("invalid_package", "package is required");
      const scope = parseSkillScope(args.scope);
      return updateRelaySkill({ cwd, package: pkg, scope });
    }
    case "plugins.list": {
      const cwd = await assertAllowedCwdRef(requireCwd(args.cwd));
      const listed = await listRelayPlugins(cwd);
      const { offset, limit } = pageOf(listed.packages.length, args.offset, args.limit, 50);
      return {
        cwd: listed.cwd,
        packages: listed.packages.slice(offset, offset + limit),
        total: listed.packages.length,
        offset,
        limit,
        hasMore: offset + limit < listed.packages.length,
      };
    }
    case "plugins.action": {
      const cwd = requireCwd(args.cwd);
      const pluginAction = asString(args.action)?.trim();
      if (pluginAction !== "install" && pluginAction !== "remove" && pluginAction !== "update" && pluginAction !== "disable" && pluginAction !== "enable") {
        throw new RelaySessionError("invalid_action", "plugin action is required");
      }
      const source = asString(args.source)?.trim();
      if (pluginAction !== "update" && (!source || source.length > 512)) {
        throw new RelaySessionError("invalid_source", "source is required");
      }
      if (source && source.length > 512) throw new RelaySessionError("invalid_source", "source is too long");
      const scopeRaw = asString(args.scope)?.trim();
      const scope = scopeRaw === "project" ? ("project" as const) : scopeRaw === "global" ? ("global" as const) : undefined;
      if (args.scope !== undefined && scope === undefined && scopeRaw) {
        throw new RelaySessionError("invalid_scope", "scope must be global or project");
      }
      return runRelayPluginAction(cwd, pluginAction, source || undefined, scope);
    }
    case "agents.list": {
      const cwd = optionalCwd(args.cwd);
      const listed = await listRelayAgents(cwd);
      let agents = listed.agents;
      if (args.scope !== undefined) {
        const scope = asString(args.scope)?.trim();
        agents = agents.filter((agent) => agent.source === scope);
      }
      const query = asString(args.query)?.trim().toLowerCase();
      if (query) {
        agents = agents.filter((agent) =>
          `${agent.name} ${agent.description} ${agent.systemPrompt ?? ""}`.toLowerCase().includes(query),
        );
      }
      const { offset, limit } = pageOf(agents.length, args.offset, args.limit, 50);
      return {
        ...(listed.cwd ? { cwd: listed.cwd } : {}),
        agents: agents.slice(offset, offset + limit).map((agent) => toAgentListItem(agent)),
        total: agents.length,
        offset,
        limit,
        hasMore: offset + limit < agents.length,
      };
    }
    case "agents.get": {
      const name = requireName(args.name);
      const scope = args.scope === undefined ? undefined : parseAgentScope(args.scope);
      const cwd = optionalCwd(args.cwd);
      return getRelayAgent({ name, ...(scope ? { scope } : {}), ...(cwd ? { cwd } : {}) });
    }
    case "agents.save": {
      const name = requireName(args.name);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
        throw new RelaySessionError("invalid_name", "name must be kebab-case");
      }
      const description = asString(args.description)?.trim();
      if (!description || description.length > 500) {
        throw new RelaySessionError("invalid_description", "description is required");
      }
      const systemPrompt = asString(args.systemPrompt);
      if (systemPrompt === undefined || Buffer.byteLength(systemPrompt, "utf8") > 16 * 1024 * 1024) {
        throw new RelaySessionError("invalid_prompt", "systemPrompt is required");
      }
      const scope = parseAgentScope(args.scope);
      const cwd = optionalCwd(args.cwd);
      const tools = args.tools === undefined ? undefined : parseStringList(args.tools, "tools");
      const model = args.model === undefined ? undefined : parseModelValue(args.model);
      const thinkingLevel = args.thinkingLevel === undefined ? undefined : parseOptionalString(args.thinkingLevel, "thinkingLevel", 64);
      const prewalk = args.prewalk === undefined ? undefined : parseBoolOrString(args.prewalk, "prewalk");
      const advisor = args.advisor === undefined ? undefined : parseBoolOrString(args.advisor, "advisor");
      const blocking = args.blocking === undefined ? undefined : parseOptionalBoolean(args.blocking, "blocking");
      return saveRelayAgent({
        name,
        description,
        systemPrompt,
        scope,
        ...(cwd ? { cwd } : {}),
        ...(tools !== undefined ? { tools } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
        ...(prewalk !== undefined ? { prewalk } : {}),
        ...(advisor !== undefined ? { advisor } : {}),
        ...(blocking !== undefined ? { blocking } : {}),
      });
    }
    case "agents.delete": {
      const name = requireName(args.name);
      const scope = parseAgentScope(args.scope);
      const cwd = optionalCwd(args.cwd);
      return deleteRelayAgent({ name, scope, ...(cwd ? { cwd } : {}) });
    }
    case "agents.unpack": {
      const scope = parseAgentScope(args.scope);
      const cwd = optionalCwd(args.cwd);
      const force = args.force === undefined ? undefined : args.force === true;
      if (args.force !== undefined && typeof args.force !== "boolean") {
        throw new RelaySessionError("invalid_args", "force must be a boolean");
      }
      return unpackRelayAgents({ scope, ...(cwd ? { cwd } : {}), ...(force !== undefined ? { force } : {}) });
    }
    case "agents.setDisabled": {
      const name = requireName(args.name);
      if (typeof args.disabled !== "boolean") throw new RelaySessionError("invalid_args", "disabled must be a boolean");
      const current = readNativeSettings();
      const list = new Set(Array.isArray(current.settings.task?.disabledAgents) ? current.settings.task.disabledAgents : []);
      if (args.disabled) list.add(name);
      else list.delete(name);
      const next = mergeNativeSettings(current.settings, { task: { disabledAgents: [...list] } } as NativeSettings);
      try {
        writeNativeSettings(next);
      } catch (error) {
        throw new RelaySessionError("agent_settings_failed", error instanceof Error ? error.message : String(error));
      }
      return { name, disabled: args.disabled };
    }
    case "agents.setOverride": {
      const name = requireName(args.name);
      const kind = asString(args.kind)?.trim();
      if (kind !== "model" && kind !== "prewalk" && kind !== "advisor") {
        throw new RelaySessionError("invalid_args", "kind must be model, prewalk, or advisor");
      }
      const current = readNativeSettings();
      const task = current.settings.task ?? {};
      const taskPatch: NonNullable<NativeSettings["task"]> = {};
      const patch: NativeSettings = { task: taskPatch };
      if (kind === "model") {
        const overrides: Record<string, string | string[]> = { ...(task.agentModelOverrides ?? {}) };
        if (args.value === undefined || args.value === null || args.value === "") delete overrides[name];
        else if (typeof args.value === "string" && args.value.trim()) overrides[name] = args.value.trim();
        else if (Array.isArray(args.value) && args.value.every((entry) => typeof entry === "string" && entry.trim())) {
          overrides[name] = args.value as string[];
        } else throw new RelaySessionError("invalid_args", "value must be a non-empty model selector or list");
        taskPatch.agentModelOverrides = overrides;
      } else {
        const key = kind === "prewalk" ? "agentPrewalk" : "agentAdvisor";
        const map: Record<string, boolean | string> = { ...(task[key] ?? {}) };
        if (args.value === undefined || args.value === null || args.value === "") delete map[name];
        else if (typeof args.value === "boolean" || typeof args.value === "string") map[name] = args.value;
        else throw new RelaySessionError("invalid_args", "value must be a boolean or string");
        taskPatch[key] = map;
      }
      try {
        writeNativeSettings(mergeNativeSettings(current.settings, patch));
      } catch (error) {
        throw new RelaySessionError("agent_settings_failed", error instanceof Error ? error.message : String(error));
      }
      return { name, kind };
    }
    case "mcp.list": {
      const cwd = optionalCwd(args.cwd);
      const listed = await listRelayMcp(cwd);
      const { offset, limit } = pageOf(listed.inventory.length, args.offset, args.limit, 50);
      return {
        inventory: listed.inventory.slice(offset, offset + limit),
        total: listed.inventory.length,
        offset,
        limit,
        hasMore: offset + limit < listed.inventory.length,
      };
    }
    case "mcp.get": {
      const cwd = requireCwd(args.cwd);
      return getRelayMcp(cwd, requireName(args.name));
    }
    case "mcp.validate": {
      return validateRelayMcp(requireName(args.name), args.server);
    }
    case "mcp.save": {
      const cwd = requireCwd(args.cwd);
      const name = requireName(args.name);
      const previousName = args.previousName === undefined ? undefined : requireName(args.previousName, "previousName");
      return saveRelayMcpServer(cwd, name, args.server, previousName);
    }

    case "mcp.delete": {
      const cwd = requireCwd(args.cwd);
      return deleteRelayMcp(cwd, requireName(args.name));
    }
  }
}

function parseStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new RelaySessionError("invalid_args", `${field} must be an array of strings`);
  }
  return value as string[];
}

function parseModelValue(value: unknown): string | string[] {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string" && entry.trim())) {
    return value as string[];
  }
  throw new RelaySessionError("invalid_args", "model must be a non-empty selector or list");
}

function parseOptionalString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new RelaySessionError("invalid_args", `${field} must be a non-empty string`);
  }
  return value;
}

function parseOptionalBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new RelaySessionError("invalid_args", `${field} must be a boolean`);
  return value;
}

function parseBoolOrString(value: unknown, field: string): boolean | string {
  if (typeof value === "boolean" || typeof value === "string") return value;
  throw new RelaySessionError("invalid_args", `${field} must be a boolean or string`);
}
