"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

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

function getInstallCommand(method, platform = process.platform, nodePath = process.execPath, resolveNpmCli = findNpmCli) {
  if (method === "bun") {
    return { command: platform === "win32" ? "bun.exe" : "bun", args: ["add", "--global", "ompgui@latest"] };
  }
  if (platform === "win32") {
    const npmCli = resolveNpmCli(nodePath);
    if (!npmCli) throw new Error("Could not locate npm-cli.js beside the active Node.js installation.");
    return { command: nodePath, args: [npmCli, "install", "--global", "ompgui@latest"] };
  }
  return { command: "npm", args: ["install", "--global", "ompgui@latest"] };
}

function readInstalledVersion(packageDir) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
    return typeof packageJson.version === "string" ? packageJson.version : null;
  } catch {
    return null;
  }
}

function runInstaller(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(signal ? `${command} was terminated by ${signal}` : `${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

async function updateOmpGui({
  packageDir,
  env = process.env,
  platform = process.platform,
  homeDir = os.homedir(),
  install = runInstaller,
  stdout = process.stdout,
} = {}) {
  if (!packageDir) throw new Error("The ompgui package directory is unavailable.");

  const beforeVersion = readInstalledVersion(packageDir);
  const method = detectInstallMethod(packageDir, env, homeDir, platform);
  const { command, args } = getInstallCommand(method, platform);
  stdout.write(`Updating ompgui${beforeVersion ? ` v${beforeVersion}` : ""} with ${method}...\n`);
  await install(command, args, env);

  const afterVersion = readInstalledVersion(packageDir);
  if (!afterVersion) {
    throw new Error("The package manager finished, but the installed ompgui version could not be verified.");
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
