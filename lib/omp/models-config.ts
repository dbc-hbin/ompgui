import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { isMap, isScalar, isSeq, parseDocument, stringify, type Document } from "yaml";
import { getModelsConfigPath } from "./paths";
import { isRecord } from "../type-guards";

/**
 * Direct YAML access to omp's custom-models file (~/.omp/agent/models.yml).
 * Types and validation mirror the minimal subset of
 * oh-my-pi/packages/coding-agent/src/config/models-config(-schema).ts that the
 * web editor round-trips; unknown fields are preserved untouched.
 */

export const MODEL_API_OPTIONS = [
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
  "azure-openai-responses",
  "anthropic-messages",
  "bedrock-converse-stream",
  "google-generative-ai",
  "google-gemini-cli",
  "google-vertex",
] as const;

export const THINKING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

export interface ModelThinkingConfig {
  mode?: string;
  efforts?: string[];
  defaultLevel?: string;
  effortMap?: Record<string, string>;
  [key: string]: unknown;
}

export interface ModelDefinition {
  id: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  reasoning?: boolean;
  thinking?: ModelThinkingConfig;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  compat?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ProviderConfig {
  baseUrl?: string;
  apiKey?: string;
  api?: string;
  auth?: "apiKey" | "none" | "oauth";
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  models?: ModelDefinition[];
  modelOverrides?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ModelsFileConfig {
  providers?: Record<string, ProviderConfig>;
  [key: string]: unknown;
}

/** Browser-facing provider fields use null as an explicit clear operation.
 * Undefined means that the redacted on-disk value is intentionally untouched. */
export interface ModelsConfigEditorModel extends Omit<ModelDefinition, "headers"> {
  /** Stable server-owned identity used to preserve protected headers after an id edit. */
  originalId?: string;
  /** Omitted means preserve a redacted on-disk header map; null explicitly clears it. */
  headers?: Record<string, string> | null;
}

export interface ModelsConfigEditorProvider extends Omit<ProviderConfig, "apiKey" | "headers" | "models"> {
  /** Stable server-owned identity used to preserve protected fields after a rename. */
  originalName?: string;
  apiKey?: string | null;
  headers?: Record<string, string> | null;
  models?: ModelsConfigEditorModel[];
  /** Metadata only; these fields are stripped before writing models.yml. */
  apiKeyConfigured?: boolean;
  headersConfigured?: boolean;
}

export interface ModelsConfigEditor extends Omit<ModelsFileConfig, "providers"> {
  providers?: Record<string, ModelsConfigEditorProvider>;
}

export interface ModelsConfigIssue {
  path: string;
  message: string;
}

export const MODELS_CONFIG_INVALID_CODE = "models_config_invalid" as const;

/** A server-owned diagnostics object. Messages contain field names and schema
 * rules only, never submitted values (especially credentials or headers). */
export class ModelsConfigValidationError extends Error {
  readonly code = MODELS_CONFIG_INVALID_CODE;
  readonly issues: ModelsConfigIssue[];

  constructor(issues: ModelsConfigIssue[]) {
    const safeIssues = issues.length > 0 ? issues : [{ path: "", message: "Invalid models configuration" }];
    super(safeIssues.map((issue) => issue.path ? `${issue.path} ${issue.message}` : issue.message).join("; "));
    this.name = "ModelsConfigValidationError";
    this.issues = safeIssues;
  }
}

function issue(issues: ModelsConfigIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.trim() === "") return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

function validateHeaders(value: unknown, path: string, issues: ModelsConfigIssue[]): void {
  if (!isRecord(value) || Object.values(value).some((header) => typeof header !== "string")) {
    issue(issues, path, "must map header names to strings");
  }
}

/** Mirrors validateProviderConfiguration(mode: "models-config") closely enough
 * to reject configs omp itself would refuse to load. Throws one structured
 * diagnostics object so UI and API callers share the same contract. */
export function validateModelsConfig(config: unknown): asserts config is ModelsFileConfig {
  const issues: ModelsConfigIssue[] = [];
  if (!isRecord(config)) {
    throw new ModelsConfigValidationError([{ path: "", message: "must be an object" }]);
  }

  const sanitized = sanitizeModelsConfig(config as ModelsFileConfig);
  const providersValue = sanitized.providers;
  const providers = providersValue === undefined ? {} : providersValue;
  if (!isRecord(providers)) {
    issue(issues, "providers", "must be an object");
  } else {
    for (const [providerName, provider] of Object.entries(providers)) {
      const providerPath = `providers.${providerName}`;
      if (!isRecord(provider)) {
        issue(issues, providerPath, "must be an object");
        continue;
      }

      if (provider.baseUrl !== undefined && !isHttpUrl(provider.baseUrl)) {
        issue(issues, `${providerPath}.baseUrl`, "must be a valid HTTP(S) URL");
      }
      if (provider.api !== undefined && (typeof provider.api !== "string" || provider.api.trim() === "")) {
        issue(issues, `${providerPath}.api`, "must be a non-empty API identifier");
      }
      if (provider.auth !== undefined && provider.auth !== "none" && provider.auth !== "apiKey" && provider.auth !== "oauth") {
        issue(issues, `${providerPath}.auth`, "must be one of apiKey, none, or oauth");
      }
      if (provider.apiKey !== undefined && typeof provider.apiKey !== "string") {
        // Do not interpolate the invalid value: it may be a credential.
        issue(issues, `${providerPath}.apiKey`, "must be a string");
      }
      if (provider.headers !== undefined) validateHeaders(provider.headers, `${providerPath}.headers`, issues);

      if (provider.models !== undefined && !Array.isArray(provider.models)) {
        issue(issues, `${providerPath}.models`, "must be an array");
        continue;
      }
      const models = Array.isArray(provider.models) ? provider.models : [];
      const seenModelIds = new Map<string, number>();
      if (models.length > 0) {
        if (typeof provider.baseUrl !== "string" || provider.baseUrl.trim() === "") {
          issue(issues, `${providerPath}.baseUrl`, "is required when defining custom models");
        }
        const auth = provider.auth ?? "apiKey";
        if (auth === "apiKey" && (typeof provider.apiKey !== "string" || provider.apiKey.trim() === "")) {
          issue(issues, `${providerPath}.apiKey`, "is required when defining custom models unless auth is none or oauth");
        }
      }

      for (const [index, model] of models.entries()) {
        const modelPath = `${providerPath}.models[${index}]`;
        if (!isRecord(model)) {
          issue(issues, modelPath, "must be an object");
          continue;
        }
        if (typeof model.id !== "string" || model.id.trim() === "") {
          issue(issues, `${modelPath}.id`, "is required");
        } else {
          const firstIndex = seenModelIds.get(model.id);
          if (firstIndex !== undefined) {
            issue(issues, `${modelPath}.id`, `duplicates the model id at index ${firstIndex}`);
          } else {
            seenModelIds.set(model.id, index);
          }
        }
        if (model.baseUrl !== undefined && !isHttpUrl(model.baseUrl)) {
          issue(issues, `${modelPath}.baseUrl`, "must be a valid HTTP(S) URL");
        }
        if (model.api !== undefined && (typeof model.api !== "string" || model.api.trim() === "")) {
          issue(issues, `${modelPath}.api`, "must be a non-empty API identifier");
        }
        if ((typeof provider.api !== "string" || provider.api.trim() === "") &&
          (typeof model.api !== "string" || model.api.trim() === "")) {
          issue(issues, `${modelPath}.api`, "must be specified at provider or model level");
        }
        for (const key of ["contextWindow", "maxTokens"] as const) {
          if (model[key] !== undefined && (typeof model[key] !== "number" || !Number.isFinite(model[key]) || model[key] <= 0)) {
            issue(issues, `${modelPath}.${key}`, "must be a positive finite number");
          }
        }
        if (model.headers !== undefined) validateHeaders(model.headers, `${modelPath}.headers`, issues);
        if (model.cost !== undefined) {
          if (!isRecord(model.cost)) {
            issue(issues, `${modelPath}.cost`, "must be an object");
          } else {
            for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
              const value = model.cost[key];
              if (value === undefined) {
                issue(issues, `${modelPath}.cost.${key}`, "is required (cost needs input, output, cacheRead, and cacheWrite)");
              } else if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
                issue(issues, `${modelPath}.cost.${key}`, "must be a finite non-negative number");
              }
            }
          }
        }
      }
    }
  }

