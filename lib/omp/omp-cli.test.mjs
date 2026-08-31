import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

test("getOmpVersion observes an in-place OMP update", { skip: process.platform === "win32" }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ompgui-omp-version-"));
  const bin = join(dir, "omp");
  const previousOverride = process.env.OMPGUI_OMP_BIN;

  t.after(async () => {
    if (previousOverride === undefined) delete process.env.OMPGUI_OMP_BIN;
    else process.env.OMPGUI_OMP_BIN = previousOverride;
    await rm(dir, { recursive: true, force: true });
  });

  const writeVersion = async (version) => {
    await writeFile(bin, `#!/bin/sh\nprintf 'omp/${version}\\n'\n`);
    await chmod(bin, 0o755);
  };

  await writeVersion("18.0.7");
  process.env.OMPGUI_OMP_BIN = bin;
  const { getOmpVersion, invalidateOmpCliCache } = jiti("./omp-cli.ts");

  assert.equal(await getOmpVersion(), "omp/18.0.7");
  await writeVersion("18.0.11");
  assert.equal(await getOmpVersion(), "omp/18.0.7");
  invalidateOmpCliCache();
  assert.equal(await getOmpVersion(), "omp/18.0.11");
});
