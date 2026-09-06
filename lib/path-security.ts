import { lstatSync, realpathSync } from "fs";
import path from "path";
import { isWindowsAbsolutePath } from "./paths";

export function isPathWithinRoots(target: string, roots: Set<string>): boolean {
  for (const root of roots) {
    const useWindowsRules = isWindowsAbsolutePath(target) || isWindowsAbsolutePath(root);
    const resolver = useWindowsRules ? path.win32 : path;
    const sep = useWindowsRules ? "\\" : path.sep;
    const normalized = resolver.resolve(target);
    const normalizedRoot = resolver.resolve(root);
    const comparable = useWindowsRules ? normalized.toLowerCase() : normalized;
    const comparableRoot = useWindowsRules ? normalizedRoot.toLowerCase() : normalizedRoot;
    const rootWithSep = comparableRoot.endsWith(sep) ? comparableRoot : comparableRoot + sep;
    if (comparable === comparableRoot || comparable.startsWith(rootWithSep)) return true;
  }
  return false;
}

/** Resolve existing ancestors before appending missing components. Dangling
 * symlinks fail closed rather than being mistaken for nonexistent directories. */
export function resolvePathWithMissingLeaf(target: string): string {
  let current = path.resolve(target);
  const missing: string[] = [];
  for (;;) {
    try {
      lstatSync(current);
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
  return path.join(realpathSync(current), ...missing);
}

export function isExistingPathWithinRoots(target: string, roots: Set<string>): boolean {
  let realTarget: string;
  try {
    realTarget = realpathSync(target);
  } catch {
    return false;
  }

  const realRoots = new Set<string>();
  for (const root of roots) {
    try {
      realRoots.add(realpathSync(root));
    } catch {
      // Ignore stale roots derived from removed sessions or worktrees.
    }
  }
  return isPathWithinRoots(realTarget, realRoots);
}
