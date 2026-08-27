/** UI completion-sound preference stored independently from native OMP settings. */

export const SOUND_STORAGE_KEY = "ompgui-sound-enabled";
const LEGACY_SOUND_STORAGE_KEY = "omp-sound-enabled";

function migrateLegacySoundPreference(): string | null {
  const storage = window.localStorage;
  const current = storage.getItem(SOUND_STORAGE_KEY);
  if (current !== null) return current;

  const legacy = storage.getItem(LEGACY_SOUND_STORAGE_KEY);
  if (legacy === null) return null;

  if (legacy === "true" || legacy === "false") {
    // Only remove the legacy value after the canonical copy succeeds. If a
    // browser blocks writes, the next read can retry the one-time migration.
    try {
      storage.setItem(SOUND_STORAGE_KEY, legacy);
      storage.removeItem(LEGACY_SOUND_STORAGE_KEY);
      return legacy;
    } catch {
      return null;
    }
  }

  // Invalid legacy values have no meaningful preference. Remove them so they
  // cannot keep triggering migration attempts, then use the default.
  try {
    storage.removeItem(LEGACY_SOUND_STORAGE_KEY);
  } catch {
    // Storage may be unavailable; callers still use the default below.
  }
  return null;
}

export function getSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const value = migrateLegacySoundPreference();
    return value === null ? true : value === "true";
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, String(enabled));
  } catch {
    // Storage unavailable — the live preference still applies for this mount.
  }
}
