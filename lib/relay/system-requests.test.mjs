import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const systemRequests = await jiti.import("./system-requests.ts");
const { handleSystemRequest } = systemRequests;

const ctx = { deviceId: "d_testdevice0123456789", sessionId: null };

async function throwsCode(fn, code) {
  try {
    await fn();
  } catch (error) {
    assert.equal(error.code, code, `expected code ${code}, got ${error.code}: ${error.message}`);
    return error;
  }
  assert.fail(`expected throw with code ${code}`);
}

function isolateAgentDir() {
  const dir = mkdtempSync(join(tmpdir(), "ompgui-system-req-"));
  const prevDir = process.env.PI_CODING_AGENT_DIR;
  const prevOmp = process.env.OMP_PROFILE;
  const prevPi = process.env.PI_PROFILE;
  process.env.PI_CODING_AGENT_DIR = dir;
  delete process.env.OMP_PROFILE;
  delete process.env.PI_PROFILE;
  return () => {
    if (prevDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prevDir;
    if (prevOmp === undefined) delete process.env.OMP_PROFILE;
    else process.env.OMP_PROFILE = prevOmp;
    if (prevPi === undefined) delete process.env.PI_PROFILE;
    else process.env.PI_PROFILE = prevPi;
    rmSync(dir, { recursive: true, force: true });
  };
}

test("unknown system action fails", async () => {
  await throwsCode(() => handleSystemRequest("nope", {}, ctx), "unknown_action");
});

test("update never executes and reports update_disabled", async () => {
  const err = await throwsCode(() => handleSystemRequest("update", {}, ctx), "update_disabled");
  assert.equal(err.status, 400);
  assert.deepEqual(err.details, { command: "omp update" });
});

test("omp.restart requires explicit confirm", async () => {
  await throwsCode(() => handleSystemRequest("omp.restart", {}, ctx), "confirm_required");
  await throwsCode(
    () => handleSystemRequest("omp.restart", { confirm: false }, ctx),
    "confirm_required",
  );
});

test("devices.revoke validates device id", async () => {
  await throwsCode(() => handleSystemRequest("devices.revoke", {}, ctx), "invalid_args");
  await throwsCode(
    () => handleSystemRequest("devices.revoke", { deviceId: "bogus" }, ctx),
    "invalid_args",
  );
  const restore = isolateAgentDir();
  try {
    await throwsCode(
      () => handleSystemRequest("devices.revoke", { deviceId: "d_0123456789abcdef" }, ctx),
      "device_not_found",
    );
  } finally {
    restore();
  }
});

test("devices.list returns the registry device list", async () => {
  const restore = isolateAgentDir();
  try {
    const out = await handleSystemRequest("devices.list", {}, ctx);
    assert.deepEqual(out, { devices: [] });
  } finally {
    restore();
  }
});

test("systemPrompt.get requires explicit sessionId", async () => {
  await throwsCode(() => handleSystemRequest("systemPrompt.get", {}, ctx), "invalid_args");
  await throwsCode(
    () => handleSystemRequest("systemPrompt.get", { sessionId: "missing-session-xyz" }, ctx),
    "session_not_running",
  );
});

test("settings.update rejects non-object settings", async () => {
  await throwsCode(() => handleSystemRequest("settings.update", {}, ctx), "invalid_args");
  await throwsCode(
    () => handleSystemRequest("settings.update", { settings: "x" }, ctx),
    "invalid_args",
  );
});

test("settings patches preserve siblings and reject out-of-range retries before persistence", async () => {
  const restore = isolateAgentDir();
  try {
    await handleSystemRequest("settings.update", {
      settings: { textVerbosity: "low", retry: { enabled: false, maxRetries: 0 } },
    }, ctx);
    const out = await handleSystemRequest("settings.update", {
      settings: { retry: { maxRetries: 20 }, unreviewedSetting: true },
    }, ctx);
    assert.deepEqual(out.settings.retry, { enabled: false, maxRetries: 20 });
    assert.equal(out.settings.textVerbosity, "low");
    assert.equal("unreviewedSetting" in out.settings, false);
    await throwsCode(() => handleSystemRequest("settings.update", {
      settings: { retry: { maxRetries: 21 } },
    }, ctx), "settings_write_failed");
    await throwsCode(() => handleSystemRequest("settings.update", {
      settings: { tools: { approval: { bash: "invalid" } } },
    }, ctx), "settings_write_failed");
    const read = await handleSystemRequest("settings.get", {}, ctx);
    assert.deepEqual(read.settings, out.settings);
  } finally {
    restore();
  }
});

test("usage.get propagates coded usage failures without secrets", async () => {
  const restore = isolateAgentDir();
  try {
    // No omp binary in the isolated env: expect the 503 omp_not_found path.
    const prev = process.env.OMPGUI_OMP_BIN;
    process.env.OMPGUI_OMP_BIN = join(tmpdir(), "ompgui-no-such-omp-bin");
    try {
      await throwsCode(() => handleSystemRequest("usage.get", {}, ctx), "omp_not_found");
      await throwsCode(
        () => handleSystemRequest("usage.get", { refresh: true }, ctx),
        "omp_not_found",
      );
      await throwsCode(
        () => handleSystemRequest("usage.get", { refresh: "yes" }, ctx),
        "invalid_args",
      );
    } finally {
      if (prev === undefined) delete process.env.OMPGUI_OMP_BIN;
      else process.env.OMPGUI_OMP_BIN = prev;
    }
  } finally {
    restore();
  }
});
