import { closeSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "../file-access";
import { getSessionDirNameForCwd, getSessionsDir } from "../omp/paths";
import {
  archiveSessionFileWithArtifacts,
  deleteSessionFileWithArtifacts,
  invalidateSessionFileListCache,
  listArchivedSessionInfos,
  MAX_SESSION_LOAD_BYTES,
  parseTitleSlotLine,
  restoreArchivedSessionWithArtifacts,
  SessionArchiveError,
  setSessionTitle,
  writeSessionFileAtomicSync,
} from "../omp/session-files";
import { getRpcSession } from "../rpc-manager";
import { sessionPathKey } from "../session-path";
import {
  invalidateSessionListCache,
  invalidateSessionPathCache,
  listAllSessions,
  readSessionHeader,
  resolveSessionIdByPath,
  resolveSessionPath,
} from "../session-reader";
import type { RelayArchiveItem } from "./protocol";
import { RelaySessionError } from "./session-runtime";

export interface RelayDeleteSkippedChild {
  id: string;
  reason: "session_child_live" | "session_child_too_large" | "session_child_rewrite_failed";
}

export async function deleteRelaySession(id: string): Promise<{ id: string; skippedChildren?: RelayDeleteSkippedChild[] }> {
  const filePath = await resolveSessionPath(id);
  if (!filePath) throw new RelaySessionError("not_found", "Session not found");

  const deletedHeader = readSessionHeader(filePath);
  const deletedSessionId = deletedHeader?.id ?? id;
  const parentSession = deletedHeader?.parentSession;

  let grandparentPath: string | undefined;
  let grandparentId: string | undefined;
  if (parentSession) {
    const idForPath = await resolveSessionIdByPath(parentSession);
    if (idForPath) {
      grandparentPath = parentSession;
      grandparentId = idForPath;
    } else {
      const pathForId = await resolveSessionPath(parentSession);
      if (pathForId) {
        grandparentPath = pathForId;
        grandparentId = parentSession;
      }
    }
  }

  const targetPathKey = sessionPathKey(filePath);
  const dir = dirname(filePath);
  const skippedChildren: RelayDeleteSkippedChild[] = [];
  try {
    const files = readdirSync(dir).filter(
      (file) => file.endsWith(".jsonl") && sessionPathKey(join(dir, file)) !== targetPathKey,
    );
    for (const file of files) {
      const childPath = join(dir, file);
      try {
        if (statSync(childPath).size > MAX_SESSION_LOAD_BYTES) {
          let oversizedId = file;
          let linkedChild = false;
          try {
            const fd = openSync(childPath, "r");
            try {
              const head = Buffer.alloc(64 * 1024);
              const bytes = readSync(fd, head, 0, head.length, 0);
              const lines = head.toString("utf8", 0, bytes).split("\n");
              const headerIndex = parseTitleSlotLine(lines[0] ?? "") ? 1 : 0;
              const parsed: unknown = JSON.parse(lines[headerIndex] ?? "{}");
              if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && "type" in parsed && parsed.type === "session") {
                if ("id" in parsed && typeof parsed.id === "string") oversizedId = parsed.id;
                if ("parentSession" in parsed && typeof parsed.parentSession === "string") {
                  linkedChild = parsed.parentSession === deletedSessionId || sessionPathKey(parsed.parentSession) === targetPathKey;
                }
              }
            } finally {
              closeSync(fd);
            }
          } catch {
            // An unreadable header cannot establish a child relationship.
          }
          if (linkedChild) skippedChildren.push({ id: oversizedId, reason: "session_child_too_large" });
          continue;
        }
      } catch {
        continue;
      }
      let lines: string[];
      let headerIndex: number;
      let header: Record<string, unknown>;
      let linkedByPath: boolean;
      try {
        lines = readFileSync(childPath, "utf8").split("\n");
        headerIndex = parseTitleSlotLine(lines[0] ?? "") ? 1 : 0;
        const parsed: unknown = JSON.parse(lines[headerIndex]);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
        header = {};
        for (const [key, value] of Object.entries(parsed)) header[key] = value;
        if (header.type !== "session" || typeof header.parentSession !== "string" || !header.parentSession) continue;
        linkedByPath = sessionPathKey(header.parentSession) === targetPathKey;
        if (!linkedByPath && header.parentSession !== deletedSessionId) continue;
      } catch {
        continue;
      }
      const childId = typeof header.id === "string" ? header.id : undefined;
      if (childId && getRpcSession(childId)?.isAlive?.()) {
        skippedChildren.push({ id: childId, reason: "session_child_live" });
        continue;
      }
      header.parentSession = linkedByPath
        ? (grandparentPath ?? parentSession)
        : (grandparentId ?? parentSession);
      lines[headerIndex] = JSON.stringify(header);
      try {
        writeSessionFileAtomicSync(childPath, lines.join("\n"), "reparent");
      } catch {
        skippedChildren.push({ id: childId ?? file, reason: "session_child_rewrite_failed" });
      }
    }
  } catch {
    // Directory unreadable — still delete the target session.
  }

  await getRpcSession(id)?.destroyAndWait?.();
  deleteSessionFileWithArtifacts(filePath);
  invalidateSessionPathCache(id);
  invalidateSessionListCache();
  return skippedChildren.length > 0 ? { id, skippedChildren } : { id };
}

