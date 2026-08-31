import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { dirname } from "path";
import { isMap, parseDocument } from "yaml";
import { getSettingsPath } from "./paths";
import { isRecord } from "../type-guards";

export type NativeSettings = {
  defaultThinkingLevel?: "auto" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  hideThinkingBlock?: boolean;
  externalThinking?: boolean;
  textVerbosity?: "low" | "medium" | "high";
  personality?: "default" | "friendly" | "pragmatic" | "none";
  advisor?: { enabled?: boolean; subagents?: boolean; syncBacklog?: "off" | "1" | "3" | "5"; immuneTurns?: number };
  tools?: { approvalMode?: "always-ask" | "write" | "yolo"; approval?: { bash?: "allow" | "prompt" | "deny"; extension?: "allow" | "prompt" } };
  enabledModels?: string[];
  disabledProviders?: string[];
  modelProviderOrder?: string[];
  registryHasScopedEntries?: boolean;
  retry?: {
    enabled?: boolean;
    maxRetries?: number;
    modelFallback?: boolean;
    fallbackRevertPolicy?: "cooldown-expiry" | "never";
    fallbackChains?: Record<string, string[]>;
  };
  compaction?: { enabled?: boolean; midTurnEnabled?: boolean; strategy?: "snapcompact" | "handoff" | "context-full" | "shake" | "off"; autoContinue?: boolean; remoteEnabled?: boolean; keepRecentTokens?: number };
  memory?: { backend?: "off" | "local" | "mnemopi" | "hindsight" };
  autolearn?: { enabled?: boolean; autoContinue?: boolean; minToolCalls?: number };
  mnemopi?: { scoping?: "global" | "per-project" | "per-project-tagged"; autoRecall?: boolean; autoRetain?: boolean; noEmbeddings?: boolean };
  mcp?: { enableProjectConfig?: boolean; renderMarkdownResults?: boolean; notifications?: boolean; notificationDebounceMs?: number };
  task?: { eager?: "default" | "preferred" | "always"; prewalk?: boolean; agentModelOverrides?: Record<string, string | string[]>; agentPrewalk?: Record<string, boolean | string>; agentAdvisor?: Record<string, boolean | string>; disabledAgents?: string[] };
  browser?: { enabled?: boolean; relay?: boolean; headless?: boolean };
  computer?: { enabled?: boolean; display?: string };
  web_search?: { enabled?: boolean };
  github?: { enabled?: boolean };
  security?: { enabled?: boolean };
  checkpoint?: { enabled?: boolean };
};

const THINKING_LEVELS = new Set(["auto", "minimal", "low", "medium", "high", "xhigh", "max"]);
const TEXT_VERBOSITIES = new Set(["low", "medium", "high"]);
const PERSONALITIES = new Set(["default", "friendly", "pragmatic", "none"]);
const BACKLOGS = new Set(["off", "1", "3", "5"]);
const APPROVAL_MODES = new Set(["always-ask", "write", "yolo"]);
const APPROVAL_POLICIES = new Set(["allow", "prompt", "deny"]);
const FALLBACK_REVERT_POLICIES = new Set(["cooldown-expiry", "never"]);
const COMPACTION_STRATEGIES = new Set(["snapcompact", "handoff", "context-full", "shake", "off"]);
const MEMORY_BACKENDS = new Set(["off", "local", "mnemopi", "hindsight"]);
const MEMORY_SCOPES = new Set(["global", "per-project", "per-project-tagged"]);
const TASK_EAGER_VALUES = new Set(["default", "preferred", "always"]);

function configPath(): string {
  return getSettingsPath();
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}
function stringMap(value: unknown): Record<string, string | string[]> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string | string[]> = {};
  for (const [key, item] of Object.entries(value)) if (typeof item === "string" || stringArray(item)) out[key] = item as string | string[];
  return out;
}
function booleanStringMap(value: unknown): Record<string, boolean | string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, boolean | string> = {};
  for (const [key, item] of Object.entries(value)) if (typeof item === "boolean" || typeof item === "string") out[key] = item;
  return out;
}

function assertOptionalRecord(value: unknown, name: string): asserts value is Record<string, unknown> | undefined {
  if (value !== undefined && !isRecord(value)) throw new Error(`${name} must be an object`);
}