  if (issues.length > 0) throw new ModelsConfigValidationError(issues);
}

/** Return the editor-safe representation of a parsed models.yml. Provider API
 * keys and provider/model header values are omitted. The remaining metadata is
 * server-owned and lets a later save match renamed providers/models safely. */
export function redactModelsConfig(config: ModelsFileConfig): ModelsConfigEditor {
  const safe: ModelsConfigEditor = { ...config, providers: {} };
  for (const [providerName, provider] of Object.entries(config.providers ?? {})) {
    if (!isRecord(provider)) {
      safe.providers![providerName] = provider as ModelsConfigEditorProvider;
      continue;
    }
    const safeProvider = { ...provider } as ModelsConfigEditorProvider;
    const apiKeyConfigured = typeof provider.apiKey === "string" && provider.apiKey.length > 0;
    const headersConfigured = isRecord(provider.headers) && Object.keys(provider.headers).length > 0;
    delete safeProvider.apiKey;
    delete safeProvider.headers;
    safeProvider.originalName = providerName;
    if (Array.isArray(provider.models)) {
      safeProvider.models = provider.models.map((model) => {
        if (!isRecord(model)) return model as ModelsConfigEditorModel;
        const safeModel = { ...model } as ModelsConfigEditorModel;
        delete safeModel.headers;
        if (typeof model.id === "string") safeModel.originalId = model.id;
        else delete safeModel.originalId;
        return safeModel;
      });
    }
    safeProvider.apiKeyConfigured = apiKeyConfigured;
    safeProvider.headersConfigured = headersConfigured;
    safe.providers![providerName] = safeProvider;
  }
  return safe;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export type ModelsConfigMergeMode = "full" | "partial";

/** Editor metadata is reserved for the DTO protocol and must never reach
 * models.yml, even when a caller supplies it directly rather than using the
 * redaction helper. */
function stripEditorModelMetadata(model: unknown): unknown {
  if (!isRecord(model)) return model;
  const stripped = { ...model };
  delete stripped.originalId;
  return stripped;
}

function stripEditorProviderMetadata(provider: unknown): unknown {
  if (!isRecord(provider)) return provider;
  const stripped = { ...provider };
  delete stripped.originalName;
  delete stripped.apiKeyConfigured;
  delete stripped.headersConfigured;
  if (Array.isArray(stripped.models)) {
    stripped.models = stripped.models.map(stripEditorModelMetadata);
  }
  return stripped;
}

interface IncomingProviderDescriptor {
  targetName: string;
  incoming: unknown;
  sourceName?: string;
  previous?: ProviderConfig;
}

function mergeEditorModels(
  previousValue: unknown,
  incomingModels: unknown[],
  mode: ModelsConfigMergeMode,
  path: string,
  issues: ModelsConfigIssue[],
): ModelDefinition[] {
  const previousModels = Array.isArray(previousValue) ? previousValue : [];
  const previousById = new Map<string, ModelDefinition>();
  const ambiguousPreviousIds = new Set<string>();
  for (const previousModel of previousModels) {
    if (!isRecord(previousModel) || typeof previousModel.id !== "string") continue;
    if (ambiguousPreviousIds.has(previousModel.id)) continue;
    if (previousById.has(previousModel.id)) {
      previousById.delete(previousModel.id);
      ambiguousPreviousIds.add(previousModel.id);
    } else {
      previousById.set(previousModel.id, previousModel as ModelDefinition);
    }
  }

  const seenSourceIds = new Map<string, number>();
  const seenResultIds = new Map<string, number>();
  return incomingModels.map((model, index) => {
    const modelPath = `${path}[${index}]`;
    if (!isRecord(model)) return model as ModelDefinition;

    let sourceId: string | undefined;
    if (hasOwn(model, "originalId")) {
      const originalId = model.originalId;
      if (typeof originalId !== "string") {
        issue(issues, `${modelPath}.originalId`, "must be a string identifying an existing model");
      } else if (ambiguousPreviousIds.has(originalId)) {
        issue(issues, `${modelPath}.originalId`, "must identify exactly one existing model");
      } else if (!previousById.has(originalId)) {
        issue(issues, `${modelPath}.originalId`, "must identify an existing model in the current configuration");
      } else {
        sourceId = originalId;
      }
    } else if (typeof model.id === "string") {
      if (ambiguousPreviousIds.has(model.id)) {
        issue(issues, `${modelPath}.id`, "matches multiple existing models; supply originalId");
      } else if (previousById.has(model.id)) {
        sourceId = model.id;
      }
    }

    const previousModel = sourceId === undefined ? undefined : previousById.get(sourceId);
    if (sourceId !== undefined) {
      const firstIndex = seenSourceIds.get(sourceId);
      if (firstIndex !== undefined) {
        const identityPath = hasOwn(model, "originalId") ? `${modelPath}.originalId` : `${modelPath}.id`;
        issue(issues, identityPath, `duplicates the existing model identified at index ${firstIndex}`);
      } else {
        seenSourceIds.set(sourceId, index);
      }
    }

    // Partial model patches retain omitted non-secret fields. A full snapshot
    // replaces those fields; headers remain protected and are handled below.
    const nextModel = {
      ...(mode === "partial" && previousModel ? stripEditorModelMetadata(previousModel) as Record<string, unknown> : {}),
      ...model,
    } as Record<string, unknown>;
    delete nextModel.originalId;
    if (hasOwn(model, "headers") && model.headers !== undefined) {
      if (model.headers === null) delete nextModel.headers;
      else nextModel.headers = model.headers;
    } else if (previousModel && hasOwn(previousModel, "headers")) {
      nextModel.headers = previousModel.headers;
    } else if (nextModel.headers === undefined) {
      delete nextModel.headers;
    }
    if (typeof nextModel.id === "string") {
      const firstIndex = seenResultIds.get(nextModel.id);
      if (firstIndex !== undefined) {
        issue(issues, `${modelPath}.id`, `duplicates the model id at index ${firstIndex}`);
      } else {
        seenResultIds.set(nextModel.id, index);
      }
    }
    return nextModel as ModelDefinition;
  });
}

/** Merge a browser editor DTO with the latest on-disk config. `full` is an
 * explicit snapshot (omitted providers/fields/models are deleted); `partial`
 * retains omitted peers and fields. Missing protected fields preserve the
 * current value and null explicitly removes them. */
export function mergeRedactedModelsConfig(
  current: ModelsFileConfig,
  editor: ModelsConfigEditor,
  mode: ModelsConfigMergeMode,
): ModelsFileConfig {
  if (mode !== "full" && mode !== "partial") {
    throw new ModelsConfigValidationError([{ path: "mode", message: "must be full or partial" }]);
  }

  const merged: ModelsFileConfig = mode === "full"
    ? { ...editor, providers: {} }
    : { ...current, ...editor, providers: {} };
  const currentProviders = isRecord(current.providers) ? current.providers : {};
  const hasEditorProviders = hasOwn(editor, "providers");
  const editorProviders = hasEditorProviders ? editor.providers : undefined;

  if (hasEditorProviders && !isRecord(editorProviders)) {
    // Leave malformed input for the normal schema validator, while retaining
    // the explicit full/partial top-level semantics.
    merged.providers = editorProviders as unknown as Record<string, ProviderConfig>;
    return merged;
  }
  if (!hasEditorProviders && mode === "partial") {
    merged.providers = Object.fromEntries(
      Object.entries(currentProviders).map(([name, provider]) => [name, stripEditorProviderMetadata(provider)]),
    ) as Record<string, ProviderConfig>;
    if (!isRecord(current.providers)) merged.providers = current.providers;
    return merged;
  }

  const incomingProviders = isRecord(editorProviders) ? Object.entries(editorProviders) : [];
  const issues: ModelsConfigIssue[] = [];
  const descriptors: IncomingProviderDescriptor[] = [];
  const seenSources = new Map<string, string>();

  for (const [targetName, incoming] of incomingProviders) {
    const providerPath = `providers.${targetName}`;
    let sourceName: string | undefined;
    if (isRecord(incoming) && hasOwn(incoming, "originalName")) {
      const originalName = incoming.originalName;
      if (typeof originalName !== "string") {
        issue(issues, `${providerPath}.originalName`, "must be a string identifying an existing provider");
      } else if (!hasOwn(currentProviders, originalName)) {
        issue(issues, `${providerPath}.originalName`, "must identify a provider in the current configuration");
      } else {
        sourceName = originalName;
      }
    } else if (hasOwn(currentProviders, targetName)) {
      sourceName = targetName;
    }

    if (sourceName !== undefined) {
      const firstTarget = seenSources.get(sourceName);
      if (firstTarget !== undefined) {
        issue(issues, `${providerPath}.originalName`, `duplicates the provider identity used by providers.${firstTarget}`);
      } else {
        seenSources.set(sourceName, targetName);
      }
      // A partial rename cannot silently overwrite an omitted peer. Full mode
      // may replace an existing name because omission is an explicit deletion.
      if (mode === "partial" && sourceName !== targetName && hasOwn(currentProviders, targetName)) {
        issue(issues, providerPath, "rename conflicts with an existing provider; choose an unused name");
      }
    }

    descriptors.push({
      targetName,
      incoming,
      sourceName,
      previous: sourceName !== undefined && isRecord(currentProviders[sourceName])
        ? currentProviders[sourceName] as ProviderConfig
        : undefined,
    });
  }

  const outputProviders: Record<string, unknown> = mode === "partial"
    ? Object.fromEntries(
      Object.entries(currentProviders).map(([name, provider]) => [name, stripEditorProviderMetadata(provider)]),
    )
    : {};

  for (const { targetName, incoming, sourceName, previous } of descriptors) {
    if (!isRecord(incoming)) {
      if (mode === "partial" && sourceName !== undefined && sourceName !== targetName) delete outputProviders[sourceName];
      outputProviders[targetName] = incoming;
      continue;
    }

    if (mode === "partial" && sourceName !== undefined && sourceName !== targetName) {
      delete outputProviders[sourceName];
    }
    const previousClean = previous ? stripEditorProviderMetadata(previous) as Record<string, unknown> : {};
    const provider: Record<string, unknown> = {
      ...(mode === "partial" ? previousClean : {}),
      ...incoming,
    };

    if (hasOwn(incoming, "apiKey") && incoming.apiKey !== undefined) {
      if (incoming.apiKey === null) delete provider.apiKey;
      else provider.apiKey = incoming.apiKey;
    } else if (previous && hasOwn(previous, "apiKey")) {
      provider.apiKey = previous.apiKey;
    } else {
      delete provider.apiKey;
    }
    if (hasOwn(incoming, "headers") && incoming.headers !== undefined) {
      if (incoming.headers === null) delete provider.headers;
      else provider.headers = incoming.headers;
    } else if (previous && hasOwn(previous, "headers")) {
      provider.headers = previous.headers;
    } else {
      delete provider.headers;
    }

    if (Array.isArray(incoming.models)) {
      provider.models = mergeEditorModels(previous?.models, incoming.models, mode, `providers.${targetName}.models`, issues);
    } else if (mode === "full" && (!hasOwn(incoming, "models") || incoming.models === undefined)) {
      delete provider.models;
    } else if (mode === "partial" && hasOwn(incoming, "models") && incoming.models === undefined) {
      if (previous && hasOwn(previous, "models")) provider.models = previousClean.models;
      else delete provider.models;
    }

    outputProviders[targetName] = stripEditorProviderMetadata(provider);
  }

  if (issues.length > 0) throw new ModelsConfigValidationError(issues);
  merged.providers = outputProviders as Record<string, ProviderConfig>;
  return merged;
}

/** Thrown when models.yml exists but cannot be parsed. Overwriting such a file
 * would silently delete every provider the user hand-wrote, so writes refuse
 * unless the caller explicitly opts in. */
export class ModelsConfigParseError extends Error {
  readonly path: string;
  readonly detail: string;
  constructor(path: string, detail: string) {
    super(`${path} is not valid YAML: ${detail}`);
    this.name = "ModelsConfigParseError";
    this.path = path;
    this.detail = detail;
  }
}

export interface ModelsConfigFile {
  path: string;
  exists: boolean;
  /** Raw file text, kept so writes can merge into the original document. */
  source?: string;
  /** Empty when `parseError` is set — never write this back over the file. */
  config: ModelsFileConfig;
  parseError?: string;
}

/** Drop empty model rows produced by blank YAML sequence entries or an empty
 * `id`. Malformed non-empty rows are retained so validation can report them. */
function sanitizeModelsConfig(config: ModelsFileConfig): ModelsFileConfig {
  if (!isRecord(config.providers)) return config;
  const providers = Object.fromEntries(Object.entries(config.providers).map(([providerId, provider]) => {
    if (!isRecord(provider) || !Array.isArray(provider.models)) return [providerId, provider];
    const models = provider.models.filter((model) => (
      !isRecord(model) || typeof model.id !== "string" || model.id.trim().length > 0
    ));
    return [providerId, { ...provider, models }];
  }));
  return { ...config, providers };
}

/** Read models.yml, reporting rather than swallowing parse failures. */
export function readModelsConfigFile(): ModelsConfigFile {
  const path = getModelsConfigPath();
  if (!existsSync(path)) return { path, exists: false, config: { providers: {} } };

  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    return { path, exists: true, config: { providers: {} }, parseError: String(error) };
  }

  // parseDocument collects syntax errors instead of throwing on the first one.
  const doc = parseDocument(source);
  if (doc.errors.length > 0) {
    return { path, exists: true, source, config: { providers: {} }, parseError: doc.errors[0].message };
  }
  const parsed = doc.toJS() as unknown;
  if (parsed === null || parsed === undefined) {
    return { path, exists: true, source, config: { providers: {} } };
  }
  if (!isRecord(parsed)) {
    return {
      path,
      exists: true,
      source,
      config: { providers: {} },
      parseError: "the top level of models.yml must be a mapping",
    };
  }
  return { path, exists: true, source, config: sanitizeModelsConfig(parsed as ModelsFileConfig) };
}

