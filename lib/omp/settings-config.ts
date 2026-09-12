import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "fs";
import { dirname, join } from "path";
import { isAlias, isMap, parseDocument, visit, type Document } from "yaml";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "../file-access";
import { isPathWithinRoots, resolvePathWithMissingLeaf } from "../path-security";
import { isRecord } from "../type-guards";
import {
  NATIVE_SETTINGS_CATALOG,
  type NativeSettingDefinition,
  type NativeSettingsScope,
  type NativeSettingsSnapshot,
  type NativeSettingsUpdate,
} from "./settings-catalog";
import { writeConfigFileAtomic } from "./config-file";
import { resolveNativeConfigWritePath, withNativeConfigLock } from "./file-lock";
import { getSettingsPath } from "./paths";

export type NativeSettings = Record<string, unknown> & {
  enabledModels?: string[];
  disabledProviders?: string[];
  enabledProviders?: string[];
  modelProviderOrder?: string[];
  registryHasScopedEntries?: boolean;
  retry?: Record<string, unknown> & { enabled?: boolean; maxRetries?: number; modelFallback?: boolean; fallbackChains?: Record<string, string[]> };
  tools?: Record<string, unknown> & { approval?: { bash?: "allow" | "prompt" | "deny"; extension?: "allow" | "prompt" } };
  task?: Record<string, unknown> & {
    disabledAgents?: string[];
    agentModelOverrides?: Record<string, string | string[]>;
    agentPrewalk?: Record<string, string>;
    agentAdvisor?: Record<string, string>;
  };
};

export type NativeSettingsIssue = { path: string; message: string };

export class NativeSettingsError extends Error {
  readonly code: string;
  readonly issues: NativeSettingsIssue[];

  constructor(code: string, message: string, issues: NativeSettingsIssue[] = []) {
    super(message);
    this.name = "NativeSettingsError";
    this.code = code;
    this.issues = issues;
  }
}

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_TEXT = 16_384;
const MAX_COLLECTION = 256;
const MAX_OBJECT_ENTRIES = 512;
const MAX_OBJECT_DEPTH = 8;
const MAX_JSON_BYTES = 131_072;
const CATALOG_BY_PATH = new Map(NATIVE_SETTINGS_CATALOG.map((definition) => [definition.path, definition]));
const REVIEWED_NUMBER_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  "advisor.immuneTurns": [0, 20],
  "advisor.maxNotesPerUpdate": [1, 32],
  "autolearn.minToolCalls": [0, 100],
  "compaction.keepRecentTokens": [1_000, 1_000_000],
  "mcp.notificationDebounceMs": [0, 60_000],
  "providers.webSearchTimeoutSeconds": [0, 300],
  "retry.maxRetries": [0, 20],
  "retry.usageReservePct": [0, 100],
};

type LocatedValue = { present: boolean; value?: unknown; malformedAt?: string };
type ConfigDocument = { path: string; doc: Document; raw: Record<string, unknown> };
type ConfigTarget = { path: string; scope: NativeSettingsScope; cwd?: string };

function pathParts(path: string): string[] {
  const parts = path.split(".");
  if (!parts.length || parts.some((part) => !part || FORBIDDEN_KEYS.has(part))) {
    throw new NativeSettingsError("invalid_path", "Settings path is invalid", [{ path, message: "Invalid settings path" }]);
  }
  return parts;
}

function locate(root: Record<string, unknown>, path: string): LocatedValue {
  let current: unknown = root;
  const traversed: string[] = [];
  for (const part of pathParts(path)) {
    traversed.push(part);
    if (!isRecord(current)) return { present: false, malformedAt: traversed.slice(0, -1).join(".") || part };
    if (!Object.prototype.hasOwnProperty.call(current, part)) return { present: false };
    current = current[part];
  }
  return { present: true, value: current };
}

function setNested(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = pathParts(path);
  let current = root;
  for (const part of parts.slice(0, -1)) {
    const child = current[part];
    if (!isRecord(child)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1)!] = value;
}

function cloneJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (!FORBIDDEN_KEYS.has(key)) output[key] = cloneJson(child);
    }
    return output;
  }
  return value;
}

function deepMergeJson(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) return cloneJson(override);
  const output = cloneJson(base) as Record<string, unknown>;
  for (const [key, value] of Object.entries(override)) {
    output[key] = isRecord(output[key]) && isRecord(value)
      ? deepMergeJson(output[key], value)
      : cloneJson(value);
  }
  return output;
}

