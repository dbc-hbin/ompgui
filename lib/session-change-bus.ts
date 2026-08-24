export interface SessionChange {
  type: "sessions-changed";
  sessionIds: string[];
  refreshSessionList: true;
}

type SessionChangeListener = (change: SessionChange) => void;

// The sidebar and selected-session hook live in the same browser bundle. A
// module-local listener set keeps the integration tiny and avoids coupling the
// API payload to a DOM event name or a React context provider.
const listeners = new Set<SessionChangeListener>();

export function subscribeSessionChanges(listener: SessionChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishSessionChange(change: SessionChange): void {
  // Snapshot the set: a listener is allowed to unsubscribe itself while a
  // frame is being delivered without changing which listeners see that frame.
  for (const listener of [...listeners]) {
    try {
      listener(change);
    } catch {
      // One stale component must not prevent the other subscribers from
      // reloading their selected session.
    }
  }
}
