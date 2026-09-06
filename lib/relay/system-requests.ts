/**
 * Relay `system` domain handler (GeneralSettings owns this file).
 *
 * Finite domain dispatch — NOT a generic RPC tunnel. Every action validates
 * its args; unknown actions throw `unknown_action`. All successes resolve to
 * a JSON object; all failures throw an error carrying a stable `code`
 * (plus safe, secret-free details) for TransportParity to surface as
 * `{op:'result',req,success:false,error:{code,message,...}}`.
 *
 * Reuses the exact desktop services/routes as authority:
 * - usage.get: `fetchCachedUsage` + `fetchUsagePayload` (mirrors
 *   `app/api/usage/route.ts`: 60s TTL, `refresh` invalidates via
 *   `omp usage invalidate`, full UsageResponse incl. amounts,
 *   emptyReason, accountsWithoutUsage, disabledCredentials, capacity,
 *   generatedAt, cached, error codes — never fraction-only).
 * - omp.check: `checkOmpUpdate` (mirrors `app/api/omp-update` check).
 * - app.check: `checkNpmUpdate` (mirrors `app/api/app-update` force).
 * - omp.restart: `invalidateOmpCliCache` + `restartAllRpcSessions`
 *   (mirrors `app/api/omp-update` restart; requires explicit confirm).
 * - devices.list/revoke: `listRelayDevices`/`revokeRelayDevice` (mirrors
 *   `lib/relay/registry.ts`; authed transport only; never returns secrets).
 * - systemPrompt.get: live `getRpcSession(id).send({type:"get_state"})`
 *   systemPrompt (mirrors `hooks/useAgentSession.ts` loadSystemPrompt;
 *   requires explicit sessionId, never context-implied).
 * - settings.get/update: `readNativeSettings`/`mergeNativeSettings`/
 *   `writeNativeSettings` + `assertNoAmbiguousModelScopes` (mirrors
 *   `app/api/omp-settings/route.ts` incl. registry invalidation).
 * - update: HONEST `update_disabled` mirroring the desktop route — ompgui
 *   never executes a host self-update; the panel shows a copyable command.
 *
 * Action table (domain `system`), exact schemas for TransportParity /
 * GeneralSettings / UsageSheet / SystemSection:
 * - usage.get {refresh?:boolean} -> full UsageResponse
 * - omp.check {} -> {currentVersion,availableVersion,updateAvailable,updateCommand}
 * - app.check {force?:boolean} -> {currentVersion,availableVersion,updateAvailable,updateCommand,lookupFailed}
 * - omp.restart {confirm:true} -> {success:true,sessionsRestarted:number}
 * - devices.list {} -> {devices:[{id,label,createdAt,lastSeenAt}]}
 * - devices.revoke {deviceId:string} -> {revoked:true,deviceId,self:boolean}
 * - systemPrompt.get {sessionId:string} -> {sessionId,systemPrompt:string}
 * - settings.get {} -> {path,settings}
 * - settings.update {settings:object} -> {success:true,settings,application:{mode,restartRequired}}
 * - update {...any} -> throws update_disabled (400, never executes)
 */
import { invalidateOmpCliCache, runOmpCli } from "../omp/omp-cli";
import {
  filterNativeSettings,
  mergeNativeSettings,
  readNativeSettings,
  writeNativeSettings,
} from "../omp/settings-config";
import { checkOmpUpdate, type OmpUpdateStatus } from "../omp/updates";
import { checkNpmUpdate, type NpmUpdateStatus } from "../npm-update";
import { assertNoAmbiguousModelScopes, type ModelScopeCandidate } from "../model-scope";
import { invalidateModelsCache } from "../models-cache";
import { disposeUtilityRpc, runUtilityCommand } from "../omp/rpc-utility";
import { restartAllRpcSessions, getRpcSession } from "../rpc-manager";
import { fetchCachedUsage, fetchUsagePayload, type UsageCacheState } from "../usage";
import type { UsageResponse } from "../api-types";
import { listRelayDevices, revokeRelayDevice, type RelayDevicePublic } from "./registry";
import type { RelayRequestContext } from "./request-types";

/** Finite action set for the `system` domain. */
export const SYSTEM_REQUEST_ACTIONS = [
  "usage.get",
  "omp.check",
  "app.check",
  "omp.restart",
  "devices.list",
  "devices.revoke",
  "systemPrompt.get",
  "settings.get",
  "settings.update",
  "update",
] as const;

export type SystemRequestAction = (typeof SYSTEM_REQUEST_ACTIONS)[number];

/** Coded domain error. `details` must be safe JSON — never credentials. */
export class SystemRequestError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly status?: number;

  constructor(code: string, message: string, details?: Record<string, unknown>, status?: number) {
    super(message);
    this.name = "SystemRequestError";
    this.code = code;
    if (details !== undefined) this.details = details;
    if (status !== undefined) this.status = status;
  }
}