function validateJson(value: unknown, path: string, depth = 0, state = { entries: 0 }): void {
  if (depth > MAX_OBJECT_DEPTH) throw new Error("is nested too deeply");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.length > MAX_TEXT) throw new Error(`must be at most ${MAX_TEXT} characters`);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("must be finite");
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_COLLECTION) throw new Error(`must contain at most ${MAX_COLLECTION} items`);
    for (const child of value) validateJson(child, path, depth + 1, state);
    return;
  }
  if (!isRecord(value)) throw new Error("must contain JSON values only");
  for (const [key, child] of Object.entries(value)) {
    state.entries += 1;
    if (state.entries > MAX_OBJECT_ENTRIES) throw new Error(`must contain at most ${MAX_OBJECT_ENTRIES} entries`);
    if (!key || key.length > 256 || FORBIDDEN_KEYS.has(key)) throw new Error("contains an invalid key");
    validateJson(child, path, depth + 1, state);
  }
  let encoded: string;
  try { encoded = JSON.stringify(value); } catch { throw new Error("must be JSON serializable"); }
  if (Buffer.byteLength(encoded, "utf8") > MAX_JSON_BYTES) throw new Error(`must be at most ${MAX_JSON_BYTES} bytes`);
}

function validateRecordValue(definition: NativeSettingDefinition, key: string, value: unknown, scope: NativeSettingsScope): unknown {
  const path = `${definition.path}.${key}`;
  switch (definition.recordValues) {
    case "string":
      if (typeof value !== "string" || !value.trim() || value.length > MAX_TEXT) throw new Error(`${path} must be a non-empty string`);
      return value;
    case "model-role":
      if (value === null && scope === "project") return null;
      if (typeof value === "string") {
        if (!value.trim() || value.length > MAX_TEXT) throw new Error(`${path} must be a non-empty model selector`);
        return value;
      }
      if (!Array.isArray(value) || value.length === 0 || value.length > MAX_COLLECTION || value.some((item) => typeof item !== "string" || !item.trim() || item.length > MAX_TEXT)) {
        throw new Error(`${path} must be a non-empty model selector or selector array`);
      }
      return [...value];
    case "boolean-string":
      if (typeof value !== "string" || !value.trim() || value.length > MAX_TEXT) throw new Error(`${path} must be an on/off selector or model pattern`);
      return value;
    case "string-array":
      if (!Array.isArray(value) || value.length > MAX_COLLECTION || value.some((item) => typeof item !== "string" || !item.trim() || item.length > MAX_TEXT)) {
        throw new Error(`${path} must be a bounded string array`);
      }
      return [...value];
    case "string-or-string-array": {
      if (typeof value === "string") {
        if (!value.trim() || value.length > MAX_TEXT) throw new Error(`${path} must be a non-empty string or string array`);
        return value;
      }
      if (!Array.isArray(value) || value.length > MAX_COLLECTION || value.some((item) => typeof item !== "string" || !item.trim() || item.length > MAX_TEXT)) {
        throw new Error(`${path} must be a non-empty string or bounded string array`);
      }
      return [...value];
    }
    case "approval": {
      if (typeof value !== "string" || !["allow", "prompt", "deny"].includes(value)) {
        throw new Error(`${path} must be an allowed approval policy`);
      }
      return value;
    }
    case "json":
    default:
      validateJson(value, path);
      return cloneJson(value);
  }
}

function boundedString(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > MAX_TEXT) throw new Error(`${field} must be a bounded string`);
  return value;
}

function validateStructuredValue(definition: NativeSettingDefinition, value: unknown): unknown | undefined {
  const path = definition.path;
  if (path === "modelTags") {
    if (!isRecord(value)) throw new Error(`${path} must be an object`);
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key) || !isRecord(item)) throw new Error(`${path}.${key} must be a model tag object`);
      const allowed = new Set(["name", "color", "hidden"]);
      if (Object.keys(item).some((field) => !allowed.has(field))) throw new Error(`${path}.${key} contains an unknown field`);
      const tag: Record<string, unknown> = { name: boundedString(item.name, `${path}.${key}.name`) };
      if (item.color !== undefined) tag.color = boundedString(item.color, `${path}.${key}.color`);
      if (item.hidden !== undefined) {
        if (typeof item.hidden !== "boolean") throw new Error(`${path}.${key}.hidden must be a boolean`);
        tag.hidden = item.hidden;
      }
      output[key] = tag;
    }
    validateJson(output, path);
    return output;
  }
  if (path === "providers.maxInFlightRequests") {
    if (!isRecord(value)) throw new Error(`${path} must be an object`);
    const output: Record<string, unknown> = {};
    for (const [key, limit] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key) || typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0 || limit > Number.MAX_SAFE_INTEGER) {
        throw new Error(`${path}.${key} must be a positive finite number`);
      }
      output[key] = Math.max(1, Math.floor(limit));
    }
    return output;
  }
  if (path === "images.urls.options" || path === "images.urls.credentials") {
    if (!isRecord(value)) throw new Error(`${path} must be an object`);
    const output: Record<string, unknown> = {};
    for (const [backend, options] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(backend) || !isRecord(options)) throw new Error(`${path}.${backend} must be an object`);
      const normalized: Record<string, unknown> = {};
      for (const [key, option] of Object.entries(options)) {
        if (FORBIDDEN_KEYS.has(key)) throw new Error(`${path}.${backend} contains an invalid key`);
        if (path === "images.urls.credentials") normalized[key] = boundedString(option, `${path}.${backend}.${key}`);
        else { validateJson(option, `${path}.${backend}.${key}`); normalized[key] = cloneJson(option); }
      }
      output[backend] = normalized;
    }
    validateJson(output, path);
    return output;
  }
  if (path === "bash.patterns") {
    if (!Array.isArray(value) || value.length > MAX_COLLECTION) throw new Error(`${path} must be a bounded array`);
    return value.map((item, index) => {
      if (!isRecord(item) || Object.keys(item).some((key) => !["match", "approval"].includes(key))) throw new Error(`${path}.${index} must contain only match and approval`);
      const match = boundedString(item.match, `${path}.${index}.match`);
      if (item.approval !== "allow" && item.approval !== "prompt" && item.approval !== "deny") throw new Error(`${path}.${index}.approval is invalid`);
      return { match, approval: item.approval };
    });
  }
  if (path === "bashInterceptor.patterns") {
    if (!Array.isArray(value) || value.length > MAX_COLLECTION) throw new Error(`${path} must be a bounded array`);
    return value.map((item, index) => {
      if (!isRecord(item) || Object.keys(item).some((key) => !["pattern", "flags", "tool", "message", "allowSubcommands"].includes(key))) throw new Error(`${path}.${index} contains an unknown field`);
      const rule: Record<string, unknown> = {
        pattern: boundedString(item.pattern, `${path}.${index}.pattern`),
        tool: boundedString(item.tool, `${path}.${index}.tool`),
        message: boundedString(item.message, `${path}.${index}.message`, true),
      };
      if (item.flags !== undefined) rule.flags = boundedString(item.flags, `${path}.${index}.flags`, true);
      try { new RegExp(rule.pattern as string, rule.flags as string | undefined); } catch { throw new Error(`${path}.${index} must contain a valid regular expression`); }
      if (item.allowSubcommands !== undefined) {
        if (!Array.isArray(item.allowSubcommands) || item.allowSubcommands.length > MAX_COLLECTION || item.allowSubcommands.some((entry) => typeof entry !== "string" || !entry.trim() || entry.length > MAX_TEXT)) throw new Error(`${path}.${index}.allowSubcommands must be a bounded string array`);
        rule.allowSubcommands = [...item.allowSubcommands];
      }
      return rule;
    });
  }
  return undefined;
}

