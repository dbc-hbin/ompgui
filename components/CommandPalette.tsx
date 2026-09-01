"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Command } from "cmdk";
import { AlertCircle, Moon, Plus, Sun, MessageSquare, X } from "lucide-react";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/hooks/useTheme";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useModalDialog } from "@/hooks/useModalDialog";
import { useOverlayBack } from "@/hooks/overlay-stack";
import { getSessionListSnapshot, loadSessionList, subscribeSessionList } from "@/lib/client-session-store";

type Props = {
  onSelectSession: (session: SessionInfo) => void;
  onNewSession: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function relativeTime(value: string, locale: string): string {
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.max(0, Math.floor(diff / 60000));
  if (mins < 1) return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(0, "minute");
  if (mins < 60) return new Intl.RelativeTimeFormat(locale, { numeric: "always" }).format(-mins, "minute");
  const hours = Math.floor(mins / 60);
  if (hours < 24) return new Intl.RelativeTimeFormat(locale, { numeric: "always" }).format(-hours, "hour");
  return new Intl.RelativeTimeFormat(locale, { numeric: "always" }).format(-Math.floor(hours / 24), "day");
}

function SessionLoadingSkeleton({ isMobile, label }: { isMobile: boolean; label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: isMobile ? "var(--space-2)" : 6,
        padding: isMobile ? "var(--space-2) var(--space-3)" : "var(--space-1) var(--space-2)",
      }}
    >
      {[55, 70, 45].map((widthPct, idx) => (
        <div
          key={idx}
          style={{
            display: "flex",
            alignItems: "center",
            gap: isMobile ? 12 : 10,
            minHeight: isMobile ? 48 : 38,
            padding: isMobile ? "10px 12px" : "8px 10px",
            borderRadius: "var(--radius-control)",
          }}
        >
          <div
            className="skeleton"
            style={{
              width: isMobile ? 16 : 15,
              height: isMobile ? 16 : 15,
              borderRadius: "var(--radius-control)",
              flexShrink: 0,
            }}
          />
          <div
            className="skeleton"
            style={{
              height: 14,
              width: `${widthPct}%`,
              borderRadius: "var(--radius-control)",
            }}
          />
          <div
            className="skeleton"
            style={{
              height: 12,
              width: 44,
              marginLeft: "auto",
              borderRadius: "var(--radius-control)",
              flexShrink: 0,
            }}
          />
        </div>
      ))}
    </div>
  );
}

function SessionLoadError({ isMobile, label, retryLabel, onRetry }: { isMobile: boolean; label: string; retryLabel: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: isMobile ? "10px 12px" : "8px 10px",
        margin: isMobile ? "var(--space-2) var(--space-2)" : "var(--space-1) var(--space-1)",
        borderRadius: "var(--radius-control)",
        background: "color-mix(in srgb, var(--accent-strong) 8%, var(--bg))",
        border: "1px solid color-mix(in srgb, var(--accent-strong) 25%, var(--border))",
        color: "var(--accent-strong)",
        fontSize: "var(--text-md)",
      }}
    >
      <AlertCircle size={15} style={{ flexShrink: 0 }} aria-hidden="true" />
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="ui-focus-ring"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: isMobile ? 44 : undefined,
          minHeight: isMobile ? 44 : undefined,
          background: "transparent",
          border: "1px solid color-mix(in srgb, var(--accent-strong) 35%, var(--border))",
          borderRadius: "var(--radius-control)",
          color: "var(--accent-strong)",
          fontSize: "var(--text-md)",
          fontWeight: 600,
          padding: isMobile ? "0 12px" : "2px 8px",
          cursor: "pointer",
          touchAction: "manipulation",
          flexShrink: 0,
        }}
      >
        {retryLabel}
      </button>
    </div>
  );
}

