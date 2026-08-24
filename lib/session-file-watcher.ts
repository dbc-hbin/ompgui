import {
  lstatSync,
  readdirSync,
  statSync,
  watch,
  type Dirent,
  type FSWatcher,
} from "fs";
import * as path from "path";
import { invalidateSessionListCache } from "./session-reader";
import { readSessionHeaderSync } from "./omp/session-files";
import { getSessionsDir } from "./omp/paths";

export const SESSION_WATCH_DEBOUNCE_MS = 250;
export const SESSION_WATCH_RETRY_MS = 5_000;

export interface SessionFilesChanged {
  type: "sessions-changed";
  sessionIds: string[];
  refreshSessionList: true;
}

type SessionFilesChangedListener = (change: SessionFilesChanged) => void;
type WatchEventType = "change" | "rename";

type SessionFileRecord = {
  id: string | undefined;
  size: number;
  mtimeMs: number;
};

export interface SessionFileWatcherOptions {
  rootDir?: string;
  debounceMs?: number;
  retryMs?: number;
}

function isPathInside(rootDir: string, candidate: string): boolean {
  const relative = path.relative(rootDir, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isSessionFile(filePath: string): boolean {
  return path.extname(filePath) === ".jsonl";
}

function fileSignature(filePath: string): { size: number; mtimeMs: number } | null {
  try {
    const linkStat = lstatSync(filePath);
    if (!linkStat.isFile() || linkStat.isSymbolicLink()) return null;
    const stat = statSync(filePath);
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

/**
 * Walk a session tree without following symlinked directories. Session files
 * are normally one level below getSessionsDir(), but recursive walking keeps
 * profile/project layouts portable and also lets a newly-created directory be
 * watched without restarting the server.
 */
function collectDirectories(rootDir: string): string[] | null {
  const directories: string[] = [];
  const pending = [rootDir];
  try {
    while (pending.length > 0) {
      const directory = pending.pop()!;
      const stat = statSync(directory);
      if (!stat.isDirectory()) continue;
      directories.push(directory);
      let entries: Dirent[];
      try {
        entries = readdirSync(directory, { withFileTypes: true });
      } catch {
        // A project directory can disappear between the parent event and this
        // walk. Keep the rest of the tree and let the retry repair watchers.
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        pending.push(path.join(directory, entry.name));
      }
    }
  } catch {
    return null;
  }
  return directories;
}

function collectSessionFiles(rootDir: string): string[] | null {
  const directories = collectDirectories(rootDir);
  if (!directories) return null;
  const files: string[] = [];
  for (const directory of directories) {
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && isSessionFile(entry.name)) {
        files.push(path.join(directory, entry.name));
      }
    }
  }
  return files;
}

function readSessionId(filePath: string): string | undefined {
  const header = readSessionHeaderSync(filePath);
  return typeof header?.id === "string" && header.id.length > 0 ? header.id : undefined;
}

/**
 * Owns the process-level recursive session watcher. It is deliberately
 * independent of the running RPC registry: external omp/TUI sessions must
 * be observed without ever creating or attaching an RPC child.
 */
export class SessionFileWatcher {
  private readonly rootDir: string;
  private readonly debounceMs: number;
  private readonly retryMs: number;
  private readonly listeners = new Set<SessionFilesChangedListener>();
  private readonly directoryWatchers = new Map<string, FSWatcher>();
  private readonly knownFiles = new Map<string, SessionFileRecord>();
  private readonly pendingFiles = new Map<string, WatchEventType>();
  // Some platforms deliver notifications for a rapid write after the
  // trailing timer has already fired. Keep a short per-session coalescing
  // window so that delayed duplicates do not produce a second frame.
  private readonly emittedIdAt = new Map<string, number>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private processing = false;
  private pendingRescan = false;
  private started = false;
  private stopped = false;
  private hasSnapshot = false;

  constructor(options: SessionFileWatcherOptions = {}) {
    this.rootDir = path.resolve(options.rootDir ?? getSessionsDir());
    this.debounceMs = Math.max(0, options.debounceMs ?? SESSION_WATCH_DEBOUNCE_MS);
    this.retryMs = Math.max(1, options.retryMs ?? SESSION_WATCH_RETRY_MS);
  }

  subscribe(listener: SessionFilesChangedListener): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  /** Exposed for focused lifecycle tests and for route cleanup. */
  stop(): void {
    this.stopped = true;
    this.started = false;
    this.processing = false;
    this.pendingRescan = false;
    this.pendingFiles.clear();
    this.knownFiles.clear();
    this.emittedIdAt.clear();
    this.hasSnapshot = false;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    for (const watcher of this.directoryWatchers.values()) {
      try { watcher.close(); } catch { /* already closed */ }
    }
    this.directoryWatchers.clear();
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    // Capture existing files first so a subsequent delete can resolve the
    // removed session id without trusting an unbounded watcher filename.
    this.rescan();
    this.syncWatchers();
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer !== null) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.stopped) return;
      this.pendingRescan = true;
      this.syncWatchers();
      this.scheduleDebounce();
    }, this.retryMs);
  }

  private scheduleDebounce(): void {
    if (this.stopped) return;
    // Reset the window on every event: this is a trailing debounce, so all
    // writes in a burst flush once after the final filesystem notification.
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flushPending();
    }, this.debounceMs);
  }

  private syncWatchers(): void {
    if (this.stopped) return;
    const directories = collectDirectories(this.rootDir);
    if (!directories) {
      this.scheduleRetry();
      return;
    }
    const wanted = new Set(directories);
    for (const [directory, watcher] of this.directoryWatchers) {
      if (wanted.has(directory)) continue;
      try { watcher.close(); } catch { /* already closed */ }
      this.directoryWatchers.delete(directory);
    }
    for (const directory of directories) {
      if (this.directoryWatchers.has(directory)) continue;
      try {
        const watcher = watch(directory, (eventType, filename) => {
          this.handleWatchEvent(directory, eventType, filename);
        });
        this.directoryWatchers.set(directory, watcher);
        watcher.on("error", () => {
          if (this.directoryWatchers.get(directory) !== watcher) return;
          this.directoryWatchers.delete(directory);
          try { watcher.close(); } catch { /* already closed */ }
          this.scheduleRetry();
        });
      } catch {
        this.scheduleRetry();
      }
    }
  }

  private handleWatchEvent(
    directory: string,
    eventType: string,
    filename: string | Buffer | null,
  ): void {
    if (this.stopped) return;
    const normalizedEvent: WatchEventType = eventType === "rename" ? "rename" : "change";
    if (filename === null || filename === undefined || filename.length === 0) {
      // Some platforms omit the name. One debounced tree rescan handles a
      // burst of such events and catches both additions and removals.
      this.pendingRescan = true;
      this.scheduleDebounce();
      return;
    }
    const name = Buffer.isBuffer(filename) ? filename.toString("utf8") : filename;
    const candidate = path.resolve(directory, name);
    if (!isPathInside(this.rootDir, candidate)) return;
    if (isSessionFile(candidate)) {
      const previous = this.pendingFiles.get(candidate);
      // A rename after a change carries the stronger signal (the file may
      // have been atomically replaced).
      if (previous !== "rename" || normalizedEvent === "rename") {
        this.pendingFiles.set(candidate, normalizedEvent);
      }
    } else if (normalizedEvent === "rename") {
      // Directory creation/removal changes the recursive watch set. Coalesce
      // this with any unknown-filename events into one bounded rescan.
      this.pendingRescan = true;
    }
    this.scheduleDebounce();
  }

  private flushPending(): void {
    if (this.stopped || this.processing) {
      if (!this.stopped) this.scheduleDebounce();
      return;
    }
    if (this.pendingFiles.size === 0 && !this.pendingRescan) return;
    this.processing = true;
    const files = new Map(this.pendingFiles);
    this.pendingFiles.clear();
    const shouldRescan = this.pendingRescan;
    this.pendingRescan = false;
    try {
      const changedIds = shouldRescan
        ? this.rescan()
        : this.processKnownFiles(files);
      if (changedIds.size > 0) this.emit(changedIds);
      this.syncWatchers();
    } finally {
      this.processing = false;
      if (!this.stopped && (this.pendingFiles.size > 0 || this.pendingRescan)) {
        this.scheduleDebounce();
      }
    }
  }

  private processKnownFiles(files: Map<string, WatchEventType>): Set<string> {
    const changedIds = new Set<string>();
    let invalidated = false;
    for (const [filePath, eventType] of files) {
      if (!isPathInside(this.rootDir, filePath) || !isSessionFile(filePath)) continue;
      const previous = this.knownFiles.get(filePath);
      const signature = fileSignature(filePath);
      if (!signature) {
        if (previous?.id) changedIds.add(previous.id);
        this.knownFiles.delete(filePath);
        if (previous) invalidated = true;
        continue;
      }

      // A change event is already an OS-level signal. Comparing metadata keeps
      // harmless duplicate events cheap while still honoring rename events.
      const id = readSessionId(filePath) ?? previous?.id;
      if (id) changedIds.add(id);
      if (id === undefined && eventType === "rename") {
        // A just-created file may still be in the middle of its first write.
        // Retry the bounded rescan later instead of losing the session forever.
        this.pendingRescan = true;
        this.scheduleRetry();
      }
      this.knownFiles.set(filePath, { ...signature, id });
      invalidated = true;
    }
    if (invalidated) invalidateSessionListCache();
    return changedIds;
  }

  private rescan(): Set<string> {
    const files = collectSessionFiles(this.rootDir);
    if (!files) {
      this.scheduleRetry();
      return new Set();
    }
    const next = new Map<string, SessionFileRecord>();
    for (const filePath of files) {
      const signature = fileSignature(filePath);
      if (!signature) continue;
      next.set(filePath, { ...signature, id: readSessionId(filePath) });
    }

    const changedIds = new Set<string>();
    if (this.hasSnapshot) {
      for (const [filePath, previous] of this.knownFiles) {
        const current = next.get(filePath);
        if (!current) {
          if (previous.id) changedIds.add(previous.id);
          continue;
        }
        if (current.id !== previous.id || current.size !== previous.size || current.mtimeMs !== previous.mtimeMs) {
          if (previous.id) changedIds.add(previous.id);
          if (current.id) changedIds.add(current.id);
        }
      }
      for (const [filePath, current] of next) {
        if (!this.knownFiles.has(filePath) && current.id) changedIds.add(current.id);
      }
    }
    this.knownFiles.clear();
    for (const [filePath, record] of next) this.knownFiles.set(filePath, record);
    this.hasSnapshot = true;
    invalidateSessionListCache();
    return changedIds;
  }

  private emit(ids: Set<string>): void {
    const now = Date.now();
    const coalesceWindow = Math.max(this.debounceMs, SESSION_WATCH_DEBOUNCE_MS);
    for (const [id, emittedAt] of this.emittedIdAt) {
      if (now - emittedAt >= coalesceWindow) this.emittedIdAt.delete(id);
    }
    const sessionIds = [...ids]
      .filter((id) => !this.emittedIdAt.has(id))
      .sort();
    if (sessionIds.length === 0) return;
    for (const id of sessionIds) this.emittedIdAt.set(id, now);
    const change: SessionFilesChanged = {
      type: "sessions-changed",
      sessionIds,
      refreshSessionList: true,
    };
    for (const listener of [...this.listeners]) {
      try { listener(change); } catch { /* isolate subscribers */ }
    }
  }
}

let sharedWatcher: SessionFileWatcher | null = null;

/** Subscribe to external session-file changes. The recursive watcher exists
 * only while at least one running-events SSE client is subscribed. */
export function subscribeSessionFileChanges(listener: SessionFilesChangedListener): () => void {
  sharedWatcher ??= new SessionFileWatcher();
  return sharedWatcher.subscribe(listener);
}
