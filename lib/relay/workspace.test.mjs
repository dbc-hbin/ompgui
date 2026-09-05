import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, statSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { listRelaySlashCommands, readRelayFile, readRelayFileChunk, writeRelayFile } = await jiti.import("./workspace.ts");
const { allowFileRoot } = await jiti.import("../file-access.ts");

test("slash.list includes web-native commands", () => {
  const commands = listRelaySlashCommands();
  assert.equal(commands.some((command) => command.name === "plan" && command.requiresArgs), true);
  assert.equal(commands.some((command) => command.name === "commit"), true);
});

test("readRelayFile returns utf8 text for allowed files", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ompgui-relay-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  allowFileRoot(dir);
  const file = join(dir, "hello.ts");
  writeFileSync(file, "export const x = 1;\n");
  const content = await readRelayFile(file);
  assert.equal(content.name, "hello.ts");
  assert.equal(content.language, "typescript");
  assert.match(content.text, /export const x/);
  assert.equal(content.encoding, "utf8");
});

test("writeRelayFile overwrites utf8 text in an allowed directory", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ompgui-relay-write-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  allowFileRoot(dir);
  const file = join(dir, "note.md");
  writeFileSync(file, "old\n");
  const original = await readRelayFile(file);
  const written = await writeRelayFile(file, "new\n", original.revision, original.contentHash);
  assert.equal(written.bytes, 4);
  assert.equal(readFileSync(file, "utf8"), "new\n");
});


test("partial UTF-8 previews cannot overwrite unseen bytes and full reads preserve boundaries", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-preview-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  allowFileRoot(dir);
  const file = join(dir, "unicode.txt");
  const original = "a".repeat(96 * 1024 - 1) + "🙂끝".repeat(2000);
  writeFileSync(file, original);
  const first = await readRelayFile(file);
  assert.equal(first.complete, false);
  assert.equal(first.contentHash, undefined);
  assert.equal(first.nextOffset, 96 * 1024 - 1);
  await assert.rejects(writeRelayFile(file, first.text, first.revision, first.contentHash), { code: "revision_required" });
  assert.equal(readFileSync(file, "utf8"), original);
  const last = await readRelayFileChunk(file, first.revision, first.nextOffset);
  assert.equal(first.text + last.text, original);
  assert.equal(last.complete, true);
  chmodSync(file, 0o640);
  const current = await readRelayFile(file);
  const ending = await readRelayFileChunk(file, current.revision, current.nextOffset);
  await writeRelayFile(file, original + "saved", current.revision, ending.contentHash);
  assert.equal(readFileSync(file, "utf8"), original + "saved");
  assert.equal(statSync(file).mode & 0o777, 0o640);
});

test("stale save and stale read retain changed file data", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-stale-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  allowFileRoot(dir);
  const file = join(dir, "note.txt");
  writeFileSync(file, "before");
  const before = await readRelayFile(file);
  writeFileSync(file, "changed by another writer");
  await assert.rejects(writeRelayFile(file, "my edit", before.revision, before.contentHash), { code: "stale_revision" });
  await assert.rejects(readRelayFileChunk(file, before.revision, 0), { code: "stale_revision" });
  assert.equal(readFileSync(file, "utf8"), "changed by another writer");
});

test("save refuses symbolic-link escape and missing files without explicit creation", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-safe-"));
  const outside = mkdtempSync(join(tmpdir(), "relay-outside-"));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });
  allowFileRoot(dir);
  const victim = join(outside, "victim.txt");
  writeFileSync(victim, "keep");
  const link = join(dir, "link.txt");
  symlinkSync(victim, link);
  await assert.rejects(writeRelayFile(link, "overwrite", "revision", "hash"), { code: "not_a_file" });
  assert.equal(readFileSync(victim, "utf8"), "keep");
  const fresh = join(dir, "new.txt");
  await assert.rejects(writeRelayFile(fresh, "new"), { code: "stale_revision" });
  await writeRelayFile(fresh, "new", undefined, undefined, true);
  assert.equal(readFileSync(fresh, "utf8"), "new");
});
