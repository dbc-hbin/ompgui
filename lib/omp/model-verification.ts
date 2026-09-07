import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ModelsConfigValidationError,
  serializeModelsConfig,
  validateModelsConfig,
  type ModelsConfigIssue,
  type ModelsFileConfig,
} from "./models-config";
import { runIsolatedUtilityCommand } from "./rpc-utility";

export type ModelVerificationErrorCode =
  | "provider_name_required"
  | "provider_required"
  | "model_required"
  | "model_id_required"
  | "models_config_invalid"
  | "model_test_unresolved"
  | "model_test_failed"
  | "connectivity_confirmation_required"
  | "connectivity_auth_required"
  | "connectivity_unsupported"
  | "connectivity_credential_method_unsupported"
  | "connectivity_model_mismatch"
  | "connectivity_timeout"
  | "connectivity_cancelled"
  | "connectivity_failed";

/** Transport-independent, credential-safe diagnostics. Adapters own status/envelopes. */
export class ModelVerificationError extends Error {
  constructor(
    readonly code: ModelVerificationErrorCode,
    message: string,
    readonly latencyMs?: number,
    readonly issues?: ModelsConfigIssue[],
  ) {
    super(message);
    this.name = "ModelVerificationError";
  }
}

export type ModelConfigurationVerificationResult = {
  ok: true;
  latencyMs: number;
  responseText: string;
};

/** Validate only the submitted candidate; never merge stored credentials. */
export function validateModelVerificationCandidate(input: unknown): { providerName: string; modelId: string; candidate: ModelsFileConfig } {
  const body = typeof input === "object" && input !== null && !Array.isArray(input) ? input : {};
  const providerName = "providerName" in body && typeof body.providerName === "string" ? body.providerName.trim() : "";
  if (!providerName) throw new ModelVerificationError("provider_name_required", "providerName is required");
  if (!("provider" in body) || typeof body.provider !== "object" || body.provider === null || Array.isArray(body.provider)) {
    throw new ModelVerificationError("provider_required", "provider is required");
  }
  if (!("model" in body) || typeof body.model !== "object" || body.model === null || Array.isArray(body.model)) {
    throw new ModelVerificationError("model_required", "model is required");
  }
  const modelId = "id" in body.model && typeof body.model.id === "string" ? body.model.id.trim() : "";
  if (!modelId) throw new ModelVerificationError("model_id_required", "Model ID is required");
  const candidate = {
    providers: { [providerName]: { ...body.provider, models: [{ ...body.model, id: modelId }] } },
  };
  try {
    validateModelsConfig(candidate);
  } catch (error) {
    throw new ModelVerificationError("models_config_invalid", error instanceof ModelsConfigValidationError ? error.message : "Invalid models configuration", undefined,
      error instanceof ModelsConfigValidationError ? error.issues : undefined);
  }

  return { providerName, modelId, candidate };
}

export function writePrivateModelCandidate(candidate: ModelsFileConfig): string {
  const directory = mkdtempSync(join(tmpdir(), "ompgui-model-test-"));
  try {
    writeFileSync(join(directory, "models.yml"), serializeModelsConfig(candidate), { encoding: "utf8", mode: 0o600 });
    return directory;
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Network-free registry resolution. The isolated runner disposes before private-file cleanup. */
export async function verifyModelConfiguration(input: unknown): Promise<ModelConfigurationVerificationResult> {
  const { providerName, modelId, candidate } = validateModelVerificationCandidate(input);
  let tempDir: string | undefined;
  let startedAt: number | undefined;
  try {
    try {
      tempDir = writePrivateModelCandidate(candidate);
      startedAt = Date.now();
      const response = await runIsolatedUtilityCommand<unknown>(
        { type: "get_available_models" },
        {
          env: { PI_CODING_AGENT_DIR: tempDir, OMP_PROFILE: "", PI_PROFILE: "", XDG_DATA_HOME: "" },
          timeoutMs: 60_000,
        },
      );
      const latencyMs = Date.now() - startedAt;
      const models = typeof response === "object" && response !== null && "models" in response && Array.isArray(response.models) ? response.models : [];
      const found = models.some((model: unknown) => typeof model === "object" && model !== null && "provider" in model && model.provider === providerName && "id" in model && model.id === modelId);
      if (!found) {
        throw new ModelVerificationError("model_test_unresolved", `Model ${providerName}/${modelId} did not resolve — check the API key and provider config`, latencyMs);
      }
      return {
        ok: true,
        latencyMs,
        responseText: `${providerName}/${modelId} resolved (configuration only; credentials were not contacted)`,
      };
    } finally {
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (error instanceof ModelVerificationError) throw error;
    throw new ModelVerificationError("model_test_failed", "Model configuration verification failed", startedAt === undefined ? undefined : Date.now() - startedAt);
  }
}
