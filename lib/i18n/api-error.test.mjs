import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { formatConnectivityError } = await jiti.import("./api-error.ts");
const { setLocale, translate } = await jiti.import("./index.tsx");
const secret = "Bearer sk-private-provider-payload";

const reasons = {
  connectivity_unsupported: "connectionUnsupported",
  connectivity_credential_method_unsupported: "connectionCredentialMethodUnsupported",
  connectivity_auth_required: "connectionAuthRequired",
  connectivity_timeout: "connectionTimeout",
  connectivity_model_mismatch: "connectionModelMismatch",
  models_config_invalid: "connectionConfigInvalid",
  provider_name_required: "connectionConfigInvalid",
  provider_required: "connectionConfigInvalid",
  model_required: "connectionConfigInvalid",
  model_id_required: "connectionConfigInvalid",
  connectivity_confirmation_required: "connectionConfirmationRequired",
  connectivity_failed: "connectionProviderFailed",
};

test("connection errors localize only supported reasons without exposing provider payloads", (t) => {
  t.after(() => setLocale("en"));
  for (const locale of ["en", "ja", "ko", "zh-CN"]) {
    setLocale(locale);
    for (const [code, key] of Object.entries(reasons)) {
      const message = formatConnectivityError({ code, error: secret, message: secret });
      assert.equal(message, translate(`modelsConfig.${key}`));
      assert.notEqual(message, translate("modelsConfig.connectionFailed"));
      assert.ok(!message.includes(secret));
    }
    assert.notEqual(
      formatConnectivityError({ code: "connectivity_unsupported" }),
      formatConnectivityError({ code: "connectivity_credential_method_unsupported" }),
    );
  }
});

test("unknown and malformed connection errors use the safe generic fallback", (t) => {
  t.after(() => setLocale("en"));
  setLocale("en");
  for (const payload of [
    null, undefined, secret, 401, [],
    [{ code: "connectivity_timeout", error: secret }],
    { error: secret, message: secret },
    { code: "unknown_provider_error", error: secret },
    { code: "generic", message: secret },
    { code: "toString", error: secret },
    { code: "__proto__", error: secret },
    { code: ["connectivity_timeout"], error: secret },
    { code: { toString: () => "connectivity_timeout" }, error: secret },
    { code: 401, error: secret },
  ]) {
    assert.equal(formatConnectivityError(payload), translate("modelsConfig.connectionFailed"));
    assert.ok(!formatConnectivityError(payload).includes(secret));
  }
});

test("connection cancellation produces no error message even with provider payloads", () => {
  assert.equal(formatConnectivityError({ code: "connectivity_cancelled", error: secret, message: secret }), null);
});
