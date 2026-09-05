/**
 * Relay `models` domain handler.
 *
 * Finite domain dispatch — NOT a generic RPC tunnel. Every action validates
 * its args; unknown actions throw `unknown_action`. All successes resolve to
 * a JSON object; all failures throw an error carrying a stable `code`
 * (plus safe, secret-free details) surfaced as
 * `{op:'result',req,success:false,error:{code,message,...}}`.
 *
 * Reuses the exact desktop services/routes as authority:
 * - catalog: `get_available_models` + `get_login_providers` + `get_state`
 *   (mirrors `app/api/models/route.ts`, including its provider-family
 *   allowlist for the /fast eligibility flag), `readDisabledProviders`.
 * - roles: `readModelRoles`/`writeModelRoles` (mirrors `/api/model-roles`).
 * - registry: `readNativeSettings`/`mergeNativeSettings`/`writeNativeSettings`
 *   + `assertNoAmbiguousModelScopes` (mirrors `/api/omp-settings`).
 * - providers.enable: `enableProvider` (mirrors `/api/providers/enable`).
 * - providers.get/update/validate/test: redacted models.yml merge
 *   (mirrors `/api/models-config`, incl. write-only apiKey/headers semantics:
 *   omitted preserves, null clears, reads expose only `apiKeyConfigured` /
 *   `headersConfigured` flags — never values).
 * - fallback: `retry` section of native settings (mirrors SettingsConfig).
 * - auth.login.*: dedicated `omp --mode rpc-ui` `login` command with
 *   `extension_ui_request` frames (mirrors `/api/auth/login/[provider]`:
 *   `open_url` -> url/instructions, `input` -> code prompt, `notify` ->
 *   progress). Relay is request/response, so the flow is split into
 *   start (spawn) / poll (bounded status read) / confirm (feed code) /
 *   cancel (dispose). Login tokens are bound to the requesting deviceId:
 *   poll/confirm/cancel from another device are denied. Codes are write-only
 *   and never logged or read back.
 * - auth.apikey.get: status only (mirrors `/api/auth/api-key` GET).
 * - auth.apikey.set/remove + auth.logout: HONEST 501s mirroring the desktop
 *   routes (`api_key_store_unsupported`, `api_key_remove_unsupported`,
 *   `logout_unsupported`). ompgui must never write omp's SQLite credential
 *   store; the panel shows terminal guidance instead of fake success.
 *
 * Action table (domain `models`):
 * - catalog.get {} -> {models:[{provider,id,name,thinkingLevels,supportsFastMode,contextWindow?}],defaultModel:{provider,modelId}|null,connectedProviders:[{id,name,disabled}],unavailable?}
 * - roles.get {} -> {path,roles:Record<string,string>}
 * - roles.set {roles:Record<string,string>} -> {roles} (non-empty entries kept, like the desktop PUT filter)
 * - registry.get {} -> {path,settings:{enabledModels?,disabledProviders?,modelProviderOrder?,registryHasScopedEntries?}}
 * - registry.set {enabledModels?:string[],disabledProviders?:string[],modelProviderOrder?:string[]} -> {settings,path}
 * - providers.enable {provider:string} -> {provider}
 * - providers.get {} -> redacted ModelsConfigEditor + {path,exists} (or {providers:{},parseError,path,code} when unparseable)
 * - providers.update {config:object,mode?:'full'|'partial',overwrite?:boolean} -> {success:true,path}
 * - providers.validate {config:object} -> {ok:true}
 * - providers.test {providerName:string,provider:object,model:{id,...}} -> {ok:true,latencyMs,responseText}
 * - fallback.get {} -> {chains:Record<string,string[]>,enabled?,maxRetries?,modelFallback?,revertPolicy?}
 * - fallback.set {chains?,enabled?,maxRetries?,modelFallback?,revertPolicy?} -> {retry}
 * - auth.providers {} -> {providers:[{id,name,loggedIn}]}
 * - auth.login.start {provider} -> {provider,token}
 * - auth.login.poll {provider,token} -> {provider,phase,url?,instructions?,message?,placeholder?,token}
 * - auth.login.confirm {provider,token,code} -> {ok:true,buffered:boolean}
 * - auth.login.cancel {provider,token} -> {cancelled:true,provider}
 * - auth.apikey.get {provider} -> {provider,displayName,configured,models}
 * - auth.apikey.set {provider,...} -> throws api_key_store_unsupported (501)
 * - auth.apikey.remove {provider} -> throws api_key_remove_unsupported (501)
 * - auth.logout {provider} -> throws logout_unsupported (501)
 *
 * Login lifecycle cleanup for the connection layer:
 * - cancelModelLoginsForDevice(deviceId: string): Promise<number> — dispose
 *   every pending login owned by one device (call on disconnect); resolves
 *   with the number of entries cancelled.
 * - cancelAllModelLogins(): Promise<void> — dispose everything (server teardown).
 */
