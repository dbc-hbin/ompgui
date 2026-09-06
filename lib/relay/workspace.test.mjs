import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, statSync, chmodSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { listRelayFiles, previewRelayFile, relayFileRevision, listRelaySlashCommands, readRelayFile, readRelayFileChunk, writeRelayFile } = await jiti.import("./workspace.ts");
const { allowFileRoot } = await jiti.import("../file-access.ts");

const { previewDocxFile } = await jiti.import("../file-preview.ts");
const { handleFilesRequest, cleanupRelayFileTransfers } = await jiti.import("./files-requests.ts");
const require = createRequire(import.meta.url);
const JSZip = createRequire(require.resolve("mammoth"))("jszip");

async function docxBytes(text = "Readable document") {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml"><w:body><w:p><w:r><w:pict><v:shape><v:imagedata r:id="image"/></v:shape></w:pict></w:r></w:p><w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:p><w:hyperlink r:id="bad"><w:r><w:t>unsafe link</w:t></w:r></w:hyperlink></w:p></w:body></w:document>`);
  zip.file("word/_rels/document.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="bad" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/><Relationship Id="image" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image.png"/></Relationships>');
  zip.file("word/media/image.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==", "base64"));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

test("listing includes hidden configuration but excludes ignored paths, escapes and active staging", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-hidden-"));
  const outside = mkdtempSync(join(tmpdir(), "relay-hidden-outside-"));
  const context = { deviceId: "hidden-preview-test" };
  t.after(() => { cleanupRelayFileTransfers(context.deviceId); rmSync(dir, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });
  allowFileRoot(dir);
  for (const name of [".config", ".git", "build"]) mkdirSync(join(dir, name));
  for (const name of [".env", "module.pyc", ".relay-upload-user.tmp"]) writeFileSync(join(dir, name), "private");
  writeFileSync(join(dir, ".config", "settings.json"), "{}");
  symlinkSync(outside, join(dir, ".escape"));
  const transfer = await handleFilesRequest("uploadBegin", { dir, file: "new.txt", size: 1 }, context);
  const listing = await listRelayFiles(dir);
  assert.deepEqual(listing.entries.map((entry) => entry.name).sort(), [".config", ".env", ".relay-upload-user.tmp"]);
  assert.deepEqual((await listRelayFiles(join(dir, ".config"))).entries.map((entry) => entry.name), ["settings.json"]);
  await assert.rejects(listRelayFiles(join(dir, ".escape")), { code: "access_denied" });
  await handleFilesRequest("uploadAbort", { transferId: transfer.transferId }, context);
});

test("DOCX relay and shared web conversion produce sanitized readable HTML with revision and size guards", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-docx-"));
  const outside = mkdtempSync(join(tmpdir(), "relay-docx-outside-"));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });
  allowFileRoot(dir);
  const file = join(dir, "document.docx");
  writeFileSync(file, await docxBytes());
  const revision = relayFileRevision(file);
  const relay = await previewRelayFile(file, revision);
  const shared = await previewDocxFile(file, revision);
  assert.equal(relay.html, shared.html);
  assert.equal(relay.mime, "text/html");
  assert.equal(relay.revision, revision);
  assert.match(relay.html, /<p>Readable document<\/p>/);
  assert.doesNotMatch(relay.html, /javascript:|<script/i);
  assert.match(relay.html, /src="data:image\/png;base64,/);
  await assert.rejects(previewDocxFile(file, revision, 20), { code: "preview_too_large" });
  writeFileSync(file, await docxBytes("Updated document"));
  await assert.rejects(previewRelayFile(file, revision), { code: "stale_revision" });
  writeFileSync(join(dir, "plain.txt"), "not DOCX");
  await assert.rejects(previewRelayFile(join(dir, "plain.txt")), { code: "preview_unavailable" });
  writeFileSync(join(outside, "secret.docx"), await docxBytes("Secret document"));
  symlinkSync(join(outside, "secret.docx"), join(dir, "escape.docx"));
  await assert.rejects(previewRelayFile(join(dir, "escape.docx")), { code: "access_denied" });
  writeFileSync(file, Buffer.alloc(10 * 1024 * 1024 + 1));
  await assert.rejects(previewRelayFile(file), { code: "docx_too_large" });
});

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