function validateValue(definition: NativeSettingDefinition, value: unknown, scope: NativeSettingsScope): unknown {
  const path = definition.path;
  const structured = validateStructuredValue(definition, value);
  if (structured !== undefined) return structured;
  switch (definition.kind) {
    case "boolean":
      if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
      return value;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error(`${path} must be a bounded finite number`);
      if (definition.integer && !Number.isSafeInteger(value)) throw new Error(`${path} must be a safe integer`);
      const reviewedRange = REVIEWED_NUMBER_RANGES[path];
      const minimum = definition.min ?? reviewedRange?.[0];
      const maximum = definition.max ?? reviewedRange?.[1];
      if (minimum !== undefined && value < minimum) throw new Error(`${path} must be at least ${minimum}`);
      if (maximum !== undefined && value > maximum) throw new Error(`${path} must be at most ${maximum}`);
      return value;
    case "string":
      if (typeof value !== "string") throw new Error(`${path} must be a string`);
      if (value.length > MAX_TEXT) throw new Error(`${path} must be at most ${MAX_TEXT} characters`);
      return value;
    case "enum":
      if (typeof value !== "string" || !definition.choices?.includes(value)) throw new Error(`${path} must be one of the allowed values`);
      return value;
    case "array": {
      if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
      if (value.length > MAX_COLLECTION) throw new Error(`${path} must contain at most ${MAX_COLLECTION} items`);
      const output: unknown[] = [];
      for (const item of value) {
        if (definition.items === "string") {
          if (typeof item !== "string" || !item.trim() || item.length > MAX_TEXT) throw new Error(`${path} must contain non-empty strings`);
          if (definition.choices?.length && !definition.choices.includes(item)) throw new Error(`${path} contains an unsupported value`);
          output.push(item);
        } else if (definition.items === "number") {
          if (typeof item !== "number" || !Number.isFinite(item)) throw new Error(`${path} must contain finite numbers`);
          output.push(item);
        } else {
          validateJson(item, path);
          output.push(cloneJson(item));
        }
      }
      return output;
    }
    case "object": {
      if (!isRecord(value)) throw new Error(`${path} must be an object`);
      const entries = Object.entries(value);
      if (entries.length > MAX_OBJECT_ENTRIES) throw new Error(`${path} must contain at most ${MAX_OBJECT_ENTRIES} entries`);
      const output: Record<string, unknown> = {};
      for (const [key, child] of entries) {
        if (!key || key.length > 256 || FORBIDDEN_KEYS.has(key)) throw new Error(`${path} contains an invalid key`);
        output[key] = validateRecordValue(definition, key, child, scope);
      }
      validateJson(output, path);
      return output;
    }
  }
}

