import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { detectInstallMethod, getInstallCommand, updateOmpGui } = require("./ompgui-update");

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "ompgui-update-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageDir = join(root, "node_modules", "ompgui");
  await mkdir(packageDir, { recursive: true });
  const version = (value) => writeFile(join(packageDir, "package.json"), JSON.stringify({ name: "ompgui", version: value }));
  await version("0.7.1");
  const events = [];
  let running = true;
  let output = "";
  let clock = 0;
  const snapshot = { hostname: "127.0.0.1", port: "30177", verify() {} };
  const serviceManager = {
    updateSnapshot: () => snapshot,
    execute: async (action) => { events.push(action); running = action === "start"; return { running }; },
    status: () => ({ running }),
  };
  const options = { packageDir, platform: "darwin", serviceManager, install: async () => { events.push("install"); await version("0.7.2"); }, ready: async () => { events.push("ready"); return true; }, now: () => clock, pause: async (ms) => { clock += ms; }, readinessTimeout: 300, stdout: { write: (value) => { output += value; } } };
  return { root, version, events, snapshot, serviceManager, options, output: () => output };
}

test("targets the executing package rather than the PATH npm prefix", () => {
  assert.deepEqual(getInstallCommand("npm", "darwin", undefined, undefined, "/opt/custom/lib/node_modules/ompgui").args, ["install", "--global", "--prefix", "/opt/custom", "ompgui@latest"]);
  assert.deepEqual(getInstallCommand("npm", "linux", undefined, undefined, "/srv/app/node_modules/ompgui").args, ["install", "--no-save", "--prefix", "/srv/app", "ompgui@latest"]);
  assert.deepEqual(getInstallCommand("npm", "win32", "C:\\node\\node.exe", () => "C:\\node\\npm-cli.js", "D:\\npm\\node_modules\\ompgui"), { command: "C:\\node\\node.exe", args: ["C:\\node\\npm-cli.js", "install", "--global", "--prefix", "D:\\npm", "ompgui@latest"] });
  assert.equal(detectInstallMethod("/home/me/.bun/install/global/node_modules/ompgui", {}, "/home/me"), "bun");
  assert.deepEqual(getInstallCommand("bun", "linux", undefined, undefined, "/home/me/.bun/install/global/node_modules/ompgui").args, ["add", "--global", "--global-dir", "/home/me/.bun/install/global", "--global-bin-dir", "/home/me/.bun/bin", "ompgui@latest"]);
});

test("HOME node_modules remains npm even when Bun is installed", () => {
  const packageDir = "/home/me/node_modules/ompgui";
  const method = detectInstallMethod(packageDir, { HOME: "/home/me", BUN_INSTALL: "/home/me/.bun" }, "/home/me", "linux");
  assert.equal(method, "npm");
  assert.deepEqual(getInstallCommand(method, "linux", undefined, undefined, packageDir).args, ["install", "--no-save", "--prefix", "/home/me", "ompgui@latest"]);
  assert.throws(() => getInstallCommand("bun", "linux", undefined, undefined, packageDir), /installation layout/);
  assert.equal(detectInstallMethod("C:\\Users\\me\\node_modules\\ompgui", { USERPROFILE: "C:\\Users\\me" }, "C:\\Users\\me", "win32"), "npm");
});

test("custom Bun roots and Windows paths retain their installation targets", () => {
  const packageDir = "/opt/bun/install/global/node_modules/ompgui";
  assert.equal(detectInstallMethod(packageDir, { BUN_INSTALL: "/opt/bun" }, "/home/me", "linux"), "bun");
  assert.deepEqual(getInstallCommand("bun", "linux", undefined, undefined, packageDir).args, ["add", "--global", "--global-dir", "/opt/bun/install/global", "--global-bin-dir", "/opt/bun/bin", "ompgui@latest"]);
  const windowsDir = "D:\\Bun\\install\\global\\node_modules\\ompgui";
  assert.equal(detectInstallMethod(windowsDir, { BUN_INSTALL: "d:\\bun" }, "C:\\Users\\me", "win32"), "bun");
  assert.deepEqual(getInstallCommand("bun", "win32", undefined, undefined, windowsDir), { command: "bun.exe", args: ["add", "--global", "--global-dir", "D:\\Bun\\install\\global", "--global-bin-dir", "D:\\Bun\\install\\global\\.bin", "ompgui@latest"] });
  assert.equal(detectInstallMethod("/home/me/.bun/install/global/node_modules/another/node_modules/ompgui", {}, "/home/me", "linux"), "npm");
});

