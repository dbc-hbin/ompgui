import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  archiveSessionFileWithArtifacts,
  listArchivedSessionInfos,
  restoreArchivedSessionWithArtifacts,
  SessionArchiveError,
} = await jiti.import("./session-files.ts");

test("archives native JSONL and sibling artifacts with an exact gzip round trip", () => {
  const root = mkdtempSync(join(tmpdir(), "ompgui-archive-test-"));
  try {
    const sessionsRoot = join(root, "sessions");
    const archiveRoot = join(root, "archive", "sessions");
    const projectDir = join(sessionsRoot, "project");
    const source = join(projectDir, "2026_session.jsonl");
    const artifacts = join(projectDir, "2026_session");
    const original = Buffer.from('{"type":"session","version":3,"id":"abc"}\n{"type":"message"}\n', "utf8");
    mkdirSync(artifacts, { recursive: true });
    writeFileSync(source, original);
    writeFileSync(join(artifacts, "child.jsonl"), "child\n");

    const archived = archiveSessionFileWithArtifacts(source, { sessionsRoot, archiveRoot });

    assert.equal(archived, join(archiveRoot, "project", "2026_session.jsonl.gz"));
    assert.equal(existsSync(source), false);
    assert.equal(existsSync(artifacts), false);
    assert.deepEqual(gunzipSync(readFileSync(archived)), original);
    assert.equal(readFileSync(join(archiveRoot, "project", "2026_session.jsonl", "child.jsonl"), "utf8"), "child\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects paths outside the active sessions root before creating an archive", () => {
  const root = mkdtempSync(join(tmpdir(), "ompgui-archive-test-"));
  try {
    const sessionsRoot = join(root, "sessions");
    const outside = join(root, "outside.jsonl");
    mkdirSync(sessionsRoot, { recursive: true });
    writeFileSync(outside, "not a session\n");
    assert.throws(
      () => archiveSessionFileWithArtifacts(outside, { sessionsRoot, archiveRoot: join(root, "archive") }),
      /outside the active OMP sessions directory/,
    );
    assert.equal(existsSync(outside), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lists searchable archive metadata and restores the transcript with artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "ompgui-archive-test-"));
  try {
    const sessionsRoot = join(root, "sessions");
    const archiveRoot = join(root, "archive", "sessions");
    const source = join(sessionsRoot, "project", "abc.jsonl");
    const artifacts = join(sessionsRoot, "project", "abc");
    const original = Buffer.from('{"type":"session","version":3,"id":"abc","title":"Archived task","timestamp":"2026-08-20T10:00:00.000Z","cwd":"/tmp/project"}\n', "utf8");
    mkdirSync(artifacts, { recursive: true });
    writeFileSync(source, original);
    writeFileSync(join(artifacts, "child.jsonl"), "child\n");
    archiveSessionFileWithArtifacts(source, { sessionsRoot, archiveRoot });

    const listed = await listArchivedSessionInfos({ sessionsRoot, archiveRoot });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].key, "project/abc.jsonl.gz");
    assert.equal(listed[0].name, "Archived task");
    assert.equal(listed[0].hasArtifacts, true);

    const restored = await restoreArchivedSessionWithArtifacts("project/abc.jsonl.gz", { sessionsRoot, archiveRoot });
    assert.equal(restored.id, "abc");
    assert.deepEqual(readFileSync(restored.path), original);
    assert.equal(readFileSync(join(sessionsRoot, "project", "abc", "child.jsonl"), "utf8"), "child\n");
    assert.equal(existsSync(join(archiveRoot, "project", "abc.jsonl.gz")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects traversal keys and active destination conflicts without touching the archive", async () => {
  const root = mkdtempSync(join(tmpdir(), "ompgui-archive-test-"));
  try {
    const sessionsRoot = join(root, "sessions");
    const archiveRoot = join(root, "archive", "sessions");
    const archivePath = join(archiveRoot, "project", "abc.jsonl.gz");
    mkdirSync(join(sessionsRoot, "project"), { recursive: true });
    mkdirSync(join(archiveRoot, "project"), { recursive: true });
    writeFileSync(archivePath, gzipSync(Buffer.from('{"type":"session","id":"abc"}\n', "utf8")));
    await assert.rejects(
      () => restoreArchivedSessionWithArtifacts("../project/abc.jsonl.gz", { sessionsRoot, archiveRoot }),
      (error) => error instanceof SessionArchiveError && error.code === "invalid_key",
    );
    writeFileSync(join(sessionsRoot, "project", "abc.jsonl"), "active\n");
    await assert.rejects(
      () => restoreArchivedSessionWithArtifacts("project/abc.jsonl.gz", { sessionsRoot, archiveRoot }),
      (error) => error instanceof SessionArchiveError && error.code === "destination_conflict",
    );
    assert.equal(existsSync(archivePath), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid restored headers leave the compressed archive recoverable", async () => {
  const root = mkdtempSync(join(tmpdir(), "ompgui-archive-test-"));
  try {
    const sessionsRoot = join(root, "sessions");
    const archiveRoot = join(root, "archive", "sessions");
    const archivePath = join(archiveRoot, "project", "broken.jsonl.gz");
    mkdirSync(join(archiveRoot, "project"), { recursive: true });
    writeFileSync(archivePath, gzipSync(Buffer.from('{"type":"message"}\n', "utf8")));
    await assert.rejects(
      () => restoreArchivedSessionWithArtifacts("project/broken.jsonl.gz", { sessionsRoot, archiveRoot }),
      (error) => error instanceof SessionArchiveError && error.code === "invalid_session_header",
    );
    assert.equal(existsSync(archivePath), true);
    assert.equal(existsSync(join(sessionsRoot, "project", "broken.jsonl")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
