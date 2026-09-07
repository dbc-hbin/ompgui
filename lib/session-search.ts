import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { setImmediate } from "node:timers/promises";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { getActiveProfile, getAgentDir, getSessionsDir } from "./omp/paths";
import { invalidateSessionFileListCache, listAllSessionInfos, parseTitleSlotLine } from "./omp/session-files";
import { sessionPathKey } from "./session-path";
import { resolveProject } from "./worktree";
import type { SessionSearchArgs, SessionSearchContext, SessionSearchResult, SessionSearchRole } from "./session-search-types";

export class SessionSearchError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = "SessionSearchError"; }
}

interface NativeSqlite {
  DatabaseSync: typeof DatabaseSync;
}
const refreshes = new Map<string, Promise<void>>();
const MAX_LINE_BYTES = 64 * 1024 * 1024;
const CONTEXT_BYTES = 256 * 1024;

function openIndex(file: string): DatabaseSync {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 19)) throw new SessionSearchError("Session search requires Node.js 22.19 or newer with node:sqlite enabled.", 503);
  let db: DatabaseSync;
  try {
    // Resolve through Node rather than a bundled require/import: Next's server
    // bundler otherwise rewrites this optional builtin into an invalid external.
    const sqlite = process.getBuiltinModule("node:sqlite") as NativeSqlite | undefined;
    if (!sqlite || typeof sqlite.DatabaseSync !== "function") throw new Error("node:sqlite is not available in this Node runtime");
    db = new sqlite.DatabaseSync(file);
  } catch (error) {
    throw new SessionSearchError(`Cannot open session search cache; use Node.js 22.19+ with node:sqlite and check cache permissions: ${error instanceof Error ? error.message : String(error)}`, 503);
  }
  try {
    db.exec("PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, path TEXT NOT NULL, stamp TEXT NOT NULL, name TEXT NOT NULL, cwd TEXT NOT NULL, project TEXT NOT NULL); CREATE TABLE IF NOT EXISTS entries (session TEXT NOT NULL, id TEXT NOT NULL, parent TEXT, timestamp TEXT NOT NULL, time REAL, role TEXT, content TEXT NOT NULL, PRIMARY KEY(session,id)); CREATE INDEX IF NOT EXISTS entries_order ON entries(time DESC,session,id);");
    db.exec("PRAGMA secure_delete=ON");
    if (db.prepare("PRAGMA user_version").get()?.user_version !== 1) {
      db.exec("BEGIN IMMEDIATE; DELETE FROM entries; DELETE FROM sessions; PRAGMA user_version=1; COMMIT");
    }
    return db;
  } catch (error) {
    db.close();
    throw new SessionSearchError(`Cannot initialize derived search cache; remove the .ompgui-search cache directory and retry: ${error instanceof Error ? error.message : String(error)}`, 503);
  }
}

function dateBound(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^(?:\d{4}-\d{2}-\d{2}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))$/.test(value)) throw new SessionSearchError(`${field} must be a UTC YYYY-MM-DD or ISO timestamp with explicit timezone.`, 400);
  if (value.length > 10 && (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59)) throw new SessionSearchError(`${field} is not a valid timestamp.`, 400);
  const day = value.slice(0, 10);
  const midnight = Date.parse(`${day}T00:00:00Z`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== day) throw new SessionSearchError(`${field} is not a valid date.`, 400);
  return parsed;
}

function plainText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.flatMap((block: unknown) => block !== null && typeof block === "object" && !("hidden" in block && block.hidden === true) && "type" in block && block.type === "text" && "text" in block && typeof block.text === "string" ? [block.text] : []).join("\n");
}

