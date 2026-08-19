import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  agentModelOptionsFromResponse,
  parseAgentModelOverrideInput,
  formatAgentModelDisplay,
} = await jiti.import("../lib/agent-model-options.ts");

test("agent model overrides use provider-qualified selectors from modelList", () => {
  const options = agentModelOptionsFromResponse({
    models: { "provider-a:shared": "Shared A" },
    modelList: [
      { provider: "provider-a", id: "shared", name: "Shared A" },
      { provider: "provider-b", id: "shared", name: "Shared B" },
      { provider: "provider-a", id: "shared", name: "duplicate" },
      { provider: "provider-c", id: "nested/model", name: "Nested" },
    ],
  });

  assert.deepEqual(options, [
    { selector: "provider-a/shared", label: "Shared A · provider-a" },
    { selector: "provider-b/shared", label: "Shared B · provider-b" },
    { selector: "provider-c/nested/model", label: "Nested · provider-c" },
  ]);
});

test("agentModelOptionsFromResponse falls back to models dictionary if modelList is empty", () => {
  const options = agentModelOptionsFromResponse({
    models: {
      "openai:gpt-5": "GPT-5",
      "anthropic:claude-3-7-sonnet": "Claude 3.7 Sonnet",
    },
    modelList: [],
  });

  assert.deepEqual(options, [
    { selector: "openai/gpt-5", label: "GPT-5 · openai" },
    { selector: "anthropic/claude-3-7-sonnet", label: "Claude 3.7 Sonnet · anthropic" },
  ]);
});

test("agentModelOptionsFromResponse returns empty array for missing or invalid payload", () => {
  assert.deepEqual(agentModelOptionsFromResponse(null), []);
  assert.deepEqual(agentModelOptionsFromResponse(undefined), []);
  assert.deepEqual(agentModelOptionsFromResponse({}), []);
});

test("parseAgentModelOverrideInput parses single and fallback chains", () => {
  assert.equal(parseAgentModelOverrideInput(""), undefined);
  assert.equal(parseAgentModelOverrideInput("   "), undefined);
  assert.equal(parseAgentModelOverrideInput(undefined), undefined);
  assert.equal(parseAgentModelOverrideInput("openai/gpt-5"), "openai/gpt-5");
  assert.equal(parseAgentModelOverrideInput("  anthropic/claude-3-7-sonnet  "), "anthropic/claude-3-7-sonnet");
  assert.deepEqual(
    parseAgentModelOverrideInput("openai/gpt-5, anthropic/claude-3-7-sonnet"),
    ["openai/gpt-5", "anthropic/claude-3-7-sonnet"]
  );
  assert.equal(parseAgentModelOverrideInput("openai/gpt-5,"), "openai/gpt-5");
});

test("formatAgentModelDisplay formats strings and arrays cleanly", () => {
  assert.equal(formatAgentModelDisplay(undefined), "");
  assert.equal(formatAgentModelDisplay(""), "");
  assert.equal(formatAgentModelDisplay("openai/gpt-5"), "openai/gpt-5");
  assert.equal(
    formatAgentModelDisplay(["openai/gpt-5", "anthropic/claude-3-7-sonnet"]),
    "openai/gpt-5, anthropic/claude-3-7-sonnet"
  );
});
