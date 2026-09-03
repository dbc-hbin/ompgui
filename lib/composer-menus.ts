type ClosestHost = { closest: (selector: string) => unknown; parentElement?: ClosestHost | null };

/** Portaled MobileSheet lives on document.body, so trigger.contains() is false. */
export function isPortaledMobileSheetTarget(target: EventTarget | null): boolean {
  const host = target as ClosestHost | null;
  const root = host && typeof host.closest === "function" ? host : host?.parentElement;
  return typeof root?.closest === "function" && root.closest(".mobile-sheet-overlay") != null;
}

/**
 * Close a composer menu on outside click only when a desktop panel is mounted.
 * A missing panel means the menu is a MobileSheet — that overlay owns dismiss.
 */
export function shouldDismissComposerMenu(
  target: EventTarget | null,
  trigger: { contains: (node: Node) => boolean } | null,
  panel: { contains: (node: Node) => boolean } | null,
): boolean {
  if (isPortaledMobileSheetTarget(target)) return false;
  if (!target || typeof (target as Node).nodeType !== "number") return false;
  const node = target as Node;
  if (trigger?.contains(node)) return false;
  if (!panel) return false;
  return !panel.contains(node);
}
