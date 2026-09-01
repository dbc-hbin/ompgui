export const VISIBLE_PAGE_SIZE = 50;
export const MAX_RENDERED_MESSAGES = 150;

export type RenderWindow = {
  startIndex: number;
  endIndex: number;
};

export type ResolvedRenderWindow = RenderWindow & {
  hasMoreAbove: boolean;
  hasMoreBelow: boolean;
};

function clampIndex(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function clampRenderWindow(
  totalCount: number,
  window: RenderWindow,
  maxRendered = MAX_RENDERED_MESSAGES,
): ResolvedRenderWindow {
  const total = Math.max(0, totalCount);
  const limit = Math.max(0, maxRendered);
  let startIndex = clampIndex(window.startIndex, 0, total);
  let endIndex = clampIndex(window.endIndex, startIndex, total);
  if (endIndex - startIndex > limit) {
    endIndex = startIndex + limit;
    if (endIndex > total) {
      endIndex = total;
      startIndex = Math.max(0, endIndex - limit);
    }
  }
  if (endIndex === startIndex && total > 0 && limit > 0) {
    endIndex = Math.min(total, startIndex + Math.min(limit, total));
    if (endIndex === startIndex) {
      startIndex = Math.max(0, total - Math.min(limit, total));
      endIndex = total;
    }
  }
  return {
    startIndex,
    endIndex,
    hasMoreAbove: startIndex > 0,
    hasMoreBelow: endIndex < total,
  };
}

export function initialRenderWindow(
  totalCount: number,
  pageSize = VISIBLE_PAGE_SIZE,
  maxRendered = MAX_RENDERED_MESSAGES,
): ResolvedRenderWindow {
  const total = Math.max(0, totalCount);
  const size = Math.min(Math.max(pageSize, 0), maxRendered, total);
  return clampRenderWindow(total, { startIndex: total - size, endIndex: total }, maxRendered);
}

export function reconcileRenderWindow(
  totalCount: number,
  window: RenderWindow,
  options: { pinToEnd?: boolean; pageSize?: number; maxRendered?: number } = {},
): ResolvedRenderWindow {
  const maxRendered = options.maxRendered ?? MAX_RENDERED_MESSAGES;
  const pageSize = options.pageSize ?? VISIBLE_PAGE_SIZE;
  if (options.pinToEnd) {
    const total = Math.max(0, totalCount);
    const currentSize = clampIndex(window.endIndex - window.startIndex, 0, maxRendered);
    const size = Math.min(maxRendered, Math.max(currentSize, Math.min(pageSize, total)), total);
    return clampRenderWindow(total, { startIndex: total - size, endIndex: total }, maxRendered);
  }
  return clampRenderWindow(totalCount, window, maxRendered);
}

export function shiftRenderWindowUp(
  totalCount: number,
  window: RenderWindow,
  pageSize = VISIBLE_PAGE_SIZE,
  maxRendered = MAX_RENDERED_MESSAGES,
): ResolvedRenderWindow {
  const startIndex = Math.max(0, window.startIndex - Math.max(pageSize, 0));
  let endIndex = window.endIndex;
  if (endIndex - startIndex > maxRendered) {
    endIndex = startIndex + maxRendered;
  }
  return clampRenderWindow(totalCount, { startIndex, endIndex }, maxRendered);
}

export function shiftRenderWindowDown(
  totalCount: number,
  window: RenderWindow,
  pageSize = VISIBLE_PAGE_SIZE,
  maxRendered = MAX_RENDERED_MESSAGES,
): ResolvedRenderWindow {
  const total = Math.max(0, totalCount);
  const endIndex = Math.min(total, window.endIndex + Math.max(pageSize, 0));
  let startIndex = window.startIndex;
  if (endIndex - startIndex > maxRendered) {
    startIndex = endIndex - maxRendered;
  }
  return clampRenderWindow(total, { startIndex, endIndex }, maxRendered);
}

export function overlappingAnchorIndex(previous: RenderWindow, next: RenderWindow): number {
  const start = Math.max(previous.startIndex, next.startIndex);
  const end = Math.min(previous.endIndex, next.endIndex);
  if (end > start) return start;
  return next.startIndex;
}

/**
 * Scroll and IntersectionObserver callbacks must read the last committed
 * window. Assign only after layout, never during render.
 */
export function commitResolvedRenderWindow(
  committed: { current: ResolvedRenderWindow },
  next: ResolvedRenderWindow,
): void {
  committed.current = next;
}

export function restoreScrollTopFromRectDelta(
  scrollTop: number,
  previousTop: number,
  nextTop: number,
): number {
  return Math.max(0, scrollTop + (nextTop - previousTop));
}

export function restoreScrollTopAfterAboveShift(
  previousScrollTop: number,
  aboveHeightDelta: number,
): number {
  return Math.max(0, previousScrollTop + aboveHeightDelta);
}

export function captureScrollDistance(scrollHeight: number, scrollTop: number): number {
  return scrollHeight - scrollTop;
}

export function restoreScrollTop(scrollHeight: number, savedDistance: number): number {
  return Math.max(0, scrollHeight - savedDistance);
}

export function getNextVisibleCount(currentVisibleCount: number, pageSize = VISIBLE_PAGE_SIZE): number {
  return currentVisibleCount + pageSize;
}
