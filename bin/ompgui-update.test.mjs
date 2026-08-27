import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  detectInstallMethod,
  getInstallCommand,
  updateOmpGui,
} = require("./ompgui-update");
const { parseLaunchOptions } = require("./ompgui-options");

test("parses update as a launcher command", () => {
  const options = parseLaunchOptions(["update"], {});
  assert.equal(options.command, "update");
  assert.deepEqual(options.extraPositionals, []);
});

test("detects Bun global installs and otherwise uses npm", () => {
  assert.equal(
    detectInstallMethod("/Users/test/.bun/install/global/node_modules/ompgui", { HOME: "/Users/test" }, "/Users/test"),
    "bun",
  );
  assert.equal(
    detectInstallMethod("C:\\Users\\test\\node_modules\\ompgui", { USERPROFILE: "C:\\Users\\test" }, "C:\\Users\\test", "win32"),
    "bun",
  );
  assert.equal(
    detectInstallMethod("C:\\Users\\Alice\\node_modules\\ompgui", { USERPROFILE: "C:\\USERS\\ALICE" }, "C:\\USERS\\ALICE", "win32"),
    "bun",
  );
  assert.equal(detectInstallMethod("/usr/local/lib/node_modules/ompgui", { HOME: "/Users/test" }, "/Users/test"), "npm");
});

test("builds shell-free global install commands", () => {
  assert.deepEqual(getInstallCommand("npm", "darwin"), {
    command: "npm",
    args: ["install", "--global", "ompgui@latest"],
  });
  assert.deepEqual(getInstallCommand("bun", "win32"), {
    command: "bun.exe",
    args: ["add", "--global", "ompgui@latest"],
  });
  assert.deepEqual(getInstallCommand("npm", "win32", "C:\\nodejs\\node.exe", () => "C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js"), {
    command: "C:\\nodejs\\node.exe",
    args: ["C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js", "install", "--global", "ompgui@latest"],
  });
});

test("updates with the owning package manager and reports the installed version", async () => {
  const packageDir = await mkdtemp(join(tmpdir(), "ompgui-update-"));
  const packagePath = join(packageDir, "package.json");
  await writeFile(packagePath, JSON.stringify({ name: "ompgui", version: "0.5.7" }));
  const calls = [];
  let output = "";

  try {
    const result = await updateOmpGui({
      packageDir,
      env: { HOME: "/Users/test" },
      homeDir: "/Users/test",
      install: async (command, args, env) => {
        calls.push({ command, args, env });
        const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
        packageJson.version = "0.5.8";
        await writeFile(packagePath, JSON.stringify(packageJson));
      },
      stdout: { write: (chunk) => { output += chunk; } },
    });

    assert.deepEqual(calls, [{
      command: "npm",
      args: ["install", "--global", "ompgui@latest"],
      env: { HOME: "/Users/test" },
    }]);
    assert.equal(result.beforeVersion, "0.5.7");
    assert.equal(result.afterVersion, "0.5.8");
    assert.match(output, /Updating ompgui v0\.5\.7 with npm/);
    assert.match(output, /Updated ompgui v0\.5\.7 to v0\.5\.8/);
  } finally {
    await rm(packageDir, { recursive: true, force: true });
  }
});

test("reports an unchanged version as already current", async () => {
  const packageDir = await mkdtemp(join(tmpdir(), "ompgui-update-"));
  await writeFile(join(packageDir, "package.json"), JSON.stringify({ name: "ompgui", version: "0.5.7" }));
  let output = "";

  try {
    await updateOmpGui({
      packageDir,
      install: async () => {},
      stdout: { write: (chunk) => { output += chunk; } },
    });
    assert.match(output, /ompgui v0\.5\.7 is already up to date/);
  } finally {
    await rm(packageDir, { recursive: true, force: true });
  }
});

test("fails when the installed package version cannot be verified", async () => {
  const packageDir = await mkdtemp(join(tmpdir(), "ompgui-update-"));
  const packagePath = join(packageDir, "package.json");
  await writeFile(packagePath, JSON.stringify({ name: "ompgui", version: "0.5.7" }));

  try {
    await assert.rejects(
      updateOmpGui({
        packageDir,
        install: async () => {
          await rm(packagePath);
        },
        stdout: { write: () => {} },
      }),
      /could not be verified/,
    );
  } finally {
    await rm(packageDir, { recursive: true, force: true });
  }
});
