import { translate } from "./index";

/**
 * Client-side rendering of API error payloads. Routes attach a stable `code`
 * to well-known failures; the dictionary maps `errors.<code>` to a localized
 * message. Unknown or dynamic errors fall back to the server's English text.
 */
export interface ApiErrorPayload {
  error?: string;
  code?: string;
}

/** Connectivity errors never render provider payloads, even for unknown codes. */
export function formatConnectivityError(payload: unknown): string | null {
  const code = typeof payload === "object" && payload !== null && !Array.isArray(payload) && "code" in payload
    ? payload.code
    : undefined;
  switch (code) {
    case "connectivity_cancelled":
      return null;
    case "connectivity_unsupported":
      return translate("modelsConfig.connectionUnsupported");
    case "connectivity_credential_method_unsupported":
      return translate("modelsConfig.connectionCredentialMethodUnsupported");
    case "connectivity_auth_required":
      return translate("modelsConfig.connectionAuthRequired");
    case "connectivity_timeout":
      return translate("modelsConfig.connectionTimeout");
    case "connectivity_model_mismatch":
      return translate("modelsConfig.connectionModelMismatch");
    case "provider_name_required":
    case "provider_required":
    case "model_required":
    case "model_id_required":
    case "models_config_invalid":
      return translate("modelsConfig.connectionConfigInvalid");
    case "connectivity_confirmation_required":
      return translate("modelsConfig.connectionConfirmationRequired");
    case "connectivity_failed":
      return translate("modelsConfig.connectionProviderFailed");
    default:
      return translate("modelsConfig.connectionFailed");
  }
}

export function formatApiError(
  payload: ApiErrorPayload | string | null | undefined,
  fallbackKey = "errors.generic",
): string {
  if (typeof payload === "string") return payload;
  const code = payload?.code;
  if (code) {
    const key = `errors.${code}`;
    const localized = translate(key);
    if (localized !== key) return localized;
  }
  if (payload?.error) return payload.error;
  const fallback = translate(fallbackKey);
  return fallback === fallbackKey ? "Request failed" : fallback;
}
