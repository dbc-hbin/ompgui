import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createJiti } from "jiti";
import { parse } from "yaml";

const jiti = createJiti(import.meta.url);
const { enableProvider, readDisabledProviders, readModelRoles, writeModelRoles } = await jiti.import("./model-roles.ts");

test("model role settings use config.yaml when config.yml is absent", async () => {
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

    await writeModelRoles({ default: "anthropic/claude-sonnet" });
    assert.equal(existsSync(join(agentDir, "config.yml")), false);
    assert.match(readFileSync(settingsPath, "utf8"), /anthropic\/claude-sonnet/);
    assert.deepEqual(readModelRoles().roles, { default: "anthropic/claude-sonnet" });

    await enableProvider("openai");
    assert.deepEqual(readDisabledProviders(), new Set());

    // Saving the string-role view must not drop fallback-chain arrays it
    // cannot see, while a cleared string role is still removed.
    writeFileSync(settingsPath, "modelRoles:\n  default: a/b\n  designer: x/d\n  reviewer:\n    - a/r1\n    - b/r2\n  scout:\n    - s/1\n", "utf8");
    await writeModelRoles({ default: "a/c", scout: "s/2" });
    const saved = parse(readFileSync(settingsPath, "utf8")).modelRoles;
    assert.deepEqual(saved, { reviewer: ["a/r1", "b/r2"], default: "a/c", scout: "s/2" });
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
