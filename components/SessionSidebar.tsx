"use client";

import { memo, useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo, useDeferredValue, useSyncExternalStore, type CSSProperties, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import type { ManagedProject, SessionInfo } from "@/lib/types";
import { translate, useI18n } from "@/lib/i18n";
import { formatApiError } from "@/lib/i18n/api-error";
import { DirectoryPicker } from "./DirectoryPicker";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import { ArchivedSessionsDialog } from "./ArchivedSessionsDialog";
import { Tooltip } from "./ui/primitives";
import { toast } from "./ui/toast";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { migrateStorageValue } from "@/lib/storage-migration";
import { clearLastOpenSession, setLastOpenSession, workspaceKeyOf } from "@/lib/workspace-memory";
import { groupSessionsByProject, projectActivityCounts, sortManagedProjects } from "@/lib/project-ordering";
import { comparableProjectPath } from "@/lib/comparable-path";
import { publishSessionChange } from "@/lib/session-change-bus";
import {
  getSessionListSnapshot,
  invalidateSessionList,
  loadSessionList,
  subscribeSessionList,
} from "@/lib/client-session-store";
import {
  nextDocumentNetworkState,
  readDocumentNetworkStatus,
  shouldFetchSessionList,
} from "@/lib/document-network-lifecycle";
import { parseRunningEventsFrame } from "@/lib/running-session-events";
import { pickSessionForRestore, shouldOpenRestoredSessionImmediately } from "@/lib/url-session-restore";
import { Archive, Check, ChevronDown, ChevronRight, FileUp, Folder, Gauge, GitBranch, MoreHorizontal, Plus, RefreshCw, Search, Settings2, SlidersHorizontal, Trash2, Upload } from "lucide-react";

declare global {
  interface Window {
    piDesktop?: {
      selectDirectory: () => Promise<string | null>;
    };
  }
}

interface Props {
  selectedSessionId: string | null;
  /** True when the sidebar is visible enough for hidden explorer work to be useful. */
  sidebarVisible?: boolean;
  /** The active session can exist in memory before its JSONL file is flushed. */
  optimisticSession?: SessionInfo | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onSessionIntent?: () => void;
  onNewSession?: (cwd: string) => void;
  initialSessionId?: string | null;
  skipInitialProjectSelection?: boolean;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  onSessionRestored?: (session: SessionInfo) => void;
  selectedCwd?: string | null;
  onCwdChange?: (cwd: string | null, projectRoot?: string | null) => void;
  onOpenFile?: (filePath: string, fileName: string) => void;
  explorerRefreshKey?: number;
  onExplorerRefresh?: () => void;
  explorerRefreshing?: boolean;
  onExplorerRefreshDone?: () => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
  /** Opens the app settings (pinned sidebar footer row). */
  onOpenSettings?: () => void;
  /** Opens the usage / quota viewer modal. */
  onOpenUsage?: () => void;
  /** True when an omp/ompweb update is available — shows a badge on the gear. */
  updateAvailable?: boolean;
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
}

interface WorktreeState {
  /** The cwd this data was fetched for — guards against stale responses */
  forCwd: string;
  projectRoot: string;
  isGit: boolean;
  /** False when forCwd is a repo subdirectory — the switcher is hidden there
   *  because subdir sessions keep their own project identity */
  isTopLevel: boolean;
  worktrees: WorktreeEntry[];
}

/** Normalize a repository/project path for use as a Git-state map key. The
 *  same physical repo may be reached via different path spellings (forward /
 *  back slashes, drive-letter casing); folding them makes distinct spellings
 *  resolve to one shared Git context, while genuinely different repos stay
 *  separate. */
function normalizeProjectKey(value: string): string {
  // Clip trailing separators and unify separators. Fold case when the path is
  // Windows-style (drive-letter rooted or backslash-y) so Drive:\ vs C:\ and
  // path casing variants map to the same repository, while preserving
  // case-sensitivity for POSIX paths (client has no process.platform).
  const isWindowsPath = /^[a-zA-Z]:/.test(value) || value.includes("\\");
  const normalized = value.replace(/[\/]+$/, "").replace(/\\/g, "/");
  return isWindowsPath ? normalized.toLowerCase() : normalized;
}

// Bounded retry window for restoring a brand-new session from its URL before
// omp flushes the JSONL (typically appears within a second or two of the
// first prompt, so 8 × 1s covers it without hanging a dead link forever).
const INITIAL_RESTORE_RETRY_MS = 1000;
const INITIAL_RESTORE_MAX_ATTEMPTS = 8;

const UNREAD_SESSIONS_STORAGE_KEY = "omp-web:unread-session-ids";

function loadUnreadSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(UNREAD_SESSIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

function saveUnreadSessionIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0) window.localStorage.removeItem(UNREAD_SESSIONS_STORAGE_KEY);
    else window.localStorage.setItem(UNREAD_SESSIONS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

const EXPANDED_PROJECTS_STORAGE_KEY = "ompgui:expanded-projects";
const LEGACY_EXPANDED_PROJECTS_STORAGE_KEY = "omp-web:expanded-projects";

/** Shared empty set for the no-stored-expansion default (never mutated). */
const EMPTY_PROJECT_SET: ReadonlySet<string> = new Set();

function isExpandedProjectsValue(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.every((path) => typeof path === "string" && path.length > 0);
  } catch {
    return false;
  }
}

/** Persisted expanded-project paths. Returns null when nothing was stored —
 *  the sidebar then defaults to expanding only the active project. */
function loadExpandedProjects(): Set<string> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = migrateStorageValue(
      window.localStorage,
      EXPANDED_PROJECTS_STORAGE_KEY,
      LEGACY_EXPANDED_PROJECTS_STORAGE_KEY,
      isExpandedProjectsValue,
    );
    if (!raw) return null;
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return null;
  }
}

function saveExpandedProjects(paths: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EXPANDED_PROJECTS_STORAGE_KEY, JSON.stringify([...paths]));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

/** Substitute the home dir prefix with ~ (no path truncation — see PathLabel) */
function displayCwd(cwd: string, homeDir?: string): string {
  return (homeDir && cwd.startsWith(homeDir)) ? "~" + cwd.slice(homeDir.length) : cwd;
}

