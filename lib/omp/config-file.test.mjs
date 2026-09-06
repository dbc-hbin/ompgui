import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { writeConfigFileAtomic } = await jiti.import("./config-file.ts");
const { writeNativeSettings } = await jiti.import("./settings-config.ts");
const { writeModelRoles, enableProvider } = await jiti.import("./model-roles.ts");
const { writeModelsConfig } = await jiti.import("./models-config.ts");

test("config replacement is private and failed rename leaves no temporary secret", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "omp-private-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "config");
  writeFileSync(file, "old", { mode: 0o644 });
  writeConfigFileAtomic(file, "secret");
  assert.equal(readFileSync(file, "utf8"), "secret");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const destination = join(dir, "directory");
  mkdirSync(destination);
  writeFileSync(join(destination, "keep"), "keep");
  assert.throws(() => writeConfigFileAtomic(destination, "secret"));
  assert.deepEqual(readdirSync(dir).sort(), ["config", "directory"]);
  assert.equal(readFileSync(join(destination, "keep"), "utf8"), "keep");
});

test("every private YAML save retains unrelated secrets without broadening permissions", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "omp-private-yaml-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  const config = join(dir, "config.yml");
  writeFileSync(config, "privateToken: secret\ndisabledProviders: [example]\n", { mode: 0o644 });
  for (const save of [() => writeNativeSettings({ hideThinkingBlock: true }), () => writeModelRoles({ default: "example/model" }), () => enableProvider("example")]) {
    save();
    assert.equal(statSync(config).mode & 0o777, 0o600);
    assert.equal(parse(readFileSync(config, "utf8")).privateToken, "secret");
  }
  writeModelsConfig({ providers: { example: { apiKey: "secret" } }, customSetting: "keep" });
  const models = join(dir, "models.yml");
  assert.equal(statSync(models).mode & 0o777, 0o600);
  assert.deepEqual(parse(readFileSync(models, "utf8")), { providers: { example: { apiKey: "secret" } }, customSetting: "keep" });
});
