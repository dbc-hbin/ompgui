import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, symlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { handleFilesRequest, cleanupRelayFileTransfers } = await jiti.import("./files-requests.ts");
const { allowFileRoot } = await jiti.import("../file-access.ts");
const owner = { deviceId: "files-regression-owner", sessionId: null };
const stranger = { deviceId: "files-regression-stranger", sessionId: null };

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), "relay-transfers-"));
  allowFileRoot(dir);
  t.after(() => { cleanupRelayFileTransfers(owner.deviceId); rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

const request = (action, args, device = owner) => handleFilesRequest(action, args, device);

test("upload transfer IDs cannot cross devices and wrong order removes staging without modifying destination", async (t) => {
  const dir = workspace(t);
  const begin = await request("uploadBegin", { dir, file: "safe.txt", size: 4 });
  await assert.rejects(request("uploadChunk", { transferId: begin.transferId, offset: 0, data: "dGVzdA==" }, stranger), { code: "transfer_not_found" });
  await assert.rejects(request("uploadChunk", { transferId: begin.transferId, offset: 1, data: "dGVzdA==" }), { code: "invalid_offset" });
  assert.deepEqual(readdirSync(dir), []);
  await assert.rejects(request("uploadComplete", { transferId: begin.transferId }), { code: "transfer_not_found" });
});

test("zero-byte upload is valid and device cleanup removes pending staging", async (t) => {
  const dir = workspace(t);
  const empty = await request("uploadBegin", { dir, file: "empty.txt", size: 0 });
  await request("uploadComplete", { transferId: empty.transferId });
  assert.equal(readFileSync(join(dir, "empty.txt")).length, 0);
  const pending = await request("uploadBegin", { dir, file: "pending.txt", size: 1 });
  cleanupRelayFileTransfers(owner.deviceId);
  assert.deepEqual(readdirSync(dir), ["empty.txt"]);
  await assert.rejects(request("uploadComplete", { transferId: pending.transferId }), { code: "transfer_not_found" });
});

test("complete-time error and skip conflicts preserve files that appeared during upload", async (t) => {
  const dir = workspace(t);
  for (const conflict of ["error", "skip"]) {
    const file = `${conflict}.txt`;
    const begin = await request("uploadBegin", { dir, file, size: 1, conflict });
    await request("uploadChunk", { transferId: begin.transferId, offset: 0, data: "eA==" });
    writeFileSync(join(dir, file), "another writer");
    if (conflict === "error") await assert.rejects(request("uploadComplete", { transferId: begin.transferId }), { code: "upload_conflict" });
    else assert.equal((await request("uploadComplete", { transferId: begin.transferId })).skipped, true);
    assert.equal(readFileSync(join(dir, file), "utf8"), "another writer");
  }
  assert.equal(readdirSync(dir).some((file) => file.startsWith(".relay-upload-")), false);
});

test("overwrite rejects symlinks and directories introduced after upload begin", async (t) => {
  const dir = workspace(t);
  const victim = join(dir, "victim.txt");
  writeFileSync(victim, "preserve");
  for (const kind of ["symlink", "directory"]) {
    const begin = await request("uploadBegin", { dir, file: kind, size: 0, conflict: "overwrite" });
    if (kind === "symlink") symlinkSync(victim, join(dir, kind));
    else mkdirSync(join(dir, kind));
    await assert.rejects(request("uploadComplete", { transferId: begin.transferId }), { code: "invalid_target" });
  }
  assert.equal(readFileSync(victim, "utf8"), "preserve");
  assert.equal(readdirSync(dir).some((file) => file.startsWith(".relay-upload-")), false);
});

test("upload through a symlinked allowed root downloads using returned canonical path", async (t) => {
  const container = mkdtempSync(join(tmpdir(), "relay-alias-"));
  const physical = join(container, "physical");
  const alias = join(container, "alias");
  mkdirSync(physical);
  symlinkSync(physical, alias);
  allowFileRoot(alias);
  t.after(() => { cleanupRelayFileTransfers(owner.deviceId); rmSync(container, { recursive: true, force: true }); });
  const original = Buffer.from([0, 255, 1, 2]);
  const upload = await request("uploadBegin", { dir: alias, file: "binary.dat", size: original.length });
  await request("uploadChunk", { transferId: upload.transferId, offset: 0, data: original.toString("base64") });
  const committed = await request("uploadComplete", { transferId: upload.transferId });
  const download = await request("downloadBegin", { path: committed.path });
  const chunk = await request("downloadChunk", { transferId: download.transferId, offset: 0 });
  assert.deepEqual(Buffer.from(chunk.data, "base64"), original);
  assert.equal(chunk.complete, true);
  await request("downloadClose", { transferId: download.transferId });
});

test("download revision pin rejects edits and invalidates the transfer", async (t) => {
  const dir = workspace(t);
  const path = join(dir, "download.txt");
  writeFileSync(path, "original");
  const begin = await request("downloadBegin", { path });
  const first = await request("downloadChunk", { transferId: begin.transferId, offset: 0, length: 3 });
  assert.equal(Buffer.from(first.data, "base64").toString(), "ori");
  writeFileSync(path, "changed");
  await assert.rejects(request("downloadChunk", { transferId: begin.transferId, offset: first.nextOffset }), { code: "stale_revision" });
  await assert.rejects(request("downloadClose", { transferId: begin.transferId }), { code: "transfer_not_found" });
});