import { homedir } from "os";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { invalidateModelsCache } from "../models-cache";
import { assertNoAmbiguousModelScopes } from "../model-scope";
import {
  MODELS_CONFIG_INVALID_CODE,
  ModelsConfigParseError,
  ModelsConfigValidationError,
  mergeRedactedModelsConfig,
  readModelsConfigFile,
  redactModelsConfig,
  serializeModelsConfig,
  validateModelsConfig,
  writeModelsConfig,
  type ModelsConfigEditor,
} from "../omp/models-config";
import {
  enableProvider,
  readDisabledProviders,
  readModelRoles,
  writeModelRoles,
} from "../omp/model-roles";
import { RpcProcess, type RpcFrame } from "../omp/rpc-process";
import {
  disposeUtilityRpc,
  runIsolatedUtilityCommand,
  runUtilityCommand,
  type OmpLoginProvider,
  type OmpModel,
} from "../omp/rpc-utility";
import {
  mergeNativeSettings,
  readNativeSettings,
  writeNativeSettings,
  type NativeSettings,
} from "../omp/settings-config";
import type { RelayRequestContext } from "./request-types";

/** Finite action set for the `models` domain. */
export const MODELS_REQUEST_ACTIONS = [
  "catalog.get",
  "roles.get",
  "roles.set",
  "registry.get",
  "registry.set",
  "providers.enable",
  "providers.get",
  "providers.update",
  "providers.validate",
  "providers.test",
  "fallback.get",
  "fallback.set",
  "auth.providers",
  "auth.login.start",
  "auth.login.poll",
  "auth.login.confirm",
  "auth.login.cancel",
  "auth.apikey.get",
  "auth.apikey.set",
  "auth.apikey.remove",
  "auth.logout",
] as const;

export type ModelsRequestAction = (typeof MODELS_REQUEST_ACTIONS)[number];

/** Coded domain error. `details` must be safe JSON — never credentials. */
export class ModelsRequestError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly status?: number;

  constructor(code: string, message: string, details?: Record<string, unknown>, status?: number) {
    super(message);
    this.name = "ModelsRequestError";
    this.code = code;
    if (details !== undefined) this.details = details;
    if (status !== undefined) this.status = status;
  }
}

const CONFIG_JSON_MAX_BYTES = 512 * 1024;
const PROVIDER_ID_MAX = 128;
const ROLE_KEY_MAX = 128;
const ROLE_VALUE_MAX = 512;
const LOGIN_TOKEN_MAX = 320;
const LOGIN_CODE_MAX = 4096;
const MAX_PENDING_LOGINS = 32;
const LOGIN_ENTRY_TTL_MS = 15 * 60_000;
const LOGIN_EXTRA_ARGS = ["--no-session", "--no-extensions", "--no-skills", "--no-lsp"];
const READY_TIMEOUT_MS = 60_000;
const LOGIN_TIMEOUT_MS = 15 * 60_000;
const CATALOG_TIMEOUT_MS = 120_000;
const PROVIDERS_TIMEOUT_MS = 30_000;
const STATE_TIMEOUT_MS = 30_000;
const MODEL_TEST_TIMEOUT_MS = 60_000;

/** Native OMP role selectors edited by the desktop ModelRolesDetail. */
export const NATIVE_MODEL_ROLES = [
  "default",
  "smol",
  "slow",
  "vision",
  "plan",
  "designer",
  "commit",
  "tiny",
  "task",
  "advisor",
] as const;

const API_KEY_WRITE_GUIDANCE =
  "ompgui cannot manage stored API keys. Run `omp` in a terminal and use /login (or /logout), " +
  "set the provider's environment variable (e.g. OPENAI_API_KEY), or configure an apiKey on a " +
  "custom provider in ~/.omp/agent/models.yml.";
const LOGOUT_GUIDANCE =
  "ompgui cannot disconnect this provider: omp exposes no logout command outside its own UI. " +
  "Run `omp` in a terminal and use /logout to remove the credential.";
const MODELS_YML_PARSE_GUIDANCE = "models.yml contains invalid YAML; fix it by hand and reload";

function requireAction(action: string): ModelsRequestAction {
  for (const candidate of MODELS_REQUEST_ACTIONS) {
    if (candidate === action) return candidate;
  }
  throw new ModelsRequestError("unknown_action", `Unknown models action "${action}"`);
}

function requireProviderId(value: unknown, field = "provider"): string {
  const provider = (typeof value === "string" ? value : undefined)?.trim();
  if (!provider || provider.length > PROVIDER_ID_MAX || /\s/.test(provider)) {
    throw new ModelsRequestError("invalid_provider", `${field} must be a non-empty id without whitespace`);
  }
  return provider;
}

function requireToken(value: unknown): string {
  const token = (typeof value === "string" ? value : undefined)?.trim();
  if (!token || token.length > LOGIN_TOKEN_MAX) {
    throw new ModelsRequestError("login_token_required", "token is required");
  }
  return token;
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ModelsRequestError("invalid_args", `${field} must contain non-empty strings`);
  }
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new ModelsRequestError("invalid_args", `${field} must contain non-empty strings`);
    }
    out.push(entry);
  }
  return out;
}

function configJsonSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    throw new ModelsRequestError("invalid_args", "config must be JSON-serializable");
  }
}

function toInvalidConfigError(error: unknown): ModelsRequestError {
  if (error instanceof ModelsConfigValidationError) {
    return new ModelsRequestError(MODELS_CONFIG_INVALID_CODE, "Invalid models configuration", {
      issues: error.issues,
    });
  }
  return new ModelsRequestError(MODELS_CONFIG_INVALID_CODE, "Invalid models configuration");
}

