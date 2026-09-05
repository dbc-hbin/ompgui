import { chmodSync, closeSync, constants, existsSync, fsyncSync, linkSync, lstatSync, openSync, readdirSync, readSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { getGitFileDiff, getGitStatus } from "../git-changes";
import { createHash, randomUUID } from "node:crypto";
import { comparableProjectPath } from "../comparable-path";
import { allowFileRoot, getAllowedFileRoots, isExistingFilePathAllowed } from "../file-access";
import { buildEntriesFromFiles, filterFileEntries } from "../file-fuzzy";
import { getImageMime, getAudioMime, getDocumentMime, documentPreviewKind } from "../file-types";
import { addWorktree, findCurrentWorktreePath, listWorktrees, resolveProject } from "../worktree";
import type { WorktreeInfo } from "../worktree";
import { resolveDirentIsDirectory } from "../file-dirent";
import { loadProjectRegistry, hideProject, mergeProjects, ProjectPathError, saveProjectRegistry, upsertProject, validateProjectPath } from "../project-registry";
import { invalidateSessionListCache, listAllSessions } from "../session-reader";
import { startRpcSession } from "../rpc-manager";
import { WEB_SLASH_COMMANDS } from "../web-slash-commands";
import { RelaySessionError } from "./session-runtime";
import { RELAY_MAX_PROMPT_CHARS } from "./protocol";

const IGNORED_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
  "target", "vendor", ".DS_Store",
]);


const THINKING_LEVELS = new Set(["auto", "minimal", "low", "medium", "high", "xhigh", "max"]);

export type RelayProject = {
  path: string;
  name: string;
  addedAt?: string;
};

export type RelayFileEntry = {
  name: string;
  path: string;
  dir: boolean;
};

export type RelaySlashCommand = {
  name: string;
  requiresArgs: boolean;
  hint: string;
};

export type RelayCreateSessionInput = {
  cwd: string;
  message?: string;
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
  toolNames?: string[];
  advisor?: boolean;
};

export async function listRelayProjects(): Promise<RelayProject[]> {
  const registry = loadProjectRegistry();
  const sessions = await listAllSessions();
  const discovered = sessions
    .map((session) => session.projectRoot ?? session.cwd)
    .filter((path): path is string => Boolean(path));
  const projects = mergeProjects(registry, discovered);
  for (const project of projects) allowFileRoot(project.path);
  return projects.map((project) => ({
    path: project.path,
    name: basename(project.path) || project.path,
    ...(project.addedAt ? { addedAt: project.addedAt } : {}),
  }));
}

export async function listRelayFiles(rawPath: string | undefined, offset = 0, limit = 100): Promise<{
  path: string;
  entries: RelayFileEntry[];
  total: number; offset: number; limit: number; hasMore: boolean;
}> {
  const roots = await getAllowedFileRoots();
  const requested = (rawPath ?? "").trim();
  const target = requested
    ? resolve(requested)
    : [...roots][0] ?? homedir();

  if (!isExistingFilePathAllowed(target, roots)) {
    throw new RelaySessionError("access_denied", "Path is outside allowed workspaces");
  }
  let stat;
  try {
    stat = statSync(target);
  } catch {
    throw new RelaySessionError("path_not_found", "Path not found");
  }
  if (!stat.isDirectory()) {
    throw new RelaySessionError("not_a_directory", "Path is not a directory");
  }

  const entries: RelayFileEntry[] = [];
  let dirents;
  try {
    dirents = readdirSync(target, { withFileTypes: true });
  } catch {
    throw new RelaySessionError("access_denied", "Could not read directory");
  }
  const sorted = [...dirents].sort((a, b) => a.name.localeCompare(b.name));
  for (const dirent of sorted) {
    if (IGNORED_NAMES.has(dirent.name) || dirent.name.startsWith(".")) continue;
    const full = join(target, dirent.name);
    if (!isExistingFilePathAllowed(full, roots)) continue;
    const isDir = resolveDirentIsDirectory(dirent, full);
    if (isDir === null) continue;
    entries.push({ name: dirent.name, path: full, dir: isDir });
  }
  const page = relayPage(offset, limit);
  return { path: target, entries: entries.slice(page.offset, page.offset + page.limit), total: entries.length, ...page, hasMore: page.offset + page.limit < entries.length };
}

