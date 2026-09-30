"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { Button, ConfirmDialog, NumInput, SecretInput, Select, Switch, TextInput } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n";
import {
  NATIVE_SETTINGS_CATALOG,
  type NativeSettingDefinition,
  type NativeSettingsScope,
  type NativeSettingsSnapshot,
  type NativeSettingsUpdate,
} from "@/lib/omp/settings-catalog";

type Category = NativeSettingDefinition["category"];
type PendingMutation = { definition: NativeSettingDefinition; update: NativeSettingsUpdate };
export type NativeSettingsDrafts = Record<string, string>;

type Props = {
  categories?: readonly Category[];
  adminOnly?: boolean;
  cwd?: string | null;
  showScope?: boolean;
  focusPath?: string | null;
  excludeGlobalPaths?: readonly string[];
  drafts?: NativeSettingsDrafts;
  setDrafts?: Dispatch<SetStateAction<NativeSettingsDrafts>>;
  onApplied?: (path: string, effectiveValue: unknown) => void;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function getPath(root: Record<string, unknown>, path: string): { present: boolean; value: unknown } {
  let current: unknown = root;
  for (const segment of path.split(".")) {
    const record = objectValue(current);
    if (!record || !Object.prototype.hasOwnProperty.call(record, segment)) return { present: false, value: undefined };
    current = record[segment];
  }
  return { present: true, value: current };
}

function draftKey(scope: NativeSettingsScope, cwd: string | null | undefined, path: string): string {
  return `${scope}\u0000${cwd ?? ""}\u0000${path}`;
}

function patchAtPath(path: string, value: unknown): Record<string, unknown> {
  const segments = path.split(".");
  let result: Record<string, unknown> = { [segments[segments.length - 1]]: value };
  for (let index = segments.length - 2; index >= 0; index--) result = { [segments[index]]: result };
  return result;
}

function apiErrorMessage(value: unknown, fallback: string, path?: string): string {
  const envelope = objectValue(value);
  if (!envelope) return fallback;
  if (typeof envelope.error === "string") return envelope.error;
  const error = objectValue(envelope.error);
  if (!error) return fallback;
  if (path && Array.isArray(error.issues)) {
    for (const issueValue of error.issues) {
      const issue = objectValue(issueValue);
      if (issue?.path === path && typeof issue.message === "string") return issue.message;
    }
  }
  return typeof error.message === "string" ? error.message : fallback;
}

function displayValue(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

function parseDraft(definition: NativeSettingDefinition, draft: string): { value?: unknown; error?: string } {
  if (definition.kind === "string") return { value: draft };
  if (definition.kind === "number") {
    if (draft.trim() === "") return { error: "Enter a number." };
    const value = Number(draft);
    if (!Number.isFinite(value)) return { error: "Enter a valid number." };
    if (definition.integer && !Number.isInteger(value)) return { error: "Enter a whole number." };
    if (definition.min !== undefined && value < definition.min) return { error: `Minimum: ${definition.min}.` };
    if (definition.max !== undefined && value > definition.max) return { error: `Maximum: ${definition.max}.` };
    return { value };
  }
  try {
    const value: unknown = JSON.parse(draft);
    if (definition.kind === "array" && !Array.isArray(value)) return { error: "Enter a JSON array." };
    if (definition.kind === "object" && !objectValue(value)) return { error: "Enter a JSON object." };
    return { value };
  } catch {
    return { error: `Enter valid JSON for this ${definition.kind}.` };
  }
}

function localized(definition: NativeSettingDefinition, locale: string): { label: string; description: string; appliesTo?: string } {
  const language = locale === "ko" ? "ko" : "en";
  return {
    label: definition.label[language],
    description: definition.description[language],
    appliesTo: definition.appliesTo?.[language],
  };
}

const panelStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-card)",
  background: "var(--bg-panel)",
} as const;