// ── Model catalog (mirrors app/api/models/route.ts) ─────────────────────────

const catalogCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function thinkingLevelsFor(model: OmpModel): string[] {
  if (!model.reasoning) return ["off"];
  return ["off", ...(model.thinking?.efforts ?? [])];
}

// OMP's /fast maps to a priority service tier. Same provider-family allowlist
// as `app/api/models/route.ts` (ModelControls.setFastMode resolution) —
// eligibility is decided by omp itself; this flag only mirrors desktop.
function supportsFastMode(model: OmpModel): boolean {
  return model.provider === "anthropic" || model.provider === "openai" || model.provider === "google";
}

function hasModelIdentity(value: unknown): value is { id: string; provider: string } {
  if (typeof value !== "object" || value === null) return false;
  return (
    "id" in value &&
    typeof value.id === "string" &&
    "provider" in value &&
    typeof value.provider === "string"
  );
}

function hasLoginIdentity(
  value: unknown,
): value is { id: string; name: string; authenticated: boolean; available?: boolean } {
  if (typeof value !== "object" || value === null) return false;
  return (
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "authenticated" in value &&
    typeof value.authenticated === "boolean"
  );
}

function toOmpModel(value: { id: string; provider: string }): OmpModel {
  const name =
    "name" in value && typeof value.name === "string" && value.name.trim().length > 0
      ? value.name
      : value.id;
  const model: OmpModel = { id: value.id, provider: value.provider, name };
  if ("reasoning" in value && typeof value.reasoning === "boolean") {
    model.reasoning = value.reasoning;
  }
  if ("thinking" in value) {
    const thinking = value.thinking;
    if (typeof thinking === "object" && thinking !== null && !Array.isArray(thinking)) {
      const efforts =
        "efforts" in thinking &&
        Array.isArray(thinking.efforts) &&
        thinking.efforts.every((entry): entry is string => typeof entry === "string")
          ? thinking.efforts
          : undefined;
      if (efforts !== undefined) {
        model.thinking = { efforts };
      }
    }
  }
  if ("contextWindow" in value && typeof value.contextWindow === "number") {
    model.contextWindow = value.contextWindow;
  }
  return model;
}

/** Full uncapped catalog mirroring `app/api/models/route.ts`: every available
 * model plus the OMP-resolved default, thinking levels, and connected
 * providers. Never throws: load failure yields an empty flagged list. */
export async function getModelsCatalog(): Promise<Record<string, unknown>> {
  let available: OmpModel[];
  try {
    const response = await runUtilityCommand<{ models?: unknown }>(
      { type: "get_available_models" },
      CATALOG_TIMEOUT_MS,
    );
    available = Array.isArray(response.models)
      ? response.models.filter(hasModelIdentity).map(toOmpModel)
      : [];
  } catch {
    // Mirror the desktop route's safe fallback: an empty list with a notice
    // instead of a thrown error, so the panel still renders.
    return { models: [], defaultModel: null, connectedProviders: [], unavailable: true };
  }

  let loginProviders: OmpLoginProvider[] = [];
  try {
    const response = await runUtilityCommand<{ providers?: unknown }>(
      { type: "get_login_providers" },
      PROVIDERS_TIMEOUT_MS,
    );
    loginProviders = Array.isArray(response.providers)
      ? response.providers.filter(hasLoginIdentity).map((provider) => ({
        id: provider.id,
        name: provider.name,
        available:
          "available" in provider && typeof provider.available === "boolean"
            ? provider.available
            : true,
        authenticated: provider.authenticated,
      }))
      : [];
  } catch {
    loginProviders = [];
  }

  let disabled: Set<string>;
  try {
    disabled = readDisabledProviders();
  } catch {
    disabled = new Set();
  }

  const thinkingLevels: Record<string, string[]> = {};
  for (const model of available) {
    thinkingLevels[`${model.provider}:${model.id}`] = thinkingLevelsFor(model);
  }
  const models = available
    .map((model) => ({
      id: model.id,
      name: model.name,
      provider: model.provider,
      thinkingLevels: thinkingLevelsFor(model),
      supportsFastMode: supportsFastMode(model),
      ...(typeof model.contextWindow === "number" &&
      Number.isFinite(model.contextWindow) &&
      model.contextWindow > 0
        ? { contextWindow: model.contextWindow }
        : {}),
    }))
    .sort(
      (a, b) =>
        catalogCollator.compare(a.name || a.id, b.name || b.id) ||
        catalogCollator.compare(a.provider, b.provider) ||
        catalogCollator.compare(a.id, b.id),
    );
  const connectedProviders = loginProviders
    .filter((provider) => provider.authenticated)
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      disabled: disabled.has(provider.id),
    }));

  let defaultModel: { provider: string; modelId: string } | null = null;
  try {
    const state = await runUtilityCommand<{ model?: { provider?: string; id?: string } }>(
      { type: "get_state" },
      STATE_TIMEOUT_MS,
    );
    const provider = state.model?.provider;
    const modelId = state.model?.id;
    if (
      provider &&
      modelId &&
      available.some((model) => model.provider === provider && model.id === modelId)
    ) {
      defaultModel = { provider, modelId };
    }
  } catch {
    // Default model is cosmetic — the catalog is still useful without it.
  }
  return { models, defaultModel, thinkingLevels, connectedProviders };
}