test("awaits stop before install and readiness before success", async (t) => {
  const f = await fixture(t);
  const stopped = Promise.withResolvers();
  f.serviceManager.execute = async (action) => { f.events.push(action); if (action === "stop") await stopped.promise; return {}; };
  const updating = updateOmpGui(f.options);
  await Promise.resolve();
  assert.deepEqual(f.events, ["stop"]);
  stopped.resolve();
  const result = await updating;
  assert.deepEqual(f.events, ["stop", "install", "start", "ready"]);
  assert.equal(result.afterVersion, "0.7.2");
});

test("stopped and uninstalled services remain unchanged", async (t) => {
  const f = await fixture(t);
  f.serviceManager.updateSnapshot = () => null;
  await updateOmpGui(f.options);
  assert.deepEqual(f.events, ["install"]);
});

test("unsupported platforms do not inspect or operate a service", async (t) => {
  const f = await fixture(t);
  f.serviceManager.updateSnapshot = () => { throw new Error("must not inspect"); };
  await updateOmpGui({ ...f.options, platform: "linux" });
  assert.deepEqual(f.events, ["install"]);
});

test("ownership or layout mismatch prevents stop and installation", async (t) => {
  const f = await fixture(t);
  f.serviceManager.updateSnapshot = () => { throw new Error("different installation"); };
  await assert.rejects(updateOmpGui(f.options), /different installation/);
  await assert.rejects(updateOmpGui({ ...f.options, packageDir: f.root }), /installation layout/);
  assert.deepEqual(f.events, []);
});

test("installer failure restarts available installation and preserves original error", async (t) => {
  const f = await fixture(t);
  const failure = new Error("installer failed");
  f.options.install = async () => { f.events.push("install"); throw failure; };
  await assert.rejects(updateOmpGui(f.options), (error) => error === failure);
  assert.deepEqual(f.events, ["stop", "install", "start", "ready"]);
  assert.match(f.output(), /no rollback was performed/);
});

test("invalid version triggers recovery and reports both failures", async (t) => {
  const f = await fixture(t);
  f.options.install = async () => { await f.version("invalid"); };
  const failure = new Error("launcher unavailable");
  f.serviceManager.execute = async (action) => { if (action === "start") throw failure; return {}; };
  await assert.rejects(updateOmpGui(f.options), (error) => error instanceof AggregateError && /could not be verified/.test(error.errors[0].message) && error.errors[1] === failure);
});

test("unchanged version still restarts running service", async (t) => {
  const f = await fixture(t);
  f.options.install = async () => { f.events.push("install"); };
  await updateOmpGui(f.options);
  assert.deepEqual(f.events, ["stop", "install", "start", "ready"]);
  assert.match(f.output(), /already up to date/);
});

test("startup snapshot must remain intact before restart", async (t) => {
  const f = await fixture(t);
  let changed = false;
  f.snapshot.verify = () => { if (changed) throw new Error("startup configuration changed"); };
  f.options.install = async () => { changed = true; await f.version("0.7.2"); };
  await assert.rejects(updateOmpGui(f.options), /startup configuration changed/);
  assert.deepEqual(f.events, ["stop"]);
});

test("readiness deadline fails without claiming success", async (t) => {
  const f = await fixture(t);
  f.options.ready = async () => false;
  await assert.rejects(updateOmpGui(f.options), /did not become ready/);
  assert.doesNotMatch(f.output(), /service is ready|Updated ompgui/);
});

test("stop failure never replaces live files", async (t) => {
  const f = await fixture(t);
  f.serviceManager.execute = async () => { throw new Error("still stopping"); };
  await assert.rejects(updateOmpGui(f.options), /still stopping/);
  assert.deepEqual(f.events, []);
});