export function CommandPalette({ onSelectSession, onNewSession, open: controlledOpen, onOpenChange }: Props) {
  const { t, locale } = useI18n();
  const { isDark, toggleTheme } = useTheme();
  const isMobile = useIsMobile();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const setOpen = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    if (typeof next === "function") {
      const computed = next(isOpen);
      if (!isControlled) setInternalOpen(computed);
      onOpenChange?.(computed);
    } else {
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
    }
  }, [isControlled, isOpen, onOpenChange]);

  const snapshot = useSyncExternalStore(
    (onStoreChange) => subscribeSessionList(() => { onStoreChange(); }),
    getSessionListSnapshot,
    getSessionListSnapshot,
  );
  const sessions = snapshot.sessions;
  const loading = sessions.length === 0 && (snapshot.status === "loading" || snapshot.status === "idle");
  const loadFailed = snapshot.status === "error" && sessions.length === 0;
  const sessionsEmpty = snapshot.status === "ready" && sessions.length === 0;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === "Escape" && isOpen) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    };
    const onCustomOpen = () => setOpen(true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("ompgui:open-command-palette", onCustomOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("ompgui:open-command-palette", onCustomOpen);
    };
  }, [isOpen, setOpen]);

  useEffect(() => {
    if (isOpen) void loadSessionList();
  }, [isOpen]);

  const panelLayout = isMobile ? "mobile" : "desktop";
  const panelRef = useModalDialog<HTMLDivElement>({
    onClose: () => setOpen(false),
    active: isOpen,
    identity: panelLayout,
  });
  useOverlayBack(isOpen, () => setOpen(false));

  if (!isOpen || typeof document === "undefined") return null;

  const choose = (action: () => void) => {
    action();
    setOpen(false);
  };

  const searchEmpty = !loading && !loadFailed ? (
    <Command.Empty style={{ padding: isMobile ? 24 : 20, textAlign: "center", color: "var(--text-muted)", fontSize: "var(--text-base)" }}>
      {t("commandPalette.empty")}
    </Command.Empty>
  ) : null;

  const sessionFeedback = loading ? (
    <SessionLoadingSkeleton isMobile={isMobile} label={t("commandPalette.loading")} />
  ) : loadFailed ? (
    <SessionLoadError
      isMobile={isMobile}
      label={t("commandPalette.loadFailed")}
      retryLabel={t("chatWindow.runtimeRetry")}
      onRetry={() => void loadSessionList({ force: true })}
    />
  ) : sessionsEmpty ? (
    <div role="status" style={{ padding: isMobile ? 24 : 20, textAlign: "center", color: "var(--text-muted)", fontSize: "var(--text-base)" }}>
      {t("commandPalette.empty")}
    </div>
  ) : null;

  if (isMobile) {
    return createPortal(
      <div
        role="presentation"
        onTouchStart={(event) => { if (event.currentTarget === event.target) setOpen(false); }}
        onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: "var(--z-command-palette)",
          background: "var(--overlay-backdrop)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
          animation: "ui-sheet-backdrop-in var(--dur-fast) var(--ease-out-warm)",
        }}
      >
        <Command
          ref={panelRef}
          label={t("commandPalette.label")}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          shouldFilter
          style={{
            width: "100%",
            maxHeight: "min(85dvh, 600px)",
            margin: 0,
            overflow: "hidden",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderBottom: "none",
            borderTopLeftRadius: "var(--radius-modal)",
            borderTopRightRadius: "var(--radius-modal)",
            boxShadow: "var(--shadow-modal)",
            animation: "ui-sheet-slide-up var(--dur-med) var(--ease-out-warm)",
            display: "flex",
            flexDirection: "column",
            paddingBottom: "max(var(--space-4), env(safe-area-inset-bottom, 0px))",
            outline: "none",
          }}
        >
          {/* Sheet Handle & Header */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "var(--space-3)", flexShrink: 0 }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--border)" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 var(--space-5) var(--space-2)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            <div style={{ fontSize: "var(--text-lg)", fontWeight: 600, color: "var(--text)" }}>
              {t("commandPalette.label")}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ui-focus-ring"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 44,
                height: 44,
                marginRight: -8,
                background: "transparent",
                border: "none",
                borderRadius: "var(--radius-control)",
                color: "var(--text-dim)",
                cursor: "pointer",
                touchAction: "manipulation",
              }}
              aria-label={t("ui.close")}
            >
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          <div style={{ padding: "10px var(--space-4)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            <Command.Input
              autoFocus
              placeholder={t("commandPalette.placeholder")}
              style={{
                width: "100%",
                height: 44,
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-control)",
                padding: "0 12px",
                outline: 0,
                background: "var(--bg-panel)",
                color: "var(--text)",
                fontSize: 16,
                touchAction: "manipulation",
              }}
            />
          </div>
          <Command.List style={{ padding: "var(--space-3)", overflowY: "auto", flex: 1, minHeight: 0 }}>
            {searchEmpty}
            <Command.Group heading={t("commandPalette.sessions")}>
              {sessionFeedback}
              {sessions.map((session) => (
                <Command.Item
                  key={session.id}
                  value={`${session.name ?? session.id} ${session.cwd}`}
                  onSelect={() => choose(() => onSelectSession(session))}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    minHeight: 48,
                    padding: "10px 12px",
                    borderRadius: "var(--radius-control)",
                    color: "var(--text)",
                    cursor: "pointer",
                    touchAction: "manipulation",
                  }}
                >
                  <MessageSquare size={16} color="var(--accent)" style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14 }}>
                    {session.name || session.id}
                  </span>
                  <span style={{ color: "var(--text-dim)", fontSize: "var(--text-md)", flexShrink: 0 }}>
                    {relativeTime(session.modified, locale)}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading={t("commandPalette.actions")}>
              <Command.Item
                value={t("commandPalette.newSession")}
                onSelect={() => choose(onNewSession)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  minHeight: 48,
                  padding: "10px 12px",
                  borderRadius: "var(--radius-control)",
                  color: "var(--text)",
                  cursor: "pointer",
                  touchAction: "manipulation",
                }}
              >
                <Plus size={16} color="var(--accent)" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 14 }}>{t("commandPalette.newSession")}</span>
              </Command.Item>
              <Command.Item
                value={t("commandPalette.toggleTheme")}
                onSelect={() => choose(toggleTheme)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  minHeight: 48,
                  padding: "10px 12px",
                  borderRadius: "var(--radius-control)",
                  color: "var(--text)",
                  cursor: "pointer",
                  touchAction: "manipulation",
                }}
              >
                {isDark ? <Sun size={16} color="var(--accent)" style={{ flexShrink: 0 }} /> : <Moon size={16} color="var(--accent)" style={{ flexShrink: 0 }} />}
                <span style={{ fontSize: 14 }}>{t("commandPalette.toggleTheme")}</span>
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </div>,
      document.body,
    );
  }

  // Desktop render
  return createPortal(
    <div
      role="presentation"
      onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--z-command-palette)",
        background: "color-mix(in srgb, var(--text) 22%, transparent)",
        paddingTop: "20vh",
      }}
    >
      <Command
        ref={panelRef}
        label={t("commandPalette.label")}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        shouldFilter
        style={{
          width: "min(92vw, 560px)",
          maxHeight: "min(70vh, 560px)",
          margin: "0 auto",
          overflow: "hidden",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-modal)",
          boxShadow: "var(--shadow-modal)",
          animation: "ui-scale-in var(--dur-med) var(--ease-out-warm)",
        }}
      >
        <div style={{ padding: "14px var(--space-6)", borderBottom: "1px solid var(--border)" }}>
          <Command.Input
            autoFocus
            placeholder={t("commandPalette.placeholder")}
            style={{
              width: "100%",
              border: 0,
              outline: 0,
              background: "transparent",
              color: "var(--text)",
              fontSize: 15,
            }}
          />
        </div>
        <Command.List style={{ padding: "var(--space-4)", overflowY: "auto", maxHeight: "min(55vh, 440px)" }}>
          {searchEmpty}
          <Command.Group heading={t("commandPalette.sessions")}>
            {sessionFeedback}
            {sessions.map((session) => (
              <Command.Item
                key={session.id}
                value={`${session.name ?? session.id} ${session.cwd}`}
                onSelect={() => choose(() => onSelectSession(session))}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 10px",
                  borderRadius: "var(--radius-control)",
                  color: "var(--text)",
                  cursor: "pointer",
                }}
              >
                <MessageSquare size={15} color="var(--accent)" />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14 }}>
                  {session.name || session.id}
                </span>
                <span style={{ color: "var(--text-dim)", fontSize: "var(--text-md)" }}>
                  {relativeTime(session.modified, locale)}
                </span>
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading={t("commandPalette.actions")}>
            <Command.Item
              value={t("commandPalette.newSession")}
              onSelect={() => choose(onNewSession)}
              style={{
                display: "flex",
                gap: 10,
                padding: "9px 10px",
                borderRadius: "var(--radius-control)",
                color: "var(--text)",
                cursor: "pointer",
              }}
            >
              <Plus size={15} color="var(--accent)" />
              <span style={{ fontSize: 14 }}>{t("commandPalette.newSession")}</span>
            </Command.Item>
            <Command.Item
              value={t("commandPalette.toggleTheme")}
              onSelect={() => choose(toggleTheme)}
              style={{
                display: "flex",
                gap: 10,
                padding: "9px 10px",
                borderRadius: "var(--radius-control)",
                color: "var(--text)",
                cursor: "pointer",
              }}
            >
              {isDark ? <Sun size={15} color="var(--accent)" /> : <Moon size={15} color="var(--accent)" />}
              <span style={{ fontSize: 14 }}>{t("commandPalette.toggleTheme")}</span>
            </Command.Item>
          </Command.Group>
        </Command.List>
        <div style={{ borderTop: "1px solid var(--border)", padding: "var(--space-4) 14px", color: "var(--text-dim)", fontSize: "var(--text-md)" }}>
          {t("commandPalette.hints")}
        </div>
      </Command>
    </div>,
    document.body,
  );
}

export default CommandPalette;
