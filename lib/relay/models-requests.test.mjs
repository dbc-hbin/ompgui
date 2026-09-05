import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const modelsRequests = await jiti.import("./models-requests.ts");
const { handleModelsRequest, cancelAllModelLogins, cancelModelLoginsForDevice } = modelsRequests;

const ctx = { deviceId: "d_test", sessionId: null };
const otherCtx = { deviceId: "d_other", sessionId: null };

async function throwsCode(fn, code) {
  try {
    await fn();
  } catch (error) {
    assert.equal(error.code, code, `expected code ${code}, got ${error.code}: ${error.message}`);
    return error;
  }
  assert.fail(`expected throw with code ${code}`);
}

function isolateAgentDir() {
  const dir = mkdtempSync(join(tmpdir(), "ompgui-models-req-"));
  const prevDir = process.env.PI_CODING_AGENT_DIR;
  const prevOmp = process.env.OMP_PROFILE;
  const prevPi = process.env.PI_PROFILE;
  process.env.PI_CODING_AGENT_DIR = dir;
  delete process.env.OMP_PROFILE;
  delete process.env.PI_PROFILE;
  return () => {
    if (prevDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prevDir;
    if (prevOmp === undefined) delete process.env.OMP_PROFILE;
    else process.env.OMP_PROFILE = prevOmp;
    if (prevPi === undefined) delete process.env.PI_PROFILE;
    else process.env.PI_PROFILE = prevPi;
    rmSync(dir, { recursive: true, force: true });
  };
}

test("unknown models action fails with a coded rejection", async () => {
  await throwsCode(() => handleModelsRequest("nope", {}, ctx), "unknown_action");
  await throwsCode(() => handleModelsRequest("", {}, ctx), "unknown_action");
});

test("roles.set keeps only non-empty string entries", async () => {
  const restore = isolateAgentDir();
  try {
    const out = await handleModelsRequest(
      "roles.set",
      { roles: { default: "openai/gpt-5", smol: "  ", bad: 42 } },
      ctx,
    );
    assert.deepEqual(out, { roles: { default: "openai/gpt-5" } });
    const read = await handleModelsRequest("roles.get", {}, ctx);
    assert.deepEqual(read.roles, { default: "openai/gpt-5" });
  } finally {
    restore();
  }
});

test("roles.set rejects non-object roles", async () => {
  await throwsCode(() => handleModelsRequest("roles.set", { roles: "x" }, ctx), "invalid_args");
});

test("registry.set requires at least one known field", async () => {
  await throwsCode(() => handleModelsRequest("registry.set", {}, ctx), "invalid_args");
  await throwsCode(
    () => handleModelsRequest("registry.set", { enabledModels: ["", "x"] }, ctx),
    "invalid_args",
  );
});

test("registry.set round-trips disabledProviders", async () => {
  const restore = isolateAgentDir();
  try {
    const out = await handleModelsRequest(
      "registry.set",
      { disabledProviders: ["openai"], modelProviderOrder: ["openai", "anthropic"] },
      ctx,
    );
    assert.deepEqual(out.settings.disabledProviders, ["openai"]);
    const read = await handleModelsRequest("registry.get", {}, ctx);
    assert.deepEqual(read.settings.disabledProviders, ["openai"]);
    assert.deepEqual(read.settings.modelProviderOrder, ["openai", "anthropic"]);
  } finally {
    restore();
  }
});

test("providers.validate accepts a minimal config and rejects garbage", async () => {
  const ok = await handleModelsRequest(
    "providers.validate",
    {
      config: {
        providers: {
          demo: {
            baseUrl: "https://api.example.com/v1",
            api: "openai-completions",
            apiKey: "k",
            models: [{ id: "m1", api: "openai-completions" }],
          },
        },
      },
    },
    ctx,
  );
  assert.deepEqual(ok, { ok: true });
  await throwsCode(
    () => handleModelsRequest("providers.validate", { config: { providers: { bad: { baseUrl: "nope" } } } }, ctx),
    "models_config_invalid",
  );
});

test("providers.update round-trips write-only apiKey through redacted readback", async () => {
  const restore = isolateAgentDir();
  try {
    const written = await handleModelsRequest(
      "providers.update",
      {
        mode: "partial",
        config: {
          providers: {
            demo: {
              baseUrl: "https://api.example.com/v1",
              api: "openai-completions",
              apiKey: "secret-123",
              models: [{ id: "m1", api: "openai-completions", name: "M1" }],
            },
          },
        },
      },
      ctx,
    );
    assert.equal(written.success, true);
    const read = await handleModelsRequest("providers.get", {}, ctx);
    const provider = read.providers.demo;
    assert.equal(provider.baseUrl, "https://api.example.com/v1");
    // Redacted readback: flags only, never the value.
    assert.equal(provider.apiKeyConfigured, true);
    assert.equal("apiKey" in provider, false);
    // Omitted secret preserves the stored value: update another field without apiKey.
    await handleModelsRequest(
      "providers.update",
      { mode: "partial", config: { providers: { demo: { baseUrl: "https://api2.example.com/v1" } } } },
      ctx,
    );
    const reread = await handleModelsRequest("providers.get", {}, ctx);
    assert.equal(reread.providers.demo.apiKeyConfigured, true);
    assert.equal(reread.providers.demo.baseUrl, "https://api2.example.com/v1");
    // Null explicitly clears. Clearing the only credential on a provider
    // that still defines custom models is rejected by validation (same as
    // desktop): the error carries field rules, never the secret value.
    const clearErr = await (async () => {
      try {
        await handleModelsRequest(
          "providers.update",
          { mode: "partial", config: { providers: { demo: { apiKey: null } } } },
          ctx,
        );
      } catch (error) {
        return error;
      }
      return null;
    })();
    assert.ok(clearErr && clearErr.code === "models_config_invalid");
    assert.ok(!JSON.stringify(clearErr.details ?? {}).includes("secret-123"));
    // Clearing alongside the model list succeeds.
    await handleModelsRequest(
      "providers.update",
      { mode: "partial", config: { providers: { demo: { apiKey: null, models: [] } } } },
      ctx,
    );
    const cleared = await handleModelsRequest("providers.get", {}, ctx);
    assert.equal(cleared.providers.demo.apiKeyConfigured, false);
  } finally {
    restore();
  }
});

test("providers.update rejects oversize mode values", async () => {
  await throwsCode(
    () => handleModelsRequest("providers.update", { config: {}, mode: "bogus" }, ctx),
    "invalid_args",
  );
});

test("providers.get reports unparseable models.yml without leaking source", async () => {
  const restore = isolateAgentDir();
  try {
    const agentDir = process.env.PI_CODING_AGENT_DIR;
    writeFileSync(join(agentDir, "models.yml"), "providers: [sk-ant-secret-value\n", "utf8");
    const read = await handleModelsRequest("providers.get", {}, ctx);
    assert.equal(read.code, "models_config_unparseable");
    assert.deepEqual(read.providers, {});
    assert.ok(!JSON.stringify(read).includes("sk-ant-secret-value"));
  } finally {
    restore();
  }
});

test("fallback.set validates selectors and round-trips", async () => {
  const restore = isolateAgentDir();
  try {
    await throwsCode(() => handleModelsRequest("fallback.set", {}, ctx), "invalid_args");
    await throwsCode(
      () => handleModelsRequest("fallback.set", { chains: { default: [""] } }, ctx),
      "invalid_args",
    );
    await throwsCode(
      () => handleModelsRequest("fallback.set", { maxRetries: 99 }, ctx),
      "invalid_args",
    );
    const out = await handleModelsRequest(
      "fallback.set",
      {
        chains: { default: ["openai/gpt-5", "anthropic/claude"] },
        enabled: true,
        maxRetries: 5,
        modelFallback: true,
        revertPolicy: "never",
      },
      ctx,
    );
    assert.deepEqual(out.retry.chains, { default: ["openai/gpt-5", "anthropic/claude"] });
    assert.equal(out.retry.maxRetries, 5);
    const read = await handleModelsRequest("fallback.get", {}, ctx);
    assert.deepEqual(read.chains, { default: ["openai/gpt-5", "anthropic/claude"] });
  } finally {
    restore();
  }
});

test("server-disabled auth operations return honest 501 codes", async () => {
  const setErr = await throwsCode(
    () => handleModelsRequest("auth.apikey.set", { provider: "openai" }, ctx),
    "api_key_store_unsupported",
  );
  assert.match(setErr.message, /cannot manage stored api keys/i);
  await throwsCode(
    () => handleModelsRequest("auth.apikey.remove", { provider: "openai" }, ctx),
    "api_key_remove_unsupported",
  );
  const logoutErr = await throwsCode(
    () => handleModelsRequest("auth.logout", { provider: "openai" }, ctx),
    "logout_unsupported",
  );
  assert.match(logoutErr.message, /\/logout/);
});

test("login confirm requires a live pending login", async () => {
  await cancelAllModelLogins();
  // No pending entries exist here, so any confirm is rejected before the
  // write-only code is ever inspected.
  const err = await throwsCode(
    () => handleModelsRequest("auth.login.confirm", { provider: "openai", token: "missing", code: "  " }, ctx),
    "login_no_pending",
  );
  assert.ok(!String(err.message).includes("  "));
});

test("login tokens are bound to the starting device", async () => {
  await cancelAllModelLogins();
  // Without an omp binary the start fails before a token is minted; with one
  // it spawns a real child. Either way the ownership contract is verified by
  // direct registry inspection below only when a token is issued.
  let started;
  try {
    started = await handleModelsRequest("auth.login.start", { provider: "openai" }, ctx);
  } catch (error) {
    assert.equal(error.code, "auth_failed");
    return;
  }
  try {
    await throwsCode(
      () => handleModelsRequest("auth.login.poll", { provider: "openai", token: started.token }, otherCtx),
      "login_device_mismatch",
    );
    await throwsCode(
      () => handleModelsRequest(
        "auth.login.confirm",
        { provider: "openai", token: started.token, code: "code-123" },
        otherCtx,
      ),
      "login_device_mismatch",
    );
    const cancelled = await cancelModelLoginsForDevice(ctx.deviceId);
    assert.equal(cancelled, 1);
    await throwsCode(
      () => handleModelsRequest("auth.login.poll", { provider: "openai", token: started.token }, ctx),
      "login_no_pending",
    );
  } finally {
    await cancelAllModelLogins();
  }
});

test("provider id validation rejects whitespace", async () => {
  await throwsCode(() => handleModelsRequest("providers.enable", { provider: "has space" }, ctx), "invalid_provider");
  await throwsCode(() => handleModelsRequest("auth.logout", { provider: "" }, ctx), "invalid_provider");
});
