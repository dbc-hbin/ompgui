import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { verifyModelConnectivity } = await jiti.import("./model-connectivity.ts");

function candidate() {
  return { confirm: true, providerName: "probe", provider: { api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", auth: "none" }, model: { id: "exact" } };
}

function fakeProcess(overrides = {}) {
  const created = Promise.withResolvers();
  const prompted = Promise.withResolvers();
  const disposing = Promise.withResolvers();
  const commands = [];
  let options;
  let disposed = false;
  return {
    created, prompted, disposing, commands,
    get directory() { return options?.cwd; },
    get disposed() { return disposed; },
    emit(frame) { options.onFrame(frame); },
    createProcess(processOptions) {
      options = processOptions;
      created.resolve();
      return {
        async waitReady() { return { type: "ready", supportedProtocolVersions: [1, 2] }; },
        async negotiateProtocol() { return 2; },
        async sendCommand(command) {
          commands.push(command);
          if (overrides.command) return overrides.command(command);
          if (command.type === "set_model") return { provider: "probe", id: "exact" };
          if (command.type === "prompt") prompted.resolve();
        },
        async dispose() {
          disposing.resolve();
          if (overrides.dispose) await overrides.dispose();
          disposed = true;
        },
      };
    },
  };
}

function assistant(overrides = {}) {
  return { role: "assistant", provider: "probe", model: "exact", stopReason: "stop", content: [{ type: "text", text: "OK" }], ...overrides };
}

function finish(fake, message = assistant()) {
  fake.emit({ type: "message_end", message });
  fake.emit({ type: "agent_end", isTerminal: true, messages: [] });
}

test("explicit confirmation is required before process creation", async () => {
  let creations = 0;
  for (const confirm of [undefined, false, "true"]) {
    await assert.rejects(verifyModelConnectivity({ ...candidate(), confirm }, {
      createProcess() { creations++; throw new Error("must not create"); },
    }), { code: "connectivity_confirmation_required" });
  }
  assert.equal(creations, 0);
});

test("prompt acknowledgement and nonterminal events do not settle the probe", async () => {
  const fake = fakeProcess();
  let settled = false;
  const result = verifyModelConnectivity(candidate(), fake);
  void result.then(() => { settled = true; }, () => { settled = true; });
  await fake.prompted.promise;
  fake.emit({ type: "agent_end", isTerminal: false, messages: [assistant()] });
  fake.emit({ type: "message_end", message: assistant() });
  for (let index = 0; index < 12; index++) await Promise.resolve();
  assert.equal(settled, false);
  fake.emit({ type: "agent_end", isTerminal: true, messages: [] });
  const value = await result;
  assert.equal(value.ok, true);
  assert.equal(value.responseText, "OK");
  assert.equal(fake.commands.filter((command) => command.type === "prompt").length, 1);
  assert.equal(fake.disposed, true);
  assert.equal(existsSync(fake.directory), false);
});

test("caller edits after approval cannot replace headers passed to native OMP", async () => {
  const input = candidate();
  input.provider.headers = { "X-Probe-Identity": "approved-provider" };
  input.model.headers = { "X-Model-Identity": "approved-model" };
  const fake = fakeProcess();
  const result = verifyModelConnectivity(input, fake);
  input.provider.headers["X-Probe-Identity"] = "unapproved-provider";
  input.model.headers["X-Model-Identity"] = "unapproved-model";
  await fake.prompted.promise;
  const nativeCandidate = readFileSync(join(fake.directory, "models.yml"), "utf8");
  finish(fake);
  await result;
  assert.match(nativeCandidate, /approved-provider/);
  assert.match(nativeCandidate, /approved-model/);
  assert.doesNotMatch(nativeCandidate, /unapproved-provider|unapproved-model/);
});

test("the isolated native model cannot omit or exceed the probe output cap", async () => {
  const input = candidate();
  input.model.maxTokens = 8192;
  input.model.omitMaxOutputTokens = true;
  const fake = fakeProcess();
  const result = verifyModelConnectivity(input, fake);
  await fake.prompted.promise;
  const nativeCandidate = readFileSync(join(fake.directory, "models.yml"), "utf8");
  finish(fake);
  await result;
  assert.match(nativeCandidate, /maxTokens: 32/);
  assert.match(nativeCandidate, /omitMaxOutputTokens: false/);
});

test("unsupported provider routing is distinct from a provider failure", async () => {
  const input = candidate();
  input.providerName = "github-copilot";
  let creations = 0;
  await assert.rejects(verifyModelConnectivity(input, {
    createProcess() { creations++; throw new Error("must not create"); },
  }), { code: "connectivity_unsupported" });
  assert.equal(creations, 0);
});

test("indirect credentials and OAuth are rejected before process creation", async (t) => {
  const cases = [
    { apiKey: "!printf private-key" },
    { apiKey: "PROBE_API_KEY" },
    { auth: "oauth" },
    { headers: { Authorization: "!credential-helper" } },
  ];
  for (const credentials of cases) {
    await t.test(JSON.stringify(credentials), async () => {
      let creations = 0;
      const input = candidate();
      Object.assign(input.provider, credentials);
      await assert.rejects(verifyModelConnectivity(input, {
        createProcess() { creations++; throw new Error("must not create"); },
      }), { code: "connectivity_credential_method_unsupported" });
      assert.equal(creations, 0);
    });
  }
});

test("empty assistant text and failed or aborted completions reject", async (t) => {
  for (const completion of [
    { content: [{ type: "text", text: "  \n" }] },
    { stopReason: "error", errorMessage: "private-upstream-error" },
    { stopReason: "aborted" },
  ]) {
    await t.test(JSON.stringify(completion), async () => {
      const fake = fakeProcess();
      const result = verifyModelConnectivity(candidate(), fake);
      const rejection = assert.rejects(result, (error) => {
        assert.equal(error.code, "connectivity_failed");
        assert.doesNotMatch(String(error) + JSON.stringify(error), /private-upstream-error/);
        return true;
      });
      await fake.prompted.promise;
      finish(fake, assistant(completion));
      await rejection;
    });
  }
});

test("any mismatched assistant in terminal messages rejects even when followed by the selected model", async (t) => {
  for (const mismatch of [{ provider: "fallback" }, { model: "fallback" }]) {
    await t.test(JSON.stringify(mismatch), async () => {
      const fake = fakeProcess();
      const result = verifyModelConnectivity(candidate(), fake);
      const rejection = assert.rejects(result, { code: "connectivity_model_mismatch" });
      await fake.prompted.promise;
      fake.emit({ type: "agent_end", isTerminal: true, messages: [assistant(mismatch), assistant()] });
      await rejection;
    });
  }
});

test("a different selected model rejects before any prompt", async () => {
  const fake = fakeProcess({ command(command) {
    if (command.type === "set_model") return { provider: "probe", id: "fallback" };
  } });
  await assert.rejects(verifyModelConnectivity(candidate(), fake), { code: "connectivity_model_mismatch" });
  assert.equal(fake.commands.some((command) => command.type === "prompt"), false);
  assert.equal(fake.disposed, true);
  assert.equal(existsSync(fake.directory), false);
});

test("a completion from a fallback provider or model is rejected", async (t) => {
  for (const mismatch of [{ provider: "fallback" }, { model: "fallback" }]) {
    await t.test(JSON.stringify(mismatch), async () => {
      const fake = fakeProcess();
      const result = verifyModelConnectivity(candidate(), fake);
      const rejection = assert.rejects(result, { code: "connectivity_model_mismatch" });
      await fake.prompted.promise;
      finish(fake, assistant(mismatch));
      await rejection;
    });
  }
});

test("provider exceptions are sanitized instead of exposing credentials", async () => {
  const input = candidate();
  input.provider.apiKey = "private-api-key";
  const fake = fakeProcess({ command() { throw new Error("upstream leaked private-api-key at https://private.example/token"); } });
  await assert.rejects(verifyModelConnectivity(input, fake), (error) => {
    assert.equal(error.code, "connectivity_failed");
    assert.doesNotMatch(String(error) + JSON.stringify(error), /private-api-key|private\.example/);
    return true;
  });
});

test("echoed candidate credentials are redacted and invalid usage is excluded", async () => {
  const input = candidate();
  input.provider.apiKey = "private-api-key";
  input.provider.headers = { "X-Secret": "private-header-value" };
  input.model.headers = { "X-Model-Secret": "private-model-value" };
  const fake = fakeProcess();
  const result = verifyModelConnectivity(input, fake);
  await fake.prompted.promise;
  finish(fake, assistant({ content: [{ type: "text", text: "private-api-key private-header-value private-model-value" }], usage: { input: 7, output: -1, totalTokens: Infinity } }));
  const value = await result;
  assert.doesNotMatch(JSON.stringify(value), /private-api-key|private-header-value|private-model-value/);
  assert.equal(value.responseText, "[redacted] [redacted] [redacted]");
  assert.deepEqual(value.usage, { input: 7 });
});

test("timeout waits for disposal and removes the isolated directory", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const release = Promise.withResolvers();
  const fake = fakeProcess({ dispose: () => release.promise });
  let settled = false;
  const result = verifyModelConnectivity(candidate(), { ...fake, timeoutMs: 100 });
  void result.then(() => { settled = true; }, () => { settled = true; });
  const rejection = assert.rejects(result, { code: "connectivity_timeout" });
  await fake.prompted.promise;
  t.mock.timers.tick(100);
  await fake.disposing.promise;
  assert.equal(settled, false);
  assert.equal(existsSync(fake.directory), true);
  release.resolve();
  await rejection;
  assert.equal(fake.disposed, true);
  assert.equal(existsSync(fake.directory), false);
});

test("cancellation after preparation sends no prompt and awaits disposal before cleanup", async () => {
  const controller = new AbortController();
  const release = Promise.withResolvers();
  const fake = fakeProcess({
    command(command) {
      if (command.type === "set_model") return { provider: "probe", id: "exact" };
      if (command.type === "set_auto_compaction") controller.abort();
    },
    dispose: () => release.promise,
  });
  let settled = false;
  const result = verifyModelConnectivity(candidate(), { ...fake, signal: controller.signal });
  void result.then(() => { settled = true; }, () => { settled = true; });
  const rejection = assert.rejects(result, { code: "connectivity_cancelled" });
  await fake.disposing.promise;
  assert.equal(fake.commands.some((command) => command.type === "prompt"), false);
  assert.equal(settled, false);
  assert.equal(existsSync(fake.directory), true);
  release.resolve();
  await rejection;
  assert.equal(fake.disposed, true);
  assert.equal(existsSync(fake.directory), false);
});
