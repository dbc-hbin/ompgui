import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { enableProvider, readDisabledProviders, readModelRoles, writeModelRoles } = await jiti.import("./model-roles.ts");

test("model role settings use config.yaml when config.yml is absent", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "ompgui-model-roles-"));
  const settingsPath = join(agentDir, "config.yaml");
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousOmpProfile = process.env.OMP_PROFILE;
  const previousPiProfile = process.env.PI_PROFILE;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  delete process.env.OMP_PROFILE;
  delete process.env.PI_PROFILE;

  try {
    writeFileSync(settingsPath, "modelRoles:\n  default: openai/gpt-5\ndisabledProviders:\n  - openai\n", "utf8");

    assert.deepEqual(readModelRoles(), {
      path: settingsPath,
      roles: { default: "openai/gpt-5" },
    });
    assert.deepEqual(readDisabledProviders(), new Set(["openai"]));

    writeModelRoles({ default: "anthropic/claude-sonnet" });
    assert.equal(existsSync(join(agentDir, "config.yml")), false);
    assert.match(readFileSync(settingsPath, "utf8"), /anthropic\/claude-sonnet/);
    assert.deepEqual(readModelRoles().roles, { default: "anthropic/claude-sonnet" });

    enableProvider("openai");
    assert.deepEqual(readDisabledProviders(), new Set());
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousOmpProfile === undefined) delete process.env.OMP_PROFILE;
    else process.env.OMP_PROFILE = previousOmpProfile;
    if (previousPiProfile === undefined) delete process.env.PI_PROFILE;
    else process.env.PI_PROFILE = previousPiProfile;
    rmSync(agentDir, { recursive: true, force: true });
  }
});
