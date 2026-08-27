/**
 * Client-side composer preferences (localStorage). These live outside the
 * native OMP config because they are ompweb UI behaviors.
 */

export type SubmitDuringRunBehavior = "steer" | "queue";

const SUBMIT_DURING_RUN_KEY = "omp-web:submit-during-run";
const SUBMIT_DURING_RUN_EVENT = "ompgui:submit-during-run-change";

/** Default behavior when a message is submitted while the agent is running. */
export function getSubmitDuringRunBehavior(): SubmitDuringRunBehavior {
  if (typeof window === "undefined") return "steer";
  try {
    const value = window.localStorage.getItem(SUBMIT_DURING_RUN_KEY);
    if (value === "steer" || value === "queue") return value;
  } catch {
    // storage unavailable — fall through to the default
  }
  return "steer";
}

export function setSubmitDuringRunBehavior(behavior: SubmitDuringRunBehavior): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SUBMIT_DURING_RUN_KEY, behavior);
    window.dispatchEvent(new Event(SUBMIT_DURING_RUN_EVENT));
  } catch {
    // storage unavailable — the preference simply won't persist
  }
}

export function subscribeSubmitDuringRunBehavior(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === SUBMIT_DURING_RUN_KEY) listener();
  };
  window.addEventListener(SUBMIT_DURING_RUN_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SUBMIT_DURING_RUN_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}