async function indexFile(db: DatabaseSync, file: string, sessionId: string): Promise<string> {
  const insert = db.prepare("INSERT OR REPLACE INTO entries VALUES (?,?,?,?,?,?,?)");
  const stream = createReadStream(file, { encoding: "utf8", highWaterMark: 64 * 1024 });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let first = true;
  let header = false;
  let slotTitle: string | undefined;
  let title = "";
  let fallback = "";
  let legacy = false;
  let previous: string | null = null;
  let ordinal = 0;
  // readline buffers a physical line; reject oversized lines explicitly rather than silently dropping body text.
  let lineBytes = 0;
  stream.on("data", (chunk: string) => {
    for (const part of chunk.split(/(?<=\n)/)) {
      lineBytes += Buffer.byteLength(part);
      if (lineBytes > MAX_LINE_BYTES) { stream.destroy(new SessionSearchError("A session JSONL line exceeds the 64 MiB search limit. Split or compact the session before searching.", 503)); return; }
      if (part.endsWith("\n")) lineBytes = 0;
    }
  });
  try {
    for await (const raw of lines) {
      if (first) {
        first = false;
        const slot = parseTitleSlotLine(raw);
        if (slot) { slotTitle = slot.title; continue; }
      }
      let record: unknown;
      try { record = JSON.parse(raw); } catch { continue; }
      if (record === null || typeof record !== "object" || Array.isArray(record)) continue;
      if (!header) {
        if (!("type" in record) || record.type !== "session" || !("id" in record) || record.id !== sessionId) throw new SessionSearchError("Session changed while indexing; retry search.", 503);
        legacy = !("version" in record) || typeof record.version !== "number" || record.version < 2;
        title = slotTitle ?? ("title" in record && typeof record.title === "string" ? record.title : "");
        header = true;
        continue;
      }
      if ("type" in record && record.type === "session") continue;
      ordinal++;
      const id = legacy ? `legacy-${ordinal}` : "id" in record && typeof record.id === "string" ? record.id : undefined;
      if (!id) continue;
      const parent = legacy ? previous : "parentId" in record && typeof record.parentId === "string" ? record.parentId : null;
      previous = id;
      const timestamp = "timestamp" in record && typeof record.timestamp === "string" ? record.timestamp : "";
      let role: SessionSearchRole | null = null;
      let content = "";
      if ("type" in record && record.type === "message" && "message" in record && record.message !== null && typeof record.message === "object") {
        const message = record.message;
        if (!("hidden" in record && record.hidden === true) && !("hidden" in message && message.hidden === true) && "role" in message && (message.role === "user" || message.role === "assistant" || message.role === "toolResult")) {
          role = message.role;
          content = "content" in message ? plainText(message.content) : "";
        }
      }
      if (!fallback && role !== null && content.trim()) fallback = Array.from(content.slice(0, 320)).slice(0, 160).join("");
      const time = Date.parse(timestamp);
      insert.run(sessionId, id, parent, timestamp, Number.isFinite(time) ? time : null, role, content);
      if (ordinal % 128 === 0) await setImmediate();
    }
    if (!header) throw new SessionSearchError("Session header disappeared while indexing; retry search.", 503);
    return title || fallback;
  } finally { lines.close(); stream.destroy(); }
}

async function refresh(file: string, root: string): Promise<void> {
  invalidateSessionFileListCache();
  const infos = await listAllSessionInfos();
  // The active profile can change in an embedding process; never mix a listing from another root.
  if (sessionPathKey(await realpath(getSessionsDir()).catch(() => path.resolve(getSessionsDir()))) !== root) throw new SessionSearchError("Active session profile changed; retry search.", 503);
  const handle = await open(file, "a", 0o600);
  await handle.close();
  await chmod(file, 0o600);
  const db = openIndex(file);
  try {
    const known = new Set<string>();
    for (const info of infos) {
      const canonical = await realpath(info.path).catch(() => null);
      if (!canonical) continue;
      const relative = path.relative(root, canonical);
      if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) continue;
      if (known.has(info.id)) throw new SessionSearchError("Duplicate native session IDs prevent unambiguous search; remove the duplicate session file.", 503);
      known.add(info.id);
      const before = await stat(canonical);
      const stamp = `${before.dev}:${before.ino}:${before.size}:${before.mtimeMs}:${before.ctimeMs}`;
      const old = db.prepare("SELECT stamp,path FROM sessions WHERE id=?").get(info.id);
      if (old?.stamp === stamp && old.path === canonical) continue;
      const project = sessionPathKey((await resolveProject(info.cwd)).projectRoot);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM entries WHERE session=?").run(info.id);
        const name = await indexFile(db, canonical, info.id);
        const after = await stat(canonical);
        if (`${after.dev}:${after.ino}:${after.size}:${after.mtimeMs}:${after.ctimeMs}` !== stamp) throw new SessionSearchError("Session changed while indexing; retry search.", 503);
        db.prepare("INSERT OR REPLACE INTO sessions VALUES (?,?,?,?,?,?)").run(info.id, canonical, stamp, name, info.cwd, project);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      await setImmediate();
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of db.prepare("SELECT id FROM sessions").all()) {
        if (typeof row.id === "string" && !known.has(row.id)) {
          db.prepare("DELETE FROM entries WHERE session=?").run(row.id);
          db.prepare("DELETE FROM sessions WHERE id=?").run(row.id);
        }
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } finally { db.close(); }
}