export function listRelaySlashCommands(): RelaySlashCommand[] {
  return WEB_SLASH_COMMANDS.map((command) => ({
    name: command.name,
    requiresArgs: command.requiresArgs,
    hint: command.name,
  }));
}

export async function createRelaySession(input: RelayCreateSessionInput): Promise<{ sessionId: string }> {
  let cwd: string;
  try {
    cwd = validateProjectPath(input.cwd);
  } catch (error) {
    if (error instanceof ProjectPathError) {
      throw new RelaySessionError(error.code, error.message);
    }
    throw error;
  }
  if (!existsSync(cwd)) {
    throw new RelaySessionError("directory_not_found", `Directory does not exist: ${cwd}`);
  }

  const message = input.message?.trim() ?? "";
  if (message.length > RELAY_MAX_PROMPT_CHARS) {
    throw new RelaySessionError("invalid_command", "prompt message is too long");
  }
  const thinking = input.thinkingLevel?.trim();
  if (thinking && !THINKING_LEVELS.has(thinking)) {
    throw new RelaySessionError("invalid_command", "Unknown thinking level");
  }
  const provider = input.provider?.trim();
  const modelId = input.modelId?.trim();
  if ((provider && !modelId) || (!provider && modelId)) {
    throw new RelaySessionError("invalid_command", "set_model requires provider and modelId");
  }

  const tempKey = `__new__${randomUUID()}`;
  const { session, realSessionId } = await startRpcSession(tempKey, "", cwd, input.toolNames, input.advisor ?? false);
  allowFileRoot(cwd);
  invalidateSessionListCache();

  if (provider && modelId) {
    await session.send({ type: "set_model", provider, modelId });
  }
  if (thinking) {
    await session.send({ type: "set_thinking_level", level: thinking });
  }
  if (message) {
    await session.send({ type: "prompt", message });
  }
  return { sessionId: realSessionId };
}

const RELAY_TEXT_PREVIEW_BYTES = 96 * 1024;

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  mjs: "javascript", py: "python", go: "go", rs: "rust", java: "java",
  kt: "kotlin", json: "json", md: "markdown", yml: "yaml", yaml: "yaml",
  sh: "bash", css: "css", html: "html", txt: "text",
};

export type RelayFileContent = {
  path: string; name: string; language?: string; text: string;
  revision: string; size: number; nextOffset: number; complete: boolean;
  contentHash?: string; truncated: boolean; bytes: number; encoding: "utf8";
};

export type RelayWorktreeList = {
  cwd: string;
  projectRoot: string;
  isGit: boolean;
  currentWorktreePath: string | null;
  worktrees: Array<{ path: string; branch: string | null; isMain: boolean }>;
};

export async function assertAllowedPath(rawPath: string): Promise<string> {
  const roots = await getAllowedFileRoots();
  const target = resolve(rawPath.trim());
  if (!isExistingFilePathAllowed(target, roots)) {
    throw new RelaySessionError("access_denied", "Path is outside allowed workspaces");
  }
  return target;
}

export function relayPage(offset = 0, limit = 100): { offset: number; limit: number } {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new RelaySessionError("invalid_args", "Invalid pagination (limit must be 1–100)");
  }
  return { offset, limit };
}

export function relayFileRevision(path: string): string {
  const stat = statSync(path, { bigint: true });
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

export function relayContentHash(path: string): string {
  const fd = openSync(path, "r");
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(128 * 1024);
    let count: number;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
    return hash.digest("hex");
  } finally { closeSync(fd); }
}