function assertOptionalBoolean(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
}

function assertOptionalString(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== "string") throw new Error(`${name} must be a string`);
}

function hasDefined(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined;
}

/** Keep only fields that this editor is allowed to persist. Unknown request
 * fields must not become new OMP config, while unknown YAML already on disk is
 * left untouched by the document writer below. Malformed recognized values are
 * intentionally retained so the normal validator can reject them. */
function filterKnownObject(value: unknown, keys: readonly string[]): unknown {
  if (!isRecord(value)) return value;
  const output: Record<string, unknown> = {};
  for (const key of keys) if (hasDefined(value, key)) output[key] = value[key];
  return output;
}

function filterKnownSection(
  source: Record<string, unknown>,
  sectionName: string,
  keys: readonly string[],
  nested: Record<string, readonly string[]> = {},
): unknown {
  if (!hasDefined(source, sectionName)) return undefined;
  const value = source[sectionName];
  if (!isRecord(value)) return value;
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    if (!hasDefined(value, key)) continue;
    const childKeys = nested[key];
    if (!childKeys || !isRecord(value[key])) {
      output[key] = value[key];
      continue;
    }
    const child = filterKnownObject(value[key], childKeys);
    // An explicitly empty child object is meaningful (it clears that map),
    // whereas an object containing only unknown keys must be a no-op.
    if (Object.keys(value[key] as Record<string, unknown>).length === 0 || Object.keys(child as Record<string, unknown>).length > 0) {
      output[key] = child;
    }
  }
  return output;
}

/** Return a reviewed, runtime-safe settings subset without changing values.
 * This is exported for the API route so it can merge a patch before writing. */
export function filterNativeSettings(settings: NativeSettings): NativeSettings {
  if (!isRecord(settings)) throw new Error("Settings must be an object");
  const source = settings as unknown as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of [
    "defaultThinkingLevel", "hideThinkingBlock", "externalThinking", "textVerbosity", "personality",
    "enabledModels", "disabledProviders", "modelProviderOrder",
  ]) if (hasDefined(source, key)) output[key] = source[key];
  const sections: Array<[string, readonly string[], Record<string, readonly string[]> | undefined]> = [
    ["advisor", ["enabled", "subagents", "syncBacklog", "immuneTurns"], undefined],
    ["tools", ["approvalMode", "approval"], { approval: ["bash", "extension"] }],
    ["retry", ["enabled", "maxRetries", "modelFallback", "fallbackRevertPolicy", "fallbackChains"], undefined],
    ["compaction", ["enabled", "midTurnEnabled", "strategy", "autoContinue", "remoteEnabled", "keepRecentTokens"], undefined],
    ["memory", ["backend"], undefined],
    ["autolearn", ["enabled", "autoContinue", "minToolCalls"], undefined],
    ["mnemopi", ["scoping", "autoRecall", "autoRetain", "noEmbeddings"], undefined],
    ["mcp", ["enableProjectConfig", "renderMarkdownResults", "notifications", "notificationDebounceMs"], undefined],
    ["task", ["eager", "prewalk", "agentModelOverrides", "agentPrewalk", "agentAdvisor", "disabledAgents"], undefined],
    ["browser", ["enabled", "relay", "headless"], undefined],
    ["computer", ["enabled", "display"], undefined],
    ["web_search", ["enabled"], undefined],
    ["github", ["enabled"], undefined],
    ["security", ["enabled"], undefined],
    ["checkpoint", ["enabled"], undefined],
  ];
  for (const [section, keys, nested] of sections) {
    const filtered = filterKnownSection(source, section, keys, nested);
    if (filtered === undefined) continue;
    const original = source[section];
    if (!isRecord(original) || Object.keys(original).length === 0 || Object.keys(filtered as Record<string, unknown>).length > 0) {
      output[section] = filtered;
    }
  }
  // registryHasScopedEntries is derived read-only metadata, never a write
  // target. In particular, do not let a client spoof it into the YAML file.
  return output as NativeSettings;
}

const OBJECT_SETTINGS_SECTIONS: Record<string, true> = {
  advisor: true,
  tools: true,
  retry: true,
  compaction: true,
  memory: true,
  autolearn: true,
  mnemopi: true,
  mcp: true,
  task: true,
  browser: true,
  computer: true,
  web_search: true,
  github: true,
  security: true,
  checkpoint: true,
};