async function readyIndex(): Promise<DatabaseSync> {
  const root = sessionPathKey(await realpath(getSessionsDir()).catch(() => path.resolve(getSessionsDir())));
  const key = createHash("sha256").update(`${getActiveProfile() ?? ""}\0${root}`).digest("hex");
  const agentRoot = await realpath(getAgentDir()).catch(() => path.resolve(getAgentDir()));
  const directory = path.join(agentRoot, ".ompgui-search");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const file = path.join(directory, `${key}.sqlite`);
  let pending = refreshes.get(file);
  if (!pending) {
    pending = refresh(file, root).finally(() => { refreshes.delete(file); });
    refreshes.set(file, pending);
  }
  try { await pending; return openIndex(file); } catch (error) {
    if (error instanceof SessionSearchError) throw error;
    throw new SessionSearchError(`Session search index refresh failed; check native session files and cache permissions: ${error instanceof Error ? error.message : String(error)}`, 503);
  }
}

export async function searchSessions(args: SessionSearchArgs): Promise<SessionSearchResult> {
  if (typeof args.query !== "string" || !args.query.trim() || args.query.length > 500) throw new SessionSearchError("query must contain 1–500 characters and cannot be whitespace-only.", 400);
  const limit = args.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new SessionSearchError("limit must be an integer from 1 to 50.", 400);
  if (args.projectRoot !== undefined && (typeof args.projectRoot !== "string" || !args.projectRoot.trim() || args.projectRoot.length > 4096)) throw new SessionSearchError("projectRoot must be a nonempty path of at most 4096 characters.", 400);
  const from = dateBound(args.from, "from");
  const to = dateBound(args.to, "to");
  if (from !== undefined && to !== undefined && from >= to) throw new SessionSearchError("from must precede to (to is exclusive).", 400);
  const project = args.projectRoot === undefined ? null : sessionPathKey(await realpath(args.projectRoot).catch(() => path.resolve(args.projectRoot!)));
  const signature = createHash("sha256").update(JSON.stringify([args.query, project, from, to, limit])).digest("hex");
  let offset = 0;
  let generation: string | undefined;
  if (args.cursor !== undefined) {
    try {
      if (typeof args.cursor !== "string" || args.cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(args.cursor)) throw new Error();
      const cursor: unknown = JSON.parse(Buffer.from(args.cursor, "base64url").toString("utf8"));
      if (cursor === null || typeof cursor !== "object" || !("signature" in cursor) || cursor.signature !== signature || !("offset" in cursor) || typeof cursor.offset !== "number" || !Number.isSafeInteger(cursor.offset) || cursor.offset < 1 || cursor.offset % limit !== 0 || !("generation" in cursor) || typeof cursor.generation !== "string") throw new Error();
      offset = cursor.offset; generation = cursor.generation;
    } catch { throw new SessionSearchError("Invalid cursor or cursor belongs to different search filters.", 400); }
  }
  const db = await readyIndex();
  try {
    const current = createHash("sha256").update(JSON.stringify(db.prepare("SELECT id,path,stamp FROM sessions ORDER BY id").all())).digest("hex");
    if (generation !== undefined && generation !== current) throw new SessionSearchError("Search results changed; restart without a cursor.", 400);
    const literal = new RegExp(args.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
    const foldedQuery = args.query.toLowerCase();
    const candidates = db.prepare("SELECT s.id AS sessionId,s.name AS sessionName,s.cwd,e.id AS entryId,e.timestamp,e.time,e.role,e.content FROM entries e JOIN sessions s ON s.id=e.session WHERE e.role IS NOT NULL AND (? IS NULL OR s.project=?) AND (? IS NULL OR e.time>=?) AND (? IS NULL OR e.time<?) AND (?=0 OR e.time<? OR (e.time IS ? AND (e.session>? OR (e.session=? AND e.id>?))) OR (e.time IS NULL AND ? IS NOT NULL)) ORDER BY e.time DESC,e.session,e.id LIMIT 128");
    const matches: SessionSearchResult["matches"] = [];
    let started = 0;
    let lastTime: number | null = null;
    let lastSession = "";
    let lastEntry = "";
    let matched = 0;
    let hasMore = false;
    let exhausted = false;
    while (!exhausted && !hasMore) {
      let batchCount = 0;
      let batchBytes = 0;
      // Exhaust/close each iterator before yielding: DELETE-journal refreshes must never wait on a suspended reader.
      for (const row of candidates.iterate(project, project, from ?? null, from ?? null, to ?? null, to ?? null, started, lastTime, lastTime, lastSession, lastSession, lastEntry, lastTime)) {
        started = 1;
        lastTime = typeof row.time === "number" ? row.time : null;
        lastSession = String(row.sessionId);
        lastEntry = String(row.entryId);
        batchCount++;
        const content = String(row.content);
        batchBytes += content.length;
      const unicodeMatch = literal.exec(content);
      const at = unicodeMatch ? -1 : content.toLowerCase().indexOf(foldedQuery);
      if (!unicodeMatch && at < 0) {
        if (batchBytes >= 1024 * 1024) break;
        continue;
      }
      if (matched++ < offset) {
        if (batchBytes >= 1024 * 1024) break;
        continue;
      }
      if (matches.length === limit) { hasMore = true; break; }
      // Map lowercase expansion offsets back to original code points (for example İ → i + combining dot).
      let foldedOffset = 0;
      let originalOffset = unicodeMatch?.index ?? 0;
      for (const point of content) {
        if (foldedOffset >= at) break;
        foldedOffset += point.toLowerCase().length;
        originalOffset += point.length;
      }
      let start = Math.max(0, originalOffset - 80);
      if (start && /[\uDC00-\uDFFF]/.test(content[start])) start--;
      let end = Math.min(content.length, start + 640);
      if (end < content.length && /[\uDC00-\uDFFF]/.test(content[end])) end--;
      const snippet = `${start ? "…" : ""}${content.slice(start, end)}${end < content.length ? "…" : ""}`;
      matches.push({ sessionId: String(row.sessionId), sessionName: String(row.sessionName), cwd: String(row.cwd), entryId: String(row.entryId), timestamp: String(row.timestamp), role: row.role as SessionSearchRole, snippet });
      if (batchBytes >= 1024 * 1024) break;
      }
      exhausted = batchCount === 0;
      if (!exhausted && !hasMore) await setImmediate();
      const afterBatch = createHash("sha256").update(JSON.stringify(db.prepare("SELECT id,path,stamp FROM sessions ORDER BY id").all())).digest("hex");
      if (afterBatch !== current) throw new SessionSearchError("Search results changed; restart without a cursor.", 400);
    }
    if (offset && matches.length === 0) throw new SessionSearchError("Cursor points beyond the search results; restart without a cursor.", 400);
    return { matches, ...(hasMore ? { nextCursor: Buffer.from(JSON.stringify({ signature, generation: current, offset: offset + limit })).toString("base64url") } : {}) };
  } finally { db.close(); }
}

export async function searchSessionContext(args: { id: string; entryId: string }): Promise<SessionSearchContext> {
  if (typeof args.id !== "string" || !args.id || args.id.length > 1024 || typeof args.entryId !== "string" || !args.entryId || args.entryId.length > 1024) throw new SessionSearchError("id and entryId must be nonempty identifiers of at most 1024 characters.", 400);
  const db = await readyIndex();
  try {
    const session = db.prepare("SELECT name,cwd FROM sessions WHERE id=?").get(args.id);
    const get: StatementSync = db.prepare("SELECT id,parent,timestamp,role,content FROM entries WHERE session=? AND id=?");
    let row = get.get(args.id, args.entryId);
    if (!session || !row || row.role === null || !row.content) throw new SessionSearchError("Session or searchable entry not found.", 404);
    const messages: SessionSearchContext["messages"] = [];
    const visited = new Set<string>();
    let bytes = 0;
    while (row) {
      const id = String(row.id);
      if (visited.has(id)) throw new SessionSearchError("Session ancestor chain contains a cycle; repair the native session file.", 503);
      visited.add(id);
      if (row.role !== null && row.content) {
        const content = String(row.content);
        const size = Buffer.byteLength(content);
        if (size > CONTEXT_BYTES && messages.length === 0) throw new SessionSearchError("Matched message exceeds the 256 KiB context limit; inspect the native session file for its full text.", 503);
        if (messages.length === 21 || bytes + size > CONTEXT_BYTES) break;
        bytes += size;
        messages.push({ entryId: id, timestamp: String(row.timestamp), role: row.role as SessionSearchRole, content });
      }
      row = typeof row.parent === "string" ? get.get(args.id, row.parent) : undefined;
    }
    messages.reverse();
    return { sessionId: args.id, sessionName: String(session.name), cwd: String(session.cwd), entryId: args.entryId, leafId: args.entryId, matchIndex: messages.length - 1, messages, hasMoreBefore: row !== undefined, hasMoreAfter: false };
  } finally { db.close(); }
}
