"use client";

/**
 * Warm-paper UI primitives on top of @base-ui/react.
 * Theming contract: CSS variables from globals.css (--bg, --accent, --radius-*,
 * --shadow-*, --dur-*, --ease-out-warm, --space-*, --text-*, --z-*). No
 * hardcoded colors here.
 */
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import React, { useSyncExternalStore } from "react";
import { useOverlayBack } from "@/hooks/overlay-stack";

/* ---------------------------------- Dialog --------------------------------- */

/**
 * Pin a near-fullscreen dialog inside the padded safe rect.
 *
 * Pre-0.6.0 Android padded the WebView for system bars, so a centered
 * `100dvh - 16px` panel sat below the status bar. 0.6.0 left system bars to
 * `env(safe-area-inset-*)`; centering that same box now draws under the
 * status bar (insets are not symmetric). `dialog-pop-in` locks
 * `translate(-50%, -50%)` for its fill lifetime, so animation is disabled.
 */
export const MOBILE_SAFE_AREA_DIALOG_STYLE: React.CSSProperties = {
  top: "max(8px, env(safe-area-inset-top, 0px))",
  left: "max(8px, env(safe-area-inset-left, 0px))",
  right: "max(8px, env(safe-area-inset-right, 0px))",
  bottom: "max(8px, env(safe-area-inset-bottom, 0px))",
  width: "auto",
  height: "auto",
  maxWidth: "none",
  maxHeight: "none",
  transform: "none",
  animation: "none",
};


function OverlayBackBridge({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  useOverlayBack(open, () => onOpenChange(false));
  return null;
}

export function Dialog({ open, onOpenChange, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <OverlayBackBridge open={open} onOpenChange={onOpenChange} />
      {children}
    </BaseDialog.Root>
  );
}

export function DialogContent({ children, className, style, ariaLabel }: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
}) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop
        style={{
          position: "fixed", inset: 0,
          background: "var(--overlay-backdrop)",
          backdropFilter: "blur(2px)",
          zIndex: "var(--z-dialog-backdrop)",
        }}
      />
      <BaseDialog.Popup
        aria-label={ariaLabel}
        className={className}
        style={{
          position: "fixed", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          // Entrance animation must include the centering transform in its
          // keyframes: an animation overrides the inline transform for its
          // whole (fill: both) lifetime.
          animation: "dialog-pop-in var(--dur-med) var(--ease-out-warm) both",
          zIndex: "var(--z-dialog)",
          background: "var(--bg)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-modal)",
          boxShadow: "var(--shadow-modal)",
          padding: "calc(var(--space-6) + var(--space-2))",
          maxWidth: "min(92vw, 560px)",
          maxHeight: "85dvh",
          overflow: "auto",
          ...style,
        }}
      >
        {children}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

export function DialogTitle({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <BaseDialog.Title
      className="display-serif"
      style={{
        fontSize: "calc(var(--text-xl) + var(--space-3) / 2)",
        margin: "0 0 var(--space-5)",
        ...style,
      }}
    >
      {children}
    </BaseDialog.Title>
  );
}

export const DialogClose = BaseDialog.Close;

/* ---------------------------------- Tooltip -------------------------------- */

const COARSE_POINTER_QUERY = "(hover: none), (pointer: coarse)";

function subscribeCoarse(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(COARSE_POINTER_QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

function getCoarseSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(COARSE_POINTER_QUERY).matches;
}

function getCoarseServerSnapshot(): boolean {
  return false;
}

function useIsCoarsePointer(): boolean {
  return useSyncExternalStore(subscribeCoarse, getCoarseSnapshot, getCoarseServerSnapshot);
}

export function Tooltip({ content, children, side = "top" }: {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "bottom" | "left" | "right";
}) {
  const isCoarse = useIsCoarsePointer();
  const child = children as React.ReactElement<{
    "aria-label"?: string;
    "aria-labelledby"?: string;
  }>;
  const childProps = child.props;
  const trigger = isCoarse && typeof content === "string" && !childProps["aria-label"] && !childProps["aria-labelledby"]
    ? React.cloneElement(child, { "aria-label": content })
    : child;

  return (
    <BaseTooltip.Provider delay={350} closeDelay={0}>
      <BaseTooltip.Root disabled={isCoarse || !content}>
        <BaseTooltip.Trigger render={trigger} />
        {isCoarse || !content ? null : (
          <BaseTooltip.Portal>
            <BaseTooltip.Positioner side={side} sideOffset={6} style={{ zIndex: "var(--z-tooltip)" }}>
              <BaseTooltip.Popup
                style={{
                  background: "var(--bg-panel)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-control)",
                  boxShadow: "var(--shadow-pop)",
                  padding: "var(--space-2) calc(var(--space-4) + var(--space-1) / 2)",
                  fontSize: "var(--text-md)",
                  lineHeight: 1.4,
                  maxWidth: 260,
                }}
              >
                {content}
              </BaseTooltip.Popup>
            </BaseTooltip.Positioner>
          </BaseTooltip.Portal>
        )}
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  );
}

/* -------------------------------- Collapsible ------------------------------- */

export function Collapsible({ open, onOpenChange, defaultOpen, children }: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <BaseCollapsible.Root open={open} onOpenChange={onOpenChange} defaultOpen={defaultOpen}>
      {children}
    </BaseCollapsible.Root>
  );
}

export const CollapsibleTrigger = BaseCollapsible.Trigger;

export function CollapsiblePanel({ children, style }: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <BaseCollapsible.Panel style={style}>
      {children}
    </BaseCollapsible.Panel>
  );
}
