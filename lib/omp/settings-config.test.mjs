import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import timersPromises from "node:timers/promises";
import { parse } from "yaml";
import { createJiti } from "jiti";

let observeLockRetry;
const controlledDelay = mock.method(timersPromises, "setTimeout", () => {
  const released = Promise.withResolvers();
  observeLockRetry?.({ release: released.resolve });
  return released.promise;
});
syncBuiltinESMExports();
test.after(() => {
  controlledDelay.mock.restore();
  syncBuiltinESMExports();
});

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  NativeSettingsError,
  filterNativeSettings,
  readNativeSettings,
  readNativeSettingsSnapshot,
  updateNativeSettings,
  writeNativeSettings,
} = await jiti.import("./settings-config.ts");
const { allowFileRoot } = await jiti.import("../file-access.ts");
const { getAdditionalAllowedRoots } = await jiti.import("../allowed-roots.ts");
const { withNativeConfigLock } = await jiti.import("./file-lock.ts");

async function withIsolatedSettings(run) {
  const root = mkdtempSync(join(tmpdir(), "ompgui-settings-config-"));
  const agent = join(root, "agent");
  const project = join(root, "project");
  mkdirSync(agent);
  mkdirSync(project);
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  allowFileRoot(project);
  try {
    await run({ root, agent, project, globalPath: join(agent, "config.yml"), projectPath: join(project, ".omp", "config.yml") });
  } finally {
    getAdditionalAllowedRoots().delete(project);
    globalThis.__piAllowedRootsCache = undefined;
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

function errorPaths(error) {
  assert.ok(error instanceof NativeSettingsError);
  return error.issues.map((issue) => issue.path);
}

test("catalog filtering validates recognized leaves and drops unknown request fields", () => {
  assert.deepEqual(filterNativeSettings({ retry: { enabled: false, unknown: true }, unknownRoot: true }), { retry: { enabled: false } });
  for (const [settings, path] of [
    [{ retry: { enabled: "no" } }, "retry.enabled"],
    [{ retry: [] }, "retry"],
    [{ temperature: Number.POSITIVE_INFINITY }, "settings"],
    [{ tools: { approval: { constructor: "allow" } } }, "settings"],
  ]) {
    assert.throws(
      () => filterNativeSettings(settings),
      (error) => error instanceof NativeSettingsError
        && error.code === "invalid_settings"
        && errorPaths(error).includes(path),
    );
  }
});

test("native-shaped record values normalize safely", () => {
  assert.deepEqual(filterNativeSettings({ providers: { maxInFlightRequests: { openai: 0.5, anthropic: 3.9 } } }), {
    providers: { maxInFlightRequests: { openai: 1, anthropic: 3 } },
  });
  assert.throws(
    () => filterNativeSettings({ retry: { fallbackChains: { default: "openai/gpt-4o-mini" } } }),
    (error) => error instanceof NativeSettingsError && errorPaths(error).includes("retry.fallbackChains"),
  );
  assert.deepEqual(filterNativeSettings({ retry: { fallbackChains: { default: ["openai/gpt-4o-mini"] } } }), {
    retry: { fallbackChains: { default: ["openai/gpt-4o-mini"] } },
  });
});

test("global compatibility helpers preserve unknown YAML and replace record leaves", async () => {
  await withIsolatedSettings(async ({ globalPath }) => {
    writeFileSync(globalPath, "# retain comment\nunknownRoot: keep\ntask:\n  unknownChild: keep\n  agentModelOverrides:\n    scout: old\n    reviewer: old\n", "utf8");
    await writeNativeSettings({ task: { agentModelOverrides: { scout: "new" } } });
    assert.deepEqual(readNativeSettings().settings.task.agentModelOverrides, { scout: "new" });
    const source = readFileSync(globalPath, "utf8");
    assert.match(source, /# retain comment/);
    assert.match(source, /unknownRoot: keep/);
    assert.match(source, /unknownChild: keep/);
    assert.doesNotMatch(source, /reviewer: old/);
  });
});

test("settings updates re-read under the native lock and preserve a preceding native save", async () => {
  await withIsolatedSettings(async ({ globalPath }) => {
    writeFileSync(globalPath, "retry:\n  enabled: true\n", "utf8");
    const acquired = Promise.withResolvers();
    const release = Promise.withResolvers();
    const retryScheduled = Promise.withResolvers();
    const nativeSave = withNativeConfigLock(globalPath, async () => {
      acquired.resolve();
      await release.promise;
      writeFileSync(globalPath, "retry:\n  enabled: true\ntextVerbosity: low\n", "utf8");
    });
    await acquired.promise;
    observeLockRetry = retryScheduled.resolve;
    const guiSave = updateNativeSettings({ settings: { retry: { maxRetries: 4 } } });
    const retry = await retryScheduled.promise;
    release.resolve();
    await nativeSave;
    retry.release();
    await guiSave;
    observeLockRetry = undefined;
    const settings = readNativeSettings().settings;
    assert.equal(settings.textVerbosity, "low");
    assert.deepEqual(settings.retry, { enabled: true, maxRetries: 4 });
  });
});

test("leaf patches materialize aliased branches without mutating anchors or dropping policy and secret siblings", async () => {
  await withIsolatedSettings(async ({ globalPath }) => {
    const secret = "alias-secret-4d3c2b";
    writeFileSync(globalPath, [
      "policies: &policies",
      "  bash: deny",
      "toolDefaults: &toolDefaults",
      "  approvalMode: always-ask",
      "  approval: *policies",
      "  unmanaged: keep",
      "tools: *toolDefaults",
      "searchDefaults: &searchDefaults",
      `  basicPassword: ${secret}`,
      "  basicUsername: old-user",
      "searxng: *searchDefaults",
      "",
    ].join("\n"), "utf8");

    await updateNativeSettings({ settings: {
      tools: { artifactHeadBytes: 24 },
      searxng: { basicUsername: "new-user" },
    } });

    const source = readFileSync(globalPath, "utf8");
    const stored = parse(source);
    assert.equal(stored.tools.approvalMode, "always-ask");
    assert.deepEqual(stored.tools.approval, { bash: "deny" });
    assert.equal(stored.tools.unmanaged, "keep");
    assert.equal(stored.tools.artifactHeadBytes, 24);
    assert.equal(stored.searxng.basicPassword, secret);
    assert.equal(stored.searxng.basicUsername, "new-user");
    assert.match(source, /toolDefaults: &toolDefaults/);
    assert.match(source, /searchDefaults: &searchDefaults/);
    assert.doesNotMatch(source, /tools: \*toolDefaults/);
    assert.doesNotMatch(source, /searxng: \*searchDefaults/);
  });
});

test("editing an anchored branch detaches every untouched alias consumer", async () => {
  await withIsolatedSettings(async ({ globalPath }) => {
    writeFileSync(globalPath, [
      "retry: &shared",
      "  enabled: false",
      "bash: *shared # keep consumer comment",
      "unmanaged:",
      "  nested: *shared",
      "  sequence: [*shared]",
      "",
    ].join("\n"), "utf8");

    await updateNativeSettings({ settings: { retry: { enabled: true } } });

    const source = readFileSync(globalPath, "utf8");
    const stored = parse(source);
    assert.equal(stored.retry.enabled, true);
    assert.equal(stored.bash.enabled, false);
    assert.equal(stored.unmanaged.nested.enabled, false);
    assert.equal(stored.unmanaged.sequence[0].enabled, false);
    assert.match(source, /keep consumer comment/);
  });
});

test("legacy migration is a read-only per-layer projection and canonical values win", async () => {
  await withIsolatedSettings(async ({ globalPath, project, projectPath }) => {
    writeFileSync(globalPath, [
      "compaction:",
      "  strategy: handoff",
      "  remoteEnabled: false",
      "  methodOrder: [soft]",
      "advisor:",
      "  subagents: true",
      "task:",
      "  agentAdvisor:",
      "    task: on",
      "  agentPrewalk:",
      "    scout: true",
      "",
    ].join("\n"), "utf8");
    mkdirSync(join(project, ".omp"));
    writeFileSync(projectPath, "advisor:\n  subagents: false\ncompaction:\n  strategy: shake\n  remoteEnabled: false\n", "utf8");

    const globalBefore = readFileSync(globalPath, "utf8");
    const globalSnapshot = await readNativeSettingsSnapshot();
    assert.deepEqual(globalSnapshot.settings.compaction.methodOrder, ["soft"]);
    assert.equal(globalSnapshot.settings.task.agentAdvisor.task, "on");
    assert.equal(globalSnapshot.settings.task.agentPrewalk.scout, "on");
    assert.equal(readFileSync(globalPath, "utf8"), globalBefore);

    const projectSnapshot = await readNativeSettingsSnapshot("project", project);
    assert.equal(projectSnapshot.effectiveSettings.task.agentAdvisor.task, "off");
    assert.deepEqual(projectSnapshot.effectiveSettings.compaction.methodOrder, ["shake", "soft"]);
    await updateNativeSettings({ scope: "project", cwd: project, settings: { retry: { enabled: false } } });
    const migrated = parse(readFileSync(projectPath, "utf8"));
    assert.deepEqual(migrated.compaction.methodOrder, ["shake", "soft"]);
    assert.equal(migrated.compaction.strategy, undefined);
    assert.equal(migrated.compaction.remoteEnabled, undefined);
    assert.equal(migrated.advisor?.subagents, undefined);
    assert.equal(migrated.task.agentAdvisor.task, "off");
    assert.equal(readFileSync(globalPath, "utf8"), globalBefore);
  });
});

test("legacy advisor migration fills only a missing canonical task entry", async () => {
  await withIsolatedSettings(async ({ globalPath }) => {
    writeFileSync(globalPath, "advisor:\n  subagents: false\ntask:\n  agentAdvisor:\n    scout: on\n", "utf8");

    const before = await readNativeSettingsSnapshot();
    assert.deepEqual(before.settings.task.agentAdvisor, { scout: "on", task: "off" });
    await updateNativeSettings({ settings: { retry: { enabled: false } } });

    const stored = parse(readFileSync(globalPath, "utf8"));
    assert.deepEqual(stored.task.agentAdvisor, { scout: "on", task: "off" });
    assert.equal(stored.advisor?.subagents, undefined);
  });
});

test("project patches and reset preserve unrelated YAML while inherited values remain effective", async () => {
  await withIsolatedSettings(async ({ globalPath, project, projectPath }) => {
    writeFileSync(globalPath, "retry:\n  enabled: true\n  maxRetries: 3\ntools:\n  approval:\n    bash: allow\n", "utf8");
    mkdirSync(join(project, ".omp"));
    writeFileSync(projectPath, "# project comment\nunknown: keep\nretry:\n  enabled: false\ntools:\n  approval:\n    extension: prompt\n", "utf8");
    await updateNativeSettings({ scope: "project", cwd: project, settings: { retry: { maxRetries: 4 } } });
    let snapshot = await readNativeSettingsSnapshot("project", project);
    assert.deepEqual(snapshot.settings.retry, { enabled: false, maxRetries: 4 });
    assert.deepEqual(snapshot.effectiveSettings.tools.approval, { bash: "allow", extension: "prompt" });
    await updateNativeSettings({ scope: "project", cwd: project, reset: ["retry.enabled"] });
    snapshot = await readNativeSettingsSnapshot("project", project);
    assert.equal(snapshot.settings.retry.enabled, undefined);
    assert.equal(snapshot.effectiveSettings.retry.enabled, true);
    assert.equal(snapshot.effectiveSettings.retry.maxRetries, 4);
    const source = readFileSync(projectPath, "utf8");
    assert.match(source, /# project comment/);
    assert.match(source, /unknown: keep/);
  });
});

test("model role arrays and project null clears preserve sibling roles and native inheritance", async () => {
  await withIsolatedSettings(async ({ globalPath, project, projectPath }) => {
    writeFileSync(globalPath, "modelRoles:\n  default: openai/global\n  smol: openai/global-smol\n  reviewer: [openai/reviewer, anthropic/reviewer]\n", "utf8");
    mkdirSync(join(project, ".omp"));
    writeFileSync(projectPath, "modelRoles:\n  default: openai/project\n  smol: null\n  scout: [openai/scout, anthropic/scout]\n  invalid: 42\n", "utf8");

    const snapshot = await readNativeSettingsSnapshot("project", project);
    assert.deepEqual(snapshot.settings.modelRoles, {
      default: "openai/project",
      smol: null,
      scout: ["openai/scout", "anthropic/scout"],
    });
    assert.deepEqual(snapshot.effectiveSettings.modelRoles, {
      default: "openai/project",
      smol: "openai/global-smol",
      reviewer: ["openai/reviewer", "anthropic/reviewer"],
      scout: ["openai/scout", "anthropic/scout"],
    });
    assert.deepEqual(snapshot.issues, [{ path: "modelRoles.invalid", message: "Stored model role is invalid and was omitted" }]);
  });
});

test("scoped registry entries remain read-only while plain entries stay visible", async () => {
  await withIsolatedSettings(async ({ globalPath }) => {
    writeFileSync(globalPath, [
      "enabledModels:",
      "  - openai/global",
      "  - path: /tmp/project",
      "    models: [openai/scoped]",
      "disabledProviders:",
      "  - anthropic",
      "  - paths: [/tmp/a, /tmp/b]",
      "    providers: openai",
      "enabledProviders:",
      "  - pathPrefixes: /tmp/project",
      "    items: [google]",
      "",
    ].join("\n"), "utf8");

    const snapshot = await readNativeSettingsSnapshot();
    assert.deepEqual(snapshot.settings.enabledModels, ["openai/global"]);
    assert.deepEqual(snapshot.settings.disabledProviders, ["anthropic"]);
    assert.deepEqual(snapshot.settings.enabledProviders, []);
    assert.equal(snapshot.settings.registryHasScopedEntries, true);
    await assert.rejects(
      updateNativeSettings({ settings: { disabledProviders: ["google"] } }),
      (error) => error instanceof NativeSettingsError
        && error.code === "scoped_registry_read_only"
        && errorPaths(error).includes("disabledProviders"),
    );
    assert.equal(parse(readFileSync(globalPath, "utf8")).disabledProviders[1].providers, "openai");
  });
});

test("project scope uses canonical config.yml and never silently edits unsupported config.yaml", async () => {
  await withIsolatedSettings(async ({ project }) => {
    const directory = join(project, ".omp");
    mkdirSync(directory);
    const unsupported = join(directory, "config.yaml");
    writeFileSync(unsupported, "retry:\n  enabled: false\n", "utf8");
    let snapshot = await readNativeSettingsSnapshot("project", project);
    assert.equal(snapshot.path, join(realpathSync(project), ".omp", "config.yml"));
    assert.equal(snapshot.settings.retry, undefined);
    await updateNativeSettings({ scope: "project", cwd: project, settings: { retry: { enabled: true } } });
    snapshot = await readNativeSettingsSnapshot("project", project);
    assert.equal(snapshot.settings.retry.enabled, true);
    assert.match(readFileSync(unsupported, "utf8"), /enabled: false/);
  });
});

test("project scope rejects global-only fields and settings symlink escapes", async () => {
  await withIsolatedSettings(async ({ root, project }) => {
    await assert.rejects(
      updateNativeSettings({ scope: "project", cwd: project, settings: { auth: { broker: { url: "https://example.test" } } } }),
      (error) => errorPaths(error).includes("auth.broker.url"),
    );
    const outside = join(root, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(project, ".omp"));
    await assert.rejects(
      readNativeSettingsSnapshot("project", project),
      (error) => error instanceof NativeSettingsError && error.code === "forbidden_scope",
    );
    assert.equal(existsSync(join(outside, "config.yml")), false);
  });
});

test("credential-bearing endpoints are global-only, confirmed, and never expose inherited credentials", async () => {
  await withIsolatedSettings(async ({ globalPath, project }) => {
    const secret = "hindsight-global-token-9087";
    writeFileSync(globalPath, `hindsight:\n  apiToken: ${secret}\n  apiUrl: https://memory.example.test\n`, "utf8");

    await assert.rejects(
      updateNativeSettings({ scope: "project", cwd: project, settings: { hindsight: { apiUrl: "https://attacker.example.test" } } }),
      (error) => error instanceof NativeSettingsError
        && error.code === "invalid_settings"
        && errorPaths(error).includes("hindsight.apiUrl"),
    );
    let snapshot = await readNativeSettingsSnapshot("project", project);
    assert.equal(snapshot.secretStatus["hindsight.apiToken"], true);
    assert.equal(JSON.stringify(snapshot).includes(secret), false);
    assert.equal(readFileSync(globalPath, "utf8").includes(secret), true);

    await assert.rejects(
      updateNativeSettings({ settings: { hindsight: { apiUrl: "https://replacement.example.test" } } }),
      (error) => error instanceof NativeSettingsError
        && error.code === "confirmation_required"
        && errorPaths(error).includes("hindsight.apiUrl"),
    );
    snapshot = await readNativeSettingsSnapshot();
    assert.equal(snapshot.settings.hindsight.apiUrl, "https://memory.example.test");
    assert.equal(JSON.stringify(snapshot).includes(secret), false);
  });
});

test("confirmation is required only for changed protected leaves, including reset", async () => {
  await withIsolatedSettings(async () => {
    await assert.rejects(
      updateNativeSettings({ settings: { bash: { enabled: false } } }),
      (error) => error instanceof NativeSettingsError && error.code === "confirmation_required" && errorPaths(error).includes("bash.enabled"),
    );
    await updateNativeSettings({ settings: { bash: { enabled: false } }, confirm: ["bash.enabled"] });
    await updateNativeSettings({ settings: { bash: { enabled: false } } });
    await assert.rejects(
      updateNativeSettings({ reset: ["bash.enabled"] }),
      (error) => error instanceof NativeSettingsError && error.code === "confirmation_required",
    );
    await updateNativeSettings({ reset: ["bash.enabled"], confirm: ["bash.enabled"] });
  });
});

test("leaf resets remove malformed parents while preserving aliases and unrelated YAML", async () => {
  await withIsolatedSettings(async ({ globalPath }) => {
    writeFileSync(globalPath, "retry: &shared malformed\nunmanaged: *shared\nunknown: keep\n", "utf8");
    let snapshot = await readNativeSettingsSnapshot();
    assert.deepEqual(snapshot.issues, [{ path: "retry", message: "Stored settings section is not an object and was omitted" }]);

    await updateNativeSettings({ reset: ["retry.enabled"] });

    const source = readFileSync(globalPath, "utf8");
    const stored = parse(source);
    assert.equal(stored.retry, undefined);
    assert.equal(stored.unmanaged, "malformed");
    assert.equal(stored.unknown, "keep");

    writeFileSync(globalPath, "bash: malformed\nunknown: keep\n", "utf8");
    await assert.rejects(
      updateNativeSettings({ reset: ["bash.enabled"] }),
      (error) => error instanceof NativeSettingsError
        && error.code === "confirmation_required"
        && errorPaths(error).includes("bash.enabled"),
    );
    await updateNativeSettings({ reset: ["bash.enabled"], confirm: ["bash.enabled"] });
    snapshot = await readNativeSettingsSnapshot();
    assert.equal(snapshot.settings.bash, undefined);
    assert.equal(parse(readFileSync(globalPath, "utf8")).unknown, "keep");
  });
});

test("omitted out-of-bounds persisted policies surface safe issues and still require reset confirmation", async () => {
  await withIsolatedSettings(async ({ globalPath }) => {
    const patterns = Array.from({ length: 257 }, (_, index) => ({ match: `command-${index}`, approval: "deny" }));
    writeFileSync(globalPath, JSON.stringify({ bash: { patterns } }), "utf8");
    const snapshot = await readNativeSettingsSnapshot();
    assert.equal(snapshot.settings.bash?.patterns, undefined);
    assert.deepEqual(snapshot.issues, [{
      path: "bash.patterns",
      message: "Stored value is invalid or outside editor bounds and was omitted",
    }]);
    assert.equal(JSON.stringify(snapshot.issues).includes("command-"), false);
    await assert.rejects(
      updateNativeSettings({ reset: ["bash.patterns"] }),
      (error) => error instanceof NativeSettingsError
        && error.code === "confirmation_required"
        && errorPaths(error).includes("bash.patterns"),
    );
    await updateNativeSettings({ reset: ["bash.patterns"], confirm: ["bash.patterns"] });
  });
});

test("secrets are write-only, preserved on unrelated edits, redacted from snapshots and errors", async () => {
  await withIsolatedSettings(async ({ globalPath }) => {
    const secret = "not-for-responses-7f8e9d";
    await assert.rejects(
      updateNativeSettings({ secrets: { "auth.broker.token": secret } }),
      (error) => error instanceof NativeSettingsError && error.code === "confirmation_required" && !JSON.stringify(error).includes(secret),
    );
    await updateNativeSettings({ secrets: { "auth.broker.token": secret }, confirm: ["auth.broker.token"] });
    let snapshot = await readNativeSettingsSnapshot();
    assert.equal(snapshot.secretStatus["auth.broker.token"], true);
    assert.equal(JSON.stringify(snapshot).includes(secret), false);
    assert.equal(JSON.stringify(snapshot.settings).includes("token"), false);
    await updateNativeSettings({ settings: { retry: { enabled: false } } });
    assert.match(readFileSync(globalPath, "utf8"), new RegExp(secret));
    snapshot = await readNativeSettingsSnapshot();
    assert.equal(JSON.stringify(snapshot).includes(secret), false);
    await assert.rejects(
      updateNativeSettings({ settings: { auth: { broker: { token: secret } } } }),
      (error) => error instanceof NativeSettingsError && !JSON.stringify(error).includes(secret),
    );
    await updateNativeSettings({ secrets: { "auth.broker.token": null }, confirm: ["auth.broker.token"] });
    snapshot = await readNativeSettingsSnapshot();
    assert.equal(snapshot.secretStatus["auth.broker.token"], false);
  });
});
