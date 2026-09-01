import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { mergeClientNativeSettings, shouldApplyRemoteSettings } = await jiti.import("./native-settings-client.ts");

test("same-section patches merge against latest state and keep sibling keys", () => {
  const afterEnabled = mergeClientNativeSettings(
    { retry: { enabled: true, maxRetries: 10 } },
    { retry: { enabled: false } },
  );
  const afterRetries = mergeClientNativeSettings(afterEnabled, { retry: { maxRetries: 3 } });
  assert.deepEqual(afterRetries.retry, { enabled: false, maxRetries: 3 });
});

test("tools.approval patches keep sibling approval keys", () => {
  const next = mergeClientNativeSettings(
    { tools: { approvalMode: "write", approval: { bash: "prompt" } } },
    { tools: { approval: { extension: "allow" } } },
  );
  assert.deepEqual(next.tools, {
    approvalMode: "write",
    approval: { bash: "prompt", extension: "allow" },
  });
});

test("stale initial or save responses are fenced after a newer mutation or unmount", () => {
  assert.equal(shouldApplyRemoteSettings({
    mounted: true,
    requestGeneration: 0,
    latestGeneration: 0,
  }), true);
  assert.equal(shouldApplyRemoteSettings({
    mounted: true,
    requestGeneration: 1,
    latestGeneration: 2,
  }), false);
  assert.equal(shouldApplyRemoteSettings({
    mounted: false,
    requestGeneration: 2,
    latestGeneration: 2,
  }), false);
});
