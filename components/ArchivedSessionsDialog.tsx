"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, RotateCcw, Search, X } from "lucide-react";
import type { ArchivedSessionInfo, SessionInfo } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { useModalDialog } from "@/hooks/useModalDialog";

interface Props {
  onClose: () => void;
  onRestored: (session: SessionInfo) => void;
}

interface ArchiveResponse {
  archives?: ArchivedSessionInfo[];
  error?: string;
}

interface RestoreResponse {
  session?: SessionInfo;
  error?: string;
}

function archiveLabel(archive: ArchivedSessionInfo): string {
  return archive.name || archive.id || archive.key;
}

export function ArchivedSessionsDialog({ onClose, onRestored }: Props) {
  const { t } = useI18n();
  const [archives, setArchives] = useState<ArchivedSessionInfo[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoringKey, setRestoringKey] = useState<string | null>(null);
  const panelRef = useModalDialog<HTMLDivElement>({ onClose, active: true });

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch("/api/sessions/archive", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as ArchiveResponse;
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
        setArchives(body.archives ?? []);
      })
      .catch((reason: unknown) => {
        if ((reason as { name?: string })?.name !== "AbortError") {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const visibleArchives = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return archives;
    return archives.filter((archive) =>
      [archiveLabel(archive), archive.id, archive.key, archive.cwd]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(normalized)),
    );
  }, [archives, query]);

  const restore = async (archive: ArchivedSessionInfo) => {
    if (restoringKey) return;
    setRestoringKey(archive.key);
    setError(null);
    try {
      const response = await fetch("/api/sessions/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: archive.key }),
      });
      const body = await response.json() as RestoreResponse;
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      if (!body.session) throw new Error(t("sessionSidebar.archiveRestoreMissing"));
      onRestored(body.session);
      onClose();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRestoringKey(null);
    }
  };

  return (
    <div
      className="animate-fade-in"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--z-dialog)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-5)",
        background: "var(--overlay-backdrop)",
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("sessionSidebar.archivedSessions")}
        tabIndex={-1}
        className="animate-scale-in"
        style={{
          width: "min(620px, 100%)",
          maxHeight: "min(640px, 90vh)",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-modal)",
          background: "var(--bg)",
          boxShadow: "var(--shadow-modal)",
          outline: "none",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
          <Archive size={16} strokeWidth={1.9} aria-hidden="true" />
          <strong style={{ flex: 1, fontSize: "var(--text-base)" }}>{t("sessionSidebar.archivedSessions")}</strong>
          <button type="button" className="sidebar-icon-button ui-focus-ring" onClick={onClose} aria-label={t("sessionSidebar.closeArchive")} title={t("sessionSidebar.closeArchive")}>
            <X size={15} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg-panel)" }}>
            <Search size={14} strokeWidth={1.9} aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("sessionSidebar.archiveSearchPlaceholder")}
              aria-label={t("sessionSidebar.archiveSearch")}
              style={{ minWidth: 0, flex: 1, border: 0, outline: "none", background: "transparent", color: "var(--text)", fontSize: "var(--text-sm)" }}
            />
          </label>
        </div>
        <div style={{ minHeight: 160, overflowY: "auto", padding: "6px 8px" }}>
          {loading && <div className="sidebar-state-message sidebar-state-message-muted">{t("sessionSidebar.archiveLoading")}</div>}
          {!loading && error && <div className="sidebar-state-message sidebar-state-message-error">{error}</div>}
          {!loading && !error && visibleArchives.length === 0 && (
            <div className="sidebar-state-message sidebar-state-message-muted">{query.trim() ? t("sessionSidebar.archiveNoMatches") : t("sessionSidebar.archiveEmpty")}</div>
          )}
          {!loading && !error && visibleArchives.map((archive) => (
            <div key={archive.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 8px", borderRadius: 7 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)", fontSize: "var(--text-sm)", fontWeight: 600 }} title={archiveLabel(archive)}>{archiveLabel(archive)}</div>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }} title={archive.cwd || archive.key}>{archive.cwd || archive.key}</div>
              </div>
              <button
                type="button"
                className="sidebar-menu-item"
                disabled={restoringKey !== null}
                onClick={() => void restore(archive)}
                title={t("sessionSidebar.restoreArchive")}
              >
                <RotateCcw size={13} strokeWidth={1.9} aria-hidden="true" />
                <span>{restoringKey === archive.key ? t("sessionSidebar.restoringArchive") : t("sessionSidebar.restoreArchive")}</span>
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "9px 14px", borderTop: "1px solid var(--border)", background: "var(--bg-panel)" }}>
          <button type="button" className="sidebar-session-cancel-button" onClick={onClose}>{t("sessionSidebar.cancel")}</button>
        </div>
      </div>
    </div>
  );
}