function legacyCompaction(raw: Record<string, unknown>): string[] | undefined {
  const compaction = isRecord(raw.compaction) ? raw.compaction : undefined;
  const canonical = compaction?.methodOrder ?? raw["compaction.methodOrder"];
  if (Array.isArray(canonical)) return canonical as string[];
  const strategyValue = compaction?.strategy ?? raw["compaction.strategy"];
  const strategy = strategyValue === "shake-summary" ? "shake" : strategyValue;
  const legacyRemote = compaction?.remoteEnabled ?? raw["compaction.remoteEnabled"];
  const remote = legacyRemote !== false;
  switch (strategy) {
    case "context-full": return remote ? ["remote", "soft"] : ["soft"];
    case "handoff": return remote ? ["handoff", "remote", "soft"] : ["handoff", "soft"];
    case "shake": return remote ? ["shake", "remote", "soft"] : ["shake", "soft"];
    case "snapcompact": return remote ? ["snapcompact", "remote", "soft"] : ["snapcompact", "soft"];
    case "off": return [];
    default:
      if (legacyRemote === false) return ["snapcompact", "handoff", "shake", "soft"];
      return undefined;
  }
}

function projectedValue(raw: Record<string, unknown>, path: string): LocatedValue {
  const located = locate(raw, path);
  if (located.present) {
    if ((path === "task.agentAdvisor" || path === "task.agentPrewalk") && isRecord(located.value)) {
      const normalized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(located.value)) normalized[key] = typeof value === "boolean" ? (value ? "on" : "off") : value;
      if (path === "task.agentAdvisor" && !Object.prototype.hasOwnProperty.call(normalized, "task")) {
        const advisor = isRecord(raw.advisor) ? raw.advisor : undefined;
        const legacy = advisor && Object.prototype.hasOwnProperty.call(advisor, "subagents") ? advisor.subagents : raw["advisor.subagents"];
        if (typeof legacy === "boolean") normalized.task = legacy ? "on" : "off";
      }
      return { present: true, value: normalized };
    }
    return located;
  }
  if (path === "compaction.methodOrder") {
    const migrated = legacyCompaction(raw);
    return migrated === undefined ? located : { present: true, value: migrated };
  }
  if (path === "task.agentAdvisor") {
    const advisor = isRecord(raw.advisor) ? raw.advisor : undefined;
    const legacy = advisor && Object.prototype.hasOwnProperty.call(advisor, "subagents") ? advisor.subagents : raw["advisor.subagents"];
    if (typeof legacy === "boolean") return { present: true, value: { task: legacy ? "on" : "off" } };
  }
  return located;
}

const PATH_SCOPED_REGISTRY_SETTINGS = new Set(["enabledModels", "disabledProviders", "enabledProviders"]);

function projectedRegistryValue(value: unknown): { value: string[]; hasScopedEntries: boolean } {
  if (!Array.isArray(value) || value.length > MAX_COLLECTION) throw new Error("must be a bounded array");
  validateJson(value, "registry");
  const strings: string[] = [];
  let hasScopedEntries = false;
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim() && entry.length <= MAX_TEXT) strings.push(entry);
    else if (isRecord(entry)) hasScopedEntries = true;
    else throw new Error("must contain strings or path-scoped rules");
  }
  return { value: strings, hasScopedEntries };
}

function projectKnown(raw: Record<string, unknown>, issues?: NativeSettingsIssue[], scope: NativeSettingsScope = "global"): NativeSettings {
  const output: Record<string, unknown> = {};
  const reported = new Set(issues?.map((issue) => issue.path) ?? []);
  let registryHasScopedEntries = false;
  for (const definition of NATIVE_SETTINGS_CATALOG) {
    if (definition.secret) continue;
    const located = projectedValue(raw, definition.path);
    if (located.malformedAt) {
      if (issues && !reported.has(located.malformedAt)) {
        reported.add(located.malformedAt);
        issues.push({ path: located.malformedAt, message: "Stored settings section is not an object and was omitted" });
      }
      continue;
    }
    if (!located.present) continue;
    try {
      if (PATH_SCOPED_REGISTRY_SETTINGS.has(definition.path)) {
        const projected = projectedRegistryValue(located.value);
        registryHasScopedEntries ||= projected.hasScopedEntries;
        setNested(output, definition.path, projected.value);
      } else if (definition.path === "modelRoles" && isRecord(located.value)) {
        const roles: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(located.value)) {
          try { roles[key] = validateRecordValue(definition, key, value, scope); }
          catch {
            const issuePath = `${definition.path}.${key}`;
            if (issues && !reported.has(issuePath)) {
              reported.add(issuePath);
              issues.push({ path: issuePath, message: "Stored model role is invalid and was omitted" });
            }
          }
        }
        setNested(output, definition.path, roles);
      } else {
        setNested(output, definition.path, validateValue(definition, located.value, scope));
      }
    } catch {
      if (issues && !reported.has(definition.path)) {
        reported.add(definition.path);
        issues.push({ path: definition.path, message: "Stored value is invalid or outside editor bounds and was omitted" });
      }
    }
  }
  if (registryHasScopedEntries) output.registryHasScopedEntries = true;
  return output as NativeSettings;
}