const DEVICE_ID_RE = /^d_[A-Za-z0-9_-]{16,64}$/;
const DEVICE_ID_MAX = 128;
const SESSION_ID_MAX = 128;
const USAGE_CACHE_TTL_MS = 60_000;

declare global {
  var __ompgui_system_usage_cache: UsageCacheState | undefined;
}

function getSystemUsageState(): UsageCacheState {
  if (!globalThis.__ompgui_system_usage_cache) {
    globalThis.__ompgui_system_usage_cache = {};
  }
  return globalThis.__ompgui_system_usage_cache;
}

function usageToRecord(payload: UsageResponse): Record<string, unknown> {
  const record: Record<string, unknown> = {
    generatedAt: payload.generatedAt,
    reports: payload.reports,
    accountsWithoutUsage: payload.accountsWithoutUsage,
    disabledCredentials: payload.disabledCredentials,
    capacity: payload.capacity,
    cached: payload.cached,
  };
  if (payload.emptyReason !== undefined) record.emptyReason = payload.emptyReason;
  return record;
}

function ompStatusToRecord(status: OmpUpdateStatus): Record<string, unknown> {
  return {
    currentVersion: status.currentVersion,
    availableVersion: status.availableVersion,
    updateAvailable: status.updateAvailable,
    updateCommand: status.updateCommand,
  };
}

function npmStatusToRecord(status: NpmUpdateStatus): Record<string, unknown> {
  return {
    currentVersion: status.currentVersion,
    availableVersion: status.availableVersion,
    updateAvailable: status.updateAvailable,
    updateCommand: status.updateCommand,
    lookupFailed: status.lookupFailed,
  };
}

function devicesToRecord(devices: RelayDevicePublic[]): Record<string, unknown> {
  return {
    devices: devices.map((device) => ({
      id: device.id,
      label: device.label,
      createdAt: device.createdAt,
      lastSeenAt: device.lastSeenAt,
    })),
  };
}

function requireAction(action: string): SystemRequestAction {
  if (!(SYSTEM_REQUEST_ACTIONS as readonly string[]).includes(action)) {
    throw new SystemRequestError("unknown_action", `Unknown system action "${action}"`);
  }
  return action as SystemRequestAction;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new SystemRequestError("invalid_args", `${field} must be a boolean`);
  }
  return value;
}

function requireDeviceId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id.length > DEVICE_ID_MAX || !DEVICE_ID_RE.test(id)) {
    throw new SystemRequestError("invalid_args", "deviceId must be a valid device id");
  }
  return id;
}

function requireSessionId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id.length > SESSION_ID_MAX) {
    throw new SystemRequestError("invalid_args", "sessionId is required");
  }
  return id;
}

function errorCodeForUsageStatus(status: number): string {
  switch (status) {
    case 503:
      return "omp_not_found";
    case 501:
      return "usage_not_supported";
    case 502:
    default:
      return "usage_fetch_failed";
  }
}

async function getUsage(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const refresh = optionalBoolean(args.refresh, "refresh") ?? false;
  const state = getSystemUsageState();
  const result = await fetchCachedUsage(state, refresh, {
    fetch: () => fetchUsagePayload(),
    invalidate: () => runOmpCli(["usage", "invalidate"], { timeout: 15_000 }),
    ttlMs: USAGE_CACHE_TTL_MS,
  });
  if (result.ok) {
    return usageToRecord(result.payload);
  }
  throw new SystemRequestError(
    errorCodeForUsageStatus(result.status),
    result.error,
    undefined,
    result.status,
  );
}

