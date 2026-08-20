import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  validateAgentIdentifier,
  discoverAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  unpackBundledAgents,
} = await jiti.import("./agents-service.ts");

test("validateAgentIdentifier validates kebab-case identifiers strictly", () => {
  assert.equal(validateAgentIdentifier("scout"), true);
  assert.equal(validateAgentIdentifier("security-reviewer"), true);
  assert.equal(validateAgentIdentifier("my-custom-agent-123"), true);

  assert.equal(validateAgentIdentifier(""), false);
  assert.equal(validateAgentIdentifier("Scout"), false);
  assert.equal(validateAgentIdentifier("scout/traversal"), false);
  assert.equal(validateAgentIdentifier("../scout"), false);
  assert.equal(validateAgentIdentifier("scout.md"), false);
  assert.equal(validateAgentIdentifier("scout_agent"), false);
  assert.equal(validateAgentIdentifier("scout "), false);
});

test("discoverAgents discovers bundled agents by default", async () => {
  const result = await discoverAgents(process.cwd());
  assert.ok(Array.isArray(result.agents));
  assert.ok(result.agents.length >= 7);

  const taskAgent = result.agents.find((a) => a.name === "task");
  assert.ok(taskAgent);
  assert.equal(taskAgent.source, "bundled");
  assert.equal(taskAgent.model, "@task");

  const scoutAgent = result.agents.find((a) => a.name === "scout");
  assert.ok(scoutAgent);
  assert.equal(scoutAgent.source, "bundled");
  assert.equal(scoutAgent.model, "@smol");

  const reviewerAgent = result.agents.find((a) => a.name === "reviewer");
  assert.equal(reviewerAgent?.model, "@slow");

  const designerAgent = result.agents.find((a) => a.name === "designer");
  assert.equal(designerAgent?.model, "@designer");
});

test("createAgent, updateAgent, and deleteAgent lifecycle in user directory", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-agent-service-test-"));
  const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = tmpDir;

  try {
    // 1. Create custom user agent
    const createdPath = await createAgent({
      scope: "user",
      name: "test-helper",
      description: "A test helper agent",
      tools: ["read", "grep"],
      model: "gpt-5.6-luna",
      prewalk: true,
      advisor: false,
      systemPrompt: "You are a test helper agent.",
    });

    assert.ok(createdPath.endsWith("test-helper.md"));
    const content = await fs.readFile(createdPath, "utf8");
    assert.ok(content.includes("test-helper"));
    assert.ok(content.includes("You are a test helper agent."));

    // 2. Discover agents should now include test-helper as user scope
    const discovered = await discoverAgents(tmpDir);
    const userAgent = discovered.agents.find((a) => a.name === "test-helper");
    assert.ok(userAgent);
    assert.equal(userAgent.source, "user");
    assert.equal(userAgent.description, "A test helper agent");

    // 3. Update agent
    await updateAgent({
      scope: "user",
      name: "test-helper",
      description: "Updated description",
      systemPrompt: "Updated prompt instructions.",
    });

    const updatedDiscovered = await discoverAgents(tmpDir);
    const updatedAgent = updatedDiscovered.agents.find((a) => a.name === "test-helper");
    assert.ok(updatedAgent);
    assert.equal(updatedAgent.description, "Updated description");
    assert.equal(updatedAgent.systemPrompt, "Updated prompt instructions.");

    // 4. Delete agent
    await deleteAgent({
      scope: "user",
      name: "test-helper",
    });

    const postDelete = await discoverAgents(tmpDir);
    assert.equal(postDelete.agents.some((a) => a.name === "test-helper"), false);
  } finally {
    if (prevAgentDir !== undefined) {
      process.env.PI_CODING_AGENT_DIR = prevAgentDir;
    } else {
      delete process.env.PI_CODING_AGENT_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("unpackBundledAgents unpacks markdown definitions", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-unpack-test-"));
  const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = tmpDir;

  try {
    const res = await unpackBundledAgents({
      scope: "user",
      force: true,
    });

    assert.ok(res.targetDir);
    const files = await fs.readdir(res.targetDir);
    assert.ok(files.includes("task.md"));
    assert.ok(files.includes("scout.md"));
    assert.ok(files.includes("reviewer.md"));
  } finally {
    if (prevAgentDir !== undefined) {
      process.env.PI_CODING_AGENT_DIR = prevAgentDir;
    } else {
      delete process.env.PI_CODING_AGENT_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("discoverAgents applies native settings overrides for models, prewalk, advisor, and disabled state", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-agent-overrides-test-"));
  const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = tmpDir;

  try {
    const configYml = `
task:
  agentModelOverrides:
    scout: openai/gpt-5-mini
    reviewer:
      - anthropic/claude-3-7-sonnet
      - openai/gpt-5
  agentPrewalk:
    scout: true
  agentAdvisor:
    reviewer: true
  disabledAgents:
    - designer
`;
    await fs.writeFile(path.join(tmpDir, "config.yml"), configYml, "utf8");

    const discovered = await discoverAgents(tmpDir);
    const scout = discovered.agents.find((a) => a.name === "scout");
    assert.equal(scout?.overrideModel, "openai/gpt-5-mini");
    assert.equal(scout?.prewalkOverride, true);

    const reviewer = discovered.agents.find((a) => a.name === "reviewer");
    assert.deepEqual(reviewer?.overrideModel, ["anthropic/claude-3-7-sonnet", "openai/gpt-5"]);
    assert.equal(reviewer?.advisorOverride, true);

    const designer = discovered.agents.find((a) => a.name === "designer");
    assert.equal(designer?.disabled, true);
  } finally {
    if (prevAgentDir !== undefined) {
      process.env.PI_CODING_AGENT_DIR = prevAgentDir;
    } else {
      delete process.env.PI_CODING_AGENT_DIR;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