/** Merge a reviewed partial editor update onto the latest persisted snapshot.
 * Arrays and scalar leaves replace; object-valued sections merge so omitted
 * siblings survive. tools.approval is the one nested section edited directly
 * by the UI and therefore receives the same merge treatment. */
export function mergeNativeSettings(current: NativeSettings, patch: NativeSettings): NativeSettings {
  const existing = isRecord(current) ? current as unknown as Record<string, unknown> : {};
  const incoming = filterNativeSettings(patch) as unknown as Record<string, unknown>;
  const output: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    if (OBJECT_SETTINGS_SECTIONS[key] && isRecord(value)) {
      const previous = isRecord(output[key]) ? output[key] as Record<string, unknown> : {};
      const section: Record<string, unknown> = { ...previous, ...value };
      if (key === "tools" && isRecord(value.approval)) {
        const previousApproval = isRecord(previous.approval) ? previous.approval : {};
        section.approval = Object.keys(value.approval).length === 0
          ? {}
          : { ...previousApproval, ...value.approval };
      }
      output[key] = section;
    } else {
      output[key] = value;
    }
  }
  delete output.registryHasScopedEntries;
  return output as NativeSettings;
}

function readDocument() {
  const path = configPath();
  const doc = parseDocument(existsSync(path) ? readFileSync(path, "utf8") : "");
  if (doc.errors.length > 0) throw new Error(`${path} is not valid YAML: ${doc.errors[0].message}`);
  return { path, doc };
}

