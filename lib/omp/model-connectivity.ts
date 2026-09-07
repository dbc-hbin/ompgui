import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ModelVerificationError, validateModelVerificationCandidate, writePrivateModelCandidate } from "./model-verification";
import { RpcProcess, type RpcFrame, type RpcProcessOptions } from "./rpc-process";
import { createModelProbeDispatch, resolveModelProbeEndpoint } from "./model-probe-dispatch";

export interface ModelConnectivityResult {
  ok: true;
  latencyMs: number;
  responseText: string;
  usage?: { input?: number; output?: number; totalTokens?: number };
}

export interface ModelConnectivityOptions {
  assertActive?: () => void;
  signal?: AbortSignal;
  /** Native boundary injection for deterministic tests; never exposed by transports. */
  createProcess?: (options: RpcProcessOptions) => Pick<RpcProcess, "waitReady" | "negotiateProtocol" | "sendCommand" | "dispose">;
  timeoutMs?: number;
}

// Only these native HTTP adapters have audited, replaceable base-URL routing.
// Other APIs require a separately audited transport; configuration checks remain
// available for them, but must not be presented as credential verification.
const PROBE_APIS = new Set(["openai-completions", "openai-responses", "anthropic-messages"]);
// Native model-registry/provider descriptors allow unauthenticated discovery for
// these identities. Disable them before startup to prevent requests outside the
// completion gate. A custom identity using an audited API can still be tested.
const DISABLED_PROBE_PROVIDERS = ["ollama", "llama.cpp", "lm-studio", "google-vertex", "zenmux", "vllm"];
// Native openai-shared routing derives endpoints from environment/credential
// metadata for these identities instead of reliably honoring candidate baseUrl.
// ollama-cloud is also excluded: model-registry forces omitMaxOutputTokens=true.
const UNSAFE_PROBE_PROVIDERS = new Set(["moonshot", "sakana", "github-copilot", "alibaba-token-plan", "alibaba-coding-plan", "ollama-cloud"]);
const PROBE_SETTINGS = {
  disabledProviders: DISABLED_PROBE_PROVIDERS,
  retry: { enabled: false, maxRetries: 0, modelFallback: false, usageAwareFallback: false, fallbackChains: {} },
  advisor: { enabled: false },
  autolearn: { enabled: false, autoContinue: false },
  memory: { backend: "off" },
  memories: { enabled: false },
  compaction: { enabled: false, autoContinue: false },
  ttsr: { enabled: false },
  features: { unexpectedStopDetection: false },
  providers: { anthropic: { serverSideFallback: false } },
};

/** A single, explicitly approved completion using only the submitted credentials.
 * The loopback dispatch gate prevents native adapter retries from reaching the provider.
 */
