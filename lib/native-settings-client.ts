type SettingsRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is SettingsRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordCopy(value: object): SettingsRecord {
  return Object.assign({}, value as SettingsRecord);
}

export function mergeClientNativeSettings<T extends object>(
  current: T,
  patch: Partial<T>,
): T {
  const output = recordCopy(current);
  for (const [key, value] of Object.entries(patch as SettingsRecord)) {
    if (value === undefined) continue;
    if (isPlainObject(value)) {
      const previousValue = output[key];
      const previous = isPlainObject(previousValue) ? recordCopy(previousValue) : {};
      const section: SettingsRecord = { ...previous, ...value };
      if (key === "tools" && isPlainObject(value.approval)) {
        const previousApproval = isPlainObject(previous.approval) ? previous.approval : {};
        section.approval = Object.keys(value.approval).length === 0
          ? {}
          : { ...previousApproval, ...value.approval };
      }
      output[key] = section;
    } else {
      output[key] = value;
    }
  }
  return output as T;
}

export function shouldApplyRemoteSettings(options: {
  mounted: boolean;
  requestGeneration: number;
  latestGeneration: number;
}): boolean {
  return options.mounted && options.requestGeneration === options.latestGeneration;
}
