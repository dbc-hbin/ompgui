import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

test("getOmpVersion observes in-place updates, symlink retargeting, and coalesces concurrent probes", { skip: process.platform === "win32" }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ompgui-omp-version-"));
  const bin = join(dir, "omp");
  const previousOverride = process.env.OMPGUI_OMP_BIN;

  t.after(async () => {
    if (previousOverride === undefined) delete process.env.OMPGUI_OMP_BIN;
    else process.env.OMPGUI_OMP_BIN = previousOverride;
    await rm(dir, { recursive: true, force: true });
  });

  const writeVersion = async (path, version, mtimeOffsetSec = 0) => {
    await writeFile(path, `#!/bin/sh\nprintf 'omp/${version}\\n'\n`);
    await chmod(path, 0o755);
    if (mtimeOffsetSec !== 0) {
      const targetTime = new Date(Date.now() + mtimeOffsetSec * 1000);
      await utimes(path, targetTime, targetTime);
    }
  };

  await writeVersion(bin, "18.0.7");
  process.env.OMPGUI_OMP_BIN = bin;
  const { getOmpVersion, invalidateOmpCliCache } = jiti("./omp-cli.ts");

  assert.equal(await getOmpVersion(), "omp/18.0.7");
  // Second call without modification hits cache
  assert.equal(await getOmpVersion(), "omp/18.0.7");

  // In-place binary update with new mtime is detected automatically without server restart
  await writeVersion(bin, "18.0.11", 5);
  // Concurrent calls coalesce to the same probe result
  const [v1, v2, v3] = await Promise.all([getOmpVersion(), getOmpVersion(), getOmpVersion()]);
  assert.equal(v1, "omp/18.0.11");
  assert.equal(v2, "omp/18.0.11");
  assert.equal(v3, "omp/18.0.11");

  // Symlink retargeting is detected even when target files share timestamps
  const targetA = join(dir, "targetA");
  const targetB = join(dir, "targetB");
  const linkBin = join(dir, "omp-link");
  const fixedTime = new Date(Date.now() + 10_000);
  await writeVersion(targetA, "18.1.0");
  await writeVersion(targetB, "18.1.3");
  await utimes(targetA, fixedTime, fixedTime);
  await utimes(targetB, fixedTime, fixedTime);

  await symlink(targetA, linkBin);
  process.env.OMPGUI_OMP_BIN = linkBin;
  invalidateOmpCliCache();
  assert.equal(await getOmpVersion(), "omp/18.1.0");

  // Retarget symlink to targetB
  await rm(linkBin);
  await symlink(targetB, linkBin);
  assert.equal(await getOmpVersion(), "omp/18.1.3");
});
