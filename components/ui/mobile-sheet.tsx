"use client";

import React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useModalDialog } from "@/hooks/useModalDialog";
import { useOverlayBack } from "@/hooks/overlay-stack";

interface MobileSheetProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  maxHeight?: string;
  headerExtra?: React.ReactNode;
  ariaLabel?: string;
}

export function MobileSheet({
  open,
  onClose,
  title,
  children,
  maxHeight = "min(82dvh, 560px)",
  headerExtra,
  ariaLabel,
}: MobileSheetProps) {
  const { t } = useI18n();
  const containerRef = useModalDialog<HTMLDivElement>({ onClose, active: open });
  useOverlayBack(open, onClose);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="presentation"
      className="mobile-sheet-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          onClose();
        }
      }}
      onTouchStart={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--z-dialog)",
        background: "var(--overlay-backdrop)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
        animation: "ui-sheet-backdrop-in var(--dur-fast) var(--ease-out-warm)",
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={typeof title === "string" ? title : ariaLabel}
        className="mobile-sheet-content dropdown-surface"
        style={{
          width: "100%",
          maxHeight,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderBottom: "none",
          borderTopLeftRadius: "var(--radius-modal)",
          borderTopRightRadius: "var(--radius-modal)",
          boxShadow: "var(--shadow-modal)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          paddingBottom: "max(var(--space-4), env(safe-area-inset-bottom, 0px))",
          outline: "none",
          animation: "ui-sheet-slide-up var(--dur-med) var(--ease-out-warm)",
        }}
      >
        {/* Drag handle */}
        <div
          style={{
            width: "100%",
            display: "flex",
            justifyContent: "center",
            paddingTop: "var(--space-3)",
            paddingBottom: "var(--space-2)",
          }}
        >
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: "var(--border)",
            }}
          />
        </div>

        {/* Header */}
        {(title || headerExtra) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 var(--space-5) var(--space-3)",
              borderBottom: "1px solid var(--border)",
              gap: "var(--space-3)",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                fontSize: "var(--text-lg)",
                fontWeight: 600,
                color: "var(--text)",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
              }}
            >
              {title}
            </div>
            {headerExtra}
            <button
              type="button"
              onClick={onClose}
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
        )}

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