function readConfigDocument(path: string): ConfigDocument {
  const doc = parseDocument(existsSync(path) ? readFileSync(path, "utf8") : "");
  if (doc.errors.length) throw new NativeSettingsError("invalid_yaml", "Settings file is not valid YAML", [{ path: "$", message: "Invalid YAML syntax" }]);
  const value = doc.toJS();
  if (value !== null && !isRecord(value)) throw new NativeSettingsError("invalid_yaml", "Settings file must contain a YAML mapping", [{ path: "$", message: "Expected a mapping" }]);
  return { path, doc, raw: isRecord(value) ? value : {} };
}

function globalTarget(): ConfigTarget {
  return { path: getSettingsPath(), scope: "global" };
}

function physicalWriteTarget(target: ConfigTarget): ConfigTarget {
  return { ...target, path: resolveNativeConfigWritePath(target.path) };
}

async function projectTarget(cwdValue: unknown): Promise<ConfigTarget> {
  if (typeof cwdValue !== "string" || !cwdValue.trim() || cwdValue.length > 4096 || cwdValue.includes("\0")) {
    throw new NativeSettingsError("invalid_scope", "An existing authorized cwd is required for project settings", [{ path: "cwd", message: "Invalid project cwd" }]);
  }
  let cwd: string;
  try {
    cwd = realpathSync(cwdValue);
    if (!statSync(cwd).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new NativeSettingsError("invalid_scope", "An existing authorized cwd is required for project settings", [{ path: "cwd", message: "Project cwd does not exist" }]);
  }
  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    throw new NativeSettingsError("forbidden_scope", "Project settings path is not authorized", [{ path: "cwd", message: "Project cwd is outside allowed roots" }]);
  }
  const requested = join(cwd, ".omp", "config.yml");
  let resolved: string;
  try { resolved = resolvePathWithMissingLeaf(requested); } catch {
    throw new NativeSettingsError("forbidden_scope", "Project settings path cannot be resolved safely", [{ path: "cwd", message: "Project settings path is unsafe" }]);
  }
  if (!isPathWithinRoots(resolved, new Set([cwd]))) {
    throw new NativeSettingsError("forbidden_scope", "Project settings path escapes the authorized workspace", [{ path: "cwd", message: "Project settings symlink escapes the workspace" }]);
  }
  return { path: resolved, scope: "project", cwd };
}

async function resolveTarget(scope: unknown, cwd: unknown): Promise<ConfigTarget> {
  const selected = scope ?? "global";
  if (selected === "global") return globalTarget();
  if (selected === "project") return projectTarget(cwd);
  throw new NativeSettingsError("invalid_scope", "scope must be global or project", [{ path: "scope", message: "Unsupported settings scope" }]);
}

function mergeKnown(globalSettings: NativeSettings, projectSettings: NativeSettings): NativeSettings {
  const output = cloneJson(globalSettings) as Record<string, unknown>;
  for (const definition of NATIVE_SETTINGS_CATALOG) {
    if (definition.secret) continue;
    const projectValue = locate(projectSettings, definition.path);
    if (!projectValue.present) continue;
    const globalValue = locate(output, definition.path);
    let override = projectValue.value;
    if (definition.path === "modelRoles" && isRecord(override)) {
      override = Object.fromEntries(Object.entries(override).filter(([, value]) => value !== null));
    }
    setNested(output, definition.path, globalValue.present
      ? deepMergeJson(globalValue.value, override)
      : cloneJson(override));
  }
  if (projectSettings.registryHasScopedEntries) output.registryHasScopedEntries = true;
  return output as NativeSettings;
}

function secretStatus(raw: Record<string, unknown>): Record<string, boolean> {
  const status: Record<string, boolean> = {};
  for (const definition of NATIVE_SETTINGS_CATALOG) {
    if (!definition.secret) continue;
    const located = locate(raw, definition.path);
    status[definition.path] = located.present && located.value !== null && located.value !== "";
  }
  return status;
}

export function filterNativeSettings(settings: unknown, scope: NativeSettingsScope = "global"): NativeSettings {
  if (!isRecord(settings)) throw new NativeSettingsError("invalid_settings", "settings must be an object", [{ path: "settings", message: "Expected an object" }]);
  try { validateJson(settings, "settings"); }
  catch (error) {
    throw new NativeSettingsError("invalid_settings", "Settings object is malformed", [{ path: "settings", message: error instanceof Error ? error.message : "Malformed settings object" }]);
  }
  const output: Record<string, unknown> = {};
  const issues: NativeSettingsIssue[] = [];
  const malformedParents = new Set<string>();
  for (const definition of NATIVE_SETTINGS_CATALOG) {
    const located = locate(settings, definition.path);
    if (located.malformedAt && !malformedParents.has(located.malformedAt)) {
      malformedParents.add(located.malformedAt);
      issues.push({ path: located.malformedAt, message: "Expected an object" });
      continue;
    }
    if (!located.present) continue;
    if (definition.secret) {
      issues.push({ path: definition.path, message: "Secret fields must use the write-only secrets object" });
      continue;
    }
    if (scope === "project" && definition.scope !== "both") {
      issues.push({ path: definition.path, message: "This setting is global-only" });
      continue;
    }
    try { setNested(output, definition.path, validateValue(definition, located.value, scope)); }
    catch (error) { issues.push({ path: definition.path, message: error instanceof Error ? error.message : "Invalid value" }); }
  }
  if (issues.length) throw new NativeSettingsError("invalid_settings", "One or more settings are invalid", issues);
  return output as NativeSettings;
}

