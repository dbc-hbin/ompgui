export const CLIENT_MODELS_TTL_MS = 30_000;

export type ClientModelsResponse = {
  models: Record<string, string>;
  modelList: { id: string; name: string; provider: string; supportsFastMode?: boolean; contextWindow?: number }[];
  defaultModel: { provider: string; modelId: string } | null;
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps?: Record<string, Record<string, string | null>>;
  connectedProviders?: { id: string; name: string; disabled: boolean }[];
  modelError?: string;
};

export type ClientModelsStatus = "idle" | "loading" | "ready" | "error";

export type ClientModelsSnapshot = {
  status: ClientModelsStatus;
  data: ClientModelsResponse | null;
  error: string | null;
  cwd: string;
  expiresAt: number | null;
};

type ModelsEntry = {
  data: ClientModelsResponse | null;
  error: string | null;
  status: ClientModelsStatus;
  expiresAt: number | null;
  generation: number;
  snapshot: ClientModelsSnapshot;
};

type ModelsStoreState = {
  globalGeneration: number;
  entries: Map<string, ModelsEntry>;
  inFlight: Map<string, Promise<ClientModelsResponse>>;
  listeners: Map<string, Set<(snapshot: ClientModelsSnapshot) => void>>;
};

declare global {
  var __ompClientModelStore: ModelsStoreState | undefined;
}

function emptyStore(): ModelsStoreState {
  return {
    globalGeneration: 0,
    entries: new Map(),
    inFlight: new Map(),
    listeners: new Map(),
  };
}

function getStore(): ModelsStoreState {
  if (!globalThis.__ompClientModelStore) {
    globalThis.__ompClientModelStore = emptyStore();
  }
  return globalThis.__ompClientModelStore;
}

export function normalizeClientModelsCwd(cwd?: string | null): string {
  return cwd ?? "";
}

function modelsUrl(cwd: string): string {
  return cwd ? `/api/models?cwd=${encodeURIComponent(cwd)}` : "/api/models";
}

function snapshotOf(cwd: string, entry: ModelsEntry | undefined): ClientModelsSnapshot {
  if (!entry) {
    return { status: "idle", data: null, error: null, cwd, expiresAt: null };
  }
  return entry.snapshot;
}

function writeSnapshot(cwd: string, entry: ModelsEntry): ClientModelsSnapshot {
  entry.snapshot = {
    status: entry.status,
    data: entry.data,
    error: entry.error,
    cwd,
    expiresAt: entry.expiresAt,
  };
  const listeners = getStore().listeners.get(cwd);
  if (listeners) {
    for (const listener of [...listeners]) {
      try {
        listener(entry.snapshot);
      } catch {
        // One subscriber must not block the rest.
      }
    }
  }
  return entry.snapshot;
}

function ensureEntry(store: ModelsStoreState, cwd: string): ModelsEntry {
  const existing = store.entries.get(cwd);
  if (existing) return existing;
  const entry: ModelsEntry = {
    data: null,
    error: null,
    status: "idle",
    expiresAt: null,
    generation: 0,
    snapshot: { status: "idle", data: null, error: null, cwd, expiresAt: null },
  };
  store.entries.set(cwd, entry);
  return entry;
}

function parseModels(data: unknown): ClientModelsResponse {
  if (!data || typeof data !== "object") throw new Error("invalid models response");
  const value = data as Partial<ClientModelsResponse>;
  return {
    models: value.models && typeof value.models === "object" ? value.models : {},
    modelList: Array.isArray(value.modelList) ? value.modelList : [],
    defaultModel: value.defaultModel ?? null,
    thinkingLevels: value.thinkingLevels && typeof value.thinkingLevels === "object" ? value.thinkingLevels : {},
    ...(value.thinkingLevelMaps ? { thinkingLevelMaps: value.thinkingLevelMaps } : {}),
    ...(value.connectedProviders ? { connectedProviders: value.connectedProviders } : {}),
    ...(typeof value.modelError === "string" ? { modelError: value.modelError } : {}),
  };
}

export function getClientModelsSnapshot(cwd?: string | null): ClientModelsSnapshot {
  const key = normalizeClientModelsCwd(cwd);
  return snapshotOf(key, getStore().entries.get(key));
}

export function subscribeClientModels(
  cwd: string | null | undefined,
  listener: (snapshot: ClientModelsSnapshot) => void,
): () => void {
  const key = normalizeClientModelsCwd(cwd);
  const store = getStore();
  let listeners = store.listeners.get(key);
  if (!listeners) {
    listeners = new Set();
    store.listeners.set(key, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) store.listeners.delete(key);
  };
}

export function invalidateClientModels(cwd?: string | null): void {
  const store = getStore();
  if (cwd === undefined) {
    store.globalGeneration += 1;
    for (const [key, entry] of store.entries) {
      entry.generation += 1;
      entry.data = null;
      entry.error = null;
      entry.status = "idle";
      entry.expiresAt = null;
      writeSnapshot(key, entry);
    }
    store.inFlight.clear();
    return;
  }
  const key = normalizeClientModelsCwd(cwd);
  const entry = ensureEntry(store, key);
  entry.generation += 1;
  entry.data = null;
  entry.error = null;
  entry.status = "idle";
  entry.expiresAt = null;
  store.inFlight.delete(key);
  writeSnapshot(key, entry);
}

export function resetClientModelStore(): void {
  globalThis.__ompClientModelStore = emptyStore();
}

export function loadClientModels(cwd?: string | null, options?: { force?: boolean }): Promise<ClientModelsResponse> {
  const key = normalizeClientModelsCwd(cwd);
  if (options?.force) invalidateClientModels(key);

  const store = getStore();
  const entry = ensureEntry(store, key);
  const now = Date.now();
  const fresh = entry.data && entry.expiresAt !== null && entry.expiresAt > now;
  if (fresh && !options?.force) return Promise.resolve(entry.data as ClientModelsResponse);

  const existing = store.inFlight.get(key);
  if (existing) return existing;

  const generation = entry.generation;
  const globalGeneration = store.globalGeneration;
  if (entry.status !== "ready") {
    entry.status = "loading";
    entry.error = null;
    writeSnapshot(key, entry);
  }

  const request = (async () => {
    const response = await fetch(modelsUrl(key), { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseModels(await response.json());
  })();

  const guarded = request.then((data) => {
    const current = getStore();
    const live = current.entries.get(key);
    if (!live || live.generation !== generation || current.globalGeneration !== globalGeneration) {
      return data;
    }
    live.data = data;
    live.error = null;
    live.status = "ready";
    live.expiresAt = Date.now() + CLIENT_MODELS_TTL_MS;
    writeSnapshot(key, live);
    return data;
  }).catch((error: unknown) => {
    const current = getStore();
    const live = current.entries.get(key);
    if (live && live.generation === generation && current.globalGeneration === globalGeneration) {
      live.status = "error";
      live.error = error instanceof Error ? error.message : String(error);
      live.expiresAt = null;
      writeSnapshot(key, live);
    }
    throw error;
  }).finally(() => {
    const current = getStore();
    if (current.inFlight.get(key) === guarded) current.inFlight.delete(key);
  });

  store.inFlight.set(key, guarded);
  return guarded;
}