export async function relayFileMeta(rawPath: string) {
  const path = await assertAllowedPath(rawPath);
  const stat = statSync(path);
  if (!stat.isFile() && !stat.isDirectory()) throw new RelaySessionError("not_a_file", "Unsupported file type");
  const image = getImageMime(path);
  const audio = getAudioMime(path);
  const document = documentPreviewKind(path);
  let previewKind = image ? "image" : audio ? "audio" : document ?? "text";
  if (stat.isFile() && previewKind === "text") {
    const fd = openSync(path, "r");
    try {
      const buffer = Buffer.allocUnsafe(Math.min(stat.size, 8192));
      const count = readSync(fd, buffer, 0, buffer.length, 0);
      if (buffer.subarray(0, count).includes(0)) previewKind = "binary";
      else {
        try { new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, count), { stream: count < stat.size }); }
        catch { previewKind = "binary"; }
      }
    } finally { closeSync(fd); }
  }
  const ext = basename(path).toLowerCase().split(".").pop() ?? "";
  const textMime: Record<string, string> = { json: "application/json", html: "text/html", css: "text/css", csv: "text/csv", js: "text/javascript", mjs: "text/javascript", xml: "application/xml", md: "text/markdown" };
  return { path, name: basename(path), size: stat.size, mtimeMs: stat.mtimeMs, revision: relayFileRevision(path),
    kind: stat.isDirectory() ? "dir" : "file", previewKind,
    mime: stat.isDirectory() ? "inode/directory" : image ?? audio ?? getDocumentMime(path) ?? (previewKind === "binary" ? "application/octet-stream" : textMime[ext] ?? "text/plain") };
}

function utf8Prefix(buffer: Buffer, maximum: number): Buffer {
  let end = Math.min(buffer.length, maximum);
  if (end < buffer.length) while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--;
  return buffer.subarray(0, end);
}

export async function readRelayFileChunk(rawPath: string, revision: string, offset: number, length = RELAY_TEXT_PREVIEW_BYTES) {
  const meta = await relayFileMeta(rawPath);
  if (meta.kind !== "file") throw new RelaySessionError("not_a_file", "Path is not a file");
  if (meta.previewKind !== "text") throw Object.assign(new RelaySessionError("use_download", "Use download for this file"), { details: { meta } });
  if (meta.revision !== revision) throw new RelaySessionError("stale_revision", "File changed; reload before continuing");
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > meta.size || !Number.isSafeInteger(length) || length < 4 || length > RELAY_TEXT_PREVIEW_BYTES) throw new RelaySessionError("invalid_args", "Invalid read range");
  const fd = openSync(meta.path, "r");
  let bytes: Buffer;
  try {
    const buffer = Buffer.allocUnsafe(Math.min(length + 4, meta.size - offset));
    const count = readSync(fd, buffer, 0, buffer.length, offset);
    bytes = utf8Prefix(buffer.subarray(0, count), length);
  } finally { closeSync(fd); }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw Object.assign(new RelaySessionError("use_download", "File is not UTF-8 text"), { details: { meta: { ...meta, previewKind: "binary", mime: "application/octet-stream" } } }); }
  const nextOffset = offset + bytes.length;
  const complete = nextOffset === meta.size;
  const contentHash = complete ? relayContentHash(meta.path) : undefined;
  if (relayFileRevision(meta.path) !== revision) throw new RelaySessionError("stale_revision", "File changed during read");
  return { text, nextOffset, complete, ...(contentHash ? { contentHash } : {}) };
}

export async function readRelayFile(rawPath: string): Promise<RelayFileContent> {
  const meta = await relayFileMeta(rawPath);
  const chunk = await readRelayFileChunk(meta.path, meta.revision, 0);
  const ext = meta.name.toLowerCase().split(".").pop() ?? "";
  return { path: meta.path, name: meta.name, language: EXT_TO_LANGUAGE[ext] ?? "text", revision: meta.revision,
    size: meta.size, bytes: meta.size, encoding: "utf8", truncated: !chunk.complete, ...chunk };
}

export async function listRelayWorktrees(rawCwd: string): Promise<RelayWorktreeList> {
  const cwd = await assertAllowedPath(rawCwd);
  const project = await resolveProject(cwd);
  let worktrees: WorktreeInfo[] = [];
  let currentWorktreePath: string | null = null;
  let isGit = true;
  try {
    worktrees = await listWorktrees(existsSync(cwd) ? cwd : project.projectRoot);
    currentWorktreePath = findCurrentWorktreePath(worktrees, cwd);
  } catch {
    isGit = false;
  }
  for (const worktree of worktrees) allowFileRoot(worktree.path);
  return {
    cwd,
    projectRoot: project.projectRoot,
    isGit,
    currentWorktreePath,
    worktrees: worktrees.map((worktree) => ({
      path: worktree.path,
      branch: worktree.branch,
      isMain: worktree.isMain,
    })),
  };
}

