"use client";

import { useEffect, useState } from "react";
import type { ExtensionUiRequest } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { useModalDialog } from "@/hooks/useModalDialog";

export type ExtensionDialogRequest = Extract<
  ExtensionUiRequest,
  { method: "select" | "confirm" | "input" | "editor" }
>;

export type ExtensionDialogResponse =
  | { value: string }
  | { confirmed: boolean }
  | { cancelled: true };

/**
 * Overlay dialog for `select` / `confirm` / `input` / `editor` extension UI
 * requests. Polished UX:
 *   - entrance animation (fade backdrop + scale-in panel)
 *   - focus trap: focus moves into the dialog on open and is returned to the
 *     opener on close; Tab/Shift-Tab wrap inside (via useModalDialog)
 *   - Escape closes as "cancelled" (document-level, top-of-stack only)
 *   - backdrop click closes as "cancelled"
 * Logic and i18n keys are unchanged from the in-ChatWindow original.
 */
export function ExtensionDialog({
  request,
  onRespond,
  runtimeReady = true,
}: {
  request: ExtensionDialogRequest;
  onRespond: (request: ExtensionDialogRequest, response: ExtensionDialogResponse) => void;
  runtimeReady?: boolean;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(request.method === "editor" ? request.prefill ?? "" : "");

  useEffect(() => {
    setValue(request.method === "editor" ? request.prefill ?? "" : "");
  }, [request]);

  const cancel = () => {
    if (!runtimeReady) return;
    onRespond(request, { cancelled: true });
  };

  // useModalDialog gives us: focus-in on open, focus-restore on close,
  // document-level Escape (top-of-stack), and Tab wrapping inside the panel.
  const panelRef = useModalDialog<HTMLDivElement>({
    onClose: cancel,
    active: runtimeReady,
  });

  const submitValue = () => {
    if (!runtimeReady) return;
    if (request.method === "confirm") {
      onRespond(request, { confirmed: true });
    } else {
      onRespond(request, { value });
    }
  };

  return (
    <div
      className="animate-fade-in"
      onMouseDown={(event) => {
        // Close when the pointer goes down on the backdrop itself (not when
        // the press starts inside the panel and is dragged out).
        if (runtimeReady && event.target === event.currentTarget) cancel();
      }}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: "var(--z-dialog)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "var(--overlay-backdrop)",
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        tabIndex={-1}
        className="animate-scale-in"
        style={{
          width: "min(560px, 100%)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-modal)",
          background: "var(--bg)",
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden",
          outline: "none",
        }}
      >
        <div style={{ padding: "var(--space-5) 14px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ color: "var(--text)", fontSize: "var(--text-lg)", fontWeight: 650 }}>{request.title}</div>
          <div style={{ marginTop: 3, color: "var(--text-dim)", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>{t("chatWindow.extensionRequest")}</div>
        </div>

        <div style={{ padding: 14 }}>
          {request.method === "confirm" && (
            <div style={{ color: "var(--text-muted)", fontSize: "var(--text-base)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{request.message}</div>
          )}
          {request.method === "select" && (
            <div style={{ display: "grid", gap: "var(--space-4)" }}>
              {request.options.map((option) => (
                <button
                  key={option}
                  disabled={!runtimeReady}
                  aria-disabled={!runtimeReady}
                  onClick={() => {
                    if (!runtimeReady) return;
                    onRespond(request, { value: option });
                  }}
                  style={{
                    width: "100%",
                    padding: "9px 10px",
                    borderRadius: 7,
                    border: "1px solid var(--border)",
                    background: "var(--bg-panel)",
                    color: "var(--text)",
                    cursor: !runtimeReady ? "not-allowed" : "pointer",
                    opacity: !runtimeReady ? 0.5 : undefined,
                    textAlign: "left",
                    fontSize: "var(--text-base)",
                    transition: "background-color var(--dur-fast) var(--ease-out-warm), border-color var(--dur-fast) var(--ease-out-warm)",
                  }}
                  onMouseEnter={(e) => { if (runtimeReady) e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { if (runtimeReady) e.currentTarget.style.background = "var(--bg-panel)"; }}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          {request.method === "input" && (
            <input
              autoFocus={runtimeReady}
              disabled={!runtimeReady}
              aria-disabled={!runtimeReady}
              readOnly={!runtimeReady}
              aria-label={request.title || request.placeholder || "Input value"}
              value={value}
              placeholder={request.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (!runtimeReady) return;
                if (e.key === "Enter") submitValue();
              }}
              style={{
                width: "100%",
                padding: "9px 10px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                outline: "none",
                fontSize: "var(--text-base)",
                opacity: !runtimeReady ? 0.6 : undefined,
                cursor: !runtimeReady ? "not-allowed" : undefined,
              }}
            />
          )}
          {request.method === "editor" && (
            <textarea
              autoFocus={runtimeReady}
              disabled={!runtimeReady}
              aria-disabled={!runtimeReady}
              readOnly={!runtimeReady}
              aria-label={request.title || "Input value"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (!runtimeReady) return;
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submitValue();
              }}
              style={{
                width: "100%",
                minHeight: 220,
                padding: 10,
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                outline: "none",
                resize: "vertical",
                fontSize: "var(--text-base)",
                lineHeight: 1.55,
                fontFamily: "var(--font-mono)",
                opacity: !runtimeReady ? 0.6 : undefined,
                cursor: !runtimeReady ? "not-allowed" : undefined,
              }}
            />
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-4)", padding: "10px 14px", borderTop: "1px solid var(--border)", background: "var(--bg-panel)" }}>
          <button
            onClick={cancel}
            disabled={!runtimeReady}
            aria-disabled={!runtimeReady}
            style={{
              padding: "var(--space-3) 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              cursor: !runtimeReady ? "not-allowed" : "pointer",
              opacity: !runtimeReady ? 0.5 : undefined,
              transition: "background-color var(--dur-fast) var(--ease-out-warm), color var(--dur-fast) var(--ease-out-warm)",
            }}
            onMouseEnter={(e) => { if (runtimeReady) { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; } }}
            onMouseLeave={(e) => { if (runtimeReady) { e.currentTarget.style.background = "var(--bg)"; e.currentTarget.style.color = "var(--text-muted)"; } }}
          >
            {t("chatWindow.cancel")}
          </button>
          {request.method === "confirm" ? (
            <button
              onClick={submitValue}
              disabled={!runtimeReady}
              aria-disabled={!runtimeReady}
              style={{
                padding: "var(--space-3) 10px",
                borderRadius: 6,
                border: "1px solid var(--accent)",
                background: "var(--accent)",
                color: "var(--on-accent)",
                cursor: !runtimeReady ? "not-allowed" : "pointer",
                opacity: !runtimeReady ? 0.5 : undefined,
                transition: "background-color var(--dur-fast) var(--ease-out-warm)",
              }}
              onMouseEnter={(e) => { if (runtimeReady) e.currentTarget.style.background = "var(--accent-hover)"; }}
              onMouseLeave={(e) => { if (runtimeReady) e.currentTarget.style.background = "var(--accent)"; }}
            >
              {t("chatWindow.confirm")}
            </button>
          ) : request.method !== "select" ? (
            <button
              onClick={submitValue}
              disabled={!runtimeReady}
              aria-disabled={!runtimeReady}
              style={{
                padding: "var(--space-3) 10px",
                borderRadius: 6,
                border: "1px solid var(--accent)",
                background: "var(--accent)",
                color: "var(--on-accent)",
                cursor: !runtimeReady ? "not-allowed" : "pointer",
                opacity: !runtimeReady ? 0.5 : undefined,
                transition: "background-color var(--dur-fast) var(--ease-out-warm)",
              }}
              onMouseEnter={(e) => { if (runtimeReady) e.currentTarget.style.background = "var(--accent-hover)"; }}
              onMouseLeave={(e) => { if (runtimeReady) e.currentTarget.style.background = "var(--accent)"; }}
            >
              {t("chatWindow.submit")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