async function checkOmp(): Promise<Record<string, unknown>> {
  try {
    const status = await checkOmpUpdate();
    return ompStatusToRecord(status);
  } catch (error) {
    throw new SystemRequestError(
      "omp_check_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function checkApp(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const force = optionalBoolean(args.force, "force") ?? false;
  const status = await checkNpmUpdate(force);
  return npmStatusToRecord(status);
}

async function restartOmp(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (args.confirm !== true) {
    throw new SystemRequestError("confirm_required", "omp.restart requires {confirm:true}");
  }
  try {
    invalidateOmpCliCache();
    const sessionsRestarted = await restartAllRpcSessions();
    return { success: true, sessionsRestarted };
  } catch (error) {
    throw new SystemRequestError(
      "restart_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function listDevices(): Record<string, unknown> {
  return devicesToRecord(listRelayDevices());
}

function revokeDevice(
  args: Record<string, unknown>,
  context: RelayRequestContext,
): Record<string, unknown> {
  const deviceId = requireDeviceId(args.deviceId);
  const revoked = revokeRelayDevice(deviceId);
  if (!revoked) {
    throw new SystemRequestError("device_not_found", `Unknown device "${deviceId}"`);
  }
  // Self-revoke is allowed but the caller must handle reconnect safely:
  // TransportParity closes the current socket only after delivering this
  // result, so the phone sees the confirmation instead of a bare drop.
  return { revoked: true, deviceId, self: deviceId === context.deviceId };
}

async function getSystemPrompt(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  // Explicit sessionId only — never context.sessionId implied — so a stale
  // transport context cannot leak another session's instructions.
  const sessionId = requireSessionId(args.sessionId);
  const wrapper = getRpcSession(sessionId);
  if (!wrapper) {
    throw new SystemRequestError("session_not_running", "Session is not running");
  }
  try {
    const state: unknown = await wrapper.send({ type: "get_state" });
    if (typeof state !== "object" || state === null || Array.isArray(state)) {
      throw new SystemRequestError("system_prompt_failed", "Session state unavailable");
    }
    const prompt = "systemPrompt" in state && typeof state.systemPrompt === "string"
      ? state.systemPrompt
      : "";
    return { sessionId, systemPrompt: prompt };
  } catch (error) {
    if (error instanceof SystemRequestError) throw error;
    throw new SystemRequestError(
      "system_prompt_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function settingsToRecord(path: string, settings: unknown): Record<string, unknown> {
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
    throw new SystemRequestError("settings_read_failed", "Stored settings are not an object");
  }
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) record[key] = value;
  return { path, settings: record };
}

function getSettings(): Record<string, unknown> {
  try {
    const data = readNativeSettings();
    return settingsToRecord(data.path, data.settings);
  } catch (error) {
    if (error instanceof SystemRequestError) throw error;
    throw new SystemRequestError(
      "settings_read_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function readStringList(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new SystemRequestError("invalid_args", "model lists must contain non-empty strings");
  }
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new SystemRequestError("invalid_args", "model lists must contain non-empty strings");
    }
    out.push(entry);
  }
  return out;
}

function modelsForScopeCheck(models: unknown): ModelScopeCandidate[] {
  if (!Array.isArray(models)) return [];
  const out: ModelScopeCandidate[] = [];
  for (const entry of models) {
    if (typeof entry !== "object" || entry === null) continue;
    if (!("id" in entry) || !("provider" in entry)) continue;
    const id = entry.id;
    const provider = entry.provider;
    if (typeof id === "string" && typeof provider === "string") out.push({ id, provider });
  }
  return out;
}

async function updateSettings(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (typeof args.settings !== "object" || args.settings === null || Array.isArray(args.settings)) {
    throw new SystemRequestError("invalid_args", "settings must be an object");
  }
  // Drop unknown fields through the existing filter. Recognized malformed
  // values survive filtering and are rejected before persistence by the writer.
  const reviewed = filterNativeSettings(args.settings);
  const enabledModels = readStringList(reviewed.enabledModels);
  if (enabledModels !== undefined && enabledModels.length > 0) {
    // Best-effort ambiguity guard, mirroring /api/omp-settings: settings stay
    // editable when omp is unavailable.
    try {
      const response = await runUtilityCommand<{ models?: unknown }>(
        { type: "get_available_models" },
        120_000,
      );
      if (Array.isArray(response.models)) {
        assertNoAmbiguousModelScopes(enabledModels, modelsForScopeCheck(response.models));
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Ambiguous enabledModels entry")) {
        throw new SystemRequestError("invalid_args", error.message);
      }
    }
  }
  try {
    const current = readNativeSettings();
    const next = mergeNativeSettings(current.settings, reviewed);
    writeNativeSettings(next);
    const registryInvalidated = reviewed.enabledModels !== undefined
      || reviewed.disabledProviders !== undefined
      || reviewed.modelProviderOrder !== undefined;
    if (registryInvalidated) {
      invalidateModelsCache();
      disposeUtilityRpc();
    }
    const updated = readNativeSettings();
    const updatedRecord = settingsToRecord(updated.path, updated.settings);
    const settingsValue = updatedRecord.settings;
    return {
      success: true,
      settings: settingsValue,
      application: {
        mode: registryInvalidated ? "runtime-refresh" : "new-session",
        restartRequired: false,
      },
    };
  } catch (error) {
    if (error instanceof SystemRequestError) throw error;
    throw new SystemRequestError(
      "settings_write_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Handle one `system`-domain request. Returns a JSON object on success;
 * throws a coded error (never a raw credential) on failure.
 */
export async function handleSystemRequest(
  action: string,
  args: Record<string, unknown>,
  context: RelayRequestContext,
): Promise<Record<string, unknown>> {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new SystemRequestError("invalid_args", "args must be an object");
  }
  switch (requireAction(action)) {
    case "usage.get":
      return getUsage(args);
    case "omp.check":
      return checkOmp();
    case "app.check":
      return checkApp(args);
    case "omp.restart":
      return restartOmp(args);
    case "devices.list":
      return listDevices();
    case "devices.revoke":
      return revokeDevice(args, context);
    case "systemPrompt.get":
      return getSystemPrompt(args);
    case "settings.get":
      return getSettings();
    case "settings.update":
      return updateSettings(args);
    case "update":
      throw new SystemRequestError(
        "update_disabled",
        "Automatic self-updating is disabled. Run 'omp update' in your terminal.",
        { command: "omp update" },
        400,
      );
  }
}
