"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const LABEL = "com.hanbinnoh.ompgui";
const POLL_WAIT = new Int32Array(new SharedArrayBuffer(4));
const ACTIONS = new Set(["install", "repair", "start", "stop", "restart", "status", "uninstall", "remove", "enable", "disable"]);
const escapeXml = (value) => String(value).replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]);
function plistValue(value) {
  if (typeof value === "boolean") return value ? "<true/>" : "<false/>";
  if (Array.isArray(value)) return `<array>${value.map(plistValue).join("")}</array>`;
  if (value && typeof value === "object") return `<dict>${Object.entries(value).map(([key, entry]) => `<key>${escapeXml(key)}</key>${plistValue(entry)}`).join("")}</dict>`;
  return `<string>${escapeXml(value)}</string>`;
}
function createServiceManager({ processAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; }
}, now = Date.now, pause = (milliseconds) => Atomics.wait(POLL_WAIT, 0, 0, milliseconds), label = LABEL, platform = process.platform, home = os.homedir(), uid = process.getuid?.(), env = process.env, execPath = process.execPath, cliPath = path.join(__dirname, "ompgui.js"), portAvailable = (port, hostname) => {
  const probe = spawnSync(process.execPath, [__filename, "--check-port", String(port), hostname], { encoding: "utf8", timeout: 5000 });
  if (probe.status === 0) return true;
  if (probe.status === 2) return false;
  throw new Error("Could not check service port availability");
}, run = (command, args) => spawnSync(command, args, { encoding: "utf8", timeout: 10000 }) } = {}) {
  // Internal dependency-injection seam only; CLI and HTTP never accept a label override.
  if (typeof label !== "string" || !/^com\.hanbinnoh\.ompgui(?:\.verify[A-Za-z0-9-]+)?$/.test(label)) throw new Error("Invalid ompgui service label");
  const plistPath = path.join(home, "Library", "LaunchAgents", `${label}.plist`);
  const logPath = path.join(home, "Library", "Logs", "ompgui", "service.log");
  const domain = `gui/${uid}`;
  const target = `${domain}/${label}`;
  function command(args, allowMissing = false) {
    const result = run("/bin/launchctl", args);
    if (result.error || result.status !== 0) {
      // launchctl's missing-service exit status is 113; never hide permission/domain errors.
      if (allowMissing && result.status === 113) return null;
      throw new Error(`launchctl ${args[0]} failed${result.error ? `: ${result.error.code || "execution error"}` : ` (exit ${result.status})`}`);
    }
    return result.stdout || "";
  }
  function ownedExecutable(args) {
    if (!Array.isArray(args) || args.length < 2 || typeof args[0] !== "string" || typeof args[1] !== "string" || !path.isAbsolute(args[0]) || !path.isAbsolute(args[1]) || path.basename(args[0]) !== "node") return false;
    try {
      const resolved = fs.realpathSync(args[1]);
      if (path.basename(resolved) !== "ompgui.js" || path.basename(path.dirname(resolved)) !== "bin") return false;
      return JSON.parse(fs.readFileSync(path.join(path.dirname(resolved), "..", "package.json"), "utf8")).name === "ompgui";
    } catch { return false; }
  }
  function readInstalled() {
    let stat;
    try { stat = fs.lstatSync(plistPath); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid || (stat.mode & 0o022) !== 0) throw new Error("Refusing unmanaged or foreign-owned LaunchAgent");
    const result = run("/usr/bin/plutil", ["-convert", "json", "-o", "-", plistPath]);
    if (result.error || result.status !== 0) throw new Error("Cannot read LaunchAgent configuration");
    let config;
    try { config = JSON.parse(result.stdout); } catch { throw new Error("Invalid LaunchAgent configuration"); }
    if (config.Label !== label || !ownedExecutable(config.ProgramArguments) || config.Program) throw new Error("Refusing LaunchAgent not owned by ompgui");
    return config;
  }
  function inspect() {
    const state = { supported: platform === "darwin", installed: false, running: false, autoStart: false, label, pid: null, logPath: null };
    if (!state.supported) return { ...state, error: "Service management is supported only on macOS." };
    const config = readInstalled();
    state.installed = Boolean(config);
    state.logPath = typeof config?.StandardOutPath === "string" ? config.StandardOutPath : null;
    const printed = command(["print", target], true);
    if (printed !== null) {
      const source = printed.match(/^\s*path = (.+)$/m)?.[1]?.trim();
      if (!config || source !== plistPath) throw new Error("Refusing loaded service with unverified ownership");
      const pid = printed.match(/^\s*pid = (\d+)\s*$/m);
      state.pid = pid ? Number(pid[1]) : null;
      state.running = /\bstate = running\b/.test(printed) && state.pid !== null;
      if (!state.running) state.pid = null;
    }
    const disabled = command(["print-disabled", domain]);
    const explicitlyDisabled = new RegExp(`"${label.replaceAll(".", "\\.")}"\\s*=>\\s*(?:true|disabled)\\b`).test(disabled);
    state.autoStart = Boolean(config && config.RunAtLoad !== false && !explicitlyDisabled);
    return { ...state, loaded: printed !== null, explicitlyDisabled };
  }
  function status() {
    try { const state = inspect(); delete state.loaded; delete state.explicitlyDisabled; return state; }
    catch (error) { return { supported: platform === "darwin", installed: fs.existsSync(plistPath), running: false, autoStart: false, label, pid: null, logPath: null, error: error.message }; }
  }
  function validate(action) {
    if (!ACTIONS.has(action)) throw new Error(`Unknown service action: ${action}`);
    if (platform !== "darwin") throw new Error("Service management is supported only on macOS.");
    const state = inspect();
    if (["start", "restart", "enable", "disable"].includes(action) && !state.installed) throw new Error("Service is not installed. Run ompgui service install first.");
    return state;
  }
  function execute(action, options = {}) {
    if (action === "status") return status();
    const before = validate(action);
    if (action === "remove") action = "uninstall";
    if (action === "repair") action = before.installed ? "restart" : "install";
    if (["install", "start", "restart"].includes(action) && !before.running) {
      const installed = before.installed ? readInstalled() : null;
      const launch = installed ? require("./ompgui-options").parseLaunchOptions(installed.ProgramArguments.slice(2), installed.EnvironmentVariables || {}) : options;
      const port = launch.port || "30177";
      const hostname = launch.hostname || "127.0.0.1";
      if (!portAvailable(port, hostname)) throw new Error(`Port ${port} on ${hostname} is already in use. Stop the foreground server or other listener, then run ompgui service ${before.installed ? "start" : "install"}. No service configuration was changed.`);
    }
    if (action === "install" && !before.installed) {
      const realCli = fs.realpathSync(cliPath);
      const packageDir = path.resolve(path.dirname(realCli), "..");
      if (!ownedExecutable([execPath, realCli]) || fs.existsSync(path.join(packageDir, ".git")) || !fs.existsSync(path.join(packageDir, ".next", "BUILD_ID"))) throw new Error("Install the published ompgui package before installing its service; development checkouts are not supported.");
      const persistentEnv = {};
      for (const [key, value] of Object.entries(env)) {
        if ((/^(OMP_|OMPGUI_|OMP_WEB_)/.test(key) || ["PATH", "HOME", "SHELL", "LANG", "LC_ALL", "PI_CODING_AGENT_DIR", "PI_PROFILE"].includes(key)) && typeof value === "string" && !/(?:PACKAGE_DIR|LAUNCHER_PID)$/.test(key)) persistentEnv[key] = value;
      }
      persistentEnv.OMPGUI_NO_OPEN = "1";
      if (options.password) { persistentEnv.OMPGUI_PASSWORD = options.password; persistentEnv.OMP_WEB_PASSWORD = options.password; }
      if (options.relayUrl) persistentEnv.OMPGUI_RELAY_URL = options.relayUrl;
      const config = { Label: label, ProgramArguments: [execPath, realCli, "--port", String(options.port || "30177"), "--hostname", options.hostname || "127.0.0.1", "--no-open"], WorkingDirectory: home, EnvironmentVariables: persistentEnv, RunAtLoad: true, KeepAlive: true, StandardOutPath: logPath, StandardErrorPath: logPath };
      fs.mkdirSync(path.dirname(plistPath), { recursive: true, mode: 0o700 });
      fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 });
      const temporary = `${plistPath}.${process.pid}.${require("node:crypto").randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${plistValue(config)}</plist>\n`, { mode: 0o600, flag: "wx" });
        fs.renameSync(temporary, plistPath);
      } finally { fs.rmSync(temporary, { force: true }); }
    }
    if (["enable", "disable"].includes(action)) {
      if (!before.installed) throw new Error("Service is not installed. Run ompgui service install first.");
      command([action, target]);
      return status();
    }
    if (["stop", "uninstall"].includes(action)) {
      if (before.loaded) {
        command(["bootout", target]);
        // The launcher allows 5 seconds before forcing its Next child to exit.
        const deadline = now() + 10000;
        while (command(["print", target], true) !== null) {
          if (now() >= deadline) throw new Error("Service is still stopping. Configuration was preserved; wait, check ompgui status, and retry the action.");
          pause(100);
        }
        while (before.pid !== null && processAlive(before.pid)) {
          if (now() >= deadline) throw new Error("Service process is still exiting. Configuration was preserved; wait, check ompgui status, and retry the action.");
          pause(100);
        }
      }
      if (action === "uninstall" && before.installed) fs.unlinkSync(plistPath);
    } else {
      if (!before.installed && action !== "install") throw new Error("Service is not installed. Run ompgui service install first.");
      if (action === "install") command(["enable", target]);
      if (!before.loaded) {
        const restoreDisabled = action !== "install" && before.explicitlyDisabled;
        if (restoreDisabled) command(["enable", target]);
        try {
          command(["bootstrap", domain, plistPath]);
          command(["kickstart", target]);
        }
        finally { if (restoreDisabled) command(["disable", target]); }
      } else if (action === "restart") command(["kickstart", "-k", target]);
      else if (!before.running) command(["kickstart", target]);
    }
    return status();
  }
  function updateSnapshot(packageDir) {
    if (platform !== "darwin") return null;
    const before = inspect();
    if (!before.installed || !before.running) return null;
    const config = readInstalled();
    const packagePath = path.resolve(path.dirname(fs.realpathSync(config.ProgramArguments[1])), "..");
    if (packagePath !== fs.realpathSync(packageDir)) throw new Error("Running ompgui service belongs to another installation; update that installation instead.");
    const contents = fs.readFileSync(plistPath);
    const launch = require("./ompgui-options").parseLaunchOptions(config.ProgramArguments.slice(2), config.EnvironmentVariables || {});
    return {
      packagePath, port: launch.port, hostname: launch.hostname,
      verify() {
        const current = inspect();
        if (!current.installed || !fs.readFileSync(plistPath).equals(contents) || current.explicitlyDisabled !== before.explicitlyDisabled) throw new Error("Service configuration changed during update; refusing automatic restart.");
      },
    };
  }
  return { status, execute, validate, updateSnapshot, plistPath };
}
async function runServiceCli(options) {
  const action = options.command === "service" ? options.extraPositionals[0] || "repair" : options.command;
  if (options.extraPositionals.length > (options.command === "service" ? 1 : 0)) throw new Error("Unexpected service arguments");
  const manager = createServiceManager();
  let result;
  try {
    if (options.defer) {
      if (!["stop", "restart", "uninstall"].includes(action)) throw new Error("Only stop, restart, and uninstall can be deferred");
      manager.validate(action);
      const child = spawn(process.execPath, [__filename, action], { detached: true, stdio: "ignore", env: process.env });
      const spawned = Promise.withResolvers();
      child.once("spawn", spawned.resolve);
      child.once("error", spawned.reject);
      await spawned.promise;
      child.unref();
      result = { ...manager.status(), accepted: true };
    } else result = manager.execute(action, options);
  } catch (error) { result = { ...manager.status(), error: error.message }; }
  if (options.json) console.log(JSON.stringify(result));
  else {
    console.log(`ompgui service: ${result.running ? `running (PID ${result.pid})` : "stopped"}; ${result.installed ? "installed" : "not installed"}; login auto-start ${result.autoStart ? "enabled" : "disabled"}`);
    if (result.logPath) console.log(`Logs: ${result.logPath}`);
    if (result.error) console.error(result.error);
  }
  if (result.error) process.exitCode = 1;
  return result;
}
if (require.main === module) {
  const action = process.argv[2];
  if (["stop", "restart", "uninstall"].includes(action) && process.argv.length === 3) setTimeout(() => {
    const manager = createServiceManager();
    const before = manager.status();
    try {
      const result = manager.execute(action);
      if (result.error) throw new Error(result.error);
    } catch (error) {
      process.exitCode = 1;
      if (before.logPath) {
        try { fs.appendFileSync(before.logPath, `${new Date().toISOString()} Deferred service ${action} failed: ${error.message}\n`, { mode: 0o600 }); } catch { /* No alternate secret-bearing output destination. */ }
      }
    }
  }, 1200);
  else if (action === "--check-port" && process.argv.length === 5) {
    require("./port-availability").isPortAvailable(process.argv[3], process.argv[4]).then((available) => { process.exitCode = available ? 0 : 2; }).catch(() => { process.exitCode = 1; });
  } else process.exitCode = 1;
}
module.exports = { LABEL, createServiceManager, runServiceCli };
