"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createServiceManager } = require("./ompgui-service");
const { setTimeout: sleep } = require("node:timers/promises");

async function checkReady({ hostname, port }) {
  const host = hostname === "0.0.0.0" ? "127.0.0.1" : hostname === "::" ? "::1" : hostname;
  const authority = host.includes(":") ? `[${host}]` : host;
  try {
    const response = await fetch(`http://${authority}:${port}/`, { signal: AbortSignal.timeout(1000), redirect: "manual" });
    await response.body?.cancel();
    return response.ok || response.status === 307 || response.status === 308;
  } catch { return false; }
}

function normalizePath(value, platform) {
  const normalized = path.normalize(value).replaceAll("\\", path.sep);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function detectInstallMethod(packageDir, env = process.env, homeDir = os.homedir(), platform = process.platform) {
  const normalized = normalizePath(packageDir, platform);
  const bunRoots = [
    env.BUN_INSTALL ? path.join(env.BUN_INSTALL, "install", "global", "node_modules") : null,
    path.join(env.USERPROFILE || env.HOME || homeDir, "node_modules"),
    path.join(homeDir, ".bun", "install", "global", "node_modules"),
  ].filter(Boolean).map((root) => normalizePath(root, platform));
  return bunRoots.some((root) => normalized.startsWith(root + path.sep)) ? "bun" : "npm";
}

function findNpmCli(nodePath = process.execPath, exists = fs.existsSync) {
  const nodeDir = path.dirname(nodePath);
  const candidates = [
    path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates.find((candidate) => {
    try {
      return exists(candidate);
    } catch {
      return false;
    }
  }) ?? null;
}

function getInstallCommand(method, platform = process.platform, nodePath = process.execPath, resolveNpmCli = findNpmCli, packageDir) {
  const paths = platform === "win32" ? path.win32 : path;
  const modules = packageDir && paths.dirname(packageDir);
  if (packageDir && (paths.basename(packageDir) !== "ompgui" || paths.basename(modules) !== "node_modules")) {
    throw new Error("Cannot safely update this installation layout. Reinstall ompgui with npm or Bun first.");
  }
  if (method === "bun") {
    const target = packageDir ? ["--global-dir", paths.dirname(modules), "--global-bin-dir", platform === "win32" ? paths.join(paths.dirname(modules), ".bin") : paths.resolve(modules, "../../../bin")] : [];
    return { command: platform === "win32" ? "bun.exe" : "bun", args: ["add", "--global", ...target, "ompgui@latest"] };
  }
  const parent = packageDir && paths.dirname(modules);
  const global = !packageDir || platform === "win32" || paths.basename(parent) === "lib";
  const target = packageDir ? ["--prefix", global && platform !== "win32" ? paths.dirname(parent) : parent] : [];
  const args = ["install", ...(global ? ["--global"] : ["--no-save"]), ...target, "ompgui@latest"];
  if (platform === "win32") {
    const npmCli = resolveNpmCli(nodePath);
    if (!npmCli) throw new Error("Could not locate npm-cli.js beside the active Node.js installation.");
    return { command: nodePath, args: [npmCli, ...args] };
  }
  return { command: "npm", args };
}

function readInstalledVersion(packageDir) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
    return packageJson.name === "ompgui" && typeof packageJson.version === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(packageJson.version) ? packageJson.version : null;
  } catch {
    return null;
  }
}

function runInstaller(command, args, env = process.env) {
  const { promise, resolve, reject } = Promise.withResolvers();
  const child = spawn(command, args, { env, stdio: "inherit", windowsHide: true });
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (code === 0) resolve();
    else reject(new Error(signal ? `${command} was terminated by ${signal}` : `${command} exited with code ${code ?? "unknown"}`));
  });
  return promise;
}

async function updateOmpGui({
  packageDir,
  env = process.env,
  platform = process.platform,
  homeDir = os.homedir(),
  install = runInstaller,
  stdout = process.stdout,
  serviceManager = createServiceManager({ platform, home: homeDir, env }),
  ready = checkReady,
  pause = sleep,
  now = Date.now,
  readinessTimeout = 30000,
} = {}) {
  if (!packageDir) throw new Error("The ompgui package directory is unavailable.");

  const beforeVersion = readInstalledVersion(packageDir);
  const method = detectInstallMethod(packageDir, env, homeDir, platform);
  const { command, args } = getInstallCommand(method, platform, process.execPath, findNpmCli, packageDir);
  const snapshot = platform === "darwin" ? serviceManager.updateSnapshot(packageDir) : null;
  async function startAndWait() {
    snapshot.verify();
    const started = await serviceManager.execute("start");
    if (started.error) throw new Error(started.error);
    const deadline = now() + readinessTimeout;
    while (now() < deadline) {
      const state = serviceManager.status();
      if (state.error) throw new Error(state.error);
      if (state.running && await ready(snapshot)) {
        snapshot.verify();
        return;
      }
      await pause(Math.min(100, Math.max(0, deadline - now())));
    }
    throw new Error("Service did not become ready before the deadline. Check ompgui status and service logs.");
  }
  if (snapshot) {
    stdout.write("Stopping the running ompgui service before updating...\n");
    const stopped = await serviceManager.execute("stop");
    if (stopped.error) throw new Error(stopped.error);
    snapshot.verify();
  }
  let afterVersion;
  try {
    stdout.write(`Updating ompgui${beforeVersion ? ` v${beforeVersion}` : ""} with ${method}...\n`);
    await install(command, args, env);
    afterVersion = readInstalledVersion(packageDir);
    if (!afterVersion) throw new Error("The package manager finished, but the installed ompgui version could not be verified.");
  } catch (error) {
    if (snapshot) {
      stdout.write("Update failed; attempting to start the available ompgui installation (no rollback was performed)...\n");
      try {
        await startAndWait();
        stdout.write("The available ompgui service is running again.\n");
      } catch (recoveryError) {
        throw new AggregateError([error, recoveryError], `${error.message} Recovery start also failed: ${recoveryError.message}`);
      }
    }
    throw error;
  }
  if (snapshot) {
    stdout.write("Starting the updated ompgui service...\n");
    await startAndWait();
    stdout.write("The ompgui service is ready.\n");
  }
  if (beforeVersion && afterVersion && beforeVersion === afterVersion) {
    stdout.write(`ompgui v${afterVersion} is already up to date.\n`);
  } else {
    stdout.write(`Updated ompgui${beforeVersion ? ` v${beforeVersion}` : ""} to v${afterVersion}.\n`);
  }
  return { method, command, args, beforeVersion, afterVersion };
}

module.exports = {
  detectInstallMethod,
  findNpmCli,
  getInstallCommand,
  readInstalledVersion,
  runInstaller,
  updateOmpGui,
};
