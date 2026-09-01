import type { SessionInfo } from "@/lib/types";

export type SessionListStatus = "idle" | "loading" | "ready" | "error";

export type SessionListSnapshot = {
  status: SessionListStatus;
  sessions: SessionInfo[];
  runningSessionIds: string[];
  etag: string | null;
  error: string | null;
  generation: number;
};

type SessionListState = {
  generation: number;
  etag: string | null;
  sessions: SessionInfo[];
  runningSessionIds: string[];
  status: SessionListStatus;
  error: string | null;
  inFlight: Promise<SessionListSnapshot> | null;
  inFlightGeneration: number;
  snapshot: SessionListSnapshot;
  listeners: Set<(snapshot: SessionListSnapshot) => void>;
};

declare global {
  var __ompClientSessionStore: SessionListState | undefined;
}

function createSnapshot(state: Omit<SessionListState, "snapshot" | "listeners" | "inFlight" | "inFlightGeneration">): SessionListSnapshot {
  return {
    status: state.status,
    sessions: state.sessions,
    runningSessionIds: state.runningSessionIds,
    etag: state.etag,
    error: state.error,
    generation: state.generation,
  };
}

function emptyState(): SessionListState {
  const base = {
    generation: 0,
    etag: null as string | null,
    sessions: [] as SessionInfo[],
    runningSessionIds: [] as string[],
    status: "idle" as SessionListStatus,
    error: null as string | null,
  };
  return {
    ...base,
    inFlight: null,
    inFlightGeneration: -1,
    snapshot: createSnapshot(base),
    listeners: new Set(),
  };
}

function getState(): SessionListState {
  if (!globalThis.__ompClientSessionStore) {
    globalThis.__ompClientSessionStore = emptyState();
  }
  return globalThis.__ompClientSessionStore;
}

function publish(state: SessionListState): SessionListSnapshot {
  state.snapshot = createSnapshot(state);
  for (const listener of [...state.listeners]) {
    try {
      listener(state.snapshot);
    } catch {
      // One subscriber must not block the rest.
    }
  }
  return state.snapshot;
}

function parseSessionList(data: unknown): { sessions: SessionInfo[]; runningSessionIds: string[] } {
  if (!data || typeof data !== "object") throw new Error("invalid session list");
  const sessions = "sessions" in data && Array.isArray((data as { sessions?: unknown }).sessions)
    ? (data as { sessions: SessionInfo[] }).sessions
    : null;
  if (!sessions) throw new Error("invalid session list");
  const runningRaw = "runningSessionIds" in data ? (data as { runningSessionIds?: unknown }).runningSessionIds : undefined;
  const runningSessionIds = Array.isArray(runningRaw)
    ? runningRaw.filter((id): id is string => typeof id === "string")
    : [];
  return { sessions, runningSessionIds };
}

export function getSessionListSnapshot(): SessionListSnapshot {
  return getState().snapshot;
}

export function subscribeSessionList(listener: (snapshot: SessionListSnapshot) => void): () => void {
  const state = getState();
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

export function invalidateSessionList(): void {
  const state = getState();
  state.generation += 1;
  state.etag = null;
  state.inFlight = null;
  state.inFlightGeneration = -1;
  if (state.status === "ready") {
    state.status = "ready";
  }
  publish(state);
}

export function resetClientSessionStore(): void {
  globalThis.__ompClientSessionStore = emptyState();
}

export function loadSessionList(options?: { force?: boolean }): Promise<SessionListSnapshot> {
  if (options?.force) invalidateSessionList();
  const state = getState();
  if (state.inFlight && state.inFlightGeneration === state.generation) {
    return state.inFlight;
  }

  const generation = state.generation;
  const etag = options?.force ? null : state.etag;
  if (state.status !== "ready") {
    state.status = "loading";
    state.error = null;
    publish(state);
  }

  const request: Promise<SessionListSnapshot> = (async () => {
    const headers: Record<string, string> = {};
    if (etag) headers["If-None-Match"] = etag;
    const response = await fetch("/api/sessions", { cache: "no-store", headers });
    const current = getState();
    if (current.generation !== generation) return current.snapshot;

    if (response.status === 304) {
      current.status = "ready";
      current.error = null;
      return publish(current);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const parsed = parseSessionList(await response.json());
    if (getState().generation !== generation) return getState().snapshot;

    const nextEtag = response.headers.get("ETag");
    current.sessions = parsed.sessions;
    current.runningSessionIds = parsed.runningSessionIds;
    if (nextEtag) current.etag = nextEtag;
    current.status = "ready";
    current.error = null;
    return publish(current);
  })()
    .catch((error: unknown) => {
      const current = getState();
      if (current.generation !== generation) return current.snapshot;
      current.status = "error";
      current.error = error instanceof Error ? error.message : String(error);
      return publish(current);
    })
    .finally(() => {
      const current = getState();
      if (current.inFlight === request) {
        current.inFlight = null;
        current.inFlightGeneration = -1;
      }
    });

  state.inFlight = request;
  state.inFlightGeneration = generation;
  return request;
}
