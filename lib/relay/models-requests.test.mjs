import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

test("connectivity requires confirmation and active device authorization before dispatch", async (t) => {
  const connectivity = await jiti.import("../omp/model-connectivity.ts");
  const dispatch = t.mock.method(connectivity, "verifyModelConnectivity", async () => {
    throw new Error("unexpected provider dispatch");
  });
  const candidate = { confirm: true, providerName: "probe", provider: { api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", auth: "none" }, model: { id: "exact" } };
  await throwsCode(() => handleModelsRequest("providers.connectivity", candidate, ctx), "unauthorized");
  let authorizations = 0;
  const active = { ...ctx, assertActive() { authorizations++; } };
  await throwsCode(() => handleModelsRequest("providers.connectivity", { ...candidate, confirm: false }, active), "connectivity_confirmation_required");
  assert.equal(authorizations, 0);
  await throwsCode(() => handleModelsRequest("providers.connectivity", { ...candidate, padding: "x".repeat(512 * 1024) }, active), "config_too_large");
  assert.equal(dispatch.mock.callCount(), 0);
});

test("unknown models action fails with a coded rejection", async () => {
  await throwsCode(() => handleModelsRequest("nope", {}, ctx), "unknown_action");
  await throwsCode(() => handleModelsRequest("", {}, ctx), "unknown_action");
});

test("catalog.search matches web results and shares refresh, TTL, and stale fallback", async (t) => {
  const { GET } = await jiti.import("../../app/api/models-config/catalog/route.ts");
  const previousCache = globalThis.__ompguiModelsDevCatalogCache;
  delete globalThis.__ompguiModelsDevCatalogCache;
  t.after(() => { globalThis.__ompguiModelsDevCatalogCache = previousCache; });
  let now = 1_000;
  t.mock.method(Date, "now", () => now);
  t.mock.method(AbortSignal, "timeout", () => new AbortController().signal);
  const response = Promise.withResolvers();
  const fetchMock = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://models.dev/api.json");
    assert.deepEqual(options.headers, { Accept: "application/json" });
    return response.promise;
  });
  const args = { query: "model-a", provider: "acme", baseUrl: "http://127.0.0.1/private?secret=never-fetch", limit: 1 };
  const nativePending = handleModelsRequest("catalog.search", args, ctx);
  const webPending = GET(new Request(`http://localhost/api/models-config/catalog?${new URLSearchParams({ q: args.query, provider: args.provider, baseUrl: args.baseUrl, limit: "1" })}`));
  const fixture = {
    acme: { name: "Acme", models: {
      "model-a": { name: "Model A", reasoning: true, modalities: { input: ["text", "image"] }, limit: { context: 128000, output: 8192 }, cost: { input: 2, output: 6, cache_read: 0.5, cache_write: 3 } },
      "model-a-extra": { name: "Model A Extra" },
    } },
  };
  response.resolve(new Response(JSON.stringify(fixture)));
  const native = await nativePending;
  assert.deepEqual(await (await webPending).json(), native);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.deepEqual(native.models.map((model) => model.id), ["model-a"]);
  assert.deepEqual(native.models[0].input, ["text", "image"]);
  assert.equal(native.models[0].reasoning, true);
  assert.equal(native.models[0].contextWindow, 128000);
  assert.equal(native.models[0].maxTokens, 8192);
  assert.deepEqual(native.recommendation.preset.cost, { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 3 });
  assert.equal(native.recommendation.price.method, "provider");
  now += 3_599_999;
  assert.deepEqual(await handleModelsRequest("catalog.search", args, ctx), native);
  assert.equal(fetchMock.mock.callCount(), 1);
  now += 1;
  fetchMock.mock.mockImplementation(async () => { throw new Error("private upstream diagnostic"); });
  assert.deepEqual(await handleModelsRequest("catalog.search", args, ctx), native);
  assert.equal(fetchMock.mock.callCount(), 2);
  fetchMock.mock.mockImplementation(async () => new Response(JSON.stringify({ acme: { models: { "model-a": { name: "Updated Model" } } } })));
  const refreshed = await handleModelsRequest("catalog.search", args, ctx);
  assert.equal(refreshed.models[0].name, "Updated Model");
  assert.equal(fetchMock.mock.callCount(), 3);
});