function applyLegacyCutover(doc: Document, raw: Record<string, unknown>): void {
  const canonicalCompaction = locate(raw, "compaction.methodOrder");
  if (!canonicalCompaction.present) {
    const migrated = legacyCompaction(raw);
    if (migrated !== undefined) setDocumentValue(doc, "compaction.methodOrder", migrated);
  }
  const canonicalAdvisor = locate(raw, "task.agentAdvisor");
  const migratedAdvisor = projectedValue(raw, "task.agentAdvisor");
  if (migratedAdvisor.present && !equalJson(canonicalAdvisor.value, migratedAdvisor.value)) {
    setDocumentValue(doc, "task.agentAdvisor", migratedAdvisor.value);
  }
  const prewalk = locate(raw, "task.agentPrewalk");
  if (prewalk.present && isRecord(prewalk.value)) {
    const normalized: Record<string, unknown> = {};
    let changed = false;
    for (const [key, value] of Object.entries(prewalk.value)) {
      normalized[key] = typeof value === "boolean" ? (value ? "on" : "off") : value;
      changed ||= typeof value === "boolean";
    }
    if (changed) setDocumentValue(doc, "task.agentPrewalk", normalized);
  }
  const compaction = isRecord(raw.compaction) ? raw.compaction : undefined;
  if (compaction && Object.prototype.hasOwnProperty.call(compaction, "strategy")) deleteDocumentValue(doc, "compaction.strategy");
  if (compaction && Object.prototype.hasOwnProperty.call(compaction, "remoteEnabled")) deleteDocumentValue(doc, "compaction.remoteEnabled");
  doc.delete("compaction.strategy");
  doc.delete("compaction.remoteEnabled");
  doc.delete("compaction.methodOrder");
  const advisor = isRecord(raw.advisor) ? raw.advisor : undefined;
  if (advisor && Object.prototype.hasOwnProperty.call(advisor, "subagents")) deleteDocumentValue(doc, "advisor.subagents");
  doc.delete("advisor.subagents");
}

function ensureMapping(doc: Document): void {
  if (doc.contents === null) {
    doc.contents = doc.createNode({}) as unknown as typeof doc.contents;
  } else if (!isMap(doc.contents)) {
    throw new NativeSettingsError("invalid_yaml", "Settings file must contain a YAML mapping", [{ path: "$", message: "Expected a mapping" }]);
  }
}

function detachAnchorConsumers(doc: Document, parts: string[]): void {
  const anchors = new Set<string>();
  for (let length = 1; length <= parts.length; length += 1) {
    const node = doc.getIn(parts.slice(0, length), true);
    if (!isAlias(node) && typeof node === "object" && node !== null && "anchor" in node && typeof node.anchor === "string") anchors.add(node.anchor);
  }
  if (anchors.size === 0) return;
  visit(doc, {
    Alias(_key, alias) {
      if (!anchors.has(alias.source)) return;
      const source = alias.resolve(doc);
      if (!source) throw new NativeSettingsError("invalid_yaml", "Settings alias cannot be resolved", [{ path: parts.join("."), message: "Unresolved YAML alias" }]);
      const detached = doc.createNode(cloneJson(source.toJS(doc)));
      detached.comment = alias.comment;
      detached.commentBefore = alias.commentBefore;
      detached.spaceBefore = alias.spaceBefore;
      return detached;
    },
  });
}

function materializeAliasParent(doc: Document, prefix: string[], path: string): void {
  const alias = doc.getIn(prefix, true);
  if (!isAlias(alias)) return;
  const root = doc.toJS();
  const resolved: LocatedValue = isRecord(root) ? locate(root, prefix.join(".")) : { present: false };
  if (!resolved.present || !isRecord(resolved.value)) {
    throw new NativeSettingsError("invalid_yaml", "Settings alias does not resolve to a mapping", [{ path, message: "Aliased settings sections must resolve to mappings" }]);
  }
  // Materialize only the edited branch. Document-context conversion resolves
  // nested aliases recursively; the shared anchor and its other aliases remain
  // untouched while all resolved siblings are retained.
  const value = resolved.value;
  try { validateJson(value, path); }
  catch {
    throw new NativeSettingsError("invalid_yaml", "Aliased settings section cannot be materialized safely", [{ path, message: "Aliased section contains unsafe or unbounded data" }]);
  }
  doc.setIn(prefix, doc.createNode(cloneJson(value)));
}

function setDocumentValue(doc: Document, path: string, value: unknown): void {
  const parts = pathParts(path);
  detachAnchorConsumers(doc, parts);
  for (let length = 1; length < parts.length; length += 1) {
    const prefix = parts.slice(0, length);
    materializeAliasParent(doc, prefix, path);
    const node = doc.getIn(prefix, true);
    if (node !== undefined && !isMap(node)) doc.setIn(prefix, {});
  }
  doc.setIn(parts, value);
}