/** Tolerant read for consumers that only inspect the config (a broken file
 * reads as empty). Anything that writes the file back must go through
 * readModelsConfigFile()/writeModelsConfig() so a parse error blocks the write. */
export function readModelsConfig(): ModelsFileConfig {
  return readModelsConfigFile().config;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Comments live on the node they follow/precede, so a replaced node has to
 * inherit them or the user's annotations drift onto the wrong key. */
function carryComments(from: unknown, to: unknown): void {
  if (!from || !to || typeof from !== "object" || typeof to !== "object") return;
  const src = from as { comment?: string | null; commentBefore?: string | null; spaceBefore?: boolean };
  const dst = to as { comment?: string | null; commentBefore?: string | null; spaceBefore?: boolean };
  if (src.comment != null) dst.comment = src.comment;
  if (src.commentBefore != null) dst.commentBefore = src.commentBefore;
  if (src.spaceBefore) dst.spaceBefore = src.spaceBefore;
}

function scalarKey(key: unknown): string | undefined {
  if (isScalar(key) && (typeof key.value === "string" || typeof key.value === "number")) {
    return String(key.value);
  }
  return typeof key === "string" ? key : undefined;
}

function itemId(item: unknown): string | undefined {
  if (!isMap(item)) return undefined;
  const value = item.get("id");
  return typeof value === "string" ? value : undefined;
}

/** Rewrite `node` so it represents `value`, reusing the existing AST wherever
 * old and new agree — that reuse is what preserves comments and layout. */
function mergeNode(doc: Document, node: unknown, value: unknown): unknown {
  if (isMap(node) && isPlainRecord(value)) {
    const wanted = new Map(Object.entries(value).filter(([, v]) => v !== undefined));
    // Keys with non-scalar (complex) keys are left alone rather than dropped.
    node.items = node.items.filter((pair) => {
      const key = scalarKey(pair.key);
      return key === undefined || wanted.has(key);
    });
    for (const [key, v] of wanted) {
      const pair = node.items.find((p) => scalarKey(p.key) === key);
      if (pair) pair.value = mergeNode(doc, pair.value, v);
      else node.set(doc.createNode(key), doc.createNode(v));
    }
    return node;
  }

  if (isSeq(node) && Array.isArray(value)) {
    const previous = [...node.items];
    // Match by `id` first: the editor reorders/removes models, and positional
    // matching would move a model's comments onto its neighbour.
    const byId = new Map<string, unknown>();
    for (const item of previous) {
      const id = itemId(item);
      if (id !== undefined && !byId.has(id)) byId.set(id, item);
    }
    node.items = value.map((entry, index) => {
      const id = isPlainRecord(entry) && typeof entry.id === "string" ? entry.id : undefined;
      let old: unknown;
      if (id !== undefined) {
        old = byId.get(id);
        if (old !== undefined) byId.delete(id);
      } else {
        old = previous[index];
      }
      return mergeNode(doc, old, entry);
    }) as typeof node.items;
    return node;
  }

  if (isScalar(node) && !isPlainRecord(value) && !Array.isArray(value)) {
    // Keep the original scalar (and its quoting style) only for same-typed
    // values — reusing a quoted string node for a number would re-quote it.
    if (typeof node.value === typeof value) {
      node.value = value;
      return node;
    }
  }

  const created = doc.createNode(value);
  carryComments(node, created);
  return created;
}

/** Serialize a config. When `existingSource` is a parseable document the edit
 * is applied onto it so hand-written comments and formatting survive. */
export function serializeModelsConfig(config: ModelsFileConfig, existingSource?: string): string {
  if (existingSource === undefined || existingSource.trim() === "") return stringify(config);
  const doc = parseDocument(existingSource);
  if (doc.errors.length > 0) return stringify(config);
  if (!isMap(doc.contents)) {
    // Comment-only or non-mapping document: replacing contents still keeps the
    // file's leading comments (they hang off the document, not the node).
    doc.contents = doc.createNode(config) as unknown as typeof doc.contents;
    return doc.toString();
  }
  mergeNode(doc, doc.contents, config);
  return doc.toString();
}

export interface WriteModelsConfigOptions {
  /** Replace an unparseable models.yml instead of refusing — destroys whatever
   * the user has in the file, so only pass it on an explicit user request. */
  overwriteUnparseable?: boolean;
}

export function writeModelsConfig(config: ModelsFileConfig, options: WriteModelsConfigOptions = {}): void {
  const current = readModelsConfigFile();
  if (current.parseError && !options.overwriteUnparseable) {
    throw new ModelsConfigParseError(current.path, current.parseError);
  }
  const text = serializeModelsConfig(sanitizeModelsConfig(config), current.parseError ? undefined : current.source);
  const dir = dirname(current.path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // Write-then-rename: a crash mid-write must not leave models.yml truncated,
  // which would disable every custom model until the user repairs it by hand.
  const temp = join(dir, `.${basename(current.path)}.ompgui-${process.pid}-${Date.now()}.tmp`);
  try {
    writeFileSync(temp, text, "utf8");
    renameSync(temp, current.path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}
