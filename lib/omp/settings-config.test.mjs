import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { filterNativeSettings, mergeNativeSettings, readNativeSettings, writeNativeSettings } = await jiti.import("./settings-config.ts");

function withAgentDir(run) {
  const dir = mkdtempSync(join(tmpdir(), "ompgui-settings-config-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    run(dir);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("uses config.yaml when the canonical config.yml is absent", () => {
  withAgentDir((dir) => {
    const fallback = join(dir, "config.yaml");
    writeFileSync(fallback, "compaction:\n  strategy: context-full\n", "utf8");
    assert.equal(readNativeSettings().path, fallback);
    assert.equal(readNativeSettings().settings.compaction.strategy, "context-full");

    writeNativeSettings({ hideThinkingBlock: true });
    assert.equal(existsSync(join(dir, "config.yml")), false);
    assert.match(readFileSync(fallback, "utf8"), /hideThinkingBlock: true/);
  });
});

test("rejects malformed native settings and accepts OMP compaction strategies", () => {
  withAgentDir(() => {
    assert.throws(() => writeNativeSettings({ mcp: { notifications: "yes" } }), /mcp.notifications must be a boolean/);
    assert.throws(() => writeNativeSettings({ compaction: { strategy: "prune" } }), /Invalid compaction strategy/);
    writeNativeSettings({ compaction: { strategy: "shake", autoContinue: true } });
    assert.equal(readNativeSettings().settings.compaction.strategy, "shake");
  });
});
test("persists and reads the externalThinking setting (v17.2.14+)", () => {
  withAgentDir(() => {
    assert.throws(() => writeNativeSettings({ externalThinking: "yes" }), /externalThinking must be a boolean/);
    writeNativeSettings({ externalThinking: true });
    assert.equal(readNativeSettings().settings.externalThinking, true);
    // Writes are incremental: an unrelated later write preserves the key.
    writeNativeSettings({ hideThinkingBlock: true });
    assert.equal(readNativeSettings().settings.externalThinking, true);
    assert.equal(readNativeSettings().settings.hideThinkingBlock, true);
  });
});
test("filters unknown submitted fields while preserving unknown YAML", () => {
  withAgentDir((dir) => {
    writeFileSync(join(dir, "config.yml"), "userSetting: keep\nadvisor:\n  enabled: true\n  userFlag: keep\n", "utf8");
    writeNativeSettings({
      hideThinkingBlock: false,
      userSetting: "replace",
      advisor: { enabled: false, userFlag: "replace" },
    });
    const source = readFileSync(join(dir, "config.yml"), "utf8");
    assert.match(source, /userSetting: keep/);
    assert.match(source, /userFlag: keep/);
    assert.doesNotMatch(source, /replace/);
    assert.equal(readNativeSettings().settings.hideThinkingBlock, false);
    assert.equal(readNativeSettings().settings.advisor.enabled, false);
  });
});

test("filters and persists the reviewed optional tools subset", () => {
  const submitted = {
    browser: { enabled: false, relay: true, headless: false, unknown: "strip" },
    computer: { enabled: true, display: "primary", unknown: "strip" },
    web_search: { enabled: false, unknown: "strip" },
    github: { enabled: true, unknown: "strip" },
    security: { enabled: true, unknown: "strip" },
    checkpoint: { enabled: true, unknown: "strip" },
    unknownSection: { enabled: true },
  };
  assert.deepEqual(filterNativeSettings(submitted), {
    browser: { enabled: false, relay: true, headless: false },
    computer: { enabled: true, display: "primary" },
    web_search: { enabled: false },
    github: { enabled: true },
    security: { enabled: true },
    checkpoint: { enabled: true },
  });
});

test("rejects malformed optional tool booleans and computer display", () => {
  withAgentDir(() => {
    const malformed = [
      [{ browser: { enabled: "yes" } }, "browser.enabled must be a boolean"],
      [{ browser: { relay: 1 } }, "browser.relay must be a boolean"],
      [{ browser: { headless: null } }, "browser.headless must be a boolean"],
      [{ computer: { enabled: "yes" } }, "computer.enabled must be a boolean"],
      [{ computer: { display: false } }, "computer.display must be a string"],
      [{ web_search: { enabled: "yes" } }, "web_search.enabled must be a boolean"],
      [{ github: { enabled: 1 } }, "github.enabled must be a boolean"],
      [{ security: { enabled: "yes" } }, "security.enabled must be a boolean"],
      [{ checkpoint: { enabled: 1 } }, "checkpoint.enabled must be a boolean"],
    ];
    for (const [settings, message] of malformed) assert.throws(() => writeNativeSettings(settings), new RegExp(message));
  });
});

test("merges optional tool patches without clobbering section siblings", () => {
  assert.deepEqual(mergeNativeSettings(
    {
      browser: { enabled: true, relay: false, headless: true },
      computer: { enabled: false, display: "all" },
      web_search: { enabled: true },
      github: { enabled: false },
      security: { enabled: false },
      checkpoint: { enabled: false },
    },
    {
      browser: { enabled: false },
      computer: { display: "primary" },
      security: { enabled: true },
    },
  ), {
    browser: { enabled: false, relay: false, headless: true },
    computer: { enabled: false, display: "primary" },
    web_search: { enabled: true },
    github: { enabled: false },
    security: { enabled: true },
    checkpoint: { enabled: false },
  });
});

test("round-trips optional tool settings while preserving unrelated YAML", () => {
  withAgentDir((dir) => {
    const path = join(dir, "config.yml");
    writeFileSync(path, [
      "# keep this comment",
      "unrelatedSetting: keep",
      "browser:",
      "  unrelated: keep-browser",
      "computer:",
      "  unrelated: keep-computer",
      "",
    ].join("\n"), "utf8");
    writeNativeSettings({
      browser: { enabled: false, relay: true, headless: false },
      computer: { enabled: true, display: "primary" },
      web_search: { enabled: false },
      github: { enabled: true },
      security: { enabled: true },
      checkpoint: { enabled: true },
    });
    assert.deepEqual(readNativeSettings().settings.browser, { enabled: false, relay: true, headless: false });
    assert.deepEqual(readNativeSettings().settings.computer, { enabled: true, display: "primary" });
    assert.deepEqual(readNativeSettings().settings.web_search, { enabled: false });
    assert.deepEqual(readNativeSettings().settings.github, { enabled: true });
    assert.deepEqual(readNativeSettings().settings.security, { enabled: true });
    assert.deepEqual(readNativeSettings().settings.checkpoint, { enabled: true });
    const source = readFileSync(path, "utf8");
    assert.match(source, /# keep this comment/);
    assert.match(source, /unrelatedSetting: keep/);
    assert.match(source, /unrelated: keep-browser/);
    assert.match(source, /unrelated: keep-computer/);
  });
});

test("merges partial sections without clobbering unrelated settings", () => {
  const merged = mergeNativeSettings(
    {
      hideThinkingBlock: true,
      tools: { approval: { bash: "deny", extension: "allow" } },
      compaction: { enabled: true, strategy: "shake" },
    },
    {
      hideThinkingBlock: false,
      tools: { approval: { bash: "prompt" } },
      compaction: { enabled: false },
    },
  );
  assert.deepEqual(merged, {
    hideThinkingBlock: false,
    tools: { approval: { bash: "prompt", extension: "allow" } },
    compaction: { enabled: false, strategy: "shake" },
  });
  assert.deepEqual(filterNativeSettings({ retry: { unknown: true } }), {});
  assert.deepEqual(mergeNativeSettings(
    { hideThinkingBlock: true, enabledModels: ["provider/model"], task: { disabledAgents: ["old-agent"] } },
    { hideThinkingBlock: false, enabledModels: [], task: { disabledAgents: [] } },
  ), {
    hideThinkingBlock: false,
    enabledModels: [],
    task: { disabledAgents: [] },
  });
});

test("persists nested partial updates without erasing sibling values", () => {
  withAgentDir(() => {
    writeNativeSettings({ tools: { approval: { bash: "deny", extension: "allow" } } });
    writeNativeSettings({ tools: { approval: { bash: "prompt" } } });
    assert.deepEqual(readNativeSettings().settings.tools.approval, { bash: "prompt", extension: "allow" });
  });
});

test("clears an explicitly empty approval map through merged writes", () => {
  withAgentDir((dir) => {
    writeFileSync(join(dir, "config.yml"), "unrelatedSetting: keep\n", "utf8");
    writeNativeSettings({
      hideThinkingBlock: true,
      tools: { approvalMode: "always-ask", approval: { bash: "allow", extension: "allow" } },
    });

    const next = mergeNativeSettings(readNativeSettings().settings, { tools: { approval: {} } });
    assert.deepEqual(next.tools, { approvalMode: "always-ask", approval: {} });
    writeNativeSettings(next);

    const settings = readNativeSettings().settings;
    assert.equal(settings.tools?.approval?.bash, undefined);
    assert.equal(settings.tools?.approval?.extension, undefined);
    assert.equal(settings.tools?.approvalMode, "always-ask");
    assert.equal(settings.hideThinkingBlock, true);
    assert.match(readFileSync(join(dir, "config.yml"), "utf8"), /unrelatedSetting: keep/);
  });
});

test("persists and validates retry settings", () => {
  withAgentDir(() => {
    writeNativeSettings({ retry: { enabled: false, maxRetries: 3, modelFallback: true } });
    const settings = readNativeSettings().settings.retry;
    assert.equal(settings?.enabled, false);
    assert.equal(settings?.maxRetries, 3);
    assert.equal(settings?.modelFallback, true);
    assert.throws(() => writeNativeSettings({ retry: { maxRetries: 99 } }), /Retry attempts must be an integer between 0 and 20/);
  });
});
test("persists and validates tool approval policies", () => {
  withAgentDir(() => {
    writeNativeSettings({ tools: { approval: { bash: "deny", extension: "allow" } } });
    const settings = readNativeSettings().settings;
    assert.equal(settings.tools.approval.bash, "deny");
    assert.equal(settings.tools.approval.extension, "allow");
    assert.throws(() => writeNativeSettings({ tools: { approval: { bash: "bogus" } } }), /Invalid Bash approval policy/);
    assert.throws(() => writeNativeSettings({ tools: { approval: { extension: "deny" } } }), /Invalid extension tool approval policy/);
  });
});

test("persists and reads task agent settings", () => {
  withAgentDir((dir) => {
    writeFileSync(join(dir, "config.yml"), "# keep me\ntask:\n  unrelated: yes\n", "utf8");
    writeNativeSettings({ task: {
      eager: "preferred",
      prewalk: true,
      agentModelOverrides: { scout: ["gpt-5", "gpt-4"] },
      agentPrewalk: { scout: "auto", builder: false },
      agentAdvisor: { scout: true, builder: "off" },
      disabledAgents: ["legacy-agent"],
    } });
    const task = readNativeSettings().settings.task;
    assert.deepEqual(task, {
      eager: "preferred",
      prewalk: true,
      agentModelOverrides: { scout: ["gpt-5", "gpt-4"] },
      agentPrewalk: { scout: "auto", builder: false },
      agentAdvisor: { scout: true, builder: "off" },
      disabledAgents: ["legacy-agent"],
    });
    assert.match(readFileSync(join(dir, "config.yml"), "utf8"), /unrelated: yes/);
    writeNativeSettings({ task: { agentModelOverrides: {} } });
    assert.deepEqual(readNativeSettings().settings.task.agentModelOverrides, {});
    assert.match(readFileSync(join(dir, "config.yml"), "utf8"), /agentModelOverrides: \{\}/);
    assert.throws(() => writeNativeSettings({ task: { prewalk: "yes" } }), /task.prewalk must be a boolean/);
    for (const eager of ["default", "preferred", "always"]) {
      writeNativeSettings({ task: { eager } });
      assert.equal(readNativeSettings().settings.task.eager, eager);
    }
    assert.throws(() => writeNativeSettings({ task: { eager: "sometimes" } }), /Invalid task eager preference/);
  });
});