export async function verifyModelConnectivity(input: unknown, options: ModelConnectivityOptions = {}): Promise<ModelConnectivityResult> {
  if (typeof input !== "object" || input === null || !("confirm" in input) || input.confirm !== true) {
    throw new ModelVerificationError("connectivity_confirmation_required", "Confirm the provider and model connection test and possible charges first");
  }
  options.assertActive?.();
  const validated = validateModelVerificationCandidate(input);
  const { providerName, modelId } = validated;
  // Detach nested headers/compatibility objects before the first async boundary:
  // later caller edits must not alter the candidate whose probe was approved.
  const candidate = structuredClone(validated.candidate);
  const provider = candidate.providers![providerName];
  const model = provider.models![0];
  const api = model.api ?? provider.api;
  if (typeof api !== "string" || !PROBE_APIS.has(api) || DISABLED_PROBE_PROVIDERS.includes(providerName) || UNSAFE_PROBE_PROVIDERS.has(providerName)) {
    throw new ModelVerificationError("connectivity_unsupported", "Live checks support OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages APIs with isolated endpoint routing. This API or native provider identity is not supported; configuration checks remain available.");
  }
  const secrets = [provider.apiKey, ...Object.values(provider.headers ?? {}), ...Object.values(model.headers ?? {})].filter((value): value is string => typeof value === "string" && value.length > 0);
  if (provider.auth === "oauth" || secrets.some((value) => value.startsWith("!") || /^[A-Z_][A-Z0-9_]*$/.test(value))) {
    throw new ModelVerificationError("connectivity_credential_method_unsupported", "Supply literal candidate credentials; saved authentication, environment references, and credential commands are not used");
  }
  const endpoint = resolveModelProbeEndpoint(model.baseUrl ?? provider.baseUrl!, api, modelId);
  const targetBaseUrl = endpoint.href;
  // Custom endpoints may carry credentials in their approved query parameters.
  for (const value of endpoint.searchParams.values()) if (value) secrets.push(value);
  for (const value of [endpoint.username, endpoint.password]) {
    if (value) {
      secrets.push(value);
      try { secrets.push(decodeURIComponent(value)); } catch {}
    }
  }
  const upstreamHeaders: Record<string, string> = {};
  if (provider.apiKey) {
    if (api === "anthropic-messages" && provider.apiKey.includes("sk-ant-oat")) {
      throw new ModelVerificationError("connectivity_credential_method_unsupported", "OAuth credentials cannot be safely tested in this isolated probe");
    }
    const header = api === "anthropic-messages" ? "x-api-key" : "authorization";
    upstreamHeaders[header] = api === "anthropic-messages" ? provider.apiKey : `Bearer ${provider.apiKey}`;
    for (const [name, value] of Object.entries({ ...provider.headers, ...model.headers })) {
      if (name.toLowerCase() === header) upstreamHeaders[header] = value;
    }
  }
  const startedAt = Date.now();
  const controller = new AbortController();
  const completed = Promise.withResolvers<ModelConnectivityResult>();
  // A process may fail while preparation is still awaiting readiness.
  void completed.promise.catch(() => {});
  let directory: string | undefined;
  let child: Pick<RpcProcess, "waitReady" | "negotiateProtocol" | "sendCommand" | "dispose"> | undefined;
  let dispatch: { baseUrl: string; close: () => Promise<void> } | undefined;
  let runTask: Promise<ModelConnectivityResult> | undefined;
  let assistant: Record<string, unknown> | undefined;
  let prompted = false;
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 30_000, 1), 30_000);
  const fail = (code: "connectivity_failed" | "connectivity_timeout" | "connectivity_cancelled" | "connectivity_model_mismatch" | "connectivity_auth_required", message: string) => {
    completed.reject(new ModelVerificationError(code, message, Date.now() - startedAt));
    controller.abort();
  };
  const abort = () => fail("connectivity_cancelled", "Model connection test cancelled");
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => fail("connectivity_timeout", "Model connection test timed out"), timeoutMs);
  const onFrame = (frame: RpcFrame) => {
    if (!prompted) return;
    if (frame.type === "message_end" && typeof frame.message === "object" && frame.message !== null && "role" in frame.message && frame.message.role === "assistant") {
      assistant = frame.message as Record<string, unknown>;
      if (assistant.provider !== providerName || assistant.model !== modelId) {
        fail("connectivity_model_mismatch", "The selected provider and model did not produce the completion");
        return;
      }
    }
    if (frame.type !== "agent_end" || frame.isTerminal === false) return;
    if (Array.isArray(frame.messages)) {
      for (const message of frame.messages) {
        if (typeof message === "object" && message !== null && "role" in message && message.role === "assistant") {
          if (message.provider !== providerName || message.model !== modelId) {
            fail("connectivity_model_mismatch", "The selected provider and model did not produce the completion");
            return;
          }
          assistant = message;
        }
      }
    }
    if (!assistant || assistant.provider !== providerName || assistant.model !== modelId) {
      fail("connectivity_model_mismatch", "The selected provider and model did not produce the completion");
      return;
    }
    if (assistant.stopReason !== "stop" && assistant.stopReason !== "length") {
      if (assistant.errorStatus === 401 || assistant.errorStatus === 403) {
        fail("connectivity_auth_required", "The provider rejected the submitted credentials; saved authentication is not used");
        return;
      }
      fail("connectivity_failed", "The provider did not complete the connection test successfully");
      return;
    }
    let text = "";
    if (Array.isArray(assistant.content)) {
      for (const block of assistant.content) {
        if (typeof block === "object" && block !== null && block.type === "text" && typeof block.text === "string") text += block.text;
      }
    }
    if (!text.trim()) {
      fail("connectivity_failed", "The provider returned no assistant text");
      return;
    }
    for (const secret of secrets) text = text.replaceAll(secret, "[redacted]");
    const usage: NonNullable<ModelConnectivityResult["usage"]> = {};
    if (typeof assistant.usage === "object" && assistant.usage !== null) {
      for (const [key, value] of Object.entries(assistant.usage)) {
        if ((key === "input" || key === "output" || key === "totalTokens") && typeof value === "number" && Number.isFinite(value) && value >= 0) {
          usage[key] = value;
        }
      }
    }
    completed.resolve({ ok: true, latencyMs: Date.now() - startedAt, responseText: text.slice(0, 2048), ...(Object.keys(usage).length ? { usage } : {}) });
  };
  try {
    if (options.signal?.aborted) abort();
    const run = async () => {
      if (controller.signal.aborted) return completed.promise;
      dispatch = await createModelProbeDispatch(targetBaseUrl, {
        upstreamHeaders,
        expectedPath: api === "openai-completions" ? "/chat/completions" : api === "openai-responses" ? "/responses" : "/v1/messages",
        assertActive: options.assertActive,
        authorizeDispatch: () => {
          options.assertActive?.();
          if (!prompted) throw new ModelVerificationError("connectivity_failed", "The model probe is not ready to dispatch");
        },
        signal: controller.signal,
      });
      options.assertActive?.();
      if (controller.signal.aborted) return completed.promise;
      provider.baseUrl = dispatch.baseUrl;
      // Native registry discovery uses API keys even in isolated RPC sessions.
      // Keep literal credentials in the one-dispatch transport, not its registry.
      provider.auth = "none";
      delete provider.apiKey;
      for (const key of ["modelOverrides", "discovery", "transport", "remoteCompaction", "contextPromotionTarget", "compactionModel"]) delete provider[key];
      for (const key of ["remoteCompaction", "contextPromotionTarget", "compactionModel"]) delete model[key];
      model.baseUrl = dispatch.baseUrl;
      model.maxTokens = Math.max(1, Math.floor(Math.min(model.maxTokens ?? 32, 32)));
      model.reasoning = false;
      model.omitMaxOutputTokens = false;
      model.compat = { ...provider.compat, ...model.compat, alwaysSendMaxTokens: true };
      delete model.compat.extraBody;
      delete model.compat.whenThinking;
      // Provider compatibility is merged underneath the model; do not retain an
      // extraBody there that can replace the fixed prompt, cap, model, or tools.
      provider.compat = model.compat;
      directory = writePrivateModelCandidate(candidate);
      // Native startup migrates the legacy settings.json to settings.json.bak
      // before reading --config overlays; use a distinct, non-migrated filename.
      const settingsPath = join(directory, "probe-settings.json");
      writeFileSync(settingsPath, JSON.stringify(PROBE_SETTINGS), { mode: 0o600 });
      const env: Record<string, string> = {};
      for (const key of Object.keys(process.env)) env[key] = "";
      Object.assign(env, { PATH: process.env.PATH ?? "", HOME: directory, TMPDIR: directory, PI_CODING_AGENT_DIR: directory, OMP_PROFILE: "", PI_PROFILE: "", XDG_DATA_HOME: directory, XDG_CONFIG_HOME: directory });
      child = (options.createProcess ?? ((processOptions) => new RpcProcess(processOptions)))({
        cwd: directory, env,
        extraArgs: ["--no-session", "--no-tools", "--no-lsp", "--no-pty", "--no-extensions", "--no-skills", "--no-rules", "--no-title", "--no-prewalk", "--provider", providerName, "--model", modelId, "--config", settingsPath, "--system-prompt", "Reply briefly.", "--thinking", "off"],
        onFrame,
        onExit: () => fail("connectivity_failed", "Model connection process exited before completion"),
      });
      const ready = await child.waitReady(timeoutMs);
      if (controller.signal.aborted) return completed.promise;
      await child.negotiateProtocol(ready);
      if (controller.signal.aborted) return completed.promise;
      const selected = await child.sendCommand<unknown>({ type: "set_model", provider: providerName, modelId }, timeoutMs);
      if (typeof selected !== "object" || selected === null || !("provider" in selected) || selected.provider !== providerName || !("id" in selected) || selected.id !== modelId) {
        throw new ModelVerificationError("connectivity_model_mismatch", "The requested provider and model could not be selected", Date.now() - startedAt);
      }
      await child.sendCommand({ type: "set_auto_retry", enabled: false }, timeoutMs);
      await child.sendCommand({ type: "set_auto_compaction", enabled: false }, timeoutMs);
      options.assertActive?.();
      if (controller.signal.aborted) return completed.promise;
      prompted = true;
      await child.sendCommand({ type: "prompt", message: "Reply with OK." }, timeoutMs);
      return completed.promise;
    };
    runTask = run();
    const result = await Promise.race([runTask, completed.promise]);
    options.assertActive?.();
    return result;
  } catch (error) {
    if (error instanceof ModelVerificationError) throw error;
    throw new ModelVerificationError("connectivity_failed", "Model connection test failed; check the submitted endpoint and credentials", Date.now() - startedAt);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    controller.abort();
    try {
      try {
        await child?.dispose();
        await runTask?.catch(() => {});
      } finally {
        try {
          await dispatch?.close();
        } finally {
          if (directory) rmSync(directory, { recursive: true, force: true });
        }
      }
    } catch {
      throw new ModelVerificationError("connectivity_failed", "Model connection cleanup failed", Date.now() - startedAt);
    }
  }
}
