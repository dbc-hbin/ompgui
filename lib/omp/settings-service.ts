import { invalidateModelsCache } from "../models-cache";
import { assertNoAmbiguousModelScopes } from "../model-scope";
import { isRecord } from "../type-guards";
import { disposeUtilityRpc, runUtilityCommand, type OmpModel } from "./rpc-utility";
import {
  NativeSettingsError,
  readNativeSettingsSnapshot,
  updateNativeSettings,
  type NativeSettingsScope,
  type NativeSettingsSnapshot,
  type NativeSettingsUpdate,
} from "./settings-config";

export type NativeSettingsResult = NativeSettingsSnapshot & {
  success: true;
  application: { mode: "new-session" | "runtime-refresh"; restartRequired: false };
};

function parseScope(value: unknown): NativeSettingsScope | undefined {
  if (value === undefined) return undefined;
  if (value === "global" || value === "project") return value;
  throw new NativeSettingsError("invalid_scope", "scope must be global or project", [{ path: "scope", message: "Unsupported settings scope" }]);
}

export async function getNativeSettings(input: Record<string, unknown> = {}): Promise<NativeSettingsSnapshot> {
  const scope = parseScope(input.scope);
  if (input.cwd !== undefined && typeof input.cwd !== "string") {
    throw new NativeSettingsError("invalid_scope", "cwd must be a string", [{ path: "cwd", message: "Expected a string" }]);
  }
  return readNativeSettingsSnapshot(scope, input.cwd as string | undefined);
}

function enabledModelsFrom(update: NativeSettingsUpdate): string[] | undefined {
  if (!isRecord(update.settings)) return undefined;
  const value = update.settings.enabledModels;
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

async function assertModelScopes(update: NativeSettingsUpdate): Promise<void> {
  const enabledModels = enabledModelsFrom(update);
  if (!enabledModels?.length) return;
  try {
    const response = await runUtilityCommand<{ models?: unknown }>({ type: "get_available_models" }, 120_000);
    if (!Array.isArray(response.models)) return;
    const models = response.models.filter((model): model is OmpModel => (
      typeof model === "object" && model !== null
      && typeof (model as OmpModel).id === "string"
      && typeof (model as OmpModel).provider === "string"
    ));
    assertNoAmbiguousModelScopes(enabledModels, models);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Ambiguous enabledModels entry")) {
      throw new NativeSettingsError("invalid_settings", error.message, [{ path: "enabledModels", message: error.message }]);
    }
    // Catalog lookup is best effort. A missing omp utility must not lock users
    // out of repairing settings.
  }
}

export async function applyNativeSettings(input: unknown): Promise<NativeSettingsResult> {
  if (!isRecord(input)) {
    throw new NativeSettingsError("invalid_update", "Settings update must be an object", [{ path: "$", message: "Expected an object" }]);
  }
  const update: NativeSettingsUpdate = {
    ...(input.settings !== undefined ? { settings: input.settings as Record<string, unknown> } : {}),
    ...(input.scope !== undefined ? { scope: parseScope(input.scope) } : {}),
    ...(input.cwd !== undefined ? { cwd: input.cwd as string } : {}),
    ...(input.reset !== undefined ? { reset: input.reset as string[] } : {}),
    ...(input.secrets !== undefined ? { secrets: input.secrets as Record<string, string | null> } : {}),
    ...(input.confirm !== undefined ? { confirm: input.confirm as string[] } : {}),
  };
  if (input.cwd !== undefined && typeof input.cwd !== "string") {
    throw new NativeSettingsError("invalid_scope", "cwd must be a string", [{ path: "cwd", message: "Expected a string" }]);
  }
  await assertModelScopes(update);
  const { snapshot, registryInvalidated } = await updateNativeSettings(update);
  if (registryInvalidated) {
    invalidateModelsCache();
    disposeUtilityRpc();
  }
  return {
    ...snapshot,
    success: true,
    application: {
      mode: registryInvalidated ? "runtime-refresh" : "new-session",
      restartRequired: false,
    },
  };
}

export function nativeSettingsErrorPayload(error: unknown): {
  error: { code: string; message: string; issues?: { path: string; message: string }[] };
} {
  if (error instanceof NativeSettingsError) {
    return { error: { code: error.code, message: error.message, ...(error.issues.length ? { issues: error.issues } : {}) } };
  }
  return { error: { code: "settings_failed", message: "Settings operation failed" } };
}
