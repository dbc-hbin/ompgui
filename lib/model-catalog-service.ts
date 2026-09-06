import {
  flattenModelsDevCatalog,
  recommendModelCatalogPreset,
  searchModelCatalog,
  type ModelCatalogEntry,
  type ModelCatalogRecommendation,
} from "./model-catalog";

const MODELS_DEV_URL = "https://models.dev/api.json";
const CATALOG_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

interface CatalogCache {
  entries: ModelCatalogEntry[];
  expiresAt: number;
  inFlight?: Promise<ModelCatalogEntry[]>;
}

declare global {
  var __ompguiModelsDevCatalogCache: CatalogCache | undefined;
}

export class ModelCatalogError extends Error {
  constructor(
    readonly code: "invalid_args" | "catalog_unavailable",
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ModelCatalogError";
  }
}

export interface ModelCatalogSearchResult {
  models: ModelCatalogEntry[];
  recommendation: ModelCatalogRecommendation;
  source: string;
}

async function fetchCatalog(): Promise<ModelCatalogEntry[]> {
  // Hints are local matching inputs only. Never send them (or credentials) upstream.
  const response = await fetch(MODELS_DEV_URL, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Catalog request failed");
  const entries = flattenModelsDevCatalog(await response.json());
  if (entries.length === 0) throw new Error("Catalog is empty");
  return entries;
}

async function loadCatalog(): Promise<ModelCatalogEntry[]> {
  let cache = globalThis.__ompguiModelsDevCatalogCache;
  if (!cache) {
    cache = globalThis.__ompguiModelsDevCatalogCache = { entries: [], expiresAt: 0 };
  }
  if (cache.entries.length > 0 && cache.expiresAt > Date.now()) return cache.entries;
  if (!cache.inFlight) {
    cache.inFlight = fetchCatalog().then((entries) => {
      cache.entries = entries;
      cache.expiresAt = Date.now() + CATALOG_TTL_MS;
      return entries;
    }).finally(() => {
      cache.inFlight = undefined;
    });
  }
  try {
    return await cache.inFlight;
  } catch {
    // Preserve the last successful catalog if a refresh fails.
    if (cache.entries.length > 0) return cache.entries;
    throw new ModelCatalogError("catalog_unavailable", "The public model catalog is unavailable. Try again later.", 502);
  }
}

/** Node-safe shared web/relay search, with no access to local provider config. */
export async function searchPublicModelCatalog(args: {
  query: unknown;
  provider?: unknown;
  baseUrl?: unknown;
  limit?: unknown;
}): Promise<ModelCatalogSearchResult> {
  const { query, provider = "", baseUrl = "", limit = 50 } = args;
  if (typeof query !== "string" || query.length > 120) {
    throw new ModelCatalogError("invalid_args", "query must be a string of at most 120 characters", 400);
  }
  if (typeof provider !== "string" || provider.length > 120) {
    throw new ModelCatalogError("invalid_args", "provider must be a string of at most 120 characters", 400);
  }
  if (typeof baseUrl !== "string" || baseUrl.length > 500) {
    throw new ModelCatalogError("invalid_args", "baseUrl must be a string of at most 500 characters", 400);
  }
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ModelCatalogError("invalid_args", "limit must be an integer between 1 and 100", 400);
  }
  const entries = await loadCatalog();
  return {
    models: searchModelCatalog(entries, query, provider, limit),
    recommendation: recommendModelCatalogPreset(entries, query, provider, baseUrl),
    source: MODELS_DEV_URL,
  };
}