export async function writeRelayFile(rawPath: string, text: string, revision?: string, baseContentHash?: string, createIfMissing = false): Promise<{ path: string; bytes: number; revision: string; contentHash: string }> {
  const roots = await getAllowedFileRoots();
  const requested = resolve(rawPath.trim());
  const parent = dirname(requested);
  if (!isExistingFilePathAllowed(parent, roots)) throw new RelaySessionError("access_denied", "Path is outside allowed workspaces");
  const realParent = realpathSync(parent);
  const target = join(realParent, basename(requested));
  let mode = 0o600;
  let existing = false;
  const revalidate = () => {
    if (realpathSync(parent) !== realParent || !isExistingFilePathAllowed(parent, roots)) throw new RelaySessionError("access_denied", "Directory changed");
    let stat;
    try { stat = lstatSync(target); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    if (stat) {
      if (!stat.isFile() || stat.isSymbolicLink()) throw new RelaySessionError("not_a_file", "Cannot replace a directory or symbolic link");
      if (!isExistingFilePathAllowed(target, roots)) throw new RelaySessionError("access_denied", "Path is outside allowed workspaces");
      if (!revision || !baseContentHash) throw new RelaySessionError("revision_required", "Read the complete file before saving");
      const before = relayFileRevision(target);
      if (before !== revision || relayContentHash(target) !== baseContentHash || relayFileRevision(target) !== before) throw new RelaySessionError("stale_revision", "File changed; your edits were not written");
      mode = stat.mode & 0o7777;
      return true;
    }
    if (revision || baseContentHash || !createIfMissing) throw new RelaySessionError("stale_revision", "File is missing; explicit creation is required");
    return false;
  };
  existing = revalidate();
  const temporary = join(realParent, `.relay-save-${randomUUID()}`);
  const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode);
  try {
    writeFileSync(fd, text, "utf8"); chmodSync(temporary, mode); fsyncSync(fd);
  } catch (error) { unlinkSync(temporary); throw error; }
  finally { closeSync(fd); }
  try {
    if (revalidate() !== existing) throw new RelaySessionError("stale_revision", "File changed before save");
    if (existing) renameSync(temporary, target);
    else { linkSync(temporary, target); unlinkSync(temporary); }
    const directory = openSync(realParent, "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
    return { path: requested, bytes: Buffer.byteLength(text), revision: relayFileRevision(target), contentHash: relayContentHash(target) };
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

export async function gitRelayStatus(rawCwd: string, offset = 0, limit = 100): Promise<{
  cwd: string;
  isGitRepository: boolean;
  repositoryRoot: string | null;
  files: Array<{ filePath: string; status: string; code: string }>;
  total: number; offset: number; limit: number; hasMore: boolean;
}> {
  const cwd = await assertAllowedPath(rawCwd);
  const status = await getGitStatus(cwd);
  const page = relayPage(offset, limit);
  return {
    cwd,
    isGitRepository: status.isGitRepository,
    repositoryRoot: status.repositoryRoot,
    total: status.files.length, ...page, hasMore: page.offset + page.limit < status.files.length,
    files: status.files.slice(page.offset, page.offset + page.limit).map((file) => ({
      filePath: resolve(status.repositoryRoot ?? cwd, file.filePath),
      status: file.status,
      code: file.code,
    })),
  };
}

export async function gitRelayDiff(rawCwd: string, rawPath: string): Promise<{
  path: string;
  supported: boolean;
  status?: string;
  patch?: string;
  truncated?: boolean;
}> {
  const cwd = await assertAllowedPath(rawCwd);
  const filePath = resolve(rawPath);
  if (existsSync(filePath)) await assertAllowedPath(filePath);
  else {
    let ancestor = dirname(filePath);
    while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor);
    await assertAllowedPath(ancestor);
  }
  const diff = await getGitFileDiff(cwd, filePath);
  if (!diff.supported) return { path: filePath, supported: false };
  let patch = diff.patch ?? "";
  const patchBytes = Buffer.from(patch, "utf8");
  const truncated = patchBytes.length > 80_000;
  if (truncated) patch = utf8Prefix(patchBytes, 80_000).toString("utf8");
  return {
    path: filePath,
    supported: true,
    ...(diff.status ? { status: diff.status } : {}),
    ...(patch ? { patch } : {}),
    truncated,
  };
}

export async function addRelayWorktree(rawCwd: string, branch: string): Promise<{ path: string; branch: string }> {
  const cwd = await assertAllowedPath(rawCwd);
  if (!existsSync(cwd)) {
    throw new RelaySessionError("directory_not_found", `Directory does not exist: ${cwd}`);
  }
  try {
    const result = await addWorktree(cwd, branch);
    allowFileRoot(result.path);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RelaySessionError("worktree_add_failed", message);
  }
}

export async function addRelayProject(rawCwd: string): Promise<{ path: string; name?: string }> {
  let normalized: string;
  try {
    normalized = validateProjectPath(rawCwd);
  } catch (error) {
    if (error instanceof ProjectPathError) throw new RelaySessionError(error.code, error.message);
    throw error;
  }
  const { projectRoot } = await resolveProject(normalized);
  const registry = loadProjectRegistry();
  const next = upsertProject(registry, projectRoot);
  saveProjectRegistry(next);
  allowFileRoot(projectRoot);
  const entry = next.projects.find((p) => comparableProjectPath(p.path) === comparableProjectPath(projectRoot));
  return { path: entry?.path ?? projectRoot, name: basename(entry?.path ?? projectRoot) || projectRoot };
}

export async function removeRelayProject(rawCwd: string): Promise<{ path: string }> {
  const trimmed = rawCwd.trim();
  if (!trimmed) throw new RelaySessionError("path_required", "Path is required");
  const { projectRoot } = await resolveProject(trimmed);
  const registry = loadProjectRegistry();
  saveProjectRegistry(hideProject(registry, projectRoot));
  return { path: projectRoot };
}

const execFileAsync = promisify(execFile);
const RELAY_FILE_INDEX_IGNORED = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
  "target", "vendor", ".DS_Store",
]);