/** Returns the persisted native OMP values only; omitted keys keep OMP defaults. */
export function readNativeSettings(): { path: string; settings: NativeSettings } {
  const { path, doc } = readDocument();
  const data = doc.toJS();
  if (!isRecord(data)) return { path, settings: {} };
  const advisor = isRecord(data.advisor) ? data.advisor : {};
  const tools = isRecord(data.tools) ? data.tools : {};
  const approval = isRecord(tools.approval) ? tools.approval : {};
  const retry = isRecord(data.retry) ? data.retry : {};
  const fallbackChains = isRecord(retry.fallbackChains)
    ? Object.fromEntries(Object.entries(retry.fallbackChains).filter((entry): entry is [string, string[]] => typeof entry[0] === "string" && stringArray(entry[1]) !== undefined))
    : {};
  const compaction = isRecord(data.compaction) ? data.compaction : {};
  const memory = isRecord(data.memory) ? data.memory : {};
  const autolearn = isRecord(data.autolearn) ? data.autolearn : {};
  const mnemopi = isRecord(data.mnemopi) ? data.mnemopi : {};
  const mcp = isRecord(data.mcp) ? data.mcp : {};
  const task = isRecord(data.task) ? data.task : {};
  const browser = isRecord(data.browser) ? data.browser : {};
  const computer = isRecord(data.computer) ? data.computer : {};
  const webSearch = isRecord(data.web_search) ? data.web_search : {};
  const github = isRecord(data.github) ? data.github : {};
  const security = isRecord(data.security) ? data.security : {};
  const checkpoint = isRecord(data.checkpoint) ? data.checkpoint : {};
  const registryHasScopedEntries = [data.enabledModels, data.disabledProviders, data.modelProviderOrder]
    .some((value) => Array.isArray(value) && !value.every((item) => typeof item === "string"));
  return {
    path,
    settings: {
      ...(THINKING_LEVELS.has(data.defaultThinkingLevel as string) ? { defaultThinkingLevel: data.defaultThinkingLevel as NativeSettings["defaultThinkingLevel"] } : {}),
      ...(typeof data.hideThinkingBlock === "boolean" ? { hideThinkingBlock: data.hideThinkingBlock } : {}),
      ...(typeof data.externalThinking === "boolean" ? { externalThinking: data.externalThinking } : {}),
      ...(TEXT_VERBOSITIES.has(data.textVerbosity as string) ? { textVerbosity: data.textVerbosity as NativeSettings["textVerbosity"] } : {}),
      ...(PERSONALITIES.has(data.personality as string) ? { personality: data.personality as NativeSettings["personality"] } : {}),
      ...(Object.keys(advisor).length ? {
        advisor: {
          ...(typeof advisor.enabled === "boolean" ? { enabled: advisor.enabled } : {}),
          ...(typeof advisor.subagents === "boolean" ? { subagents: advisor.subagents } : {}),
          ...(BACKLOGS.has(advisor.syncBacklog as string) ? { syncBacklog: advisor.syncBacklog as "off" | "1" | "3" | "5" } : {}),
          ...(typeof advisor.immuneTurns === "number" && Number.isInteger(advisor.immuneTurns) ? { immuneTurns: advisor.immuneTurns } : {}),
        },
      } : {}),
      ...(Object.keys(tools).length ? { tools: {
        ...(APPROVAL_MODES.has(tools.approvalMode as string) ? { approvalMode: tools.approvalMode as "always-ask" | "write" | "yolo" } : {}),
        ...(APPROVAL_POLICIES.has(approval.bash as string) || approval.extension === "allow" || approval.extension === "prompt" ? { approval: {
          ...(APPROVAL_POLICIES.has(approval.bash as string) ? { bash: approval.bash as "allow" | "prompt" | "deny" } : {}),
          ...(approval.extension === "allow" || approval.extension === "prompt" ? { extension: approval.extension } : {}),
        } } : {}),
      } } : {}),
      ...(stringArray(data.enabledModels) ? { enabledModels: stringArray(data.enabledModels) } : {}),
      ...(stringArray(data.disabledProviders) ? { disabledProviders: stringArray(data.disabledProviders) } : {}),
      ...(stringArray(data.modelProviderOrder) ? { modelProviderOrder: stringArray(data.modelProviderOrder) } : {}),
      ...(registryHasScopedEntries ? { registryHasScopedEntries: true } : {}),
      ...(Object.keys(retry).length ? { retry: {
        ...(typeof retry.enabled === "boolean" ? { enabled: retry.enabled } : {}),
        ...(typeof retry.maxRetries === "number" && Number.isInteger(retry.maxRetries) ? { maxRetries: retry.maxRetries } : {}),
        ...(typeof retry.modelFallback === "boolean" ? { modelFallback: retry.modelFallback } : {}),
        ...(FALLBACK_REVERT_POLICIES.has(retry.fallbackRevertPolicy as string) ? { fallbackRevertPolicy: retry.fallbackRevertPolicy as "cooldown-expiry" | "never" } : {}),
        ...(Object.keys(fallbackChains).length ? { fallbackChains } : {}),
      } } : {}),
      ...(Object.keys(compaction).length ? { compaction: {
        ...(typeof compaction.enabled === "boolean" ? { enabled: compaction.enabled } : {}),
        ...(typeof compaction.midTurnEnabled === "boolean" ? { midTurnEnabled: compaction.midTurnEnabled } : {}),
        ...(COMPACTION_STRATEGIES.has(compaction.strategy as string) ? { strategy: compaction.strategy as "snapcompact" | "handoff" | "context-full" | "shake" | "off" } : {}),
        ...(typeof compaction.autoContinue === "boolean" ? { autoContinue: compaction.autoContinue } : {}),
        ...(typeof compaction.remoteEnabled === "boolean" ? { remoteEnabled: compaction.remoteEnabled } : {}),
        ...(typeof compaction.keepRecentTokens === "number" && Number.isInteger(compaction.keepRecentTokens) ? { keepRecentTokens: compaction.keepRecentTokens } : {}),
      } } : {}),
      ...(Object.keys(memory).length ? { memory: { ...(MEMORY_BACKENDS.has(memory.backend as string) ? { backend: memory.backend as "off" | "local" | "mnemopi" | "hindsight" } : {}) } } : {}),
      ...(Object.keys(autolearn).length ? { autolearn: {
        ...(typeof autolearn.enabled === "boolean" ? { enabled: autolearn.enabled } : {}),
        ...(typeof autolearn.autoContinue === "boolean" ? { autoContinue: autolearn.autoContinue } : {}),
        ...(typeof autolearn.minToolCalls === "number" && Number.isInteger(autolearn.minToolCalls) ? { minToolCalls: autolearn.minToolCalls } : {}),
      } } : {}),
      ...(Object.keys(mnemopi).length ? { mnemopi: {
        ...(MEMORY_SCOPES.has(mnemopi.scoping as string) ? { scoping: mnemopi.scoping as "global" | "per-project" | "per-project-tagged" } : {}),
        ...(typeof mnemopi.autoRecall === "boolean" ? { autoRecall: mnemopi.autoRecall } : {}),
        ...(typeof mnemopi.autoRetain === "boolean" ? { autoRetain: mnemopi.autoRetain } : {}),
        ...(typeof mnemopi.noEmbeddings === "boolean" ? { noEmbeddings: mnemopi.noEmbeddings } : {}),
      } } : {}),
      ...(Object.keys(mcp).length ? { mcp: {
        ...(typeof mcp.enableProjectConfig === "boolean" ? { enableProjectConfig: mcp.enableProjectConfig } : {}),
        ...(typeof mcp.renderMarkdownResults === "boolean" ? { renderMarkdownResults: mcp.renderMarkdownResults } : {}),
        ...(typeof mcp.notifications === "boolean" ? { notifications: mcp.notifications } : {}),
        ...(typeof mcp.notificationDebounceMs === "number" && Number.isInteger(mcp.notificationDebounceMs) ? { notificationDebounceMs: mcp.notificationDebounceMs } : {}),
      } } : {}),
      ...(Object.keys(task).length ? { task: {
        ...(TASK_EAGER_VALUES.has(task.eager as string) ? { eager: task.eager as "default" | "preferred" | "always" } : {}),
        ...(typeof task.prewalk === "boolean" ? { prewalk: task.prewalk } : {}),
        ...(stringMap(task.agentModelOverrides) ? { agentModelOverrides: stringMap(task.agentModelOverrides) } : {}),
        ...(booleanStringMap(task.agentPrewalk) ? { agentPrewalk: booleanStringMap(task.agentPrewalk) } : {}),
        ...(booleanStringMap(task.agentAdvisor) ? { agentAdvisor: booleanStringMap(task.agentAdvisor) } : {}),
        ...(stringArray(task.disabledAgents) ? { disabledAgents: stringArray(task.disabledAgents) } : {}),
      } } : {}),
      ...(Object.keys(browser).length ? { browser: {
        ...(typeof browser.enabled === "boolean" ? { enabled: browser.enabled } : {}),
        ...(typeof browser.relay === "boolean" ? { relay: browser.relay } : {}),
        ...(typeof browser.headless === "boolean" ? { headless: browser.headless } : {}),
      } } : {}),
      ...(Object.keys(computer).length ? { computer: {
        ...(typeof computer.enabled === "boolean" ? { enabled: computer.enabled } : {}),
        ...(typeof computer.display === "string" ? { display: computer.display } : {}),
      } } : {}),
      ...(Object.keys(webSearch).length ? { web_search: {
        ...(typeof webSearch.enabled === "boolean" ? { enabled: webSearch.enabled } : {}),
      } } : {}),
      ...(Object.keys(github).length ? { github: {
        ...(typeof github.enabled === "boolean" ? { enabled: github.enabled } : {}),
      } } : {}),
      ...(Object.keys(security).length ? { security: {
        ...(typeof security.enabled === "boolean" ? { enabled: security.enabled } : {}),
      } } : {}),
      ...(Object.keys(checkpoint).length ? { checkpoint: {
        ...(typeof checkpoint.enabled === "boolean" ? { enabled: checkpoint.enabled } : {}),
      } } : {}),
    },
  };
}