/** Final folder name of a project path, portable across / and \ separators. */
function projectLabel(projectPath: string): string {
  const trimmed = projectPath.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

/**
 * Path label that ellipsizes on the LEFT, keeping the (most relevant) trailing
 * segments visible: "…orkspace/pi-web". Shows as much of the path as fits
 * instead of a fixed number of segments. The rtl container moves the ellipsis
 * to the left edge; the inner plaintext bidi isolation keeps the path itself
 * rendered strictly left-to-right (no punctuation reordering).
 */
function PathLabel({ text }: { text: string }) {
  return (
    <span className="sidebar-path-label">
      <span className="sidebar-path-label-text">{text}</span>
    </span>
  );
}

function formatRelativeTime(value: string, locale: string, now: number): string | null {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;

  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" });
  if (minutes < 1) return formatter.format(0, "minute");
  if (minutes < 60) return formatter.format(-minutes, "minute");

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatter.format(-hours, "hour");
  return formatter.format(-Math.floor(hours / 24), "day");
}

/** Quiet square icon button used across the sidebar chrome (header, section
 *  headers, footer). Stays visually subdued; the accent appears on hover and
 *  when active (e.g. an applied filter). */
function SidebarIconButton({
  label,
  title,
  onClick,
  active = false,
  disabled = false,
  children,
}: {
  label: string;
  title?: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className="sidebar-icon-button"
    >
      {children}
    </button>
  );
}

const MENU_MARGIN = 5;
const MENU_VIEWPORT_PAD = 8;

/**
 * Overflow menu rendered through a portal to document.body so it always
 * floats above every sidebar row: it is never clipped by the workspace list's
 * overflow and never covered by sibling stacking contexts (each workspace
 * section isolates its own context). Positioned from the anchor button's
 * viewport rect, flips to the other side of the anchor when there is no room,
 * follows the anchor while the sidebar scrolls, and closes on outside press
 * or Escape.
 */
function SidebarPortalMenu({
  anchor,
  open,
  onClose,
  placement = "below",
  align = "end",
  minWidth = 136,
  className,
  style,
  children,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  placement?: "below" | "above";
  /** "end" right-aligns to the anchor, "start" left-aligns to it. */
  align?: "start" | "end";
  minWidth?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Refs are passed as arguments so the callback stays dependency-clean
  // (no ref.current access inside) for the React Compiler.
  const computePos = useCallback((el: HTMLElement | null, menu: HTMLDivElement | null) => {
    if (!el || !menu) return;
    const r = el.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    let top: number;
    if (placement === "above") {
      top = r.top - height - MENU_MARGIN;
      if (top < MENU_VIEWPORT_PAD) {
        top = Math.min(r.bottom + MENU_MARGIN, window.innerHeight - height - MENU_VIEWPORT_PAD);
      }
    } else {
      top = r.bottom + MENU_MARGIN;
      if (top + height > window.innerHeight - MENU_VIEWPORT_PAD) {
        top = r.top - height - MENU_MARGIN;
      }
    }
    if (top < MENU_VIEWPORT_PAD) top = MENU_VIEWPORT_PAD;
    const left = align === "start"
      ? Math.max(MENU_VIEWPORT_PAD, Math.min(r.left, window.innerWidth - width - MENU_VIEWPORT_PAD))
      : Math.max(MENU_VIEWPORT_PAD, Math.min(r.right - width, window.innerWidth - width - MENU_VIEWPORT_PAD));
    setPos({ top, left });
  }, [placement, align]);

  // Measure on open: the portal is mounted during commit, so the menu's own
  // size is available synchronously in the layout effect.
  useLayoutEffect(() => {
    if (!open) return;
    computePos(anchor.current, menuRef.current);
  }, [open, computePos, anchor]);

  // Reposition while open — the sidebar is resizable and the list scrolls.
  useEffect(() => {
    if (!open) return;
    const update = () => computePos(anchor.current, menuRef.current);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, computePos, anchor]);

  // Close on outside press / Escape and handle keyboard arrow navigation.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const firstBtn = menuRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])");
      firstBtn?.focus();
    }, 0);
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (anchor.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
        anchor.current?.focus();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []);
        if (buttons.length === 0) return;
        const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const nextIndex = e.key === "ArrowDown"
          ? (currentIndex + 1) % buttons.length
          : (currentIndex - 1 + buttons.length) % buttons.length;
        buttons[nextIndex]?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, anchor]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className={`sidebar-portal-menu${className ? ` ${className}` : ""}`}
      style={{
        top: pos ? pos.top : -9999,
        left: pos ? pos.left : -9999,
        visibility: pos ? "visible" : "hidden",
        minWidth,
        ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

interface SessionTreeNode {
  session: SessionInfo;
  children: SessionTreeNode[];
}

function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
  const byId = new Map<string, SessionTreeNode>();
  for (const s of sessions) {
    byId.set(s.id, { session: s, children: [] });
  }

  // Build a map of parentSessionId chains so we can resolve missing ancestors
  const parentOf = new Map<string, string>();
  for (const s of sessions) {
    if (s.parentSessionId) parentOf.set(s.id, s.parentSessionId);
  }

  // Walk up the parentSessionId chain to find the nearest ancestor that exists in byId
  function resolveAncestor(id: string): string | null {
    let cur = parentOf.get(id);
    const visited = new Set<string>();
    while (cur) {
      if (visited.has(cur)) return null; // cycle guard
      visited.add(cur);
      if (byId.has(cur)) return cur;
      cur = parentOf.get(cur);
    }
    return null;
  }

  const roots: SessionTreeNode[] = [];
  for (const node of byId.values()) {
    const ancestor = resolveAncestor(node.session.id);
    if (ancestor) {
      byId.get(ancestor)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort each level by modified desc
  const sort = (nodes: SessionTreeNode[]) => {
    nodes.sort((a, b) => b.session.modified.localeCompare(a.session.modified));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

function useScramble(target: string, running: boolean, reducedMotion: boolean): string {
  const [display, setDisplay] = useState(target);
  const frameRef = useRef<number | null>(null);
  const iterRef = useRef(0);

  useEffect(() => {
    if (!running || reducedMotion) {
      setDisplay(target);
      return;
    }
    iterRef.current = 0;
    const totalFrames = target.length * 4;

    const step = () => {
      iterRef.current += 1;
      const progress = iterRef.current / totalFrames;
      const resolved = Math.floor(progress * target.length);

      setDisplay(
        target
          .split("")
          .map((char, i) => {
            if (char === " ") return " ";
            if (i < resolved) return char;
            return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
          })
          .join("")
      );

      if (iterRef.current < totalFrames) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(target);
      }
    };

    frameRef.current = requestAnimationFrame(step);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [target, running, reducedMotion]);

  return display;
}

function OmpGuiTitle() {
  const [showVersion, setShowVersion] = useState(false);
  const [scrambling, setScrambling] = useState(false);
  const scrambleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const target = showVersion ? `v${process.env.NEXT_PUBLIC_OMPGUI_VERSION}` : "ompgui";
  const display = useScramble(target, scrambling, reducedMotion);

  const triggerScramble = useCallback((toVersion: boolean) => {
    setShowVersion(toVersion);
    if (scrambleTimerRef.current) clearTimeout(scrambleTimerRef.current);
    if (reducedMotion) return;
    setScrambling(true);
    scrambleTimerRef.current = setTimeout(() => setScrambling(false), (toVersion ? 6 : 8) * 4 * (1000 / 60) + 100);
  }, [reducedMotion]);

  const handleClick = useCallback(() => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);

    const next = !showVersion;
    triggerScramble(next);

    if (next) {
      revertTimerRef.current = setTimeout(() => triggerScramble(false), 3000);
    }
  }, [showVersion, triggerScramble]);

  useEffect(() => () => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
    if (scrambleTimerRef.current) clearTimeout(scrambleTimerRef.current);
  }, []);

  return (
    <button
      onClick={handleClick}
      className="sidebar-brand"
      title={showVersion ? "Show ompgui name" : "Show ompgui version"}
    >
      {!scrambling && !showVersion ? (
        <>
          <span className="sidebar-brand-accent">omp</span>
          <span className="sidebar-brand-name">gui</span>
        </>
      ) : (
        <span className="sidebar-brand-dynamic" data-version={showVersion ? "true" : "false"}>{display}</span>
      )}
    </button>
  );
}
export function SessionSidebar({ selectedSessionId, optimisticSession, onSelectSession, onSessionIntent, onNewSession, initialSessionId, skipInitialProjectSelection, onInitialRestoreDone, refreshKey, onSessionDeleted, onSessionRestored, selectedCwd: selectedCwdProp, sidebarVisible = true, onCwdChange, onOpenFile, explorerRefreshKey, onExplorerRefresh, explorerRefreshing, onExplorerRefreshDone, onAtMention, onAtMentions, onOpenSettings, onOpenUsage, updateAvailable }: Props) {
  const { t } = useI18n();
  const sessionList = useSyncExternalStore(subscribeSessionList, getSessionListSnapshot, getSessionListSnapshot);
  const allSessions = sessionList.sessions;
  const loading = sessionList.status === "loading" || sessionList.status === "idle";
  const error = sessionList.error
    ? translate("sessionSidebar.loadFailed", { detail: sessionList.error })
    : null;
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState<string>("");
  // Managed + session-discovered projects (server-merged, hidden excluded).
  const [projects, setProjects] = useState<ManagedProject[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  // Add-project picker state.
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [addProjectBusy, setAddProjectBusy] = useState(false);
  const [addProjectError, setAddProjectError] = useState<string | null>(null);
  // Per-project expansion, persisted to localStorage (null = nothing stored).
  const [expandedProjects, setExpandedProjects] = useState<Set<string> | null>(() => loadExpandedProjects());
  // Project currently being removed (hide) — serializes remove requests.
  const [removeProjectPath, setRemoveProjectPath] = useState<string | null>(null);
  // Worktree/branch/Git state is scoped per repository. It is cached in a
  // map keyed by the normalized repository root so switching workspaces never
  // leaks one project's branch/worktree data into another's UI (each project
  // keeps its own loaded Git state; a late async response for a previous repo
  // only updates that repo's entry, never the active one).
  const [worktreeStateByProject, setWorktreeStateByProject] = useState<Record<string, WorktreeState>>({});
  const [wtDropdownOpen, setWtDropdownOpen] = useState(false);
  const [wtNewOpen, setWtNewOpen] = useState(false);
  const [wtNewBranch, setWtNewBranch] = useState("");
  const [wtError, setWtError] = useState<string | null>(null);
  const [wtBusy, setWtBusy] = useState(false);
  const [wtConfirmRemove, setWtConfirmRemove] = useState<string | null>(null);
  const wtToggleRef = useRef<HTMLButtonElement>(null);
  const wtNewInputRef = useRef<HTMLInputElement>(null);
  const [explorerOpen, setExplorerOpen] = useState(true);
  // Keep the explorer mounted after its first visible opening so
  // closing/reopening it preserves the tree, expanded paths, and upload state.
  // The default-open UI remains intact once the sidebar itself is visible.
  const explorerHasOpenedRef = useRef(false);
  useEffect(() => {
    if (sidebarVisible && explorerOpen) explorerHasOpenedRef.current = true;
  }, [sidebarVisible, explorerOpen]);
  const [explorerKey, setExplorerKey] = useState(0);
  const [explorerUploadBusy, setExplorerUploadBusy] = useState(false);
  const [sessionRefreshDone, setSessionRefreshDone] = useState(false);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => loadUnreadSessionIds());
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  // Relative session times must age while the sidebar stays open; one shared
  // minute clock avoids a timer per session row.
  const [relativeTimeNow, setRelativeTimeNow] = useState(() => Date.now());
  // Client-side workspace/session filtering (Workspaces header controls).
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [runningOnly, setRunningOnly] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Once the SSE stream has delivered a frame it is the source of truth for
  // running state; late /api/sessions responses must not overwrite it.
  const sseAuthoritativeRef = useRef(false);
  const sessionRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileExplorerRef = useRef<FileExplorerHandle>(null);

  const pendingRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A monotonically increasing lifecycle token fences async work from an
  // earlier Strict Mode setup as well as work that settles after unmount.
  const sessionsLifecycleRef = useRef(0);
  const sessionsDisposedRef = useRef(true);

  useEffect(() => {
    const lifecycle = sessionsLifecycleRef.current + 1;
    sessionsLifecycleRef.current = lifecycle;
    sessionsDisposedRef.current = false;

    return () => {
      if (sessionsLifecycleRef.current !== lifecycle) return;
      sessionsDisposedRef.current = true;
      if (pendingRefreshRef.current) {
        clearTimeout(pendingRefreshRef.current);
        pendingRefreshRef.current = null;
      }
      if (sessionRefreshTimerRef.current) {
        clearTimeout(sessionRefreshTimerRef.current);
        sessionRefreshTimerRef.current = null;
      }
    };
  }, []);

  const loadSessions = useCallback(async (showLoading = false) => {
    const lifecycle = sessionsLifecycleRef.current;
    const isActive = () => !sessionsDisposedRef.current && sessionsLifecycleRef.current === lifecycle;
    if (!isActive()) return;
    if (!shouldFetchSessionList(readDocumentNetworkStatus(document, navigator))) return;

    const snapshot = await loadSessionList();
    if (!isActive()) return;
    if (!sseAuthoritativeRef.current) {
      setRunningSessionIds(new Set(snapshot.runningSessionIds));
    }
    if (!showLoading && snapshot.status === "ready") {
      setSessionRefreshDone(true);
      if (sessionRefreshTimerRef.current) clearTimeout(sessionRefreshTimerRef.current);
      sessionRefreshTimerRef.current = null;
      const refreshTimer = setTimeout(() => {
        if (sessionRefreshTimerRef.current === refreshTimer) sessionRefreshTimerRef.current = null;
        if (!isActive()) return;
        setSessionRefreshDone(false);
      }, 2000);
      sessionRefreshTimerRef.current = refreshTimer;
    }
  }, []);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    void loadSessions(isFirst);
  }, [loadSessions, refreshKey]);

  useEffect(() => {
    const existingIds = new Set(allSessions.map((session) => session.id));
    setUnreadSessionIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter((id) => existingIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [allSessions]);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { projects?: ManagedProject[] };
      setProjects(data.projects ?? []);
      setProjectsError(null);
      projectsLoadedRef.current = true;
    } catch (e) {
      setProjectsError(translate("projects.loadFailed", { detail: e instanceof Error ? e.message : String(e) }));
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects, refreshKey]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const sync = () => {
      if (document.visibilityState === "hidden") {
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
        return;
      }
      if (!interval) interval = setInterval(() => setRelativeTimeNow(Date.now()), 60_000);
      setRelativeTimeNow(Date.now());
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  // Persist expansion state; null means nothing was stored yet.
  useEffect(() => {
    if (expandedProjects === null) return;
    saveExpandedProjects(expandedProjects);
  }, [expandedProjects]);

  // Persist unread markers so they survive a browser refresh before the user
  // has actually opened the completed session.
  useEffect(() => {
    saveUnreadSessionIds(unreadSessionIds);
  }, [unreadSessionIds]);

  // Debounce refresh bursts (agent_start + session_info_update + file-appear signal can fire within 250ms).
  const scheduleRefresh = useCallback(() => {
    const lifecycle = sessionsLifecycleRef.current;
    const isActive = () => !sessionsDisposedRef.current && sessionsLifecycleRef.current === lifecycle;
    if (!isActive()) return;
    if (pendingRefreshRef.current) return;
    const refreshTimer = setTimeout(() => {
      if (pendingRefreshRef.current === refreshTimer) pendingRefreshRef.current = null;
      if (!isActive()) return;
      void loadSessions(false);
    }, 300);
    pendingRefreshRef.current = refreshTimer;
  }, [loadSessions]);

  useEffect(() => {
    const lifecycle = sessionsLifecycleRef.current;
    const isActive = () => !sessionsDisposedRef.current && sessionsLifecycleRef.current === lifecycle;
    let source: EventSource | null = null;
    let networkActive = false;

    const disconnect = () => {
      if (!source) return;
      source.close();
      source = null;
    };

    const connect = () => {
      if (source) return;
      source = new EventSource("/api/agent/running/events");
      source.onmessage = (event) => {
        if (!isActive()) return;
        try {
          const frame = parseRunningEventsFrame(JSON.parse(event.data) as unknown);
          if (frame.type === "sessions-changed") {
            if (frame.refreshSessionList) {
              publishSessionChange({
                type: "sessions-changed",
                sessionIds: frame.sessionIds,
                refreshSessionList: true,
              });
              invalidateSessionList();
              scheduleRefresh();
            }
            return;
          }
          if (frame.type === "running") {
            sseAuthoritativeRef.current = true;
            setRunningSessionIds(new Set(frame.runningSessionIds));
            if (frame.refreshSessionList) scheduleRefresh();
          }
        } catch {
          // ignore malformed frames
        }
      };
    };

    const sync = () => {
      if (!isActive()) return;
      const next = readDocumentNetworkStatus(document, navigator);
      const transition = nextDocumentNetworkState(networkActive, next);
      networkActive = transition.active;
      if (!transition.active) {
        disconnect();
        return;
      }
      connect();
      if (transition.catchUp) void loadSessions(true);
    };

    sync();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      if (pendingRefreshRef.current) {
        clearTimeout(pendingRefreshRef.current);
        pendingRefreshRef.current = null;
      }
      disconnect();
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, [loadSessions, scheduleRefresh]);

  useEffect(() => {
    const previous = previousRunningSessionIdsRef.current;
    const completedInBackground = [...previous].filter((id) => !runningSessionIds.has(id) && id !== selectedSessionId);
    const newlyRunning = [...runningSessionIds].filter((id) => !previous.has(id));

    if (completedInBackground.length > 0 || newlyRunning.length > 0) {
      setUnreadSessionIds((prev) => {
        const next = new Set(prev);
        newlyRunning.forEach((id) => next.delete(id));
        completedInBackground.forEach((id) => next.add(id));
        return next;
      });
    }
    // A brand-new session's JSONL does not exist until the first assistant
    // turn makes progress — but its running badge must show immediately
    // via the optimistic row. Once any session completes (or a new session
    // appears on disk), reload so it replaces the optimistic placeholder
    // without waiting for another refresh trigger.
    if (completedInBackground.length > 0 || newlyRunning.length > 0) {
      scheduleRefresh();
    }

    previousRunningSessionIdsRef.current = runningSessionIds;
  }, [runningSessionIds, selectedSessionId, scheduleRefresh]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setUnreadSessionIds((prev) => {
      if (!prev.has(selectedSessionId)) return prev;
      const next = new Set(prev);
      next.delete(selectedSessionId);
      return next;
    });
  }, [selectedSessionId]);

  useEffect(() => {
    if (explorerRefreshKey !== undefined) setExplorerKey((k) => k + 1);
  }, [explorerRefreshKey]);

  useEffect(() => {
    fetch("/api/home").then((r) => r.json()).then((d: { home?: string }) => {
      if (d.home) setHomeDir(d.home);
    }).catch(() => {});
  }, []);

  const restoredRef = useRef(false);
  /** Set once the first /api/projects fetch succeeds; guards the expansion
   *  prune against running on an empty (still-loading) project list. */
  const projectsLoadedRef = useRef(false);

  /** Resolve the project root for a cwd from the freshest data available.
   *  The worktree/branch cache is keyed per repository, so this lookup is
   *  scoped: a worktree belongs to the repository whose cached GitState lists
   *  it — never to a different repository's state. */
  const projectRootFor = useCallback((cwd: string | null): string | null => {
    if (!cwd) return null;
    // Any path in a cached repo's worktree list belongs to that repo — covers
    // worktrees without sessions, so switching to them keeps the row mounted.
    for (const state of Object.values(worktreeStateByProject)) {
      if (state.worktrees.some((w) => normalizeProjectKey(w.path) === normalizeProjectKey(cwd))) {
        return state.projectRoot;
      }
    }
    // A registered project path is its own canonical root. The lookup goes
    // through the case-folded comparable form (Windows/NTFS is
    // case-insensitive, so a session's cwd/projectRoot can spell the same
    // folder with different casing), and the registered path itself is
    // returned so the caller gets a canonical value.
    const registered = projects.find((p) => comparableProjectPath(p.path) === comparableProjectPath(cwd));
    if (registered) return registered.path;
    const foldedCwd = comparableProjectPath(cwd);
    const match = allSessions.find((s) => comparableProjectPath(s.cwd) === foldedCwd);
    return match?.projectRoot ?? cwd;
  }, [worktreeStateByProject, allSessions, projects]);

  // ---- Expansion (used by the sync/notify effects below, so declared first) --
  const expandProject = useCallback((path: string) => {
    setExpandedProjects((prev) => {
      if (prev?.has(path)) return prev;
      const next = new Set(prev ?? []);
      next.add(path);
      return next;
    });
  }, []);

  const collapseProject = useCallback((path: string) => {
    setExpandedProjects((prev) => {
      if (!prev?.has(path)) return prev;
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  }, []);

  const toggleProjectExpanded = useCallback((path: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  /** Activate a project (effective cwd = its root) and expand it, without
   *  opening a session. */
  const activateProject = useCallback((path: string) => {
    provisionalSelectionRef.current = false;
    setSelectedCwd(path);
    expandProject(path);
  }, [expandProject]);

  // Notify parent only when the effective cwd actually changes (not when
  // projectRootFor identity changes due to session/worktree refreshes).
  const lastNotifiedCwdRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastNotifiedCwdRef.current === selectedCwd) return;
    lastNotifiedCwdRef.current = selectedCwd;
    onCwdChange?.(selectedCwd, projectRootFor(selectedCwd));
  }, [selectedCwd, onCwdChange, projectRootFor]);

  // Sync the worktree switcher to the selected session's cwd. Sessions of all
  // worktrees in a project share one list, so clicking a session from another
  // worktree should move the effective cwd there. Only fires when the prop
  // value changes, so a manual switcher change is not snapped back. Sessions
  // picked outside the sidebar (URL restore, command palette) also expand
  // their containing project.
  const lastSyncedCwdPropRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedCwdProp && selectedCwdProp !== lastSyncedCwdPropRef.current) {
      lastSyncedCwdPropRef.current = selectedCwdProp;
      setSelectedCwd(selectedCwdProp);
      const project = projectRootFor(selectedCwdProp);
      if (project) expandProject(project);
    }
  }, [selectedCwdProp, projectRootFor, expandProject]);

  // Load worktrees/branch data for the repository containing the current
  // effective cwd. Results are cached in worktreeStateByProject keyed by the
  // normalized repository root, so each workspace keeps its own Git context:
  //  • switching to another repo leaves this repo's cached state intact, and
  //  • a late response for the previously-selected repo writes only that
  //    repo's entry (never the active repo's, so it can't overwrite the UI).
  const [wtRefreshKey, setWtRefreshKey] = useState(0);
  useLayoutEffect(() => {
    if (!selectedCwd) return;
    let cancelled = false;
    const requestedCwd = selectedCwd;
    fetch(`/api/worktrees?cwd=${encodeURIComponent(requestedCwd)}`)
      .then((r) => r.json())
      .then((d: { projectRoot?: string; isGit?: boolean; isTopLevel?: boolean; worktrees?: WorktreeEntry[]; error?: string }) => {
        if (cancelled) return;
        if (d.error || !d.projectRoot) {
          // This cwd is not a Git repo (or the lookup failed) — the selected
          // workspace should show no branch/worktrees. Other repos' cached
          // state is left intact: a non-Git workspace never inherits another
          // repo's branch, and we never discard previously-visited repos' Git
          // state.
          return;
        }
        const projectRoot = d.projectRoot;
        const entry: WorktreeState = {
          forCwd: requestedCwd,
          projectRoot,
          isGit: d.isGit ?? false,
          isTopLevel: d.isTopLevel ?? false,
          worktrees: d.worktrees ?? [],
        };
        setWorktreeStateByProject((prev) => {
          const key = normalizeProjectKey(projectRoot);
          const existing = prev[key];
          if (existing && normalizeProjectKey(existing.projectRoot) !== key) {
            const next = { ...prev };
            delete next[normalizeProjectKey(existing.projectRoot)];
            next[key] = entry;
            return next;
          }
          return { ...prev, [key]: entry };
        });
      })
      .catch(() => { /* leave any cached state; refetch on demand */ });
    return () => { cancelled = true; };
  }, [selectedCwd, wtRefreshKey, refreshKey]);

  // Keep a just-created session and its project visible while omp is still
  // flushing the JSONL file. The server list remains authoritative once it
  // contains the same id.
  // IMPORTANT: derive synchronously — the previous projectRootFor(cwd) needs
  // the async /api/worktrees git lookup, so the optimistic row would park in
  // cwd-bucket then jump to repo bucket. Use registered-project match first.
  const optimisticProjectRoot = (() => {
    if (!optimisticSession) return null;
    if (optimisticSession.projectRoot) return optimisticSession.projectRoot;
    if (optimisticSession.projectKey) return optimisticSession.projectKey;
    const cw = optimisticSession.cwd ?? "";
    if (!cw) return null;
    const reg = projects.find((p) => comparableProjectPath(p.path) === comparableProjectPath(cw));
    if (reg) return reg.path;
    return cw;
  })();
  // Stable placeholder timestamps: Date.now() inside the memo would churn every refresh and bust downstream memos.
  const placeholderTsRef = useRef<Map<string, string>>(new Map());
  const visibleSessions = useMemo(() => {
    let base = allSessions;
    if (optimisticSession && !base.some((session) => session.id === optimisticSession.id)) {
      const stableRoot = optimisticProjectRoot ?? optimisticSession.cwd;
      const stableKey = stableRoot ? comparableProjectPath(stableRoot) : undefined;
      base = [...base, { ...optimisticSession, projectRoot: stableRoot ?? optimisticSession.cwd, ...(stableKey ? { projectKey: stableKey } : {}) }];
    }
    // A running session's JSONL may not exist yet (first turn still
    // streaming). Keep it in the list so navigating away never hides it
    // until the file lands and the next refresh replaces the placeholder.
    const known = new Set(base.map((s) => s.id));
    const placeholders: SessionInfo[] = [];
    for (const id of runningSessionIds) {
      if (known.has(id)) continue;
      let ts = placeholderTsRef.current.get(id);
      if (!ts) {
        ts = new Date().toISOString();
        placeholderTsRef.current.set(id, ts);
      }
      const phRoot = optimisticProjectRoot ?? selectedCwd ?? "";
      const phKey = phRoot ? comparableProjectPath(phRoot) : undefined;
      placeholders.push({
        id,
        path: "",
        cwd: selectedCwd ?? "",
        name: undefined,
        created: ts,
        modified: ts,
        messageCount: 1,
        firstMessage: "",
        projectRoot: phRoot,
        ...(phKey ? { projectKey: phKey } : {}),
      });
    }
    // Prune timestamps for ids that are now materialized or no longer running
    if (placeholderTsRef.current.size > placeholders.length) {
      for (const key of [...placeholderTsRef.current.keys()]) {
        if (!runningSessionIds.has(key) || known.has(key)) placeholderTsRef.current.delete(key);
      }
    }
    return placeholders.length ? [...base, ...placeholders] : base;
  }, [allSessions, optimisticSession, optimisticProjectRoot, runningSessionIds, selectedCwd]);
  const visibleProjects = useMemo(() => {
    let base = projects;
    const hasOpt = optimisticProjectRoot ? base.some((p) => comparableProjectPath(p.path) === comparableProjectPath(optimisticProjectRoot)) : false;
    if (optimisticProjectRoot && !hasOpt) {
      base = [...base, { path: optimisticProjectRoot }];
    }
    // Running placeholders may belong to a project not yet in the managed list
    // (new session's cwd wasn't registered as a project). Keep that workspace
    // visible so the placeholder row has a bucket to render in.
    const knownFolded = new Set(base.map((p) => comparableProjectPath(p.path)));
    for (const id of runningSessionIds) {
      if (allSessions.some((s) => s.id === id)) continue;
      const phPath = optimisticProjectRoot ?? selectedCwd ?? "";
      if (phPath && !knownFolded.has(comparableProjectPath(phPath))) {
        base = [...base, { path: phPath }];
        knownFolded.add(comparableProjectPath(phPath));
      }
    }
    return base;
  }, [optimisticProjectRoot, projects, runningSessionIds, allSessions, selectedCwd]);

  // ---- Derived project list ---------------------------------------------------
  const selectedProject = useMemo(() => projectRootFor(selectedCwd), [projectRootFor, selectedCwd]);
  // While a fresh optimistic/placeholder is pending (JSONL not yet on disk),
  // freeze ordering so the new project row does not flicker optimistic ->
  // confirmed position. New projects are allowed to append at the end.
  const hasPendingNewSession = Boolean(optimisticSession || [...runningSessionIds].some((id) => !allSessions.some((ss) => ss.id === id)));
  const sortedProjectsBase = useMemo(() => sortManagedProjects(visibleProjects), [visibleProjects]);
  const sortedProjectsRef = useRef<ManagedProject[] | null>(null);
  const sortedProjects = useMemo(() => {
    if (hasPendingNewSession && sortedProjectsRef.current) {
      const prev = sortedProjectsRef.current;
      const prevKeys = new Set(prev.map((p) => comparableProjectPath(p.path)));
      const next = [...prev];
      for (const p of sortedProjectsBase) if (!prevKeys.has(comparableProjectPath(p.path))) next.push(p);
      return next;
    }
    sortedProjectsRef.current = sortedProjectsBase;
    return sortedProjectsBase;
  }, [sortedProjectsBase, hasPendingNewSession]);
  const sessionsByProject = useMemo(
    () => groupSessionsByProject(sortedProjects, visibleSessions),
    [sortedProjects, visibleSessions],
  );
  const projectActivity = useMemo(
    () => projectActivityCounts(visibleSessions, runningSessionIds, unreadSessionIds),
    [visibleSessions, runningSessionIds, unreadSessionIds],
  );

  // Client-side filtering (Workspaces header: search + "running only").
  // While a filter is active, workspaces with no matching sessions are hidden
  // so the list reads as a genuine result set; at rest every workspace stays.
  // Deferred search: typing stays responsive (input updates immediately) while the heavy
  // visibleProjectEntries filter runs at lower priority. Combines with the 200ms ETag loadSessions
  // debounce already in place — keystrokes never block the main thread on large session lists.
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const filtersActive = searchOpen || runningOnly || deferredSearchQuery.trim().length > 0;
  const visibleProjectEntries = useMemo(() => {
    const q = deferredSearchQuery.trim().toLowerCase();
    const entries: { project: ManagedProject; sessions: SessionInfo[] }[] = [];
    for (const project of sortedProjects) {
      let list = sessionsByProject.get(project.path) ?? [];
      if (runningOnly) list = list.filter((s) => runningSessionIds.has(s.id));
      if (q) {
        const labelLower = projectLabel(project.path).toLowerCase();
        list = list.filter((s) => (s.name ?? "").toLowerCase().includes(q) || s.firstMessage.toLowerCase().includes(q));
        if (list.length === 0 && !labelLower.includes(q)) continue;
      }
      if (list.length === 0 && (runningOnly || q)) continue;
      entries.push({ project, sessions: list });
    }
    return entries;
  }, [sortedProjects, sessionsByProject, runningOnly, deferredSearchQuery, runningSessionIds]);

  const treesByProject = useMemo(() => {
    const m = new Map<string, ReturnType<typeof buildSessionTree>>();
    for (const { project, sessions } of visibleProjectEntries) m.set(project.path, buildSessionTree(sessions));
    return m;
  }, [visibleProjectEntries]);

  // Drop persisted expansion keys whose project no longer exists (removed or
  // vanished), so the storage stays bounded to real projects. Only runs after
  // the first project fetch — an empty list mid-load must never wipe storage.
  useEffect(() => {
    if (expandedProjects === null || !projectsLoadedRef.current) return;
    const known = new Set(sortedProjects.map((p) => p.path));
    const stale = [...expandedProjects].filter((path) => !known.has(path));
    if (stale.length === 0) return;
    setExpandedProjects((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      stale.forEach((path) => next.delete(path));
      return next;
    });
  }, [expandedProjects, sortedProjects]);

  // True while the auto-selected project was chosen before projects loaded
  // (ordering incomplete); cleared by any manual activation.
  const provisionalSelectionRef = useRef(false);

  // A just-started session's JSONL is not flushed until its first turn makes
  // progress, so a URL reopened in that window has no list entry yet. Retry
  // the list a few times before declaring the restore failed.
  const restoreRetryRef = useRef(0);
  const restoreRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreRetryAliveRef = useRef(true);
  const restoreRetryScopeRef = useRef(0);
  const [restoreRetryEpoch, setRestoreRetryEpoch] = useState(0);
  useEffect(() => {
    restoreRetryAliveRef.current = true;
    const scope = ++restoreRetryScopeRef.current;
    return () => {
      restoreRetryAliveRef.current = false;
      restoreRetryScopeRef.current = scope + 1;
      if (restoreRetryTimerRef.current) {
        clearTimeout(restoreRetryTimerRef.current);
        restoreRetryTimerRef.current = null;
      }
    };
  }, [initialSessionId, skipInitialProjectSelection]);

  // Auto-select cwd and restore session from URL on first load
  useEffect(() => {
    if (skipInitialProjectSelection) return;

    if (initialSessionId) {
      if (shouldOpenRestoredSessionImmediately(initialSessionId, restoredRef.current)) {
        restoredRef.current = true;
        const target = pickSessionForRestore(initialSessionId, allSessions);
        if (target.cwd) {
          setSelectedCwd(target.cwd);
          expandProject(workspaceKeyOf(target));
        }
        onSelectSession(target, true);
      }

      const listed = allSessions.find((session) => session.id === initialSessionId);
      if (listed) {
        restoreRetryRef.current = 0;
        if (listed.cwd) {
          setSelectedCwd(listed.cwd);
          expandProject(workspaceKeyOf(listed));
        }
        return;
      }
      if (sessionList.status === "loading" || sessionList.status === "idle") return;
      if (restoreRetryTimerRef.current) return;
      if (restoreRetryRef.current < INITIAL_RESTORE_MAX_ATTEMPTS) {
        restoreRetryRef.current += 1;
        const scope = restoreRetryScopeRef.current;
        restoreRetryTimerRef.current = setTimeout(() => {
          restoreRetryTimerRef.current = null;
          void Promise.resolve(loadSessions(false)).finally(() => {
            if (!restoreRetryAliveRef.current || restoreRetryScopeRef.current !== scope) return;
            setRestoreRetryEpoch((epoch) => epoch + 1);
          });
        }, INITIAL_RESTORE_RETRY_MS);
        return;
      }
      onInitialRestoreDone?.();
      return;
    }

    // No restore target: activate the top project (most recently added) so New
    // Session and Explorer have a context. When projects have not loaded yet
    // the ordering is provisional — re-pick once they arrive, unless the user
    // already activated a project by hand.
    if (selectedCwd !== null && !provisionalSelectionRef.current) return;
    const top = sortedProjects[0];
    if (!top) return;
    setSelectedCwd(top.path);
    expandProject(top.path);
    provisionalSelectionRef.current = allSessions.length === 0;
  }, [allSessions, selectedCwd, initialSessionId, skipInitialProjectSelection, onSelectSession, onInitialRestoreDone, sortedProjects, expandProject, loadSessions, sessionList.status, restoreRetryEpoch]);

  // Default expansion: when the user has never stored an expansion choice,
  // expand only the active project.
  const defaultExpandedRef = useRef(false);
  useEffect(() => {
    if (defaultExpandedRef.current) return;
    const project = selectedProject;
    if (!project) return;
    defaultExpandedRef.current = true;
    if (expandedProjects === null) expandProject(project);
  }, [selectedProject, expandedProjects, expandProject]);

  const commitAddProject = useCallback(async (candidate?: string) => {
    const path = (candidate ?? "").trim();
    if (!path || addProjectBusy) return;

    setAddProjectBusy(true);
    setAddProjectError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      const data = await res.json().catch(() => ({})) as { project?: ManagedProject; error?: string; code?: string };
      if (!res.ok || data.error || !data.project) {
        setAddProjectError(formatApiError({ ...data, error: data.error ?? `HTTP ${res.status}` }));
        return;
      }
      await loadProjects();
      // Activate + expand the newly added project and close the picker.
      setSelectedCwd(data.project.path);
      expandProject(data.project.path);
      setAddProjectOpen(false);
    } catch (e) {
      setAddProjectError(e instanceof Error ? e.message : String(e));
    } finally {
      setAddProjectBusy(false);
    }
  }, [addProjectBusy, loadProjects, expandProject]);

  const handleRemoveProject = useCallback(async (projectPath: string) => {
    if (removeProjectPath) return;
    setRemoveProjectPath(projectPath);
    try {
      const res = await fetch("/api/projects", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectPath }),
      });
      const data = await res.json().catch(() => ({})) as { success?: boolean; error?: string; code?: string };
      if (!res.ok || !data.success) {
        toast.error(formatApiError({ ...data, error: data.error ?? `HTTP ${res.status}` }));
        return;
      }
      // Hiding the active project leaves nothing selected; activate the next
      // most-relevant project so New Session and Explorer stay usable.
      // Compare case-folded — the selected cwd can spell the project path
      // with different casing than this row (Windows/NTFS).
      if (selectedProject !== null && comparableProjectPath(selectedProject) === comparableProjectPath(projectPath)) {
        const next = sortedProjects.find((p) => p.path !== projectPath);
        setSelectedCwd(next ? next.path : null);
      }
      collapseProject(projectPath);
      await loadProjects();
    } finally {
      setRemoveProjectPath(null);
    }
  }, [removeProjectPath, selectedProject, sortedProjects, collapseProject, loadProjects]);

  const handleCreateWorktree = useCallback(async () => {
    const branch = wtNewBranch.trim();
    // Operate against the active repo's own cached Git state — never a
    // globally stored path, so the branch is created in the correct repo.
    const activeState = selectedProject ? worktreeStateByProject[normalizeProjectKey(selectedProject)] : undefined;
    if (!branch || wtBusy || !activeState) return;
    const root = activeState.projectRoot;
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await fetch("/api/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: root, branch }),
      });
      const data = await res.json().catch(() => ({})) as { path?: string; error?: string; code?: string };
      if (!res.ok || data.error || !data.path) {
        setWtError(formatApiError({ ...data, error: data.error ?? `HTTP ${res.status}` }));
        return;
      }
      const newWorktreePath: string = data.path;
      setWtNewOpen(false);
      setWtNewBranch("");
      setWtDropdownOpen(false);
      // Optimistically register the new worktree against THIS repo's cached
      // entry so projectRootFor() resolves it to the main repo before the
      // refetch lands (keeps AppShell from treating the new cwd as a different
      // project). Other repos' cached state is untouched.
      setWorktreeStateByProject((prev) => {
        const key = normalizeProjectKey(root);
        const existing = prev[key];
        if (!existing) return prev;
        const newWt: WorktreeEntry = { path: newWorktreePath, branch, isMain: false };
        return { ...prev, [key]: { ...existing, forCwd: newWorktreePath, worktrees: [...existing.worktrees, newWt] } };
      });
      setSelectedCwd(newWorktreePath);
      setWtRefreshKey((k) => k + 1);
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
    } finally {
      setWtBusy(false);
    }
  }, [wtNewBranch, wtBusy, selectedProject, worktreeStateByProject]);

  const handleRemoveWorktree = useCallback(async (path: string, force: boolean) => {
    // Remove only from the active repo's own cached Git state.
    const activeState = selectedProject ? worktreeStateByProject[normalizeProjectKey(selectedProject)] : undefined;
    if (!activeState || wtBusy) return;
    const root = activeState.projectRoot;
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await fetch("/api/worktrees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: root, path, force }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; dirty?: boolean; code?: string };
      if (!res.ok) {
        if (data.dirty && !force) {
          // Dirty worktree — ask the user to confirm a force removal
          setWtConfirmRemove(path);
          return;
        }
        setWtError(formatApiError({ ...data, error: data.error ?? `HTTP ${res.status}` }));
        return;
      }
      setWtConfirmRemove(null);
      if (selectedCwd !== null && comparableProjectPath(selectedCwd) === comparableProjectPath(path)) setSelectedCwd(root);
      setWtRefreshKey((k) => k + 1);
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
    } finally {
      setWtBusy(false);
    }
  }, [selectedProject, worktreeStateByProject, wtBusy, selectedCwd]);

  // Reset the worktree dropdown's transient state (used by the portaled
  // dropdown's outside-press/Escape close and by the branch toggle).
  const closeWorktreeDropdown = useCallback(() => {
    setWtDropdownOpen(false);
    setWtNewOpen(false);
    setWtNewBranch("");
    setWtError(null);
    setWtConfirmRemove(null);
  }, []);

  // Clicking a session moves the effective cwd to that session's worktree.
  // Done on the click path (not via the selectedCwd prop sync) so it also
  // works when the prop value won't change — e.g. re-clicking the already
  // open session after manually switching worktrees. Selecting a session also
  // activates and expands its containing project.
  const handleSelectSessionFromList = useCallback((s: SessionInfo) => {
    provisionalSelectionRef.current = false;
    if (s.cwd) setSelectedCwd(s.cwd);
    expandProject(workspaceKeyOf(s));
    onSelectSession(s);
  }, [onSelectSession, expandProject]);

  const handleNewSession = useCallback(() => {
    if (!selectedCwd) return;
    onNewSession?.(selectedCwd);
  }, [selectedCwd, onNewSession]);

  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleImportSession = useCallback(async (file: File | null) => {
    if (!file || importing) return;
    setImporting(true);
    try {
      const content = await file.text();
      const res = await fetch("/api/sessions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, content }),
      });
      const data = await res.json().catch(() => ({})) as { success?: boolean; error?: string; code?: string };
      if (!res.ok || !data.success) {
        toast.error(data.error ?? `HTTP ${res.status}`);
        return;
      }
      toast.success(t("sessionSidebar.imported"));
      loadSessions(false);
      void loadProjects();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }, [importing, loadSessions, loadProjects, t]);

  // Sessions of every worktree in the selected project are shown together
  const expandedProjectPaths = expandedProjects ?? EMPTY_PROJECT_SET;

  // The active repo's own cached Git state, selected by repository root — never
  // a single sidebar-wide variable, so it is always the state belonging to the
  // repo the user currently has active.
  const activeGitState = selectedProject
    ? worktreeStateByProject[normalizeProjectKey(selectedProject)]
    : undefined;

  /** Inline branch label ("omp-web · main") from a project's OWN cached Git
   *  state. Returns null when the project has no Git state or is not a git
   *  repo, so a non-Git / not-yet-loaded project never shows another repo's
   *  branch. */
  const worktreeBranchForProject = useCallback((projectPath: string): string | null => {
    const state = worktreeStateByProject[normalizeProjectKey(projectPath)];
    if (!state || !state.isGit || !state.isTopLevel) return null;
    const current = state.worktrees.find((w) => normalizeProjectKey(w.path) === normalizeProjectKey(selectedCwd ?? ""))
      ?? state.worktrees.find((w) => w.isMain);
    if (!current) return null;
    return current.branch ?? displayCwd(current.path, homeDir);
  }, [worktreeStateByProject, selectedCwd, homeDir]);

  const showWorktreeSwitcher = Boolean(
    activeGitState?.isGit
    && activeGitState.isTopLevel
    && selectedCwd
    && selectedProject !== null
    // Case-folded: the active project may be spelled differently than the
    // server-resolved git root (Windows/NTFS), yet still be the same repo.
    && comparableProjectPath(selectedProject) === comparableProjectPath(activeGitState.projectRoot),
  );
  const toggleWorktrees = useCallback(() => {
    setWtDropdownOpen((v) => !v);
  }, []);

  // Stable callbacks for the session list so memoized children don't re-render
  // on every parent state change.
  const handleSessionDeleted = useCallback((id: string) => {
    const deleted = allSessions.find((session) => session.id === id);
    if (deleted) clearLastOpenSession(workspaceKeyOf(deleted));
    onSessionDeleted?.(id);
    loadSessions();
  }, [allSessions, onSessionDeleted, loadSessions]);

  useEffect(() => {
    const selected = allSessions.find((session) => session.id === selectedSessionId);
    if (selected) setLastOpenSession(workspaceKeyOf(selected), selected.id);
  }, [allSessions, selectedSessionId]);

  // row. Non-Git projects intentionally render no Git affordance at all. The
  // switcher shows the ACTIVE repo's own worktrees/branches only.
  const activeProjectSwitcher = showWorktreeSwitcher && activeGitState ? (
    <ProjectWorktreeSwitcher
      worktreeState={activeGitState}
      selectedCwd={selectedCwd}
      homeDir={homeDir}
      wtDropdownOpen={wtDropdownOpen}
      wtNewOpen={wtNewOpen}
      setWtNewOpen={setWtNewOpen}
      wtNewBranch={wtNewBranch}
      setWtNewBranch={setWtNewBranch}
      wtError={wtError}
      setWtError={setWtError}
      wtBusy={wtBusy}
      wtConfirmRemove={wtConfirmRemove}
      setWtConfirmRemove={setWtConfirmRemove}
      onSelectWorktree={(path) => {
        setSelectedCwd(path);
        setWtDropdownOpen(false);
        setWtError(null);
      }}
      onCreateWorktree={handleCreateWorktree}
      onRemoveWorktree={(path, force) => void handleRemoveWorktree(path, force)}
      anchorRef={wtToggleRef}
      newInputRef={wtNewInputRef}
      onClose={closeWorktreeDropdown}
    />
  ) : null;

  const toggleExplorer = useCallback(() => {
    setExplorerOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) explorerHasOpenedRef.current = true;
      return nextOpen;
    });
  }, []);

  return (
    <div className="sidebar-shell">
      {archiveOpen && (
        <ArchivedSessionsDialog
          onClose={() => setArchiveOpen(false)}
          onRestored={(session) => {
            onSessionRestored?.(session);
            void loadSessions(false);
            void loadProjects();
          }}
        />
      )}
      {addProjectOpen && (
        <DirectoryPicker
          busy={addProjectBusy}
          error={addProjectError}
          onCancel={() => {
            setAddProjectOpen(false);
            setAddProjectError(null);
          }}
          onSelect={(path) => void commitAddProject(path)}
        />
      )}
      {/* Header: branding + quiet utilities + New Session */}
      <div className="sidebar-header">
        <div className="sidebar-header-row">
          <OmpGuiTitle />
          <div className="sidebar-header-actions">
            <Tooltip content={t("sessionSidebar.archivedSessions")} side="bottom">
              <SidebarIconButton
                label={t("sessionSidebar.archivedSessions")}
                onClick={() => setArchiveOpen(true)}
              >
                <Archive size={14} strokeWidth={1.9} aria-hidden="true" />
              </SidebarIconButton>
            </Tooltip>
            <Tooltip content={t("sessionSidebar.importTitle")} side="bottom">
              <SidebarIconButton
                label={t("sessionSidebar.import")}
                onClick={() => importInputRef.current?.click()}
                disabled={importing}
              >
                <FileUp size={14} strokeWidth={1.9} aria-hidden="true" />
              </SidebarIconButton>
            </Tooltip>
            <Tooltip content={t("sessionSidebar.refresh")} side="bottom">
              <SidebarIconButton
                label={t("sessionSidebar.refresh")}
                active={sessionRefreshDone}
                onClick={() => {
                  loadSessions(false);
                  void loadProjects();
                }}
              >
                {sessionRefreshDone ? (
                  <Check size={14} strokeWidth={2.2} aria-hidden="true" />
                ) : (
                  <RefreshCw size={14} strokeWidth={1.9} aria-hidden="true" />
                )}
              </SidebarIconButton>
            </Tooltip>
          </div>
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept=".jsonl,.json,application/json,application/jsonl"
          className="sidebar-import-input"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            e.target.value = "";
            void handleImportSession(file);
          }}
        />
        <button
          onClick={handleNewSession}
          disabled={!selectedCwd}
          className="sidebar-new-session"
          title={selectedCwd ? t("sessionSidebar.newSessionIn", { cwd: selectedCwd }) : t("sessionSidebar.selectProjectFirst")}
        >
          <Plus size={15} strokeWidth={2.2} className="sidebar-new-session-icon" aria-hidden="true" />
          <span>{t("sessionSidebar.new")}</span>
        </button>
      </div>

      {/* Workspaces section header: label + search / filter / add */}
      <div className="sidebar-workspaces-header">
        <span className="sidebar-section-label">
          {t("projects.heading")}
        </span>
        <SidebarIconButton
          label={t("sessionSidebar.search")}
          title={t("sessionSidebar.searchTitle")}
          active={searchOpen}
          onClick={() => {
            const nextOpen = !searchOpen;
            setSearchOpen(nextOpen);
            if (nextOpen) setTimeout(() => searchInputRef.current?.focus(), 0);
            else setSearchQuery("");
          }}
        >
          <Search size={15} strokeWidth={1.9} aria-hidden="true" />
        </SidebarIconButton>
        <SidebarIconButton
          label={t("sessionSidebar.filterRunning")}
          title={t("sessionSidebar.filterRunningTitle")}
          active={runningOnly}
          onClick={() => setRunningOnly((v) => !v)}
        >
          <SlidersHorizontal size={15} strokeWidth={1.9} aria-hidden="true" />
        </SidebarIconButton>
        <SidebarIconButton
          label={t("projects.add")}
          title={t("projects.addTitle")}
          onClick={() => {
            setAddProjectOpen(true);
            setAddProjectError(null);
          }}
        >
          <Plus size={15} strokeWidth={1.9} aria-hidden="true" />
        </SidebarIconButton>
      </div>
      {searchOpen && (
        <div className="sidebar-search-wrap">
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setSearchOpen(false);
                setSearchQuery("");
              }
            }}
            placeholder={t("sessionSidebar.searchPlaceholder")}
            aria-label={t("sessionSidebar.search")}
            className="sidebar-search-input"
          />
        </div>
      )}

      {/* Workspaces */}
        <div
          className="sidebar-workspaces-list"
          style={{ flex: explorerOpen && (selectedCwdProp || selectedCwd) ? "1 1 0" : "1 1 auto" }}
        >
          {loading && (
            <div className="sidebar-state-message sidebar-state-message-muted">
              {t("sessionSidebar.loading")}
            </div>
          )}
          {projectsError && (
            <div className="sidebar-state-message sidebar-state-message-error">{projectsError}</div>
          )}
          {error && (
            <div className="sidebar-state-message sidebar-state-message-error">{error}</div>
          )}
          {!loading && !projectsError && !error && sortedProjects.length === 0 && (
            <div className="sidebar-state-message sidebar-state-message-muted sidebar-state-message-empty">
              {t("projects.noProjects")}
            </div>
          )}
          {!loading && !projectsError && !error && sortedProjects.length > 0 && visibleProjectEntries.length === 0 && (
            <div className="sidebar-state-message sidebar-state-message-dim sidebar-state-message-no-matches">
              {t("sessionSidebar.noMatches")}
            </div>
          )}

          {visibleProjectEntries.map(({ project, sessions }) => {
            const tree = treesByProject.get(project.path) ?? buildSessionTree(sessions);
            // Sessions group under a project through the case-folded comparable
            // form (see groupSessionsByProject), so the active highlight must
            // use the same comparison: a session whose cwd/projectRoot spells
            // the project folder with different casing (Windows/NTFS) lands in
            // this row — the row must light up for it too.
            const isActive = selectedProject !== null && comparableProjectPath(selectedProject) === comparableProjectPath(project.path);
            // Each project's own branch comes from its own cached Git state —
            // a project never inherits another repo's branch. Only the active
            // repo's row owns the single switcher anchor so the dropdown opens
            // against the correct row.
            const projectBranch = worktreeBranchForProject(project.path);
            return (
              <ProjectRow
                key={project.path}
                project={project}
                isActive={isActive}
                isExpanded={expandedProjectPaths.has(project.path)}
                activity={projectActivity.get(comparableProjectPath(project.path))}
                tree={tree}
                hiddenCount={filtersActive ? 0 : Math.max(0, tree.length - MAX_PROJECT_SESSIONS)}
                selectedSessionId={selectedSessionId}
                runningSessionIds={runningSessionIds}
                unreadSessionIds={unreadSessionIds}
                relativeTimeNow={relativeTimeNow}
                onActivate={activateProject}
                onToggleExpand={toggleProjectExpanded}
                onRemoveProject={handleRemoveProject}
                removeBusy={removeProjectPath === project.path}
                onSelectSession={handleSelectSessionFromList}
                onSessionIntent={onSessionIntent}
                onRenamed={loadSessions}
                onSessionDeleted={handleSessionDeleted}
                activeWorktreeSwitcher={isActive ? activeProjectSwitcher : null}
                worktreeBranch={projectBranch}
                worktreeToggleRef={isActive && projectBranch ? wtToggleRef : undefined}
                worktreeOpen={isActive ? wtDropdownOpen : false}
                onToggleWorktrees={isActive ? toggleWorktrees : undefined}
                homeDir={homeDir}
              />
            );
          })}
        </div>

      {/* File Explorer section */}
      {(selectedCwdProp || selectedCwd) && (
        <div
          className="sidebar-explorer"
          style={{ flex: explorerOpen ? "1 1 0" : "0 0 auto" }}
        >
          <div className="sidebar-explorer-header">
            <button
              onClick={toggleExplorer}
              className="sidebar-explorer-toggle"
              aria-expanded={explorerOpen}
            >
              <ChevronRight
                size={12}
                strokeWidth={1.8}
                className="sidebar-explorer-chevron"
                data-open={explorerOpen ? "true" : "false"}
                aria-hidden="true"
              />
              {t("sessionSidebar.explorer")}
            </button>
            <div
              className="sidebar-explorer-actions"
              inert={!explorerOpen ? true : undefined}
              data-open={explorerOpen ? "true" : "false"}
            >
              <Tooltip content={t("sessionSidebar.uploadFilesTitle")} side="top">
                <button
                  onClick={() => fileExplorerRef.current?.openUploadPicker()}
                  disabled={explorerUploadBusy}
                  title={t("sessionSidebar.uploadFilesTitle")}
                  aria-label={t("sessionSidebar.uploadFiles")}
                  className="sidebar-explorer-icon-button sidebar-explorer-upload"
                >
                  <Upload size={13} strokeWidth={2} aria-hidden="true" />
                </button>
              </Tooltip>
            </div>
            <Tooltip content={t("sessionSidebar.refreshExplorer")} side="top">
              <button
                aria-label={t("sessionSidebar.refreshExplorer")}
                onClick={() => {
                  if (onExplorerRefresh) onExplorerRefresh();
                  else setExplorerKey((k) => k + 1);
                }}
                title={t("sessionSidebar.refreshExplorer")}
                className="sidebar-explorer-icon-button sidebar-explorer-refresh"
                data-refreshing={explorerRefreshing ? "true" : "false"}
              >
                {explorerRefreshing ? (
                  <RefreshCw size={13} strokeWidth={2} aria-hidden="true" className="icon-spin" />
                ) : (
                  <RefreshCw size={13} strokeWidth={2} aria-hidden="true" />
                )}
              </button>
            </Tooltip>
          </div>
          <div
            className={"accordion-flow sidebar-explorer-flow " + (explorerOpen ? "is-open" : "")}
            inert={!explorerOpen ? true : undefined}
            style={{ flex: explorerOpen ? "1 1 auto" : "0 0 0px" }}
          >
            <div className="accordion-flow-inner sidebar-explorer-flow-inner">
              {(explorerHasOpenedRef.current || (sidebarVisible && explorerOpen)) && (
                <FileExplorer
                  ref={fileExplorerRef}
                  cwd={selectedCwd ?? selectedCwdProp!}
                  onOpenFile={onOpenFile ?? (() => {})}
                  refreshKey={explorerKey}
                  onAtMention={onAtMention}
                  onAtMentions={onAtMentions}
                  onUploadBusyChange={setExplorerUploadBusy}
                  onRefreshDone={onExplorerRefreshDone}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pinned footer: Settings & Usage */}
      <div className="sidebar-footer">
        <button
          className="sidebar-settings-row"
          onClick={onOpenSettings}
          title={t("settingsConfig.title")}
          aria-label={t("settingsConfig.title")}
        >
          <span className="sidebar-footer-icon">
            <Settings2 size={14} strokeWidth={2} aria-hidden="true" />
            {updateAvailable && (
              <span
                aria-label="Update available"
                role="status"
                className="sidebar-update-dot"
              />
            )}
          </span>
          <span className="sidebar-footer-label">
            {t("settingsConfig.title")}
          </span>
          <ChevronRight size={13} strokeWidth={2} className="sidebar-footer-chevron" aria-hidden="true" />
        </button>
        <span className="sidebar-footer-divider" aria-hidden="true" />
        <button
          className="sidebar-settings-row"
          onClick={onOpenUsage}
          title={t("usageConfig.title")}
          aria-label={t("usageConfig.title")}
        >
          <span className="sidebar-footer-icon">
            <Gauge size={14} strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="sidebar-footer-label">
            {t("usageConfig.title")}
          </span>
          <ChevronRight size={13} strokeWidth={2} className="sidebar-footer-chevron" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

const MAX_PROJECT_SESSIONS = 5;

interface ProjectRowProps {
  project: ManagedProject;
  isActive: boolean;
  isExpanded: boolean;
  activity: { running: number; unread: number } | undefined;
  tree: SessionTreeNode[];
  /** Sessions beyond the cap (0 when a filter is active — show all matches). */
  hiddenCount: number;
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  relativeTimeNow: number;
  onActivate: (path: string) => void;
  onToggleExpand: (path: string) => void;
  onRemoveProject: (path: string) => void;
  removeBusy: boolean;
  onSelectSession: (s: SessionInfo) => void;
  onSessionIntent?: () => void;
  onRenamed?: () => void;
  onSessionDeleted?: (id: string) => void;
  activeWorktreeSwitcher?: ReactNode;
  /** Active worktree/branch label shown inline beside the workspace name. */
  worktreeBranch?: string | null;
  worktreeToggleRef?: RefObject<HTMLButtonElement | null>;
  worktreeOpen?: boolean;
  onToggleWorktrees?: () => void;
  homeDir: string;
}

/** One project in the sidebar: a card row matching the session items' visual
 *  language, with the active project's worktree selector directly below and
 *  the project's session tree (capped at MAX_PROJECT_SESSIONS roots, with a
 *  show-more toggle) nested under it when expanded. */
function ProjectRow({
  project,
  isActive,
  isExpanded,
  activity,
  tree,
  hiddenCount,
  selectedSessionId,
  runningSessionIds,
  unreadSessionIds,
  relativeTimeNow,
  onActivate,
  onToggleExpand,
  onRemoveProject,
  removeBusy,
  onSelectSession,
  onSessionIntent,
  onRenamed,
  onSessionDeleted,
  activeWorktreeSwitcher,
  worktreeBranch,
  worktreeToggleRef,
  worktreeOpen,
  onToggleWorktrees,
}: ProjectRowProps) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const label = projectLabel(project.path);
  const hasActivity = Boolean(activity && (activity.running > 0 || activity.unread > 0));
  const visibleRoots = hiddenCount > 0 && !showAllSessions
    ? tree.slice(0, MAX_PROJECT_SESSIONS)
    : tree;
  const showActions = hovered || focusWithin || actionMenuOpen;

  return (
    <section className="sidebar-project" data-active={isActive ? "true" : "false"}>
      <div
        className="sidebar-project-header"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocusWithin(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && actionMenuOpen) {
            event.stopPropagation();
            setActionMenuOpen(false);
          }
        }}
      >
        <button
          className="sidebar-project-identity"
          onClick={() => onActivate(project.path)}
          aria-current={isActive ? "true" : undefined}
          title={project.path}
          data-active={isActive ? "true" : "false"}
        >
          <Folder
            size={15}
            strokeWidth={1.8}
            className="sidebar-project-folder-icon"
            aria-hidden="true"
          />
          <span className="sidebar-project-label">
            {label}
          </span>
        </button>
        {worktreeBranch && worktreeToggleRef && (
          <button
            type="button"
            ref={worktreeToggleRef}
            onClick={onToggleWorktrees}
            aria-expanded={worktreeOpen}
            aria-haspopup="menu"
            title={t("sessionSidebar.switchWorktreeTo", { path: worktreeBranch })}
            className="sidebar-project-worktree-toggle"
            data-open={worktreeOpen ? "true" : "false"}
          >
            <span aria-hidden="true" className="sidebar-project-worktree-dot">·</span>
            <span className="sidebar-project-worktree-label">{worktreeBranch}</span>
          </button>
        )}
        <div className="sidebar-project-spacer" />
        {hasActivity && (
          <span
            aria-label={t("projects.activity", { running: activity?.running ?? 0, unread: activity?.unread ?? 0 })}
            title={t("projects.activity", { running: activity?.running ?? 0, unread: activity?.unread ?? 0 })}
            className="sidebar-project-activity"
            role="status"
            aria-live="polite"
            data-running={(activity?.running ?? 0) > 0 ? "true" : "false"}
          >
            <span aria-hidden="true" className="sidebar-project-activity-dot" />
          </span>
        )}
        <div
          className="sidebar-project-action-slot"
          style={{ visibility: showActions ? "visible" : "hidden" }}
        >
          <button
            type="button"
            ref={actionButtonRef}
            className="sidebar-project-action"
            onClick={() => setActionMenuOpen((open) => !open)}
            disabled={removeBusy}
            aria-label={t("commandPalette.actions")}
            title={t("commandPalette.actions")}
            aria-expanded={actionMenuOpen}
            aria-haspopup="menu"
            data-open={actionMenuOpen ? "true" : "false"}
          >
            <MoreHorizontal size={13} strokeWidth={2} aria-hidden="true" />
          </button>
          <SidebarPortalMenu
            anchor={actionButtonRef}
            open={actionMenuOpen}
            onClose={() => setActionMenuOpen(false)}
            placement="below"
            minWidth={136}
          >
            <button type="button" role="menuitem" className="sidebar-menu-item sidebar-menu-item-danger sidebar-project-remove-item" disabled={removeBusy} onClick={() => { setActionMenuOpen(false); onRemoveProject(project.path); }}>
              {t("projects.remove", { name: label })}
            </button>
          </SidebarPortalMenu>
        </div>
        <button
          className="sidebar-project-toggle"
          onClick={() => onToggleExpand(project.path)}
          aria-label={isExpanded ? t("projects.collapseProject", { name: label }) : t("projects.expandProject", { name: label })}
          aria-expanded={isExpanded}
          title={isExpanded ? t("projects.collapseProjectTitle", { path: project.path }) : t("projects.expandProjectTitle", { path: project.path })}
          data-expanded={isExpanded ? "true" : "false"}
        >
          <ChevronRight
            size={13}
            strokeWidth={1.8}
            className="sidebar-project-toggle-icon"
            aria-hidden="true"
          />
        </button>
      </div>

      {isActive && activeWorktreeSwitcher}

      {isExpanded && (
        <div className="sidebar-project-sessions">
          {visibleRoots.length === 0 ? (
            <div className="sidebar-project-empty">
              {t("projects.emptyProject")}
            </div>
          ) : (
            <>
              {visibleRoots.map((node) => (
                <SessionTreeItem
                  key={node.session.id}
                  node={node}
                  selectedSessionId={selectedSessionId}
                  runningSessionIds={runningSessionIds}
                  unreadSessionIds={unreadSessionIds}
                  relativeTimeNow={relativeTimeNow}
                  onSelectSession={onSelectSession}
                  onSessionIntent={onSessionIntent}
                  onRenamed={onRenamed}
                  onSessionDeleted={onSessionDeleted}
                  depth={0}
                />
              ))}
              {hiddenCount > 0 && (
                <button
                  onClick={() => setShowAllSessions((v) => !v)}
                  aria-expanded={showAllSessions}
                  className="sidebar-show-more"
                >
                  <ChevronDown
                    size={11}
                    strokeWidth={1.8}
                    className="sidebar-show-more-icon"
                    data-expanded={showAllSessions ? "true" : "false"}
                    aria-hidden="true"
                  />
                  {showAllSessions
                    ? t("projects.showLess")
                    : t("projects.showMoreSessions", { count: hiddenCount })}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

interface ProjectWorktreeSwitcherProps {
  worktreeState: WorktreeState;
  selectedCwd: string | null;
  homeDir: string;
  wtDropdownOpen: boolean;
  wtNewOpen: boolean;
  setWtNewOpen: Dispatch<SetStateAction<boolean>>;
  wtNewBranch: string;
  setWtNewBranch: Dispatch<SetStateAction<string>>;
  wtError: string | null;
  setWtError: Dispatch<SetStateAction<string | null>>;
  wtBusy: boolean;
  wtConfirmRemove: string | null;
  setWtConfirmRemove: Dispatch<SetStateAction<string | null>>;
  onSelectWorktree: (path: string) => void;
  onCreateWorktree: () => void;
  onRemoveWorktree: (path: string, force: boolean) => void;
  /** Anchor button — the inline branch label in the workspace row. */
  anchorRef: RefObject<HTMLButtonElement | null>;
  newInputRef: RefObject<HTMLInputElement | null>;
  /** Closes the dropdown and resets its transient state. */
  onClose: () => void;
}

/** Worktree dropdown for the active project; opening it exposes all checkouts.
 *  Rendered through the portal menu so it floats above every sidebar row. */
function ProjectWorktreeSwitcher({
  worktreeState,
  selectedCwd,
  homeDir,
  wtDropdownOpen,
  wtNewOpen,
  setWtNewOpen,
  wtNewBranch,
  setWtNewBranch,
  wtError,
  setWtError,
  wtBusy,
  wtConfirmRemove,
  setWtConfirmRemove,
  onSelectWorktree,
  onCreateWorktree,
  onRemoveWorktree,
  anchorRef,
  newInputRef,
  onClose,
}: ProjectWorktreeSwitcherProps) {
  const { t } = useI18n();

  return (
    <SidebarPortalMenu
      anchor={anchorRef}
      open={wtDropdownOpen}
      onClose={onClose}
      placement="below"
      align="start"
      minWidth={240}
      className="sidebar-worktree-menu"
    >
          <div className="sidebar-worktree-list">
            {worktreeState.worktrees.map((wt) => {
              const isCurrent = wt.path === selectedCwd || (wt.isMain && !worktreeState.worktrees.some((w) => w.path === selectedCwd));
              if (wtConfirmRemove === wt.path) {
                return (
                  <div key={wt.path} className="sidebar-worktree-confirm-row">
                    <span className="sidebar-worktree-confirm-text">
                      {t("sessionSidebar.uncommittedForceRemove")}
                    </span>
                    <button
                      onClick={() => onRemoveWorktree(wt.path, true)}
                      disabled={wtBusy}
                      className="sidebar-worktree-force-button"
                    >
                      {t("sessionSidebar.force")}
                    </button>
                    <button
                      onClick={() => setWtConfirmRemove(null)}
                      className="sidebar-worktree-cancel-button"
                    >
                      {t("sessionSidebar.cancel")}
                    </button>
                  </div>
                );
              }
              return (
                <div
                  key={wt.path}
                  className="wt-row sidebar-worktree-row"
                >
                  <button
                    onClick={() => onSelectWorktree(wt.path)}
                    aria-pressed={isCurrent}
                    title={wt.path}
                    className="sidebar-worktree-select"
                  >
                    {isCurrent ? (
                      <Check size={10} strokeWidth={2} className="sidebar-worktree-check" aria-hidden="true" />
                    ) : (
                      <span className="sidebar-worktree-check-spacer" />
                    )}
                    <PathLabel text={wt.branch ?? displayCwd(wt.path, homeDir)} />
                    {wt.isMain && <span className="sidebar-worktree-main-badge">{t("sessionSidebar.mainBadge")}</span>}
                  </button>
                  {!wt.isMain && (
                    <button
                      onClick={() => onRemoveWorktree(wt.path, false)}
                      disabled={wtBusy}
                      title={t("sessionSidebar.removeWorktreeTitle", { path: wt.path })}
                      className="sidebar-worktree-remove"
                    >
                      <Trash2 size={12} strokeWidth={2} aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {!wtNewOpen ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setWtNewOpen(true);
                setWtError(null);
                setTimeout(() => newInputRef.current?.focus(), 0);
              }}
              title={t("sessionSidebar.newWorktreeTitle")}
              className="sidebar-worktree-new"
            >
              <Plus size={12} strokeWidth={1.8} className="sidebar-worktree-new-icon" aria-hidden="true" />
              <span>{t("sessionSidebar.newWorktree")}</span>
            </button>
          ) : (
            <div className="sidebar-worktree-form">
              <input
                ref={newInputRef}
                value={wtNewBranch}
                onChange={(e) => {
                  setWtNewBranch(e.target.value);
                  setWtError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onCreateWorktree();
                  }
                  if (e.key === "Escape") {
                    setWtNewOpen(false);
                    setWtNewBranch("");
                    setWtError(null);
                  }
                }}
                placeholder={t("sessionSidebar.branchNamePlaceholder")}
                className="sidebar-worktree-input"
              />
              <div className="sidebar-worktree-form-actions">
                <button
                  onClick={onCreateWorktree}
                  disabled={wtBusy || !wtNewBranch.trim()}
                  className="sidebar-worktree-create"
                >
                  {wtBusy ? t("sessionSidebar.creating") : t("sessionSidebar.create")}
                </button>
                <button
                  onClick={() => { setWtNewOpen(false); setWtNewBranch(""); setWtError(null); }}
                  className="sidebar-worktree-form-cancel"
                >
                  {t("sessionSidebar.cancel")}
                </button>
              </div>
            </div>
          )}
          {wtError && (
            <div className="sidebar-worktree-error">
              {wtError}
            </div>
          )}
    </SidebarPortalMenu>
  );
}

const SessionTreeItem = memo(function SessionTreeItem({
  node,
  selectedSessionId,
  runningSessionIds,
  unreadSessionIds,
  relativeTimeNow,
  onSelectSession,
  onSessionIntent,
  onRenamed,
  onSessionDeleted,
  depth,
}: {
  node: SessionTreeNode;
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  relativeTimeNow: number;
  onSelectSession: (s: SessionInfo) => void;
  onSessionIntent?: () => void;
  onRenamed?: () => void;
  onSessionDeleted?: (id: string) => void;
  depth: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;
  const sessionId = node.session.id;

  // Pre-compute the booleans so SessionItem only sees primitives — its memo
  // check then never re-renders unless this row's flags actually changed.
  const isSelected = sessionId === selectedSessionId;
  const isRunning = runningSessionIds.has(sessionId);
  const isUnread = unreadSessionIds.has(sessionId);

  // Stable callbacks: depend only on primitives / stable parent callbacks so
  // SessionItem's React.memo stays effective across re-renders.
  const handleClick = useCallback(() => {
    onSelectSession(node.session);
  }, [onSelectSession, node.session]);
  const handleDeleted = useCallback((id: string) => {
    onSessionDeleted?.(id);
  }, [onSessionDeleted]);
  const handleToggleCollapse = useCallback(() => {
    setCollapsed((v) => !v);
  }, []);

  return (
    <div>
      <div className="sidebar-session-tree-row">
        {/* Indent line for child sessions */}
        {depth > 0 && (
          <div
            className="sidebar-session-indent-line"
            style={{ left: depth * 14 + 22 }}
          />
        )}
        <SessionItem
          session={node.session}
          isSelected={isSelected}
          isRunning={isRunning}
          isUnread={isUnread}
          relativeTimeNow={relativeTimeNow}
          onClick={handleClick}
          onSessionIntent={onSessionIntent}
          onRenamed={onRenamed}
          onDeleted={handleDeleted}
          depth={depth}
          hasChildren={hasChildren}
          collapsed={collapsed}
          onToggleCollapse={handleToggleCollapse}
        />
      </div>
      {hasChildren && !collapsed && (
        <div>
          {node.children.map((child) => (
            <SessionTreeItem
              key={child.session.id}
              node={child}
              selectedSessionId={selectedSessionId}
              runningSessionIds={runningSessionIds}
              unreadSessionIds={unreadSessionIds}
              relativeTimeNow={relativeTimeNow}
              onSelectSession={onSelectSession}
              onSessionIntent={onSessionIntent}
              onRenamed={onRenamed}
              onSessionDeleted={onSessionDeleted}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}, (prev, next) => {
  // Deep-changed inputs warrant a re-render; otherwise skip.
  if (prev.node !== next.node) return false;
  if (prev.selectedSessionId !== next.selectedSessionId) {
    // Only re-render if THIS node's selection state flipped.
    const id = prev.node.session.id;
    if ((id === prev.selectedSessionId) !== (id === next.selectedSessionId)) return false;
  }
  if (prev.runningSessionIds !== next.runningSessionIds) {
    const id = prev.node.session.id;
    if (prev.runningSessionIds.has(id) !== next.runningSessionIds.has(id)) return false;
  }
  if (prev.unreadSessionIds !== next.unreadSessionIds) {
    const id = prev.node.session.id;
    if (prev.unreadSessionIds.has(id) !== next.unreadSessionIds.has(id)) return false;
  }
  if (prev.relativeTimeNow !== next.relativeTimeNow) return false;
  if (prev.onSelectSession !== next.onSelectSession
    || prev.onSessionIntent !== next.onSessionIntent
    || prev.onRenamed !== next.onRenamed
    || prev.onSessionDeleted !== next.onSessionDeleted) return false;
  return true;
});

function RunningSessionIndicator({ size = 14 }: { size?: number }) {
  const { t } = useI18n();
  const reducedMotion = usePrefersReducedMotion();
  return (
    <span
      title={t("sessionSidebar.agentRunning")}
      aria-label={t("sessionSidebar.agentRunningAria")}
      className="sidebar-session-indicator"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="sidebar-session-indicator-svg">
        <g>
          <path
            d="M21 12a9 9 0 1 1-3.8-7.4"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          {!reducedMotion && (
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 12 12"
              to="360 12 12"
              dur="0.9s"
              repeatCount="indefinite"
            />
          )}
        </g>
      </svg>
    </span>
  );
}

function UnreadSessionIndicator({ size = 14 }: { size?: number }) {
  const { t } = useI18n();
  const reducedMotion = usePrefersReducedMotion();
  return (
    <span
      title={t("sessionSidebar.newActivity")}
      aria-label={t("sessionSidebar.newSessionActivity")}
      className="sidebar-session-indicator"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true" className="sidebar-session-indicator-svg">
        <circle cx="7" cy="7" r="2.5" fill="currentColor" />
        {!reducedMotion && (
          <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.4" opacity="0.32">
            <animate attributeName="r" values="3;6;3" dur="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.32;0;0.32" dur="1.6s" repeatCount="indefinite" />
          </circle>
        )}
      </svg>
    </span>
  );
}

const SessionItem = memo(function SessionItem({
  session,
  isSelected,
  isRunning,
  isUnread,
  onClick,
  onSessionIntent,
  onRenamed,
  onDeleted,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  relativeTimeNow,
  onToggleCollapse,
}: {
  session: SessionInfo;
  isSelected: boolean;
  isRunning?: boolean;
  isUnread?: boolean;
  onClick: () => void;
  onSessionIntent?: () => void;
  onRenamed?: () => void;
  onDeleted?: (id: string) => void;
  depth?: number;
  hasChildren?: boolean;
  relativeTimeNow: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { t, locale } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameCancelRef = useRef(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const contentButtonRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const title = session.name || session.firstMessage.slice(0, 50) || session.id.slice(0, 12);
  const relativeTime = formatRelativeTime(session.modified, locale, relativeTimeNow);
  const confirming = confirmArchive || confirmDelete;
  const handleSessionIntent = useCallback(() => {
    onSessionIntent?.();
  }, [onSessionIntent]);
  const startRename = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setRenameValue(session.name ?? "");
    setRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [session.name]);
  const commitRename = useCallback(async () => {
    if (renameCancelRef.current) {
      renameCancelRef.current = false;
      return;
    }
    const name = renameValue.trim();
    setRenaming(false);
    if (name === (session.name ?? "")) return;
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error("Session rename failed");
      onRenamed?.();
    } catch {
      // The next refresh remains authoritative if the rename fails.
    }
  }, [renameValue, session.id, session.name, onRenamed]);
  const handleArchive = useCallback(async () => {
    setConfirmArchive(false);
    setDeleting(true);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(session.id)}/archive`, { method: "POST" });
      if (!response.ok) throw new Error("Session archive failed");
      onDeleted?.(session.id);
    } catch {
      setDeleting(false);
      toast.error(translate("sessionSidebar.archiveFailed"));
    }
  }, [session.id, onDeleted]);
  const handleDelete = useCallback(async () => {
    setConfirmDelete(false);
    setDeleting(true);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Session deletion failed");
      onDeleted?.(session.id);
    } catch {
      setDeleting(false);
      toast.error(translate("sessionSidebar.deleteFailed"));
    }
  }, [session.id, onDeleted]);
  const closeConfirmation = useCallback(() => {
    setConfirmArchive(false);
    setConfirmDelete(false);
    setActionMenuOpen(false);
    requestAnimationFrame(() => contentButtonRef.current?.focus());
  }, []);

  return (
    <div
      onClick={confirmArchive || confirmDelete || renaming ? undefined : onClick}
      onPointerDown={handleSessionIntent}
      onTouchStart={handleSessionIntent}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => {
        handleSessionIntent();
        setFocusWithin(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false);
      }}
      onKeyDown={(event) => {
        if ((confirmArchive || confirmDelete || actionMenuOpen) && event.key === "Escape") {
          event.stopPropagation();
          closeConfirmation();
        }
      }}
      className="sidebar-session-row"
      data-selected={isSelected ? "true" : "false"}
      data-confirming={confirming ? "true" : "false"}
      data-deleting={deleting ? "true" : "false"}
      data-interactive={!confirming && !renaming ? "true" : "false"}
      style={{
        height: confirming ? 34 : 30,
        paddingLeft: 30 + depth * 14,
      }}
    >
      {/* Thin orange indicator at the session's indent column — not a border
          around the row, so the active state never reads as a card. */}
      {(isSelected || confirming) && (
        <span
          aria-hidden="true"
          className="sidebar-session-selection-indicator"
          style={{ left: 20 + depth * 14 }}
        />
      )}
      {confirming ? (
        <>
          <span className="sidebar-session-confirm-text">
            {confirmArchive
              ? t("sessionSidebar.archiveConfirm", { title: title.length > 22 ? `${title.slice(0, 22)}…` : title })
              : t("sessionSidebar.deleteConfirm", { title: title.length > 22 ? `${title.slice(0, 22)}…` : title })}
          </span>
          <button className="sidebar-session-confirm-button" onClick={(event) => { event.stopPropagation(); if (confirmArchive) handleArchive(); else handleDelete(); }}>
            {confirmArchive ? t("sessionSidebar.archive") : t("sessionSidebar.delete")}
          </button>
          <button className="sidebar-session-cancel-button" onClick={(event) => { event.stopPropagation(); closeConfirmation(); }} autoFocus>
            {t("sessionSidebar.cancel")}
          </button>
        </>
      ) : renaming ? (
        <input ref={inputRef} autoFocus aria-label={t("sessionSidebar.rename")} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onBlur={commitRename} onKeyDown={(event) => { if (event.key === "Enter") void commitRename(); if (event.key === "Escape") { event.preventDefault(); renameCancelRef.current = true; setRenaming(false); } }} className="sidebar-session-rename-input" />
      ) : (
        <>
          {depth > 0 && <GitBranch size={11} strokeWidth={2} className="sidebar-session-branch-icon" aria-hidden="true" />}
          {/* Flexible title — always ellipsized; the fixed-width right rail
              (timestamp + menu) can never be pushed off-screen. */}
          <button ref={contentButtonRef} type="button" className="session-item-button sidebar-session-content" aria-current={isSelected ? "true" : undefined} onKeyDown={(event) => { if (event.key === "Delete") { event.preventDefault(); setConfirmDelete(true); } }}>
            <span title={title} className="sidebar-session-title">
              {title}
            </span>
          </button>
          {session.worktreeBranch && <span title={t("sessionSidebar.worktreeTitle", { path: session.cwd })} className="sidebar-session-worktree"><GitBranch size={10} strokeWidth={2.4} aria-hidden="true" /><span className="sidebar-session-worktree-label">{session.worktreeBranch}</span></span>}
          {isRunning && <RunningSessionIndicator size={12} />}
          {!isRunning && isUnread && <UnreadSessionIndicator size={11} />}
          {relativeTime && <span title={new Date(session.modified).toLocaleString(locale)} className="sidebar-session-time" data-selected={isSelected ? "true" : "false"}>{relativeTime}</span>}
          {hasChildren && <button className="session-item-icon-button sidebar-session-collapse" onClick={(event) => { event.stopPropagation(); onToggleCollapse?.(); }} title={collapsed ? t("sessionSidebar.expandForks") : t("sessionSidebar.collapseForks")} aria-label={collapsed ? t("sessionSidebar.expandForks") : t("sessionSidebar.collapseForks")} aria-expanded={!collapsed} data-collapsed={collapsed ? "true" : "false"}><ChevronDown size={12} strokeWidth={1.8} aria-hidden="true" /></button>}
          {/* Reserved overflow-menu slot: invisible (but space-preserving) until
              hover/focus, so rows never reflow and titles never shift. */}
          <div
            className="sidebar-session-action-slot"
            style={{ visibility: hovered || focusWithin || actionMenuOpen ? "visible" : "hidden" }}
          >
            <button
              type="button"
              ref={menuButtonRef}
              className="session-item-icon-button sidebar-session-action"
              onClick={(event) => { event.stopPropagation(); setActionMenuOpen((open) => !open); }}
              title="Session actions"
              aria-label="Session actions"
              aria-expanded={actionMenuOpen}
              aria-haspopup="menu"
              data-open={actionMenuOpen ? "true" : "false"}
            >
              <MoreHorizontal size={14} strokeWidth={2} aria-hidden="true" />
            </button>
            <SidebarPortalMenu
              anchor={menuButtonRef}
              open={actionMenuOpen}
              onClose={() => setActionMenuOpen(false)}
              placement="above"
              minWidth={128}
            >
              <button type="button" role="menuitem" className="sidebar-menu-item" onClick={(event) => { event.stopPropagation(); setActionMenuOpen(false); setConfirmArchive(true); }} disabled={hasChildren} title={hasChildren ? t("sessionSidebar.archiveLeafOnly") : t("sessionSidebar.archive")}>{t("sessionSidebar.archive")}</button>
              <button type="button" role="menuitem" className="sidebar-menu-item" onClick={(event) => { startRename(event); setActionMenuOpen(false); }}>{t("sessionSidebar.rename")}</button>
              <button type="button" role="menuitem" className="sidebar-menu-item sidebar-menu-item-danger" onClick={(event) => { event.stopPropagation(); setActionMenuOpen(false); setConfirmDelete(true); }}>{t("sessionSidebar.delete")}</button>
            </SidebarPortalMenu>
          </div>
        </>
      )}
    </div>
  );
});