test("catalog.search rejects invalid bounds before fetch and safely reports cold failure", async (t) => {
  const previousCache = globalThis.__ompguiModelsDevCatalogCache;
  delete globalThis.__ompguiModelsDevCatalogCache;
  t.after(() => { globalThis.__ompguiModelsDevCatalogCache = previousCache; });
  t.mock.method(AbortSignal, "timeout", () => new AbortController().signal);
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("secret-token upstream failure"); });
  for (const args of [{}, { query: 1 }, { query: "x".repeat(121) }, { query: "", provider: "x".repeat(121) }, { query: "", baseUrl: "x".repeat(501) }, { query: "", limit: 0 }, { query: "", limit: 101 }, { query: "", limit: 1.5 }, { query: "", limit: "50" }]) {
    await throwsCode(() => handleModelsRequest("catalog.search", args, ctx), "invalid_args");
  }
  assert.equal(fetchMock.mock.callCount(), 0);
  const error = await throwsCode(() => handleModelsRequest("catalog.search", { query: "" }, ctx), "catalog_unavailable");
  assert.equal(error.status, 502);
  assert.doesNotMatch(error.message, /secret-token/);
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


test("configuration verification shares validation and isolates each transport until registry disposal", async (t) => {
  const utility = jiti("../omp/rpc-utility.ts");
  const { POST } = await jiti.import("../../app/api/models-config/test/route.ts");
  const candidate = { providerName: "acme", provider: { baseUrl: "https://example.invalid/v1", api: "openai-completions", apiKey: "candidate-only" }, model: { id: "model-a", name: "Model A" } };
  const temporaryDirs = [];
  let resolveRegistry;
  const entered = [];
  const commandMock = t.mock.method(utility, "runIsolatedUtilityCommand", async (command, options) => {
    // This operation must never send a prompt, completion, or shared-state command.
    assert.deepEqual(command, { type: "get_available_models" });
    const dir = options.env.PI_CODING_AGENT_DIR;
    temporaryDirs.push(dir);
    assert.deepEqual(options.env, { PI_CODING_AGENT_DIR: dir, OMP_PROFILE: "", PI_PROFILE: "", XDG_DATA_HOME: "" });
    assert.deepEqual(readdirSync(dir), ["models.yml"]);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    assert.equal(statSync(join(dir, "models.yml")).mode & 0o777, 0o600);
    const yaml = readFileSync(join(dir, "models.yml"), "utf8");
    assert.match(yaml, /candidate-only/);
    const gate = Promise.withResolvers();
    resolveRegistry = gate.resolve;
    entered.shift().resolve();
    return gate.promise;
  });
  t.after(() => temporaryDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
  const post = (body) => POST(new Request("http://localhost/api/models-config/test", { method: "POST", body: JSON.stringify(body) }));
  const invalid = { ...candidate, provider: { ...candidate.provider, baseUrl: "not-a-url" } };
  await throwsCode(() => handleModelsRequest("providers.test", invalid, ctx), "models_config_invalid");
  const invalidWeb = await post(invalid);
  assert.equal(invalidWeb.status, 200);
  assert.equal((await invalidWeb.json()).ok, false);
  assert.equal(commandMock.mock.callCount(), 0);

  for (const transport of ["relay", "rest"]) {
    for (const resolved of [true, false]) {
      const started = Promise.withResolvers();
      entered.push(started);
      const pending = transport === "relay" ? handleModelsRequest("providers.test", candidate, ctx) : post(candidate);
      const observed = pending.then((value) => ({ value }), (error) => ({ error }));
      await Promise.race([started.promise, observed.then((outcome) => {
        assert.fail(`verification finished before registry discovery: ${outcome.error?.message ?? "unexpected response"}`);
      })]);
      const dir = temporaryDirs.at(-1);
      assert.equal(existsSync(dir), true, "candidate remains available until isolated command/disposal completes");
      resolveRegistry({ models: resolved ? [{ provider: "acme", id: "model-a" }] : [{ provider: "other", id: "model-a" }] });
      const outcome = await observed;
      assert.equal(existsSync(dir), false);
      if (transport === "relay" && !resolved) {
        assert.equal(outcome.error.code, "model_test_unresolved");
        assert.equal(typeof outcome.error.details.latencyMs, "number");
      } else {
        const result = transport === "rest" ? await outcome.value.json() : outcome.value;
        assert.equal(result.ok, resolved);
        assert.equal(typeof result.latencyMs, "number");
        if (resolved) assert.match(result.responseText, /configuration only/);
        else assert.equal(result.code, "model_test_unresolved");
      }
    }
  }
  assert.equal(new Set(temporaryDirs).size, 4);

  commandMock.mock.mockImplementation(async (_command, options) => {
    temporaryDirs.push(options.env.PI_CODING_AGENT_DIR);
    throw new Error("private-provider-credential");
  });
  const failed = await throwsCode(() => handleModelsRequest("providers.test", candidate, ctx), "model_test_failed");
  assert.doesNotMatch(failed.message, /private-provider-credential/);
  assert.equal(existsSync(temporaryDirs.at(-1)), false);
  const failedWeb = await post(candidate);
  assert.equal(failedWeb.status, 500);
  assert.doesNotMatch(JSON.stringify(await failedWeb.json()), /private-provider-credential/);
  assert.equal(existsSync(temporaryDirs.at(-1)), false);
});
