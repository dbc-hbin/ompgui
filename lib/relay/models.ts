import { readDisabledProviders } from "../omp/model-roles";
import { runUtilityCommand } from "../omp/rpc-utility";
import { isRecord } from "../type-guards";
import { RELAY_MAX_MODELS, toRelayModelOption, type RelayModelOption } from "./protocol";

const relayModelCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareRelayModelOptions(a: RelayModelOption, b: RelayModelOption): number {
  return relayModelCollator.compare(a.name || a.id, b.name || b.id)
    || relayModelCollator.compare(a.provider, b.provider)
    || relayModelCollator.compare(a.id, b.id);
}

/**
 * Sanitize, filter, sort, and cap a raw `get_available_models` list for phone
 * remotes: drops nulls, drops disabled providers, sorts like desktop
 * /api/models (name, then provider, then id, numeric + case-insensitive),
 * then slices to RELAY_MAX_MODELS.
 */
export function selectRelayModels(
  raw: unknown,
  disabledProviders: Iterable<string> | Set<string> = new Set(),
): RelayModelOption[] {
  if (!Array.isArray(raw)) return [];
  const disabled = disabledProviders instanceof Set
    ? disabledProviders
    : new Set(disabledProviders);
  const options: RelayModelOption[] = [];
  for (const entry of raw) {
    const option = toRelayModelOption(entry);
    if (!option) continue;
    if (disabled.has(option.provider)) continue;
    options.push(option);
  }
  options.sort(compareRelayModelOptions);
  return options.slice(0, RELAY_MAX_MODELS);
}

/**
 * List models available to phone remotes over /relay. Reads the authoritative
 * `get_available_models` registry via the shared utility RPC process, then
 * sanitizes (string id+provider required, name falls back to id, fields
 * capped), drops disabled providers, sorts like desktop /api/models, and caps
 * at 80. Never throws: load failure yields an empty list so the socket stays
 * open.
 */
export async function listRelayModels(): Promise<RelayModelOption[]> {
  try {
    let disabled: Set<string>;
    try {
      disabled = readDisabledProviders();
    } catch {
      disabled = new Set();
    }
    const response = await runUtilityCommand<{ models?: unknown }>({ type: "get_available_models" });
    if (!isRecord(response)) return [];
    return selectRelayModels(response.models, disabled);
  } catch {
    return [];
  }
}
