import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { __fileLockInternals, resolveNativeConfigWritePath, withNativeConfigLock } = await jiti.import("./file-lock.ts");

function temporaryConfigPath() {
  const root = mkdtempSync(join(tmpdir(), "ompgui-native-lock-"));
  return { root, filePath: join(root, "settings.json") };
}

test("matches OMP's seeded xxh64 native lock names", async () => {
  const vectors = [
    ["", "omp-file-lock-dd4458733774f8b02ff557a2e70c6e06"],
    ["/tmp/settings.json.lock", "omp-file-lock-4ac0192b1db690c796ba90660065da49"],
    ["C:\\Users\\test\\settings.json.lock", "omp-file-lock-7f0905010eb322e748d36285df305e77"],
    ["설정/경로.lock", "omp-file-lock-a23ca8bad6dea0ec945413627e4f98a6"],
  ];

  for (const [input, expected] of vectors) {
    assert.equal(await __fileLockInternals.memoryLockName(input), expected);
  }
});

test("native write identity keeps missing leaves lexical and resolves leaf symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "ompgui-native-path-"));
  try {
    const physical = join(root, "physical");
    const alias = join(root, "alias");
    mkdirSync(physical);
    symlinkSync(physical, alias);
    const missingThroughAlias = join(alias, "config.yml");
    assert.equal(resolveNativeConfigWritePath(missingThroughAlias), missingThroughAlias);

    const target = join(physical, "target.yml");
    const leafAlias = join(root, "config.yml");
    writeFileSync(target, "{}\n", "utf8");
    symlinkSync(target, leafAlias);
    assert.equal(resolveNativeConfigWritePath(leafAlias), realpathSync(target));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("serializes contenders and retries after ownership is released", async () => {
  const { root, filePath } = temporaryConfigPath();
  const entered = Promise.withResolvers();
  const releaseOwner = Promise.withResolvers();
  try {
    const owner = withNativeConfigLock(filePath, async () => {
      entered.resolve();
      await releaseOwner.promise;
      return "owner";
    });
    await entered.promise;

    let sleeps = 0;
    const contender = __fileLockInternals.withLock(
      filePath,
      () => "successor",
      {
        attempts: 3,
        retryDelayMs: 17,
        sleep: async (milliseconds) => {
          assert.equal(milliseconds, 17);
          sleeps += 1;
          releaseOwner.resolve();
          assert.equal(await owner, "owner");
        },
      },
    );

    assert.equal(await contender, "successor");
    assert.equal(sleeps, 1);
  } finally {
    releaseOwner.resolve();
    rmSync(root, { recursive: true, force: true });
  }
});

test("times out after the configured attempts without entering the callback", async () => {
  const { root, filePath } = temporaryConfigPath();
  const entered = Promise.withResolvers();
  const releaseOwner = Promise.withResolvers();
  try {
    const owner = withNativeConfigLock(filePath, async () => {
      entered.resolve();
      await releaseOwner.promise;
    });
    await entered.promise;

    let sleeps = 0;
    let callbackEntered = false;
    await assert.rejects(
      __fileLockInternals.withLock(
        filePath,
        () => {
          callbackEntered = true;
        },
        {
          attempts: 3,
          retryDelayMs: 23,
          sleep: async (milliseconds) => {
            assert.equal(milliseconds, 23);
            sleeps += 1;
          },
        },
      ),
      /Failed to acquire lock .* after 3 attempts/,
    );
    assert.equal(sleeps, 2);
    assert.equal(callbackEntered, false);

    releaseOwner.resolve();
    await owner;
  } finally {
    releaseOwner.resolve();
    rmSync(root, { recursive: true, force: true });
  }
});

test("releases ownership after callback success and failure", async () => {
  const { root, filePath } = temporaryConfigPath();
  try {
    assert.equal(await withNativeConfigLock(filePath, () => 42), 42);
    await assert.rejects(
      withNativeConfigLock(filePath, () => {
        throw new Error("callback failed");
      }),
      /callback failed/,
    );
    assert.equal(await withNativeConfigLock(filePath, () => "reacquired"), "reacquired");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("process exit releases native ownership", async () => {
  const { root, filePath } = temporaryConfigPath();
  const moduleUrl = pathToFileURL(join(import.meta.dirname, "file-lock.ts")).href;
  const childSource = `
    import { withNativeConfigLock } from ${JSON.stringify(moduleUrl)};
    process.on("message", () => process.exit(0));
    await withNativeConfigLock(${JSON.stringify(filePath)}, async () => {
      process.send("locked");
      await Promise.withResolvers().promise;
    });
  `;
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", childSource],
    { stdio: ["ignore", "ignore", "inherit", "ipc"] },
  );

  try {
    const startup = await Promise.race([
      once(child, "message").then(([message]) => ({ message })),
      once(child, "exit").then(([code, signal]) => ({ exit: { code, signal } })),
      once(child, "error").then(([error]) => ({ error })),
    ]);
    assert.deepEqual(startup, { message: "locked" });
    child.send("exit");
    const [exitCode, signal] = await once(child, "exit");
    assert.equal(exitCode, 0);
    assert.equal(signal, null);
    assert.equal(await withNativeConfigLock(filePath, () => "successor"), "successor");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    rmSync(root, { recursive: true, force: true });
  }
});