// ── Native registry (enabledModels / disabledProviders / order) ──────────────

function registrySubset(settings: NativeSettings): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (settings.enabledModels !== undefined) out.enabledModels = settings.enabledModels;
  if (settings.disabledProviders !== undefined) out.disabledProviders = settings.disabledProviders;
  if (settings.modelProviderOrder !== undefined) out.modelProviderOrder = settings.modelProviderOrder;
  if (settings.registryHasScopedEntries !== undefined) {
    out.registryHasScopedEntries = settings.registryHasScopedEntries;
  }
  return out;
}

async function setNativeRegistry(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const patch: NativeSettings = {};
  const enabledModels = optionalStringArray(args.enabledModels, "enabledModels");
  const disabledProviders = optionalStringArray(args.disabledProviders, "disabledProviders");
  const modelProviderOrder = optionalStringArray(args.modelProviderOrder, "modelProviderOrder");
  if (enabledModels !== undefined) patch.enabledModels = enabledModels;
  if (disabledProviders !== undefined) patch.disabledProviders = disabledProviders;
  if (modelProviderOrder !== undefined) patch.modelProviderOrder = modelProviderOrder;
  if (
    patch.enabledModels === undefined &&
    patch.disabledProviders === undefined &&
    patch.modelProviderOrder === undefined
  ) {
    throw new ModelsRequestError(
      "invalid_args",
      "registry.set requires at least one of enabledModels, disabledProviders, modelProviderOrder",
    );
  }
  if (enabledModels !== undefined && enabledModels.length > 0) {
    // Best-effort ambiguity guard, mirroring /api/omp-settings: settings stay
    // editable when omp is unavailable.
    try {
      const response = await runUtilityCommand<{ models?: unknown }>(
        { type: "get_available_models" },
        CATALOG_TIMEOUT_MS,
      );
      if (Array.isArray(response.models)) {
        assertNoAmbiguousModelScopes(
          enabledModels,
          response.models.filter(hasModelIdentity),
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Ambiguous enabledModels entry")) {
        throw error;
      }
    }
  }
  try {
    const current = readNativeSettings();
    const next = mergeNativeSettings(current.settings, patch);
    writeNativeSettings(next);
  } catch (error) {
    throw new ModelsRequestError(
      "registry_write_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
  invalidateModelsCache();
  disposeUtilityRpc();
  const updated = readNativeSettings();
  return { settings: registrySubset(updated.settings), path: updated.path };
}

// ── models.yml redacted registry ─────────────────────────────────────────────

function isEditorConfig(value: unknown): value is ModelsConfigEditor {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getEditorConfig(args: Record<string, unknown>): ModelsConfigEditor {
  const rawConfig = args.config;
  if (!isEditorConfig(rawConfig)) {
    throw new ModelsRequestError(
      MODELS_CONFIG_INVALID_CODE,
      "Invalid models configuration",
      { issues: [{ path: "", message: "must be an object" }] },
    );
  }
  return rawConfig;
}

function getRedactedProviders(): Record<string, unknown> {
  const file = readModelsConfigFile();
  if (file.parseError) {
    // Never expose the raw parse excerpt: broken YAML can contain a credential.
    return {
      providers: {},
      parseError: MODELS_YML_PARSE_GUIDANCE,
      path: file.path,
      exists: file.exists,
      code: "models_config_unparseable",
    };
  }
  return { ...redactModelsConfig(file.config), path: file.path, exists: file.exists };
}

function updateRedactedProviders(args: Record<string, unknown>): Record<string, unknown> {
  const config = getEditorConfig(args);
  if (configJsonSize(config) > CONFIG_JSON_MAX_BYTES) {
    throw new ModelsRequestError("config_too_large", "models configuration exceeds 512KiB");
  }
  const mode = args.mode === undefined || args.mode === "partial" ? "partial" : args.mode === "full" ? "full" : null;
  if (mode === null) {
    throw new ModelsRequestError("invalid_args", "mode must be full or partial");
  }
  const overwrite = args.overwrite === undefined ? false : args.overwrite === true;
  if (args.overwrite !== undefined && typeof args.overwrite !== "boolean") {
    throw new ModelsRequestError("invalid_args", "overwrite must be a boolean");
  }
  // Read at write time so a redacted DTO never replaces a credential merely
  // because the client did not receive it.
  const current = readModelsConfigFile();
  let merged;
  try {
    merged = mergeRedactedModelsConfig(current.config, config, mode);
    validateModelsConfig(merged);
  } catch (error) {
    throw toInvalidConfigError(error);
  }
  try {
    writeModelsConfig(merged, { overwriteUnparseable: overwrite });
  } catch (error) {
    if (error instanceof ModelsConfigParseError) {
      throw new ModelsRequestError(
        "models_config_unparseable",
        "models.yml is not valid YAML — fix it by hand; ompgui will not overwrite it",
      );
    }
    throw new ModelsRequestError(
      "models_config_write_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
  invalidateModelsCache();
  disposeUtilityRpc();
  return { success: true, path: current.path };
}

function validateProvidersConfig(args: Record<string, unknown>): Record<string, unknown> {
  const config = getEditorConfig(args);
  if (configJsonSize(config) > CONFIG_JSON_MAX_BYTES) {
    throw new ModelsRequestError("config_too_large", "models configuration exceeds 512KiB");
  }
  try {
    validateModelsConfig(config);
  } catch (error) {
    throw toInvalidConfigError(error);
  }
  return { ok: true };
}

async function testProviderModel(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const providerName = (typeof args.providerName === "string" ? args.providerName : undefined)?.trim();
  if (!providerName) {
    throw new ModelsRequestError("invalid_args", "providerName is required");
  }
  if (typeof args.provider !== "object" || args.provider === null || Array.isArray(args.provider)) {
    throw new ModelsRequestError("invalid_args", "provider is required");
  }
  if (typeof args.model !== "object" || args.model === null || Array.isArray(args.model)) {
    throw new ModelsRequestError("invalid_args", "model is required");
  }
  if (!("id" in args.model)) {
    throw new ModelsRequestError("invalid_args", "model.id is required");
  }
  const modelId = (typeof args.model.id === "string" ? args.model.id : undefined)?.trim();
  if (!modelId) {
    throw new ModelsRequestError("invalid_args", "model.id is required");
  }
  const candidate = {
    providers: {
      [providerName]: { ...args.provider, models: [{ ...args.model, id: modelId }] },
    },
  };
  try {
    validateModelsConfig(candidate);
  } catch (error) {
    throw toInvalidConfigError(error);
  }
  // Isolated throwaway agent dir: the spawned omp sees only this candidate
  // config and never touches ~/.omp (mirrors /api/models-config/test).
  const tempDir = mkdtempSync(join(tmpdir(), "ompgui-model-test-"));
  try {
    writeFileSync(join(tempDir, "models.yml"), serializeModelsConfig(candidate), "utf8");
    const startedAt = Date.now();
    const { models } = await runIsolatedUtilityCommand<{ models: OmpModel[] }>(
      { type: "get_available_models" },
      {
        env: { PI_CODING_AGENT_DIR: tempDir, OMP_PROFILE: "", PI_PROFILE: "", XDG_DATA_HOME: "" },
        timeoutMs: MODEL_TEST_TIMEOUT_MS,
      },
    );
    const latencyMs = Date.now() - startedAt;
    const found = Array.isArray(models)
      ? models.find((model) => model.provider === providerName && model.id === modelId)
      : undefined;
    if (!found) {
      throw new ModelsRequestError(
        "model_test_unresolved",
        `Model ${providerName}/${modelId} did not resolve — check the API key and provider config`,
        { latencyMs },
      );
    }
    return {
      ok: true,
      latencyMs,
      responseText: `${found.provider}/${found.id} resolved (configuration only; credentials were not contacted)`,
    };
  } catch (error) {
    if (error instanceof ModelsRequestError) throw error;
    throw new ModelsRequestError(
      "model_test_failed",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// ── Fallback chains (native retry section) ───────────────────────────────────

function fallbackSubset(settings: NativeSettings): Record<string, unknown> {
  const retry = settings.retry ?? {};
  const out: Record<string, unknown> = {
    chains: retry.fallbackChains ?? {},
  };
  if (retry.enabled !== undefined) out.enabled = retry.enabled;
  if (retry.maxRetries !== undefined) out.maxRetries = retry.maxRetries;
  if (retry.modelFallback !== undefined) out.modelFallback = retry.modelFallback;
  if (retry.fallbackRevertPolicy !== undefined) out.revertPolicy = retry.fallbackRevertPolicy;
  return out;
}

function setFallback(args: Record<string, unknown>): Record<string, unknown> {
  const retry: NonNullable<NativeSettings["retry"]> = {};
  let present = false;
  if (args.chains !== undefined) {
    if (typeof args.chains !== "object" || args.chains === null || Array.isArray(args.chains)) {
      throw new ModelsRequestError("invalid_args", "chains must be an object");
    }
    const chains: Record<string, string[]> = {};
    for (const [role, chain] of Object.entries(args.chains)) {
      if (
        !role.trim() ||
        !Array.isArray(chain) ||
        chain.some((selector) => typeof selector !== "string" || !selector.trim())
      ) {
        throw new ModelsRequestError(
          "invalid_args",
          "fallback chains require non-empty role and model selectors",
        );
      }
      const selectors: string[] = [];
      for (const selector of chain) {
        if (typeof selector === "string") selectors.push(selector);
      }
      chains[role] = selectors;
    }
    retry.fallbackChains = chains;
    present = true;
  }
  if (args.enabled !== undefined) {
    if (typeof args.enabled !== "boolean") throw new ModelsRequestError("invalid_args", "enabled must be a boolean");
    retry.enabled = args.enabled;
    present = true;
  }
  if (args.maxRetries !== undefined) {
    if (
      typeof args.maxRetries !== "number" ||
      !Number.isInteger(args.maxRetries) ||
      args.maxRetries < 0 ||
      args.maxRetries > 20
    ) {
      throw new ModelsRequestError("invalid_args", "maxRetries must be an integer between 0 and 20");
    }
    retry.maxRetries = args.maxRetries;
    present = true;
  }
  if (args.modelFallback !== undefined) {
    if (typeof args.modelFallback !== "boolean") {
      throw new ModelsRequestError("invalid_args", "modelFallback must be a boolean");
    }
    retry.modelFallback = args.modelFallback;
    present = true;
  }
  if (args.revertPolicy !== undefined) {
    if (args.revertPolicy !== "cooldown-expiry" && args.revertPolicy !== "never") {
      throw new ModelsRequestError("invalid_args", "revertPolicy must be cooldown-expiry or never");
    }
    retry.fallbackRevertPolicy = args.revertPolicy;
    present = true;
  }
  if (!present) {
    throw new ModelsRequestError(
      "invalid_args",
      "fallback.set requires at least one of chains, enabled, maxRetries, modelFallback, revertPolicy",
    );
  }
  try {
    const current = readNativeSettings();
    const next = mergeNativeSettings(current.settings, { retry });
    writeNativeSettings(next);
    return { retry: fallbackSubset(next) };
  } catch (error) {
    if (error instanceof ModelsRequestError) throw error;
    throw new ModelsRequestError(
      "fallback_write_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

// ── Auth: provider status + tunneled OAuth login ─────────────────────────────

async function listAuthProviders(): Promise<Record<string, unknown>> {
  try {
    const response = await runUtilityCommand<{ providers?: unknown }>(
      { type: "get_login_providers" },
      PROVIDERS_TIMEOUT_MS,
    );
    const providers = Array.isArray(response.providers)
      ? response.providers.filter(hasLoginIdentity).filter((provider) => {
        if (!("available" in provider)) return true;
        return provider.available !== false;
      })
      : [];
    return {
      providers: providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        loggedIn: provider.authenticated,
      })),
    };
  } catch (error) {
    throw new ModelsRequestError(
      "auth_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function getApiKeyStatus(rawProvider: unknown): Promise<Record<string, unknown>> {
  const provider = requireProviderId(rawProvider);
  try {
    const { models } = await runUtilityCommand<{ models: OmpModel[] }>(
      { type: "get_available_models" },
      CATALOG_TIMEOUT_MS,
    );
    const { providers: loginProviders } = await runUtilityCommand<{ providers: OmpLoginProvider[] }>(
      { type: "get_login_providers" },
      PROVIDERS_TIMEOUT_MS,
    );
    const loginProvider = loginProviders.find((entry) => entry.id === provider);
    const modelCount = models.filter((model) => model.provider === provider).length;
    return {
      provider,
      displayName: loginProvider?.name ?? provider,
      configured: modelCount > 0 || loginProvider?.authenticated === true,
      models: modelCount,
    };
  } catch (error) {
    throw new ModelsRequestError(
      "auth_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

type ModelLoginPhase = "waiting" | "auth" | "prompt" | "progress" | "success" | "error" | "cancelled";

interface PendingModelLogin {
  provider: string;
  deviceId: string;
  proc: RpcProcess | null;
  createdAt: number;
  phase: ModelLoginPhase;
  url?: string;
  instructions?: string | null;
  message?: string;
  placeholder?: string | null;
  error?: string;
  pendingInputId: string | null;
  bufferedValue: string | null;
}

const pendingModelLogins = new Map<string, PendingModelLogin>();

function sweepModelLogins(): void {
  const now = Date.now();
  for (const [token, entry] of pendingModelLogins) {
    if (now - entry.createdAt > LOGIN_ENTRY_TTL_MS) {
      try {
        void entry.proc?.dispose();
      } catch {
        // Teardown is best-effort.
      }
      pendingModelLogins.delete(token);
    }
  }
}

function loginSnapshot(token: string, entry: PendingModelLogin): Record<string, unknown> {
  const snapshot: Record<string, unknown> = { provider: entry.provider, phase: entry.phase, token };
  if (entry.url !== undefined) snapshot.url = entry.url;
  if (entry.instructions !== undefined && entry.instructions !== null) {
    snapshot.instructions = entry.instructions;
  }
  if (entry.message !== undefined) snapshot.message = entry.message;
  if (entry.placeholder !== undefined && entry.placeholder !== null) {
    snapshot.placeholder = entry.placeholder;
  }
  if (entry.error !== undefined) snapshot.error = entry.error;
  return snapshot;
}

async function runModelLogin(token: string, entry: PendingModelLogin): Promise<void> {
  const proc = entry.proc;
  if (!proc) {
    entry.phase = "error";
    entry.error = "Login process is unavailable";
    return;
  }
  try {
    const ready = await proc.waitReady(READY_TIMEOUT_MS);
    await proc.negotiateProtocol(ready);
    await proc.sendCommand({ type: "login", providerId: entry.provider }, LOGIN_TIMEOUT_MS);
    enableProvider(entry.provider);
    invalidateModelsCache();
    disposeUtilityRpc();
    entry.phase = "success";
  } catch (error) {
    entry.phase = "error";
    entry.error = error instanceof Error ? error.message : String(error);
  } finally {
    // Keep the registry entry so poll can read the terminal state; the TTL
    // sweep reaps it. The child itself is always torn down here.
    try {
      await proc.dispose();
    } catch {
      // Teardown is best-effort.
    }
    entry.proc = null;
    entry.pendingInputId = null;
  }
}

function requireDevice(context: RelayRequestContext): string {
  const deviceId = context?.deviceId;
  if (typeof deviceId !== "string" || !deviceId) {
    throw new ModelsRequestError("unauthorized", "device is required");
  }
  return deviceId;
}

function getOwnedLogin(
  token: string,
  provider: string,
  deviceId: string,
): PendingModelLogin {
  sweepModelLogins();
  const entry = pendingModelLogins.get(token);
  if (!entry) {
    throw new ModelsRequestError("login_no_pending", "No pending login for token");
  }
  if (entry.provider !== provider) {
    throw new ModelsRequestError("login_token_mismatch", "Token does not match provider");
  }
  if (entry.deviceId !== deviceId) {
    throw new ModelsRequestError("login_device_mismatch", "Login belongs to another device");
  }
  return entry;
}

function startModelLogin(rawProvider: unknown, context: RelayRequestContext): Record<string, unknown> {
  const provider = requireProviderId(rawProvider);
  const deviceId = requireDevice(context);
  sweepModelLogins();
  if (pendingModelLogins.size >= MAX_PENDING_LOGINS) {
    throw new ModelsRequestError("auth_busy", "Too many pending logins; cancel one and retry");
  }
  const token = `${provider}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const entry: PendingModelLogin = {
    provider,
    deviceId,
    proc: null,
    createdAt: Date.now(),
    phase: "waiting",
    pendingInputId: null,
    bufferedValue: null,
  };
  const handleFrame = (frame: RpcFrame): void => {
    if (frame.type !== "extension_ui_request") return;
    const method = frame.method;
    if (method === "open_url") {
      entry.phase = "auth";
      entry.url = String(frame.url ?? "");
      entry.instructions = typeof frame.instructions === "string" ? frame.instructions : null;
    } else if (method === "input") {
      const id = String(frame.id);
      if (entry.bufferedValue !== null) {
        const value = entry.bufferedValue;
        entry.bufferedValue = null;
        entry.proc?.sendFrame({ type: "extension_ui_response", id, value });
      } else {
        entry.pendingInputId = id;
        entry.phase = "prompt";
        entry.message =
          typeof frame.title === "string" && frame.title ? frame.title : "Enter the authorization code";
        entry.placeholder = typeof frame.placeholder === "string" ? frame.placeholder : null;
      }
    } else if (method === "notify") {
      if (typeof frame.message === "string") entry.message = frame.message;
      if (entry.phase === "waiting") entry.phase = "progress";
    } else if (method === "cancel") {
      if (entry.pendingInputId !== null && frame.targetId === entry.pendingInputId) {
        entry.pendingInputId = null;
        if (entry.phase === "prompt") entry.phase = entry.url ? "auth" : "waiting";
      }
    }
  };
  try {
    const proc = new RpcProcess({ cwd: homedir(), extraArgs: LOGIN_EXTRA_ARGS, onFrame: handleFrame });
    entry.proc = proc;
  } catch (error) {
    throw new ModelsRequestError(
      "auth_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
  pendingModelLogins.set(token, entry);
  // The login command resolves only when the whole flow finishes; the panel
  // learns the URL/code prompt through poll while this runs detached.
  void runModelLogin(token, entry);
  return { provider, token };
}

function pollModelLogin(args: Record<string, unknown>, context: RelayRequestContext): Record<string, unknown> {
  const provider = requireProviderId(args.provider);
  const token = requireToken(args.token);
  const entry = getOwnedLogin(token, provider, requireDevice(context));
  return loginSnapshot(token, entry);
}

function confirmModelLogin(
  args: Record<string, unknown>,
  context: RelayRequestContext,
): Record<string, unknown> {
  const provider = requireProviderId(args.provider);
  const token = requireToken(args.token);
  const entry = getOwnedLogin(token, provider, requireDevice(context));
  if (entry.phase === "success" || entry.phase === "error" || entry.phase === "cancelled") {
    throw new ModelsRequestError("login_not_pending", "Login is no longer pending");
  }
  const code = typeof args.code === "string" ? args.code : undefined;
  if (!code || !code.trim() || code.length > LOGIN_CODE_MAX) {
    throw new ModelsRequestError("login_code_required", "code is required");
  }
  // Never include the code in any error, log, or snapshot: it is write-only.
  if (entry.pendingInputId !== null && entry.proc) {
    const id = entry.pendingInputId;
    entry.pendingInputId = null;
    entry.proc.sendFrame({ type: "extension_ui_response", id, value: code });
    return { ok: true, buffered: false };
  }
  entry.bufferedValue = code;
  return { ok: true, buffered: true };
}

async function cancelModelLogin(
  args: Record<string, unknown>,
  context: RelayRequestContext,
): Promise<Record<string, unknown>> {
  const provider = requireProviderId(args.provider);
  const token = requireToken(args.token);
  const entry = getOwnedLogin(token, provider, requireDevice(context));
  pendingModelLogins.delete(token);
  try {
    await entry.proc?.dispose();
  } catch {
    // Teardown is best-effort.
  }
  return { cancelled: true, provider };
}

async function disposeLoginEntry(entry: PendingModelLogin, token: string): Promise<void> {
  pendingModelLogins.delete(token);
  try {
    await entry.proc?.dispose();
  } catch {
    // Teardown is best-effort.
  }
}

/**
 * Dispose every pending login owned by one device. The connection layer calls
 * this on disconnect so a dropped phone cannot leave omp children running.
 * Resolves with the number of entries cancelled.
 */
export async function cancelModelLoginsForDevice(deviceId: string): Promise<number> {
  let cancelled = 0;
  for (const [token, entry] of [...pendingModelLogins]) {
    if (entry.deviceId !== deviceId) continue;
    await disposeLoginEntry(entry, token);
    cancelled += 1;
  }
  return cancelled;
}

/** Dispose every pending login child process (server teardown). */
export async function cancelAllModelLogins(): Promise<void> {
  for (const [token, entry] of [...pendingModelLogins]) {
    await disposeLoginEntry(entry, token);
  }
}

// ── Domain dispatch ──────────────────────────────────────────────────────────

function setModelRoles(args: Record<string, unknown>): Record<string, unknown> {
  if (typeof args.roles !== "object" || args.roles === null || Array.isArray(args.roles)) {
    throw new ModelsRequestError("invalid_args", "roles must be an object");
  }
  const roles: Record<string, string> = {};
  for (const [role, selector] of Object.entries(args.roles)) {
    // Mirror the desktop PUT filter: keep only non-empty string entries on
    // both sides, dropping anything else instead of rejecting the whole save.
    if (typeof selector !== "string") continue;
    const key = role.trim();
    const value = selector.trim();
    // Mirror the desktop PUT filter: entries must be non-empty on both sides.
    if (key.length === 0 || key.length > ROLE_KEY_MAX || value.length === 0 || value.length > ROLE_VALUE_MAX) {
      continue;
    }
    roles[key] = value;
  }
  try {
    writeModelRoles(roles);
  } catch (error) {
    throw new ModelsRequestError(
      "roles_write_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
  invalidateModelsCache();
  return { roles };
}

/**
 * Handle one `models`-domain request. Returns a JSON object on success;
 * throws a coded error (never a raw credential) on failure.
 */
export async function handleModelsRequest(
  action: string,
  args: Record<string, unknown>,
  context: RelayRequestContext,
): Promise<Record<string, unknown>> {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new ModelsRequestError("invalid_args", "args must be an object");
  }
  if (typeof context !== "object" || context === null) {
    throw new ModelsRequestError("unauthorized", "device is required");
  }
  switch (requireAction(action)) {
    case "catalog.get":
      return getModelsCatalog();
    case "roles.get": {
      try {
        const data = readModelRoles();
        return { path: data.path, roles: data.roles };
      } catch (error) {
        throw new ModelsRequestError(
          "roles_read_failed",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    case "roles.set":
      return setModelRoles(args);
    case "registry.get": {
      try {
        const data = readNativeSettings();
        return { path: data.path, settings: registrySubset(data.settings) };
      } catch (error) {
        throw new ModelsRequestError(
          "registry_read_failed",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    case "registry.set":
      return setNativeRegistry(args);
    case "providers.enable": {
      const provider = requireProviderId(args.provider);
      try {
        enableProvider(provider);
      } catch (error) {
        throw new ModelsRequestError(
          "provider_enable_failed",
          error instanceof Error ? error.message : String(error),
        );
      }
      invalidateModelsCache();
      disposeUtilityRpc();
      return { provider };
    }
    case "providers.get":
      return getRedactedProviders();
    case "providers.update":
      return updateRedactedProviders(args);
    case "providers.validate":
      return validateProvidersConfig(args);
    case "providers.test":
      return testProviderModel(args);
    case "fallback.get": {
      try {
        const data = readNativeSettings();
        return fallbackSubset(data.settings);
      } catch (error) {
        throw new ModelsRequestError(
          "fallback_read_failed",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    case "fallback.set":
      return setFallback(args);
    case "auth.providers":
      return listAuthProviders();
    case "auth.login.start":
      return startModelLogin(args.provider, context);
    case "auth.login.poll":
      return pollModelLogin(args, context);
    case "auth.login.confirm":
      return confirmModelLogin(args, context);
    case "auth.login.cancel":
      return cancelModelLogin(args, context);
    case "auth.apikey.get":
      return getApiKeyStatus(args.provider);
    case "auth.apikey.set":
      throw new ModelsRequestError(
        "api_key_store_unsupported",
        `Cannot store an API key for "${requireProviderId(args.provider)}" from ompgui. ${API_KEY_WRITE_GUIDANCE}`,
        undefined,
        501,
      );
    case "auth.apikey.remove":
      throw new ModelsRequestError(
        "api_key_remove_unsupported",
        `Cannot remove the API key for "${requireProviderId(args.provider)}" from ompgui. ${API_KEY_WRITE_GUIDANCE}`,
        undefined,
        501,
      );
    case "auth.logout":
      throw new ModelsRequestError(
        "logout_unsupported",
        `ompgui cannot disconnect "${requireProviderId(args.provider)}": omp exposes no logout command outside its own UI. ${LOGOUT_GUIDANCE}`,
        undefined,
        501,
      );
  }
}