/** Validates and applies a reviewed subset of OMP's global config schema. */
export function writeNativeSettings(settings: NativeSettings): void {
  if (!isRecord(settings)) throw new Error("Settings must be an object");
  assertOptionalRecord(settings.advisor, "advisor");
  assertOptionalRecord(settings.tools, "tools");
  assertOptionalRecord(settings.tools?.approval, "tools.approval");
  assertOptionalRecord(settings.retry, "retry");
  assertOptionalRecord(settings.retry?.fallbackChains, "retry.fallbackChains");
  assertOptionalRecord(settings.compaction, "compaction");
  assertOptionalRecord(settings.memory, "memory");
  assertOptionalRecord(settings.autolearn, "autolearn");
  assertOptionalRecord(settings.mnemopi, "mnemopi");
  assertOptionalRecord(settings.mcp, "mcp");
  assertOptionalRecord(settings.task, "task");
  assertOptionalRecord(settings.task?.agentModelOverrides, "task.agentModelOverrides");
  assertOptionalRecord(settings.task?.agentPrewalk, "task.agentPrewalk");
  assertOptionalRecord(settings.task?.agentAdvisor, "task.agentAdvisor");
  assertOptionalRecord(settings.browser, "browser");
  assertOptionalRecord(settings.computer, "computer");
  assertOptionalRecord(settings.web_search, "web_search");
  assertOptionalRecord(settings.github, "github");
  assertOptionalRecord(settings.security, "security");
  assertOptionalRecord(settings.checkpoint, "checkpoint");
  for (const [name, value] of Object.entries({
    hideThinkingBlock: settings.hideThinkingBlock,
    externalThinking: settings.externalThinking,
    "advisor.enabled": settings.advisor?.enabled,
    "advisor.subagents": settings.advisor?.subagents,
    "retry.enabled": settings.retry?.enabled,
    "retry.modelFallback": settings.retry?.modelFallback,
    "compaction.enabled": settings.compaction?.enabled,
    "compaction.midTurnEnabled": settings.compaction?.midTurnEnabled,
    "compaction.autoContinue": settings.compaction?.autoContinue,
    "compaction.remoteEnabled": settings.compaction?.remoteEnabled,
    "autolearn.enabled": settings.autolearn?.enabled,
    "autolearn.autoContinue": settings.autolearn?.autoContinue,
    "mnemopi.autoRecall": settings.mnemopi?.autoRecall,
    "mnemopi.autoRetain": settings.mnemopi?.autoRetain,
    "mnemopi.noEmbeddings": settings.mnemopi?.noEmbeddings,
    "mcp.enableProjectConfig": settings.mcp?.enableProjectConfig,
    "mcp.renderMarkdownResults": settings.mcp?.renderMarkdownResults,
    "mcp.notifications": settings.mcp?.notifications,
    "task.prewalk": settings.task?.prewalk,
    "browser.enabled": settings.browser?.enabled,
    "browser.relay": settings.browser?.relay,
    "browser.headless": settings.browser?.headless,
    "computer.enabled": settings.computer?.enabled,
    "web_search.enabled": settings.web_search?.enabled,
    "github.enabled": settings.github?.enabled,
    "security.enabled": settings.security?.enabled,
    "checkpoint.enabled": settings.checkpoint?.enabled,
  })) assertOptionalBoolean(value, name);
  assertOptionalString(settings.computer?.display, "computer.display");
  for (const [name, value] of Object.entries(settings.task?.agentModelOverrides ?? {})) {
    if (typeof value === "string") {
      if (!value.trim()) throw new Error(`task.agentModelOverrides.${name} must be a non-empty string`);
    } else if (stringArray(value)) {
      if (value.some((v) => !v.trim())) throw new Error(`task.agentModelOverrides.${name} must contain non-empty strings`);
    } else throw new Error(`task.agentModelOverrides.${name} must be a string or string array`);
  }
  for (const [mapName, map] of [["agentPrewalk", settings.task?.agentPrewalk], ["agentAdvisor", settings.task?.agentAdvisor]] as const) {
    for (const [name, value] of Object.entries(map ?? {})) if (typeof value !== "boolean" && typeof value !== "string") throw new Error(`task.${mapName}.${name} must be a boolean or string`);
  }
  if (settings.task?.disabledAgents !== undefined && (!stringArray(settings.task.disabledAgents) || settings.task.disabledAgents.some((v) => !v.trim()))) throw new Error("task.disabledAgents must contain non-empty strings");
  if (settings.task?.eager !== undefined && !TASK_EAGER_VALUES.has(settings.task.eager)) throw new Error("Invalid task eager preference");
  if (settings.defaultThinkingLevel !== undefined && !THINKING_LEVELS.has(settings.defaultThinkingLevel)) throw new Error("Invalid default thinking level");
  if (settings.textVerbosity !== undefined && !TEXT_VERBOSITIES.has(settings.textVerbosity)) throw new Error("Invalid text verbosity");
  if (settings.personality !== undefined && !PERSONALITIES.has(settings.personality)) throw new Error("Invalid personality");
  if (settings.advisor?.syncBacklog !== undefined && !BACKLOGS.has(settings.advisor.syncBacklog)) throw new Error("Invalid advisor sync backlog");
  if (settings.advisor?.immuneTurns !== undefined && (!Number.isInteger(settings.advisor.immuneTurns) || settings.advisor.immuneTurns < 0 || settings.advisor.immuneTurns > 20)) throw new Error("Advisor immune turns must be an integer between 0 and 20");
  if (settings.tools?.approvalMode !== undefined && !APPROVAL_MODES.has(settings.tools.approvalMode)) throw new Error("Invalid approval mode");
  if (settings.tools?.approval?.bash !== undefined && !APPROVAL_POLICIES.has(settings.tools.approval.bash)) throw new Error("Invalid Bash approval policy");
  if (settings.tools?.approval?.extension !== undefined && settings.tools.approval.extension !== "allow" && settings.tools.approval.extension !== "prompt") throw new Error("Invalid extension tool approval policy");
  if (settings.retry?.maxRetries !== undefined && (!Number.isInteger(settings.retry.maxRetries) || settings.retry.maxRetries < 0 || settings.retry.maxRetries > 20)) throw new Error("Retry attempts must be an integer between 0 and 20");
  if (settings.retry?.fallbackRevertPolicy !== undefined && !FALLBACK_REVERT_POLICIES.has(settings.retry.fallbackRevertPolicy)) throw new Error("Invalid fallback revert policy");
  if (settings.retry?.fallbackChains !== undefined) {
    for (const [role, chain] of Object.entries(settings.retry.fallbackChains)) {
      if (!role.trim() || !Array.isArray(chain) || chain.some((selector) => typeof selector !== "string" || !selector.trim())) throw new Error("Fallback chains require non-empty role and model selectors");
    }
  }
  if (settings.compaction?.strategy !== undefined && !COMPACTION_STRATEGIES.has(settings.compaction.strategy)) throw new Error("Invalid compaction strategy");
  if (settings.compaction?.keepRecentTokens !== undefined && (!Number.isInteger(settings.compaction.keepRecentTokens) || settings.compaction.keepRecentTokens < 1_000 || settings.compaction.keepRecentTokens > 1_000_000)) throw new Error("Compaction retained tokens must be an integer between 1,000 and 1,000,000");
  if (settings.memory?.backend !== undefined && !MEMORY_BACKENDS.has(settings.memory.backend)) throw new Error("Invalid memory backend");
  if (settings.autolearn?.minToolCalls !== undefined && (!Number.isInteger(settings.autolearn.minToolCalls) || settings.autolearn.minToolCalls < 0 || settings.autolearn.minToolCalls > 100)) throw new Error("Auto-learn minimum tool calls must be an integer between 0 and 100");
  if (settings.mnemopi?.scoping !== undefined && !MEMORY_SCOPES.has(settings.mnemopi.scoping)) throw new Error("Invalid Mnemopi memory scope");
  if (settings.mcp?.notificationDebounceMs !== undefined && (!Number.isInteger(settings.mcp.notificationDebounceMs) || settings.mcp.notificationDebounceMs < 0 || settings.mcp.notificationDebounceMs > 60_000)) throw new Error("MCP notification debounce must be an integer between 0 and 60,000");
  for (const [key, values] of Object.entries({ enabledModels: settings.enabledModels, disabledProviders: settings.disabledProviders, modelProviderOrder: settings.modelProviderOrder })) {
    if (values !== undefined && (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim()))) throw new Error(`${key} must contain non-empty strings`);
  }

  const reviewed = filterNativeSettings(settings);
  const { path, doc } = readDocument();
  mkdirSync(dirname(path), { recursive: true });
  if (doc.contents === null) {
    // Keep document-level comments when turning a new or comment-only file
    // into a mapping, just as we do for an existing mapping below.
    doc.contents = doc.createNode(reviewed) as unknown as typeof doc.contents;
    const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
    try { writeFileSync(temp, doc.toString(), "utf8"); renameSync(temp, path); } catch (error) { try { if (existsSync(temp)) unlinkSync(temp); } catch {} throw error; }
    return;
  }
  if (!isMap(doc.contents)) throw new Error(`${path} must contain a YAML mapping`);
  if (reviewed.defaultThinkingLevel !== undefined) doc.set("defaultThinkingLevel", reviewed.defaultThinkingLevel);
  if (reviewed.hideThinkingBlock !== undefined) doc.set("hideThinkingBlock", reviewed.hideThinkingBlock);
  if (reviewed.externalThinking !== undefined) doc.set("externalThinking", reviewed.externalThinking);
  if (reviewed.textVerbosity !== undefined) doc.set("textVerbosity", reviewed.textVerbosity);
  if (reviewed.personality !== undefined) doc.set("personality", reviewed.personality);
  for (const [key, value] of Object.entries(reviewed.advisor ?? {})) doc.setIn(["advisor", key], value);
  if (reviewed.tools?.approvalMode !== undefined) doc.setIn(["tools", "approvalMode"], reviewed.tools.approvalMode);
  if (reviewed.tools?.approval !== undefined) {
    if (Object.keys(reviewed.tools.approval).length === 0) doc.setIn(["tools", "approval"], {});
    else {
      if (reviewed.tools.approval.bash !== undefined) doc.setIn(["tools", "approval", "bash"], reviewed.tools.approval.bash);
      if (reviewed.tools.approval.extension !== undefined) doc.setIn(["tools", "approval", "extension"], reviewed.tools.approval.extension);
    }
  }
  if (reviewed.enabledModels !== undefined) doc.set("enabledModels", reviewed.enabledModels);
  if (reviewed.disabledProviders !== undefined) doc.set("disabledProviders", reviewed.disabledProviders);
  if (reviewed.modelProviderOrder !== undefined) doc.set("modelProviderOrder", reviewed.modelProviderOrder);
  for (const [key, value] of Object.entries(reviewed.retry ?? {})) doc.setIn(["retry", key], value);
  for (const [key, value] of Object.entries(reviewed.compaction ?? {})) doc.setIn(["compaction", key], value);
  for (const [key, value] of Object.entries(reviewed.memory ?? {})) doc.setIn(["memory", key], value);
  for (const [key, value] of Object.entries(reviewed.autolearn ?? {})) doc.setIn(["autolearn", key], value);
  for (const [key, value] of Object.entries(reviewed.mnemopi ?? {})) doc.setIn(["mnemopi", key], value);
  for (const [key, value] of Object.entries(reviewed.mcp ?? {})) doc.setIn(["mcp", key], value);
  if (reviewed.task?.eager !== undefined) doc.setIn(["task", "eager"], reviewed.task.eager);
  if (reviewed.task?.prewalk !== undefined) doc.setIn(["task", "prewalk"], reviewed.task.prewalk);
  if (reviewed.task?.agentModelOverrides !== undefined) doc.setIn(["task", "agentModelOverrides"], reviewed.task.agentModelOverrides);
  if (reviewed.task?.agentPrewalk !== undefined) doc.setIn(["task", "agentPrewalk"], reviewed.task.agentPrewalk);
  if (reviewed.task?.agentAdvisor !== undefined) doc.setIn(["task", "agentAdvisor"], reviewed.task.agentAdvisor);
  if (reviewed.task?.disabledAgents !== undefined) doc.setIn(["task", "disabledAgents"], reviewed.task.disabledAgents);
  for (const [key, value] of Object.entries(reviewed.browser ?? {})) doc.setIn(["browser", key], value);
  for (const [key, value] of Object.entries(reviewed.computer ?? {})) doc.setIn(["computer", key], value);
  for (const [key, value] of Object.entries(reviewed.web_search ?? {})) doc.setIn(["web_search", key], value);
  for (const [key, value] of Object.entries(reviewed.github ?? {})) doc.setIn(["github", key], value);
  for (const [key, value] of Object.entries(reviewed.security ?? {})) doc.setIn(["security", key], value);
  for (const [key, value] of Object.entries(reviewed.checkpoint ?? {})) doc.setIn(["checkpoint", key], value);
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  try { writeFileSync(temp, doc.toString(), "utf8"); renameSync(temp, path); } catch (error) { try { if (existsSync(temp)) unlinkSync(temp); } catch {} throw error; }
}
