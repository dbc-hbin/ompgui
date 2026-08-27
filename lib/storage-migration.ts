type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Move one valid legacy value to its canonical key. A canonical value always
 * wins, and a failed write leaves the legacy value intact so migration can be
 * retried on the next load.
 */
export function migrateStorageValue(
  storage: StorageLike,
  canonicalKey: string,
  legacyKey: string,
  isValid: (value: string) => boolean,
): string | null {
  const canonicalValue = storage.getItem(canonicalKey);
  const legacyValue = storage.getItem(legacyKey);

  if (canonicalValue !== null) {
    if (legacyValue !== null) {
      try {
        storage.removeItem(legacyKey);
      } catch {
        // The canonical value remains authoritative.
      }
    }
    return canonicalValue;
  }
  if (legacyValue === null) return null;
  if (!isValid(legacyValue)) {
    try {
      storage.removeItem(legacyKey);
    } catch {
      // Invalid legacy data is ignored even when storage is read-only.
    }
    return null;
  }

  try {
    storage.setItem(canonicalKey, legacyValue);
  } catch {
    return legacyValue;
  }
  try {
    storage.removeItem(legacyKey);
  } catch {
    // The copy succeeded; a stale legacy key is harmless.
  }
  return legacyValue;
}