export function NativeSettingsEditor({ categories, adminOnly = false, cwd, showScope = true, focusPath, excludeGlobalPaths = [], drafts: sharedDrafts, setDrafts: setSharedDrafts, onApplied }: Props) {
  const { locale, t } = useI18n();
  const [scope, setScope] = useState<NativeSettingsScope>("global");
  const [snapshot, setSnapshot] = useState<NativeSettingsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [localDrafts, setLocalDrafts] = useState<NativeSettingsDrafts>({});
  const drafts = sharedDrafts ?? localDrafts;
  const setDrafts = setSharedDrafts ?? setLocalDrafts;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [optimistic, setOptimistic] = useState<Record<string, unknown>>({});
  const [pending, setPending] = useState<PendingMutation | null>(null);
  const generationRef = useRef(0);
  const latestByPathRef = useRef<Record<string, number>>({});
  const mountedRef = useRef(true);
  const saveChainRef = useRef(Promise.resolve());

  const load = useCallback(async (nextScope: NativeSettingsScope) => {
    if (nextScope === "project" && !cwd) return;
    const generation = ++generationRef.current;
    setLoading(true);
    setLoadError(null);
    const params = new URLSearchParams({ scope: nextScope });
    if (nextScope === "project" && cwd) params.set("cwd", cwd);
    try {
      const response = await fetch(`/api/omp-settings?${params}`);
      const raw: unknown = await response.json();
      if (!response.ok) throw new Error(apiErrorMessage(raw, `HTTP ${response.status}`));
      const data = raw as NativeSettingsSnapshot;
      if (!mountedRef.current || generation !== generationRef.current) return;
      setSnapshot(data);
      setOptimistic({});
    } catch (reason) {
      if (mountedRef.current && generation === generationRef.current) setLoadError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (mountedRef.current && generation === generationRef.current) setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    mountedRef.current = true;
    void load(scope);
    return () => { mountedRef.current = false; };
  }, [load, scope]);

  const allDefinitions = snapshot?.catalog?.length ? snapshot.catalog : NATIVE_SETTINGS_CATALOG;
  const definitions = useMemo(() => allDefinitions.filter((definition) => {
    if (Boolean(definition.admin) !== adminOnly) return false;
    if (categories && !categories.includes(definition.category)) return false;
    if (scope === "global" && excludeGlobalPaths.includes(definition.path)) return false;
    const text = localized(definition, locale);
    const needle = query.trim().toLocaleLowerCase();
    return !needle || `${definition.path} ${definition.group} ${text.label} ${text.description}`.toLocaleLowerCase().includes(needle);
  }), [adminOnly, allDefinitions, categories, excludeGlobalPaths, locale, query, scope]);

  const issueByPath = useMemo(() => new Map((snapshot?.issues ?? []).map((issue) => [issue.path, issue.message])), [snapshot?.issues]);
  const hasRelevantIssues = useMemo(() => (snapshot?.issues ?? []).some((issue) => allDefinitions.some((definition) => definition.path === issue.path && Boolean(definition.admin) === adminOnly && (!categories || categories.includes(definition.category)))), [adminOnly, allDefinitions, categories, snapshot?.issues]);

  const groups = useMemo(() => {
    const grouped = new Map<string, NativeSettingDefinition[]>();
    for (const definition of definitions) {
      const key = `${definition.category}:${definition.group}`;
      const list = grouped.get(key);
      if (list) list.push(definition);
      else grouped.set(key, [definition]);
    }
    return [...grouped.entries()];
  }, [definitions]);

  useEffect(() => {
    if (focusPath) setQuery(focusPath);
  }, [focusPath]);

  const performUpdate = useCallback(async (definition: NativeSettingDefinition, update: NativeSettingsUpdate) => {
    const path = definition.path;
    const currentDraftKey = draftKey(scope, cwd, path);
    const proposed = getPath(update.settings ?? {}, path);
    if (proposed.present) setOptimistic((current) => ({ ...current, [path]: proposed.value }));
    const requestGeneration = ++generationRef.current;
    latestByPathRef.current[path] = requestGeneration;
    setSaving((current) => new Set(current).add(path));
    setErrors((current) => { const next = { ...current }; delete next[path]; return next; });
    saveChainRef.current = saveChainRef.current.then(async () => {
      try {
        const body: NativeSettingsUpdate = { ...update, scope };
        if (scope === "project" && cwd) body.cwd = cwd;
        const response = await fetch("/api/omp-settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const raw: unknown = await response.json();
        if (!response.ok) throw new Error(apiErrorMessage(raw, `HTTP ${response.status}`, path));
        const data = raw as NativeSettingsSnapshot;
        if (mountedRef.current && requestGeneration === generationRef.current) {
          setSnapshot(data);
          setOptimistic({});
        }
        const applied = getPath(data.effectiveSettings, path);
        if (mountedRef.current || setSharedDrafts) onApplied?.(path, applied.present ? applied.value : definition.defaultValue);
        if ((mountedRef.current || setSharedDrafts) && latestByPathRef.current[path] === requestGeneration) setDrafts((current) => { const next = { ...current }; delete next[currentDraftKey]; return next; });
      } catch (reason) {
        if (mountedRef.current && latestByPathRef.current[path] === requestGeneration) {
          setErrors((current) => ({ ...current, [path]: reason instanceof Error ? reason.message : String(reason) }));
          if (requestGeneration === generationRef.current) setOptimistic((current) => { const next = { ...current }; delete next[path]; return next; });
        }
      } finally {
        if (mountedRef.current && latestByPathRef.current[path] === requestGeneration) {
          setSaving((current) => { const next = new Set(current); next.delete(path); return next; });
        }
      }
    });
    await saveChainRef.current;
  }, [cwd, onApplied, scope, setDrafts, setSharedDrafts]);

  const submit = useCallback((definition: NativeSettingDefinition, update: NativeSettingsUpdate) => {
    if (definition.confirmation) {
      setPending({ definition, update: { ...update, confirm: [definition.path] } });
      return;
    }
    void performUpdate(definition, update);
  }, [performUpdate]);

  const commitValue = useCallback((definition: NativeSettingDefinition, value: unknown) => {
    submit(definition, definition.secret
      ? { secrets: { [definition.path]: typeof value === "string" ? value : null } }
      : { settings: patchAtPath(definition.path, value) });
  }, [submit]);

  const saveDraft = useCallback((definition: NativeSettingDefinition) => {
    const draft = drafts[draftKey(scope, cwd, definition.path)] ?? "";
    if (definition.secret) {
      if (!draft) {
        setErrors((current) => ({ ...current, [definition.path]: "Enter a replacement secret, or use Clear." }));
        return;
      }
      if (definition.kind === "object") {
        try {
          const parsed: unknown = JSON.parse(draft);
          if (!objectValue(parsed)) throw new Error("not an object");
        } catch {
          setErrors((current) => ({ ...current, [definition.path]: "Enter a valid JSON object." }));
          return;
        }
      }
      commitValue(definition, draft);
      return;
    }
    const parsed = parseDraft(definition, draft);
    if (parsed.error) {
      setErrors((current) => ({ ...current, [definition.path]: parsed.error! }));
      return;
    }
    commitValue(definition, parsed.value);
  }, [commitValue, cwd, drafts, scope]);

  if (loading && !snapshot) return <div role="status" style={{ padding: 16, color: "var(--text-muted)" }}>{t("nativeSettings.loading")}</div>;

  const currentDraftPrefix = `${scope}\u0000${cwd ?? ""}\u0000`;
  const hasCurrentDraft = Object.keys(drafts).some((key) => key.startsWith(currentDraftPrefix));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      {adminOnly && (
        <div role="note" style={{ ...panelStyle, display: "flex", gap: 10, padding: 12, borderColor: "var(--status-warning)", color: "var(--status-warning)" }}>
          <AlertTriangle size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
          <div><strong>{t("nativeSettings.administratorTitle")}</strong><div style={{ marginTop: 3, color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>{t("nativeSettings.administratorWarning")}</div></div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {showScope && (
          <Select
            aria-label={t("nativeSettings.settingsScope")}
            value={scope}
            onChange={(value) => setScope(value as NativeSettingsScope)}
            options={[{ value: "global", label: t("nativeSettings.global") }, { value: "project", label: cwd ? t("nativeSettings.project") : t("nativeSettings.projectUnavailable") }]}
            disabled={(!cwd && scope === "global") || hasCurrentDraft || saving.size > 0}
            style={{ width: 220 }}
          />
        )}
        <TextInput aria-label={t("nativeSettings.searchPlaceholder")} value={query} onChange={setQuery} placeholder={t("nativeSettings.searchPlaceholder")} style={{ flex: 1, minWidth: 220 }} />
      </div>
      <div role="note" style={{ color: "var(--text-dim)", fontSize: "var(--text-xs)", lineHeight: 1.4 }}>{t("nativeSettings.applicationNotice")}</div>
      {hasRelevantIssues && <div role="alert" style={{ ...panelStyle, padding: 10, borderColor: "var(--status-warning)", color: "var(--status-warning)", fontSize: "var(--text-sm)", lineHeight: 1.45 }}>{t("nativeSettings.storedValueWarning")}</div>}
      {scope === "project" && !cwd && <div role="alert" style={{ color: "var(--status-warning)", fontSize: "var(--text-sm)" }}>{t("nativeSettings.workspaceRequired")}</div>}
      {loadError && <div role="alert" style={{ color: "var(--danger)", fontSize: "var(--text-sm)" }}>{loadError} <Button size="sm" variant="secondary" onClick={() => void load(scope)}>{t("nativeSettings.retry")}</Button></div>}
      {!loadError && definitions.length === 0 && <div role="status" style={{ padding: 16, color: "var(--text-muted)" }}>{t("nativeSettings.noResults")}</div>}
      {groups.map(([groupKey, groupDefinitions]) => {
        const expanded = query.trim() !== "" || openGroups.has(groupKey);
        const first = groupDefinitions[0];
        return (
          <section key={groupKey} style={{ ...panelStyle, overflow: "hidden" }}>
            <button type="button" aria-expanded={expanded} onClick={() => setOpenGroups((current) => { const next = new Set(current); if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey); return next; })} className="ui-focus-ring" style={{ width: "100%", minHeight: 44, padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, border: 0, background: "var(--bg-panel)", color: "var(--text)", cursor: "pointer", textAlign: "left" }}>
              <span><strong>{first.group}</strong><span style={{ marginLeft: 8, color: "var(--text-dim)", fontSize: "var(--text-xs)" }}>{first.category} · {groupDefinitions.length}</span></span>
              {expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
            </button>
            {expanded && <div style={{ borderTop: "1px solid var(--border)" }}>{groupDefinitions.map((definition) => {
              const text = localized(definition, locale);
              const persisted = snapshot ? getPath(snapshot.settings, definition.path) : { present: false, value: undefined };
              const effectivePath = snapshot ? getPath(snapshot.effectiveSettings, definition.path) : { present: false, value: undefined };
              const effective = effectivePath.present ? effectivePath.value : definition.defaultValue;
              const value = Object.prototype.hasOwnProperty.call(optimistic, definition.path) ? optimistic[definition.path] : effective;
              const editValue = definition.kind === "object"
                ? persisted.present ? persisted.value : scope === "global" ? definition.defaultValue ?? {} : {}
                : value;
              const key = draftKey(scope, cwd, definition.path);
              return <SettingRow key={definition.path} definition={definition} label={text.label} description={text.description} appliesTo={text.appliesTo} value={value} editValue={editValue} persisted={persisted.present} configuredSecret={snapshot?.secretStatus[definition.path] ?? false} draft={drafts[key]} error={errors[definition.path]} storedIssue={issueByPath.get(definition.path)} saving={saving.has(definition.path)} disabled={scope === "project" && (!cwd || definition.scope === "global")} onDraft={(next) => setDrafts((current) => { const updated = { ...current }; if (next === (definition.secret ? "" : displayValue(editValue))) delete updated[key]; else updated[key] = next; return updated; })} onImmediate={(next) => commitValue(definition, next)} onSave={() => saveDraft(definition)} onReset={() => submit(definition, definition.secret ? { secrets: { [definition.path]: null } } : { reset: [definition.path] })} />;
            })}</div>}
          </section>
        );
      })}
      <ConfirmDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null); }} title={t("nativeSettings.confirmTitle")} description={pending ? t("nativeSettings.confirmDescription", { scope: t(scope === "global" ? "nativeSettings.global" : "nativeSettings.project"), path: pending.definition.path, value: pending.definition.secret ? (pending.update.secrets?.[pending.definition.path] === null ? t("nativeSettings.deleteSecret") : t("nativeSettings.replaceSecretHidden")) : pending.update.reset?.includes(pending.definition.path) ? t("nativeSettings.resetDestination") : displayValue(getPath(pending.update.settings ?? {}, pending.definition.path).value) }) : ""} confirmLabel={t("nativeSettings.applyChange")} cancelLabel={t("nativeSettings.cancel")} danger onConfirm={() => { const mutation = pending; setPending(null); if (mutation) void performUpdate(mutation.definition, mutation.update); }} />
    </div>
  );
}

function SettingRow({ definition, label, description, appliesTo, value, editValue, persisted, configuredSecret, draft, error, storedIssue, saving, disabled, onDraft, onImmediate, onSave, onReset }: {
  definition: NativeSettingDefinition;
  label: string;
  description: string;
  appliesTo?: string;
  value: unknown;
  editValue: unknown;
  persisted: boolean;
  configuredSecret: boolean;
  draft?: string;
  error?: string;
  storedIssue?: string;
  saving: boolean;
  disabled: boolean;
  onDraft: (value: string) => void;
  onImmediate: (value: unknown) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const initial = displayValue(editValue);
  const currentDraft = draft ?? (definition.secret ? "" : initial);
  const explicit = definition.kind === "string" || definition.kind === "number" || definition.kind === "array" || definition.kind === "object" || definition.secret;
  const dirty = draft !== undefined && currentDraft !== initial;
  let arrayValue = Array.isArray(value) ? value : [];
  if (definition.kind === "array" && draft !== undefined) {
    try {
      const parsed: unknown = JSON.parse(draft);
      if (Array.isArray(parsed)) arrayValue = parsed;
    } catch {
      // Keep the last valid value visible while preserving the invalid draft.
    }
  }
  const commonInput = (() => {
    if (definition.secret) return <SecretInput aria-label={label} value={currentDraft} onChange={onDraft} disabled={disabled || saving} multiline={definition.kind === "object"} placeholder={configuredSecret ? t("nativeSettings.secretReplacementPlaceholder") : t("nativeSettings.secretPlaceholder")} />;
    if (definition.kind === "boolean") return <Switch checked={value === true} onChange={onImmediate} disabled={disabled || saving} aria-label={label} />;
    if (definition.kind === "enum") return <Select value={typeof value === "string" ? value : displayValue(definition.defaultValue)} onChange={onImmediate} options={definition.choices ?? []} disabled={disabled || saving} aria-label={label} />;
    if (definition.kind === "number") return <NumInput aria-label={label} value={currentDraft} onChange={onDraft} disabled={disabled || saving} min={definition.min} max={definition.max} step={definition.step ?? (definition.integer ? 1 : undefined)} />;
    if (definition.kind === "string") return <TextInput aria-label={label} value={currentDraft} onChange={onDraft} disabled={disabled || saving} mono />;
    return null;
  })();

  return (
    <div data-setting-path={definition.path} style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 16, alignItems: "start" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}><strong style={{ fontSize: "var(--text-base)" }}>{label}</strong>{definition.admin && <span style={{ padding: "1px 6px", borderRadius: "var(--radius-control)", background: "color-mix(in srgb, var(--status-warning) 14%, transparent)", color: "var(--status-warning)", fontSize: "var(--text-xs)" }}>{t("nativeSettings.administratorTitle")}</span>}<code style={{ color: "var(--text-dim)", fontSize: "var(--text-xs)", overflowWrap: "anywhere" }}>{definition.path}</code></div>
        <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: "var(--text-sm)", lineHeight: 1.45 }}>{description}</div>
        {appliesTo && <div style={{ marginTop: 4, color: "var(--text-dim)", fontSize: "var(--text-xs)" }}>{appliesTo}</div>}
        <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", fontSize: "var(--text-xs)", color: "var(--text-dim)" }}><span style={storedIssue ? { color: "var(--status-warning)", fontWeight: 600 } : undefined}>{storedIssue ? t("nativeSettings.storedValueNeedsAttention") : t(persisted ? "nativeSettings.override" : "nativeSettings.inherited")}</span><span>•</span><span>{t(definition.scope === "global" ? "nativeSettings.globalOnly" : "nativeSettings.bothScopes")}</span>{configuredSecret && <><span>•</span><span>{t("nativeSettings.secretConfigured")}</span></>}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        {definition.secret ? commonInput : definition.kind === "array" && definition.items !== "object" ? <OrderedArrayEditor definition={definition} value={arrayValue} disabled={disabled || saving} onDraft={onDraft} /> : definition.kind === "array" || definition.kind === "object" ? <textarea aria-label={label} value={currentDraft} disabled={disabled || saving} onChange={(event) => onDraft(event.target.value)} rows={Math.min(12, Math.max(4, currentDraft.split("\n").length))} spellCheck={false} style={{ width: "100%", boxSizing: "border-box", resize: "vertical", padding: 10, border: `1px solid ${error ? "var(--danger)" : "var(--border)"}`, borderRadius: "var(--radius-control)", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }} /> : commonInput}
        {storedIssue && <div role="alert" style={{ color: "var(--status-warning)", fontSize: "var(--text-sm)", lineHeight: 1.4 }}>{storedIssue}</div>}
        {error && <div role="alert" style={{ color: "var(--danger)", fontSize: "var(--text-sm)" }}>{error}</div>}
        {saving && !explicit && <div role="status" style={{ color: "var(--text-dim)", fontSize: "var(--text-xs)" }}>{t("nativeSettings.saving")}</div>}
        <div style={{ display: "flex", gap: 7, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {explicit && <Button size="sm" disabled={disabled || saving || (!definition.secret && !dirty)} onClick={onSave}><Save size={13} aria-hidden="true" /> {saving ? t("nativeSettings.saving") : t(definition.secret && configuredSecret ? "nativeSettings.replace" : "nativeSettings.save")}</Button>}
          {(persisted || storedIssue || (definition.secret && configuredSecret)) && <Button size="sm" variant={definition.secret ? "danger" : "secondary"} disabled={disabled || saving} onClick={onReset}>{definition.secret ? <Trash2 size={13} aria-hidden="true" /> : <RotateCcw size={13} aria-hidden="true" />} {t(definition.secret ? "nativeSettings.clear" : "nativeSettings.reset")}</Button>}
        </div>
      </div>
    </div>
  );
}

function OrderedArrayEditor({ definition, value, disabled, onDraft }: { definition: NativeSettingDefinition; value: unknown[]; disabled: boolean; onDraft: (value: string) => void }) {
  const { t } = useI18n();
  const [candidate, setCandidate] = useState("");
  const update = (next: unknown[]) => onDraft(JSON.stringify(next, null, 2));
  const add = () => {
    if (!candidate.trim()) return;
    let item: string | number = candidate;
    if (definition.items === "number") {
      const parsed = Number(candidate);
      if (!Number.isFinite(parsed)) return;
      item = parsed;
    }
    update([...value, item]);
    setCandidate("");
  };
  return <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
    {value.map((item, index) => <div key={`${displayValue(item)}:${index}`} style={{ display: "flex", alignItems: "center", gap: 5 }}><code style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", fontSize: "var(--text-sm)" }}>{displayValue(item)}</code><Button size="sm" variant="secondary" disabled={disabled || index === 0} aria-label={`Move ${displayValue(item)} up`} onClick={() => { const next = [...value]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; update(next); }}><ChevronUp size={14} /></Button><Button size="sm" variant="secondary" disabled={disabled || index === value.length - 1} aria-label={`Move ${displayValue(item)} down`} onClick={() => { const next = [...value]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; update(next); }}><ChevronDown size={14} /></Button><Button size="sm" variant="secondary" disabled={disabled} aria-label={`Remove ${displayValue(item)}`} onClick={() => update(value.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></Button></div>)}
    <div style={{ display: "flex", gap: 7 }}><SelectOrInput definition={definition} value={candidate} onChange={setCandidate} disabled={disabled} /><Button size="sm" variant="secondary" disabled={disabled || !candidate.trim()} onClick={add}><Plus size={14} aria-hidden="true" /> {t("nativeSettings.add")}</Button></div>
  </div>;
}

function SelectOrInput({ definition, value, onChange, disabled }: { definition: NativeSettingDefinition; value: string; onChange: (value: string) => void; disabled: boolean }) {
  const label = `New item for ${definition.path}`;
  if (definition.choices?.length) return <Select aria-label={label} value={value} onChange={onChange} options={definition.choices} placeholder="Select item" disabled={disabled} />;
  if (definition.items === "number") return <NumInput aria-label={label} value={value} onChange={onChange} disabled={disabled} />;
  return <TextInput aria-label={label} value={value} onChange={onChange} disabled={disabled} />;
}