async function listIndexFiles(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", cwd, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { timeout: 10_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } },
    );
    const all = stdout.split("\0").filter(Boolean);
    return all;
  } catch {
    // Fall back to a bounded readdir walk.
  }
  const files: string[] = [];
  const queue: Array<{ abs: string; rel: string; depth: number }> = [{ abs: cwd, rel: "", depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    let dirents;
    try {
      dirents = readdirSync(current.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of dirents) {
      if (RELAY_FILE_INDEX_IGNORED.has(dirent.name) || dirent.name.endsWith(".pyc")) continue;
      const childRel = current.rel ? `${current.rel}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        {
          queue.push({ abs: join(current.abs, dirent.name), rel: childRel, depth: current.depth + 1 });
        }
      } else if (dirent.isFile()) {
        files.push(childRel);
      }
    }
  }
  return files;
}

export async function searchRelayFileIndex(rawCwd: string, query: string, offset = 0, limit = 100): Promise<{
  cwd: string;
  query: string;
  matches: Array<{ path: string; isDir?: boolean }>;
  total: number; offset: number; limit: number; hasMore: boolean;
}> {
  const cwd = await assertAllowedPath(rawCwd);
  let stat;
  try {
    stat = statSync(cwd);
  } catch {
    throw new RelaySessionError("directory_not_found", "Directory not found");
  }
  if (!stat.isDirectory()) throw new RelaySessionError("not_a_directory", "Not a directory");
  const files = await listIndexFiles(cwd);
  const entries = buildEntriesFromFiles(files);
  const matched = filterFileEntries(entries, query, entries.length);
  const page = relayPage(offset, limit);
  return {
    cwd,
    query,
    total: matched.length, ...page, hasMore: page.offset + page.limit < matched.length,
    matches: matched.slice(page.offset, page.offset + page.limit).map((entry) => ({
      path: entry.path,
      ...(entry.isDir ? { isDir: true as const } : {}),
    })),
  };
}