export async function archiveRelaySession(id: string): Promise<{ id: string }> {
  const filePath = await resolveSessionPath(id);
  if (!filePath) throw new RelaySessionError("not_found", "Session not found");
  const hasChildren = (await listAllSessions()).some((session) => session.parentSessionId === id);
  if (hasChildren) {
    throw new RelaySessionError("session_has_children", "Archive child sessions before archiving this session");
  }
  await getRpcSession(id)?.destroyAndWait?.();
  archiveSessionFileWithArtifacts(filePath);
  invalidateSessionPathCache(id);
  invalidateSessionListCache();
  return { id };
}

export async function renameRelaySession(id: string, name: string): Promise<{ id: string; name: string }> {
  const trimmed = name.trim();
  if (!trimmed) throw new RelaySessionError("invalid_name", "name is required");
  let renamed = false;
  const rpc = getRpcSession(id);
  if (rpc?.isAlive?.() && typeof rpc.send === "function") {
    try {
      await rpc.send({ type: "set_session_name", name: trimmed });
      renamed = true;
    } catch {
      // Fall back to the on-disk title slot.
    }
  }
  if (!renamed) {
    const filePath = await resolveSessionPath(id);
    if (!filePath) throw new RelaySessionError("not_found", "Session not found");
    setSessionTitle(filePath, trimmed, "user");
  }
  invalidateSessionListCache();
  return { id, name: trimmed };
}

export async function listRelayArchives(): Promise<RelayArchiveItem[]> {
  const archives = await listArchivedSessionInfos();
  return archives.slice(0, 80).map((archive) => ({
    key: archive.key,
    ...(archive.name ? { name: archive.name } : {}),
    ...(archive.id ? { id: archive.id } : {}),
    archivedAt: archive.modified,
  }));
}

export async function restoreRelayArchive(key: string): Promise<{ id: string }> {
  try {
    const restored = await restoreArchivedSessionWithArtifacts(key);
    invalidateSessionPathCache(restored.id);
    invalidateSessionListCache();
    return { id: restored.id };
  } catch (error) {
    if (error instanceof SessionArchiveError) {
      throw new RelaySessionError(error.code, error.message);
    }
    throw error;
  }
}

function isoSessionTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export const RELAY_IMPORT_MAX_BYTES = 10 * 1024 * 1024;

export async function importRelaySession(fileName: string, content: string): Promise<{ id: string; cwd: string }> {
  const name = fileName.trim();
  if (!name || name.length > 200 || name.includes("/") || name.includes("\\")) {
    throw new RelaySessionError("invalid_file_name", "Invalid file name");
  }
  if (!content.trim()) {
    throw new RelaySessionError("invalid_content", "Empty session file");
  }
  if (Buffer.byteLength(content, "utf8") > RELAY_IMPORT_MAX_BYTES) {
    throw new RelaySessionError("invalid_content", "Session file is too large (max 10 MB)");
  }
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  let cwd: string | undefined;
  const freshId = randomUUID();
  const rewritten: string[] = [];
  for (const line of lines) {
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      throw new RelaySessionError("invalid_session_file", "Not a valid omp session file (malformed JSON line)");
    }
    if (typeof entry === "object" && entry !== null && !Array.isArray(entry) && "type" in entry) {
      if (entry.type === "session" && "cwd" in entry && typeof entry.cwd === "string") cwd = entry.cwd;
      if (entry.type === "session") {
        rewritten.push(JSON.stringify({ ...entry, id: freshId }));
        continue;
      }
      if (entry.type === "message" && "message" in entry) {
        const message = entry.message;
        if (typeof message === "object" && message !== null && !Array.isArray(message) && "role" in message && message.role === "bashExecution") {
          const safeMessage: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(message)) {
            if (key !== "fullOutputPath") safeMessage[key] = value;
          }
          rewritten.push(JSON.stringify({ ...entry, message: safeMessage }));
          continue;
        }
      }
    }
    rewritten.push(line);
  }
  if (!cwd) {
    throw new RelaySessionError("invalid_session_file", "Not a valid omp session file (missing session header with cwd)");
  }
  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    throw new RelaySessionError("import_cwd_not_authorized", "Imported session workspace is not authorized");
  }
  const sessionDir = join(getSessionsDir(), getSessionDirNameForCwd(cwd));
  mkdirSync(sessionDir, { recursive: true });
  const sessionFile = join(sessionDir, `${isoSessionTimestamp()}_${randomUUID()}.jsonl`);
  writeFileSync(sessionFile, rewritten.join("\n") + "\n", "utf8");
  invalidateSessionListCache();
  invalidateSessionFileListCache();
  return { id: freshId, cwd };
}