function deleteDocumentValue(doc: Document, path: string): void {
  const parts = pathParts(path);
  detachAnchorConsumers(doc, parts);
  for (let length = 1; length < parts.length; length += 1) {
    const prefix = parts.slice(0, length);
    materializeAliasParent(doc, prefix, path);
    const node = doc.getIn(prefix, true);
    if (node === undefined) return;
    if (!isMap(node)) {
      doc.deleteIn(prefix);
      return;
    }
  }
  doc.deleteIn(parts);
}

function assertNoScopedRegistryReplacement(raw: Record<string, unknown>, paths: Iterable<string>): void {
  const unsafe: NativeSettingsIssue[] = [];
  for (const path of paths) {
    if (!PATH_SCOPED_REGISTRY_SETTINGS.has(path)) continue;
    const current = locate(raw, path);
    if (current.present && Array.isArray(current.value) && current.value.some(isRecord)) {
      unsafe.push({ path, message: "Path-scoped registry rules are read-only in this editor" });
    }
  }
  if (unsafe.length) throw new NativeSettingsError("scoped_registry_read_only", "Path-scoped registry rules cannot be replaced by this editor", unsafe);
}

function persistMutation(
  target: ConfigTarget,
  patch: NativeSettings,
  reset: readonly string[],
  secrets: Readonly<Record<string, unknown>>,
  lockedDocument = readConfigDocument(target.path),
): void {
  const { doc, raw } = lockedDocument;
  ensureMapping(doc);
  applyLegacyCutover(doc, raw);
  for (const definition of NATIVE_SETTINGS_CATALOG) {
    const located = locate(patch, definition.path);
    if (located.present) setDocumentValue(doc, definition.path, located.value);
  }
  for (const path of reset) deleteDocumentValue(doc, path);
  for (const [path, value] of Object.entries(secrets)) {
    if (value === null) deleteDocumentValue(doc, path);
    else setDocumentValue(doc, path, value);
  }
  mkdirSync(dirname(target.path), { recursive: true });
  writeConfigFileAtomic(target.path, doc.toString());
}

/** Existing global callers use a synchronous, catalog-filtered projection. */
export function readNativeSettings(): { path: string; settings: NativeSettings } {
  const target = globalTarget();
  const document = readConfigDocument(target.path);
  return { path: target.path, settings: projectKnown(document.raw) };
}

/** Existing global callers write a reviewed patch while preserving unrelated YAML. */
export async function writeNativeSettings(settings: NativeSettings): Promise<NativeSettings> {
  const patch = filterNativeSettings(settings);
  const target = physicalWriteTarget(globalTarget());
  mkdirSync(dirname(target.path), { recursive: true });
  return withNativeConfigLock(target.path, () => {
    const document = readConfigDocument(target.path);
    const paths = NATIVE_SETTINGS_CATALOG.filter((definition) => locate(patch, definition.path).present).map((definition) => definition.path);
    assertNoScopedRegistryReplacement(document.raw, paths);
    persistMutation(target, patch, [], {}, document);
    return projectKnown(readConfigDocument(target.path).raw);
  });
}

/** Run an internal global read-modify-write against one locked generation. */
export async function mutateNativeSettings(
  mutation: (current: NativeSettings) => NativeSettings,
): Promise<NativeSettings> {
  const target = physicalWriteTarget(globalTarget());
  mkdirSync(dirname(target.path), { recursive: true });
  return withNativeConfigLock(target.path, () => {
    const document = readConfigDocument(target.path);
    const patch = filterNativeSettings(mutation(projectKnown(document.raw)));
    const paths = NATIVE_SETTINGS_CATALOG.filter((definition) => locate(patch, definition.path).present).map((definition) => definition.path);
    assertNoScopedRegistryReplacement(document.raw, paths);
    persistMutation(target, patch, [], {}, document);
    return projectKnown(readConfigDocument(target.path).raw);
  });
}

export async function readNativeSettingsSnapshot(scope?: NativeSettingsScope, cwd?: string): Promise<NativeSettingsSnapshot> {
  const target = await resolveTarget(scope, cwd);
  const globalDocument = readConfigDocument(globalTarget().path);
  const issues: NativeSettingsIssue[] = [];
  const globalSettings = projectKnown(globalDocument.raw, issues, "global");
  if (target.scope === "global") {
    return {
      path: target.path,
      scope: "global",
      settings: globalSettings,
      effectiveSettings: cloneJson(globalSettings) as NativeSettings,
      catalog: NATIVE_SETTINGS_CATALOG,
      secretStatus: secretStatus(globalDocument.raw),
      ...(issues.length ? { issues } : {}),
    };
  }
  const projectDocument = readConfigDocument(target.path);
  const projectSettings = projectKnown(projectDocument.raw, issues, "project");
  return {
    path: target.path,
    scope: "project",
    cwd: target.cwd,
    settings: projectSettings,
    effectiveSettings: mergeKnown(globalSettings, projectSettings),
    catalog: NATIVE_SETTINGS_CATALOG,
    secretStatus: secretStatus(globalDocument.raw),
    ...(issues.length ? { issues } : {}),
  };
}

function parseStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > NATIVE_SETTINGS_CATALOG.length || value.some((item) => typeof item !== "string")) {
    throw new NativeSettingsError("invalid_update", `${field} must be an array of settings paths`, [{ path: field, message: "Expected a bounded string array" }]);
  }
  return [...new Set(value as string[])];
}

function equalJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => equalJson(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && equalJson(left[key], right[key]));
}

export async function updateNativeSettings(update: NativeSettingsUpdate): Promise<{ snapshot: NativeSettingsSnapshot; registryInvalidated: boolean }> {
  if (!isRecord(update)) throw new NativeSettingsError("invalid_update", "Settings update must be an object", [{ path: "$", message: "Expected an object" }]);
  const target = physicalWriteTarget(await resolveTarget(update.scope, update.cwd));
  const patch = update.settings === undefined ? {} : filterNativeSettings(update.settings, target.scope);
  const reset = update.reset === undefined ? [] : parseStringList(update.reset, "reset");
  const confirmed = new Set(update.confirm === undefined ? [] : parseStringList(update.confirm, "confirm"));
  const issues: NativeSettingsIssue[] = [];
  for (const path of reset) {
    const definition = CATALOG_BY_PATH.get(path);
    if (!definition || definition.secret) issues.push({ path, message: "Unknown or secret reset path" });
    else if (target.scope === "project" && definition.scope !== "both") issues.push({ path, message: "This setting is global-only" });
  }
  const secretsInput = update.secrets;
  if (secretsInput !== undefined && !isRecord(secretsInput)) issues.push({ path: "secrets", message: "Expected an object keyed by secret path" });
  const secretValues: Record<string, unknown> = {};
  if (isRecord(secretsInput)) {
    if (Object.keys(secretsInput).length > MAX_COLLECTION) issues.push({ path: "secrets", message: `Must contain at most ${MAX_COLLECTION} entries` });
    for (const [path, encoded] of Object.entries(secretsInput)) {
      const definition = CATALOG_BY_PATH.get(path);
      if (!definition?.secret) { issues.push({ path, message: "Unknown secret path" }); continue; }
      if (target.scope === "project" && definition.scope !== "both") { issues.push({ path, message: "This secret is global-only" }); continue; }
      if (encoded === null) { secretValues[path] = null; continue; }
      if (typeof encoded !== "string" || !encoded.length || encoded.length > MAX_JSON_BYTES) { issues.push({ path, message: "Secret replacement must be a non-empty bounded string or null" }); continue; }
      try {
        const candidate = definition.kind === "object" ? JSON.parse(encoded) as unknown : encoded;
        secretValues[path] = validateValue(definition, candidate, target.scope);
      } catch {
        issues.push({ path, message: "Secret replacement has an invalid format" });
      }
    }
  }
  if (issues.length) throw new NativeSettingsError("invalid_update", "Settings update is invalid", issues);

  const requestedPaths = new Set<string>(reset);
  for (const definition of NATIVE_SETTINGS_CATALOG) if (locate(patch, definition.path).present) requestedPaths.add(definition.path);
  for (const path of Object.keys(secretValues)) requestedPaths.add(path);

  mkdirSync(dirname(target.path), { recursive: true });
  const snapshot = await withNativeConfigLock(target.path, async () => {
    // Policy decisions and mutation share the same fresh locked generation;
    // otherwise a native OMP save could race confirmation or restore old data.
    const currentDocument = readConfigDocument(target.path);
    assertNoScopedRegistryReplacement(currentDocument.raw, requestedPaths);
    for (const path of requestedPaths) {
      const definition = CATALOG_BY_PATH.get(path);
      if (!definition?.confirmation) continue;
      const oldValue = projectedValue(currentDocument.raw, path);
      const patchValue = locate(patch, path);
      const newValue = reset.includes(path) ? undefined : definition.secret ? secretValues[path] : patchValue.value;
      const changed = oldValue.present
        ? !equalJson(oldValue.value, newValue)
        : oldValue.malformedAt !== undefined || (newValue !== undefined && newValue !== null);
      if (changed && !confirmed.has(path)) issues.push({ path, message: "Explicit confirmation is required" });
    }
    if (issues.length) throw new NativeSettingsError("confirmation_required", "Explicit confirmation is required for risky settings", issues);

    persistMutation(target, patch, reset, secretValues, currentDocument);
    return readNativeSettingsSnapshot(target.scope, target.cwd);
  });
  const registryInvalidated = ["enabledModels", "enabledProviders", "disabledProviders", "modelProviderOrder"].some((path) => requestedPaths.has(path));
  return { snapshot, registryInvalidated };
}

export type { NativeSettingsScope, NativeSettingsSnapshot, NativeSettingsUpdate } from "./settings-catalog";
