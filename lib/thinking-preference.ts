const STORAGE_KEY = "ompgui:hide-thinking";
const CHANGE_EVENT = "ompgui:hide-thinking-change";
let volatilePreference = false;

export function getHideThinking(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "true" || stored === "false") volatilePreference = stored === "true";
    return volatilePreference;
  } catch {
    return volatilePreference;
  }
}

export function setHideThinking(hidden: boolean): void {
  if (typeof window === "undefined") return;
  volatilePreference = hidden;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(hidden));
  } catch {
    // The preference still applies to this page through the change event.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeHideThinking(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}
