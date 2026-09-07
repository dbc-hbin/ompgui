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

export type ModelVerificationErrorCode =
  | "provider_name_required"
  | "provider_required"
  | "model_required"
  | "model_id_required"
  | "models_config_invalid"
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

/** Structural validation only: native startup performs background discovery and
 * endpoint preconnect even without a prompt, so it cannot prove an offline check.
 * No process, credential resolution, private files, or network access occurs here.
 * Real registry/endpoint verification belongs to the explicitly confirmed
 * connectivity operation and must not be inferred from this result.
 */
export async function verifyModelConfiguration(input: unknown): Promise<ModelConfigurationVerificationResult> {
  const startedAt = Date.now();
  const { providerName, modelId } = validateModelVerificationCandidate(input);
  return {
    ok: true,
    latencyMs: Date.now() - startedAt,
    responseText: `${providerName}/${modelId} has valid configuration (configuration only; no provider connection attempted)`,
  };
}
