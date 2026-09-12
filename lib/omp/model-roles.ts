import { existsSync, mkdirSync, readFileSync } from "fs";
import { writeConfigFileAtomic } from "./config-file";
import { resolveNativeConfigWritePath, withNativeConfigLock } from "./file-lock";
import { dirname } from "path";
import { isMap, parseDocument, stringify } from "yaml";
import { getSettingsPath } from "./paths";
import { isRecord } from "../type-guards";

export type ModelRoles = Record<string, string>;

/** Reads the native OMP role selectors without touching other settings. */
export function readModelRoles(): { path: string; roles: ModelRoles } {
  const path = getSettingsPath();
  if (!existsSync(path)) return { path, roles: {} };
  const doc = parseDocument(readFileSync(path, "utf8"));
  if (doc.errors.length > 0) throw new Error(`${path} is not valid YAML: ${doc.errors[0].message}`);
  const data = doc.toJS();
  if (!isRecord(data) || !isRecord(data.modelRoles)) return { path, roles: {} };
  return {
    path,
    roles: Object.fromEntries(Object.entries(data.modelRoles).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
  };
}

/** Updates only modelRoles, preserving the user's remaining native OMP config. */
export async function writeModelRoles(roles: ModelRoles): Promise<void> {
  const path = resolveNativeConfigWritePath(getSettingsPath());
  mkdirSync(dirname(path), { recursive: true });
  await withNativeConfigLock(path, () => {
    const source = existsSync(path) ? readFileSync(path, "utf8") : "";
    const doc = parseDocument(source);
    if (doc.errors.length > 0) throw new Error(`${path} is not valid YAML: ${doc.errors[0].message}`);
    if (doc.contents === null) {
      writeConfigFileAtomic(path, stringify({ modelRoles: roles }));
    } else {
      if (!isMap(doc.contents)) throw new Error(`${path} must contain a YAML mapping`);
      doc.set("modelRoles", roles);
      writeConfigFileAtomic(path, doc.toString());
    }
  });
}

export function readDisabledProviders(): Set<string> {
  const path = getSettingsPath();
  if (!existsSync(path)) return new Set();
  const doc = parseDocument(readFileSync(path, "utf8"));
  if (doc.errors.length > 0) throw new Error(`${path} is not valid YAML: ${doc.errors[0].message}`);
  const data = doc.toJS();
  if (!isRecord(data) || !Array.isArray(data.disabledProviders)) return new Set();
  return new Set(data.disabledProviders.filter((provider): provider is string => typeof provider === "string"));
}

/** Re-enable a provider after a successful native OMP login. */
export async function enableProvider(provider: string): Promise<void> {
  const configuredPath = getSettingsPath();
  if (!existsSync(configuredPath)) return;
  const path = resolveNativeConfigWritePath(configuredPath);
  await withNativeConfigLock(path, () => {
    if (!existsSync(path)) return;
    const doc = parseDocument(readFileSync(path, "utf8"));
    if (doc.errors.length > 0) throw new Error(`${path} is not valid YAML: ${doc.errors[0].message}`);
    if (!isMap(doc.contents)) throw new Error(`${path} must contain a YAML mapping`);
    const data = doc.toJS();
    const disabled = isRecord(data) && Array.isArray(data.disabledProviders)
      ? data.disabledProviders.filter((value): value is string => typeof value === "string")
      : [];
    const next = disabled.filter((value) => value !== provider);
    if (next.length === disabled.length) return;
    doc.set("disabledProviders", next);
    writeConfigFileAtomic(path, doc.toString());
  });
}
