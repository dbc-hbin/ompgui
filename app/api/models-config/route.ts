import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-utils";
import { invalidateModelsCache } from "@/lib/models-cache";
import { disposeUtilityRpc } from "@/lib/omp/rpc-utility";
import {
  MODELS_CONFIG_INVALID_CODE,
  ModelsConfigParseError,
  ModelsConfigValidationError,
  mergeRedactedModelsConfig,
  readModelsConfigFile,
  redactModelsConfig,
  validateModelsConfig,
  writeModelsConfig,
  type ModelsConfigEditor,
  type ModelsFileConfig,
} from "@/lib/omp/models-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const file = readModelsConfigFile();
  if (file.parseError) {
    // The editor must show the failure instead of an empty form — an empty
    // form invites a Save that would wipe the user's real providers.
    return NextResponse.json({
      providers: {},
      // yaml includes a source-line excerpt in parseError; it can contain a
      // credential or header from the broken file, so expose only guidance.
      parseError: "models.yml contains invalid YAML; fix it by hand and reload",
      path: file.path,
      code: "models_config_unparseable",
    });
  }
  return NextResponse.json(redactModelsConfig(file.config));
}

// PUT /api/models-config[?mode=full|partial][&overwrite=true]
// Full is an explicit editor snapshot; an absent mode defaults to partial.
// Refuses to write while models.yml is unparseable unless ?overwrite=true.
export async function PUT(req: Request) {
  try {
    const searchParams = new URL(req.url).searchParams;
    const modeParam = searchParams.get("mode");
    if (modeParam !== null && modeParam !== "full" && modeParam !== "partial") {
      return NextResponse.json(
        {
          error: "Invalid models configuration mode",
          code: MODELS_CONFIG_INVALID_CODE,
          issues: [{ path: "mode", message: "must be full or partial" }],
        },
        { status: 400 },
      );
    }
    const mode = modeParam === "full" ? "full" : "partial";
    const overwriteUnparseable = searchParams.get("overwrite") === "true";
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON request body", code: "invalid_json" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Models configuration must be an object", code: MODELS_CONFIG_INVALID_CODE, issues: [{ path: "", message: "must be an object" }] }, { status: 400 });
    }

    // Read the current file at write time so a redacted editor DTO never
    // replaces a credential merely because the browser did not receive it.
    const current = readModelsConfigFile();
    let merged: ModelsFileConfig;
    try {
      merged = mergeRedactedModelsConfig(current.config, body as ModelsConfigEditor, mode);
      validateModelsConfig(merged);
    } catch (error) {
      if (error instanceof ModelsConfigValidationError) {
        return NextResponse.json(
          { error: "Invalid models configuration", code: MODELS_CONFIG_INVALID_CODE, issues: error.issues },
          { status: 400 },
        );
      }
      // Validation itself must not echo arbitrary values into a response.
      return NextResponse.json({ error: "Invalid models configuration", code: MODELS_CONFIG_INVALID_CODE }, { status: 400 });
    }
    try {
      writeModelsConfig(merged, { overwriteUnparseable });
    } catch (error) {
      if (error instanceof ModelsConfigParseError) {
        return NextResponse.json(
          { error: "models.yml is not valid YAML — fix it by hand; ompgui will not overwrite it", code: "models_config_unparseable" },
          { status: 409 },
        );
      }
      throw error;
    }
    invalidateModelsCache();
    // The utility process loads models.yml once at startup. A cache flush alone
    // would still query that stale registry after a provider was added.
    disposeUtilityRpc();
    return NextResponse.json({ success: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
