import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const { createServiceManager, LABEL } = require("./ompgui-service");

function fixture(t, { installed = true, loaded = true, disabled = false, stoppingPolls = 0, portAvailable = () => true } = {}) {
  let running = loaded;
  let stopping = false;
  let time = 0;
  const home = mkdtempSync(join(tmpdir(), "ompgui-service-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const pkg = join(home, "node_modules", "ompgui");
  mkdirSync(join(pkg, "bin"), { recursive: true });
  mkdirSync(join(pkg, ".next"));
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "ompgui" }));
  writeFileSync(join(pkg, "bin", "ompgui.js"), "");
  writeFileSync(join(pkg, ".next", "BUILD_ID"), "built");
  const config = { Label: LABEL, ProgramArguments: [process.execPath, join(pkg, "bin", "ompgui.js")], EnvironmentVariables: { OMPGUI_PASSWORD: "secret<>&", OMPGUI_RELAY_URL: "wss://private.example/relay" }, RunAtLoad: true, KeepAlive: true, StandardOutPath: join(home, "existing.log") };
  const calls = [];
  let failure = null;
  let source = null;
  let manager;
  const run = (binary, args) => {
    if (binary.endsWith("plutil")) return { status: 0, stdout: JSON.stringify(config) };
    calls.push(args);
    if (args[0] === failure) return { status: 1, stderr: "permission denied secret" };
    if (args[0] === "print" && stopping) {
      assert.equal(existsSync(manager.plistPath), true, "configuration must remain until the loaded service disappears");
      if (stoppingPolls-- <= 0) { loaded = false; stopping = false; }
    }
    if (args[0] === "print") return loaded ? { status: 0, stdout: `path = ${source || manager.plistPath}\n${running ? "state = running\npid = 4242\n" : "state = not running\n"}` } : { status: 113 };
    if (args[0] === "print-disabled") return { status: 0, stdout: `"${LABEL}" => ${disabled ? "disabled" : "enabled"}` };
    if (args[0] === "bootout") { stopping = stoppingPolls > 0; loaded = stopping; running = false; }
    if (args[0] === "bootstrap") { loaded = true; running = config.RunAtLoad || config.KeepAlive; }
    if (args[0] === "kickstart") {
      if (stopping) return { status: 5, stderr: "service is stopping" };
      loaded = true; running = true;
    }
    if (args[0] === "disable") disabled = true;
    if (args[0] === "enable") disabled = false;
    return { status: 0, stdout: "" };
  };
  manager = createServiceManager({ now: () => time, pause: (milliseconds) => { time += milliseconds; }, platform: "darwin", home, cliPath: config.ProgramArguments[1], run, portAvailable, env: config.EnvironmentVariables });
  mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
  if (installed) writeFileSync(manager.plistPath, "original plist including secrets", { mode: 0o600 });
  return { manager, config, calls, fail: (value) => { failure = value; }, source: (value) => { source = value; } };
}

test("stop retains login registration and secrets; start restores runtime", (t) => {
  const { manager } = fixture(t);
  const original = readFileSync(manager.plistPath);
  const stopped = manager.execute("stop");
  assert.equal(stopped.running, false);
  assert.equal(stopped.autoStart, true);
  assert.deepEqual(readFileSync(manager.plistPath), original);
  assert.equal(manager.execute("start").running, true);
  assert.doesNotMatch(JSON.stringify(manager.status()), /secret|private\.example/);
});

test("disabling login startup leaves server running and survives subsequent start", (t) => {
  const { manager } = fixture(t);
  assert.equal(manager.execute("disable").running, true);
  assert.equal(manager.status().autoStart, false);
  manager.execute("stop");
  const started = manager.execute("start");
  assert.equal(started.running, true);
  assert.equal(started.autoStart, false);
  assert.equal(manager.execute("enable").autoStart, true);
});

test("repair and repeated install preserve existing production executable and secret configuration", (t) => {
  const { manager, calls } = fixture(t);
  const original = readFileSync(manager.plistPath);
  manager.execute("install", { password: "replacement" });
  manager.execute("repair");
  assert.deepEqual(readFileSync(manager.plistPath), original);
  assert.equal(calls.filter(([action]) => action === "bootstrap").length, 0);
  assert.ok(calls.some(([action, flag]) => action === "kickstart" && flag === "-k"));
});

test("uninstall is idempotent and removes only verified registration", (t) => {
  const { manager } = fixture(t);
  const removed = manager.execute("uninstall");
  assert.equal(removed.installed, false);
  assert.equal(removed.running, false);
  assert.equal(existsSync(manager.plistPath), false);
  assert.equal(manager.execute("uninstall").installed, false);
});

