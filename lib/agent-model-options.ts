export type AgentModelOption = {
  selector: string;
  label: string;
};

/** Build unambiguous OMP model selectors from the /api/models response. */
export function agentModelOptionsFromResponse(value: unknown): AgentModelOption[] {
  if (!value || typeof value !== "object") return [];
  const seen = new Set<string>();
  const options: AgentModelOption[] = [];

  if ("modelList" in value && Array.isArray(value.modelList)) {
    for (const item of value.modelList) {
      if (!item || typeof item !== "object" || !("id" in item) || !("provider" in item)
        || typeof item.id !== "string" || typeof item.provider !== "string") continue;
      const selector = `${item.provider}/${item.id}`;
      if (seen.has(selector)) continue;
      seen.add(selector);
      const name = "name" in item && typeof item.name === "string" && item.name.trim() ? item.name : item.id;
      options.push({ selector, label: `${name} · ${item.provider}` });
    }
  }

  if (options.length === 0 && "models" in value && value.models && typeof value.models === "object") {
    for (const [key, name] of Object.entries(value.models as Record<string, unknown>)) {
      const idx = key.indexOf(":");
      if (idx === -1) continue;
      const provider = key.slice(0, idx);
      const id = key.slice(idx + 1);
      const selector = `${provider}/${id}`;
      if (seen.has(selector)) continue;
      seen.add(selector);
      const label = typeof name === "string" && name.trim() ? `${name} · ${provider}` : `${id} · ${provider}`;
      options.push({ selector, label });
    }
  }

  return options;
}

/** Parse an input string into a single string or an array of model selectors for OMP config. */
export function parseAgentModelOverrideInput(input: string | undefined): string | string[] | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes(",")) {
    const list = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length === 0) return undefined;
    return list.length === 1 ? list[0] : list;
  }
  return trimmed;
}

/** Format an agent model definition or override (string | string[]) into a readable comma-separated string. */
export function formatAgentModelDisplay(model: string | string[] | undefined): string {
  if (!model) return "";
  if (Array.isArray(model)) return model.filter(Boolean).join(", ");
  return String(model).trim();
}
