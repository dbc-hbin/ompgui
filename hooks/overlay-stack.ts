"use client";

import { useEffect, useRef } from "react";

export type OverlayCloser = () => void;

const stack: OverlayCloser[] = [];
const listeners = new Set<() => void>();
let windowListening = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function onOverlayBack(event: Event): void {
  const close = stack[stack.length - 1];
  if (!close) return;
  event.preventDefault();
  close();
}

function attachWindowListener(): void {
  if (windowListening || typeof window === "undefined") return;
  window.addEventListener("ompgui:overlay-back", onOverlayBack);
  windowListening = true;
}

function detachWindowListener(): void {
  if (!windowListening || typeof window === "undefined") return;
  window.removeEventListener("ompgui:overlay-back", onOverlayBack);
  windowListening = false;
}

export function getOverlayDepth(): number {
  return stack.length;
}

export function subscribeOverlayStack(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function registerOverlay(close: OverlayCloser): () => void {
  if (stack.length === 0) attachWindowListener();
  stack.push(close);
  emit();
  return () => {
    const index = stack.lastIndexOf(close);
    if (index !== -1) stack.splice(index, 1);
    if (stack.length === 0) detachWindowListener();
    emit();
  };
}

export function closeTopOverlay(): boolean {
  const close = stack[stack.length - 1];
  if (!close) return false;
  close();
  return true;
}

/** Register an open overlay so native/web Back closes only the topmost one. */
export function useOverlayBack(active: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    return registerOverlay(() => {
      onCloseRef.current();
    });
  }, [active]);
}