test("uninstall waits for dying launchd registration before removing configuration", (t) => {
  const { manager } = fixture(t, { stoppingPolls: 3 });
  const state = manager.execute("uninstall");
  assert.equal(state.error, undefined);
  assert.equal(state.installed, false);
  assert.equal(state.running, false);
  assert.equal(manager.execute("uninstall").error, undefined);
});

test("stop waits for unload so immediate start can safely bootstrap", (t) => {
  const { manager } = fixture(t, { stoppingPolls: 3 });
  const stopped = manager.execute("stop");
  assert.equal(stopped.running, false);
  assert.equal(stopped.pid, null);
  assert.equal(manager.execute("start").running, true);
});

test("unload timeout preserves configuration and reports retry instructions", (t) => {
  const { manager } = fixture(t, { stoppingPolls: Infinity });
  const original = readFileSync(manager.plistPath);
  assert.throws(() => manager.execute("uninstall"), /still stopping.*Configuration was preserved.*retry/);
  assert.deepEqual(readFileSync(manager.plistPath), original);
  assert.equal(manager.status().pid, null);
});

test("foreign plist and loaded service source are never mutated", (t) => {
  const { manager, config, calls, source } = fixture(t);
  config.Label = "foreign";
  assert.throws(() => manager.execute("uninstall"), /not owned/);
  config.Label = LABEL;
  source("/some/other.plist");
  assert.throws(() => manager.execute("restart"), /unverified ownership/);
  assert.equal(calls.some(([action]) => ["bootout", "kickstart"].includes(action)), false);
  assert.equal(existsSync(manager.plistPath), true);
});

test("launchctl failures do not masquerade as missing service or delete configuration", (t) => {
  const { manager, fail } = fixture(t);
  fail("print");
  assert.match(manager.status().error, /launchctl print failed/);
  assert.throws(() => manager.execute("uninstall"), /launchctl print failed/);
  fail("bootout");
  assert.throws(() => manager.execute("uninstall"), /bootout failed/);
  assert.equal(existsSync(manager.plistPath), true);
  assert.doesNotMatch(JSON.stringify(manager.status()), /secret/);
});

test("new installation escapes secret values and writes private atomic plist", (t) => {
  const { manager, config } = fixture(t, { installed: false, loaded: false });
  config.EnvironmentVariables.PI_CODING_AGENT_DIR = "/private/agent & profiles";
  config.EnvironmentVariables.PI_PROFILE = "work-profile";
  const state = manager.execute("install");
  assert.equal(state.running, true);
  assert.equal(statSync(manager.plistPath).mode & 0o777, 0o600);
  const persisted = readFileSync(manager.plistPath, "utf8");
  assert.match(persisted, /secret&lt;&gt;&amp;/);
  assert.match(persisted, /<key>PI_CODING_AGENT_DIR<\/key><string>\/private\/agent &amp; profiles<\/string>/);
  assert.match(persisted, /<key>PI_PROFILE<\/key><string>work-profile<\/string>/);
});

test("fresh install refuses occupied port without registering or changing launchd", (t) => {
  const { manager, calls } = fixture(t, { installed: false, loaded: false, portAvailable: (port, hostname) => {
    assert.equal(port, "31337");
    assert.equal(hostname, "127.0.0.1");
    return false;
  } });
  assert.throws(() => manager.execute("install", { port: "31337", hostname: "127.0.0.1" }), /Stop the foreground server.*service install/);
  assert.equal(existsSync(manager.plistPath), false);
  assert.equal(calls.some(([action]) => !["print", "print-disabled"].includes(action)), false);
});

test("manual start checks existing service endpoint and preserves config on conflict", (t) => {
  const { manager, config, calls } = fixture(t, { loaded: false, portAvailable: (port, hostname) => {
    assert.equal(port, "31338");
    assert.equal(hostname, "::1");
    return false;
  } });
  config.ProgramArguments.push("--port", "31338", "--hostname", "::1");
  const original = readFileSync(manager.plistPath);
  assert.throws(() => manager.execute("start"), /service start/);
  assert.deepEqual(readFileSync(manager.plistPath), original);
  assert.equal(calls.some(([action]) => !["print", "print-disabled"].includes(action)), false);
});

test("explicit start, restart, and repair run unloaded agents without launch triggers", (t) => {
  const { manager, config } = fixture(t, { loaded: false, disabled: true });
  config.RunAtLoad = false;
  config.KeepAlive = false;
  for (const action of ["start", "restart", "repair"]) {
    const result = manager.execute(action);
    assert.equal(result.running, true, `${action} must start a process rather than only load registration`);
    assert.equal(result.autoStart, false);
    manager.execute("stop");
  }
});

test("unsupported systems provide status without invoking launchctl", () => {
  const manager = createServiceManager({ platform: "linux", run: () => { throw new Error("must not execute"); } });
  assert.equal(manager.status().supported, false);
  assert.match(manager.status().error, /only on macOS/);
  assert.throws(() => manager.execute("start"), /only on macOS/);
});
