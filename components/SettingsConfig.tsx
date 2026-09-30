"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getSubmitDuringRunBehavior, setSubmitDuringRunBehavior, type SubmitDuringRunBehavior } from "@/lib/composer-prefs";
import dynamic from "next/dynamic";
import { Copy, ExternalLink, RefreshCw, RotateCcw, Search, Monitor, Moon, Sun } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/primitives";
import { ConfirmDialog, Select, Switch } from "@/components/ui/field";
import { ExtensionsTabs, type ExtensionsTab, SettingsTabs, type SettingsTab, SETTINGS_CATEGORIES, getNormalizedActive } from "./SettingsTabs";
import { useI18n } from "@/lib/i18n";
import { copyText } from "@/lib/clipboard";
import { parseDaemonStatus, type DaemonAction, type DaemonStatus } from "@/lib/daemon-types";
import { useTheme } from "@/hooks/useTheme";
import { getSoundEnabled, setSoundEnabled as persistSoundEnabled } from "@/lib/sound-prefs";
import { useHideThinking } from "@/hooks/useHideThinking";
import { setHideThinking } from "@/lib/thinking-preference";
import { NATIVE_SETTINGS_CATALOG } from "@/lib/omp/settings-catalog";
import type { NativeSettingsDrafts } from "./NativeSettingsEditor";

const MODEL_MANAGER_GLOBAL_PATHS = ["enabledModels", "disabledProviders", "modelProviderOrder", "modelRoles"] as const;
const AGENT_MANAGER_GLOBAL_PATHS = ["task.disabledAgents", "task.agentModelOverrides", "task.agentPrewalk", "task.agentAdvisor"] as const;

const SettingsTabLoading = () => <div role="status" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>Loading settings…</div>;
const NativeSettingsEditor = dynamic(() => import("./NativeSettingsEditor").then((module) => module.NativeSettingsEditor), { loading: SettingsTabLoading });
const ModelsConfig = dynamic(() => import("./ModelsConfig").then((module) => module.ModelsConfig), { loading: SettingsTabLoading });
const SkillsConfig = dynamic(() => import("./SkillsConfig").then((module) => module.SkillsConfig), { loading: SettingsTabLoading });
const PluginsConfig = dynamic(() => import("./PluginsConfig").then((module) => module.PluginsConfig), { loading: SettingsTabLoading });
const McpConfig = dynamic(() => import("./McpConfig").then((module) => module.McpConfig), { loading: SettingsTabLoading });
const AgentsConfig = dynamic(() => import("./AgentsConfig").then((m) => m.AgentsConfig), { ssr: false });
const RelayPairPanel = dynamic(() => import("./RelayPairPanel").then((module) => module.RelayPairPanel), { loading: SettingsTabLoading });

type UpdateState = {
  currentVersion: string | null;
  availableVersion: string | null;
  updateAvailable: boolean;
  updateCommand?: string;
  lookupFailed?: boolean;
};

const chipStyle = {
  fontSize: "var(--text-xs)",
  padding: "1px 6px",
  borderRadius: "calc(var(--radius-control) / 2)",
  background: "var(--bg-subtle)",
  color: "var(--text-muted)",
  fontWeight: 500,
} as const;

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const SettingsHighlightContext = createContext<string | null>(null);

type SearchResult = {
  id: string;
  kind: "category" | "setting";
  tab: SettingsTab;
  label: string;
  description: string;
  scope?: string;
  section?: string;
  path?: string;
};

const CATALOG_CATEGORY_TAB = {
  models: "models",
  intelligence: "intelligence",
  agents: "agents",
  tools: "extensions",
  safety: "safety",
  system: "system",
} as const satisfies Record<string, SettingsTab>;

type SettingIndexEntry = {
  tab: SettingsTab;
  section: string;
  label: string;
  description: string;
  labelKey?: string;
  descriptionKey?: string;
  sectionKey?: string;
  scope?: "UI" | "New sessions" | "Workspace";
};

// NOTE: This index mirrors the <NativeSetting label=...> cards rendered in the
// panels below. Search matches against this index and jumps via slugify(label),
// so keep labels/descriptions in sync when editing the settings UI.
const SETTING_INDEX: SettingIndexEntry[] = [
  { tab: "relay", section: "Connect Phone", label: "Pair phone via Relay", description: "Create a QR or link so ompgui Remote can connect over Relay.", scope: "UI", labelKey: "relayPair.title", descriptionKey: "relayPair.description", sectionKey: "settingsTabs.relay" },
  { tab: "general", section: "Appearance", label: "Color mode", description: "Choose between light, dark, or system color mode.", scope: "UI" },
  { tab: "general", section: "Appearance", label: "Theme palette", description: "Select the interface color palette.", scope: "UI" },
  { tab: "general", section: "Interface & Behavior", label: "Keep tool calls collapsed", description: "Show compact headers while tools execute.", scope: "UI" },
  { tab: "general", section: "Interface & Behavior", label: "Completion sound", description: "Play a tone when the agent completes a run.", scope: "UI" },
  { tab: "general", section: "Interface & Behavior", label: "Message during active run", description: "Choose whether a submission steers the current run or queues a follow-up.", scope: "UI" },
  { tab: "general", section: "Interface & Behavior", label: "Thinking Blocks", description: "Hide assistant reasoning on this device while keeping final answers visible.", scope: "UI", labelKey: "settingsConfig.hideThinking", descriptionKey: "settingsConfig.hideThinkingDesc" },
  { tab: "system", section: "System & Updates", label: "Background service", description: "Manage the background service and automatic start at login.", labelKey: "daemon.title", descriptionKey: "daemon.description", sectionKey: "settingsConfig.systemUpdates" },
  { tab: "system", section: "System & Updates", label: "Active session system prompt", description: "Inspect the system prompt used by the active session.", labelKey: "settingsConfig.sessionSystemPrompt", descriptionKey: "settingsConfig.sessionSystemPromptDescription", sectionKey: "settingsConfig.systemUpdates" },
];

function SearchResultsList({ results, query, onSelect }: { results: SearchResult[]; query: string; onSelect: (result: SearchResult) => void }) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "var(--bg)", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: "var(--text-base)", color: "var(--text-muted)" }}>
        {results.length === 0 ? `No settings match “${query}”.` : `${results.length} result${results.length === 1 ? "" : "s"} for “${query}”.`}
      </div>
      {results.map((result) => (
        <button
          key={result.id}
          type="button"
          onClick={() => onSelect(result)}
          style={{
            textAlign: "left",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: "10px 12px",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-card)",
            background: "var(--bg-panel)",
            color: "var(--text)",
            cursor: "pointer",
            transition: "border-color var(--dur-fast) var(--ease-out-warm), background var(--dur-fast) var(--ease-out-warm)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: "var(--text-base)", fontWeight: 600 }}>{result.label}</span>
            {result.kind === "category" && (
              <span style={chipStyle}>Section</span>
            )}
            {result.scope && (
              <span style={chipStyle}>{result.scope}</span>
            )}
          </div>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", lineHeight: 1.45 }}>{result.description}</div>
          {result.section && <div style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>{result.section}</div>}
        </button>
      ))}
    </div>
  );
}

function NativeSetting({ label, description, scope, compact = false, hideDescription = false, children }: { label: string; description: string; scope?: "UI" | "New sessions" | "Workspace"; compact?: boolean; hideDescription?: boolean; children: ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const highlightId = useContext(SettingsHighlightContext);
  const highlighted = highlightId !== null && highlightId === slugify(label);

  useEffect(() => {
    if (highlighted && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlighted]);

  return (
    <div
      ref={ref}
      data-search-id={slugify(label)}
      style={{
        minWidth: 0,
        padding: compact ? "8px 10px" : "12px 14px",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-card)",
        background: "var(--bg-panel)",
        display: "flex",
        flexDirection: "column",
        gap: compact ? 4 : 8,
        transition: "box-shadow var(--dur-fast) var(--ease-out-warm), border-color var(--dur-fast) var(--ease-out-warm)",
        ...(highlighted ? { borderColor: "var(--accent)", boxShadow: "0 0 0 2px var(--accent)" } : {}),
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: "var(--text-base)", fontWeight: 600, color: "var(--text)" }}>{label}</span>
          {scope && (
            <span style={chipStyle}>
              {scope === "New sessions" ? t("settingsConfig.newSessions") : scope}
            </span>
          )}
        </div>
        <span style={{ flexShrink: 0 }}>{children}</span>
      </div>
      {!hideDescription && (
        <span style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", lineHeight: compact ? 1.3 : 1.45 }}>{description}</span>
      )}
    </div>
  );
}

export function SettingsConfig({ activeTab, onAdvisorChange, toolCallsDefaultCollapsed, onToolCallsDefaultCollapsedChange, cwd, sessionId, systemPrompt, systemPromptLoading, onLoadSystemPrompt, onModelsSaved, onPluginsReloaded, onOmpSessionsRestarted, onOmpUpdateAvailabilityChange, onAppUpdateAvailabilityChange, onSelectTab, onClose, runtimeReady }: {
  activeTab: SettingsTab;
  onAdvisorChange: (enabled: boolean) => void;
  toolCallsDefaultCollapsed: boolean;
  onToolCallsDefaultCollapsedChange: (collapsed: boolean) => void;
  cwd?: string | null;
  sessionId?: string | null;
  systemPrompt: string | null;
  systemPromptLoading: boolean;
  onLoadSystemPrompt: () => void;
  onModelsSaved: () => void;
  onPluginsReloaded: () => void;
  onOmpSessionsRestarted: () => void;
  onOmpUpdateAvailabilityChange?: (available: boolean) => void;
  onAppUpdateAvailabilityChange?: (available: boolean) => void;
  onSelectTab: (tab: SettingsTab) => void;
  onClose: () => void;
  runtimeReady?: boolean;
}) {
  const { t, locale } = useI18n();
  const isMobile = useIsMobile();
  const [currentTab, setCurrentTab] = useState<SettingsTab>(getNormalizedActive(activeTab));
  const [extensionTab, setExtensionTab] = useState<ExtensionsTab>(() => {
    if (activeTab === "mcp" || activeTab === "skills" || activeTab === "plugins") return activeTab;
    return "tools";
  });
  const [visitedTabs, setVisitedTabs] = useState<Set<SettingsTab>>(() => new Set([getNormalizedActive(activeTab)]));
  const [modelsDirty, setModelsDirty] = useState(false);
  const [nativeDrafts, setNativeDrafts] = useState<NativeSettingsDrafts>({});
  const nativeDraftCwdRef = useRef(cwd);
  const hasUnsavedChanges = modelsDirty || Object.keys(nativeDrafts).length > 0;
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [modelsEditorKey, setModelsEditorKey] = useState(0);

  const [daemon, setDaemon] = useState<DaemonStatus | null>(null);
  const [daemonBusy, setDaemonBusy] = useState(false);
  const [daemonError, setDaemonError] = useState<string | null>(null);
  const [daemonPending, setDaemonPending] = useState<{ action: DaemonAction; pid: number | null; deadline: number } | null>(null);
  const [daemonConfirm, setDaemonConfirm] = useState<DaemonAction | null>(null);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [checking, setChecking] = useState(false);
  const [appUpdate, setAppUpdate] = useState<UpdateState | null>(null);
  const [checkingAppUpdate, setCheckingAppUpdate] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [appUpdateError, setAppUpdateError] = useState(false);
  const ompCheckRef = useRef(0);
  const appCheckRef = useRef(0);
  const ompCheckInFlightRef = useRef(false);
  const appCheckInFlightRef = useRef(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [submitBehavior, setSubmitBehavior] = useState<SubmitDuringRunBehavior>("steer");
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightSettingId, setHighlightSettingId] = useState<string | null>(null);

  const { preference, setTheme, palette, setPalette } = useTheme();
  const hideThinking = useHideThinking();
  const mountedRef = useRef(true);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setSoundEnabled(getSoundEnabled());
    setSubmitBehavior(getSubmitDuringRunBehavior());
  }, []);

  useEffect(() => {
    if (nativeDraftCwdRef.current === cwd) return;
    nativeDraftCwdRef.current = cwd;
    setNativeDrafts({});
  }, [cwd]);

  const requestAction = useCallback((action: () => void) => {
    if (hasUnsavedChanges) {
      setPendingAction(() => action);
      setDiscardDialogOpen(true);
      return;
    }
    action();
  }, [hasUnsavedChanges]);

  const requestClose = useCallback(() => {
    requestAction(() => {
      onClose();
    });
  }, [onClose, requestAction]);

  const requestTabChange = useCallback((tab: SettingsTab | ExtensionsTab) => {
    if (tab === "tools" || tab === "mcp" || tab === "skills" || tab === "plugins") {
      requestAction(() => {
        setCurrentTab("extensions");
        setExtensionTab(tab);
        setVisitedTabs((prev) => new Set([...prev, "extensions"]));
        onSelectTab(tab);
      });
      return;
    }
    requestAction(() => {
      const normalized = getNormalizedActive(tab);
      setCurrentTab(normalized);
      setVisitedTabs((prev) => new Set([...prev, normalized]));
      onSelectTab(normalized);
    });
  }, [onSelectTab, requestAction]);

  const confirmDiscard = useCallback(() => {
    setModelsDirty(false);
    setNativeDrafts({});
    setModelsEditorKey((prev) => prev + 1);
    setDiscardDialogOpen(false);
    const action = pendingAction;
    setPendingAction(null);
    if (action) {
      action();
    }
  }, [pendingAction]);

  useEffect(() => {
    const normalized = getNormalizedActive(activeTab);
    setCurrentTab(normalized);
    if (activeTab === "tools" || activeTab === "mcp" || activeTab === "skills" || activeTab === "plugins") {
      setExtensionTab(activeTab);
    }
    setVisitedTabs((prev) => new Set([...prev, normalized]));
  }, [activeTab]);

  const checkForUpdate = useCallback(async (manual = false) => {
    if (!manual && ompCheckInFlightRef.current) return;
    const requestId = ++ompCheckRef.current;
    ompCheckInFlightRef.current = true;
    setChecking(true);
    if (manual) {
      setMessage(null);
    }
    try {
      const response = await fetch("/api/omp-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check" }),
      });
      if (!response.ok) {
        throw new Error("Failed to check OMP updates");
      }
      const data = await response.json() as UpdateState;
      if (requestId !== ompCheckRef.current || !mountedRef.current) return;
      setUpdate(data);
      if (onOmpUpdateAvailabilityChange && typeof data.updateAvailable === "boolean") {
        onOmpUpdateAvailabilityChange(data.updateAvailable);
      }
      if (!data.updateAvailable) {
        setMessage(t("settingsConfig.upToDate", { version: data.currentVersion ?? "current" }));
      }
    } catch {
      if (requestId !== ompCheckRef.current || !mountedRef.current) return;
      setMessage(t("settingsConfig.updateCheckFailed"));
    } finally {
      if (requestId === ompCheckRef.current) {
        ompCheckInFlightRef.current = false;
        if (mountedRef.current) {
          setChecking(false);
        }
      }
    }
  }, [onOmpUpdateAvailabilityChange, t]);

  const checkForAppUpdate = useCallback(async (manual = false) => {
    if (!manual && appCheckInFlightRef.current) return;
    const requestId = ++appCheckRef.current;
    appCheckInFlightRef.current = true;
    setCheckingAppUpdate(true);
    if (manual) {
      setMessage(null);
      setAppUpdateError(false);
    }
    try {
      const response = await fetch(manual ? "/api/app-update?force=1" : "/api/app-update");
      if (!response.ok) {
        throw new Error("Failed to check ompgui updates");
      }
      const data = await response.json() as UpdateState;
      if (requestId !== appCheckRef.current || !mountedRef.current) return;
      setAppUpdate(data);
      if (data.lookupFailed) {
        if (manual) {
          setAppUpdateError(true);
          setMessage(t("settingsConfig.appUpdateCheckFailed"));
        }
        return;
      }
      if (onAppUpdateAvailabilityChange && typeof data.updateAvailable === "boolean") {
        onAppUpdateAvailabilityChange(data.updateAvailable);
      }
      setAppUpdateError(false);
      if (manual) {
        if (data.updateAvailable) {
          setMessage(null);
        } else {
          setMessage(t("settingsConfig.upToDate", { version: data.currentVersion ?? "current" }));
        }
      }
    } catch {
      if (requestId !== appCheckRef.current || !mountedRef.current) return;
      if (manual) {
        setAppUpdateError(true);
        setMessage(t("settingsConfig.appUpdateCheckFailed"));
      }
    } finally {
      if (requestId === appCheckRef.current) {
        appCheckInFlightRef.current = false;
        if (mountedRef.current) {
          setCheckingAppUpdate(false);
        }
      }
    }
  }, [onAppUpdateAvailabilityChange, t]);

  useEffect(() => {
    if (currentTab === "system") {
      void checkForUpdate();
      void checkForAppUpdate(false);
    }
  }, [currentTab, checkForUpdate, checkForAppUpdate]);

  const refreshDaemon = useCallback(async () => {
    setDaemonBusy(true);
    setDaemonError(null);
    try {
      const response = await fetch("/api/daemon", { cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(t("daemon.unavailable"));
      const status = parseDaemonStatus(await response.json());
      if (mountedRef.current) setDaemon(status);
    } catch (error) {
      if (mountedRef.current) setDaemonError(error instanceof Error ? error.message : t("daemon.unavailable"));
    } finally {
      if (mountedRef.current) setDaemonBusy(false);
    }
  }, [t]);

  useEffect(() => {
    if (currentTab === "system") void refreshDaemon();
  }, [currentTab, refreshDaemon]);

  useEffect(() => {
    if (!daemonPending) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch("/api/daemon", { cache: "no-store", signal: AbortSignal.timeout(4000) });
        if (response.ok) {
          const status = parseDaemonStatus(await response.json());
          if (cancelled) return;
          setDaemon(status);
          const complete = daemonPending.action === "restart"
            ? status.running && status.pid !== daemonPending.pid
            : daemonPending.action === "uninstall" ? !status.installed : !status.running;
          if (complete) { setDaemonPending(null); setDaemonError(status.error ?? null); return; }
        }
      } catch { /* The managed server may be offline while launchd restarts it. */ }
      if (cancelled) return;
      if (Date.now() >= daemonPending.deadline) {
        setDaemonPending(null);
        setDaemon(null);
        setDaemonError(t("daemon.readbackFailed"));
        return;
      }
      timer = window.setTimeout(() => void poll(), 2000);
    };
    timer = window.setTimeout(() => void poll(), 2000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [daemonPending, t]);

  const runDaemonAction = useCallback(async (action: DaemonAction) => {
    setDaemonBusy(true);
    setDaemonError(null);
    setDaemonConfirm(null);
    const mayDisconnect = action === "restart" || action === "stop" || action === "uninstall";
    let rejected = false;
    try {
      const response = await fetch("/api/daemon", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }), signal: AbortSignal.timeout(20_000),
      });
      // An HTTP rejection is definitive even when its body is interrupted or invalid.
      rejected = !response.ok;
      const body: unknown = await response.json();
      if (!response.ok) {
        throw new Error(typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : t("daemon.actionFailed"));
      }
      if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" && body.error) {
        rejected = true;
        throw new Error(body.error);
      }
      const status = parseDaemonStatus(body);
      if (!mountedRef.current) return;
      setDaemon(status);
      if (status.accepted) setDaemonPending({ action, pid: daemon?.pid ?? null, deadline: Date.now() + 60_000 });
      else await refreshDaemon();
    } catch (error) {
      if (!mountedRef.current) return;
      setDaemonError(error instanceof Error ? error.message : t("daemon.actionFailed"));
      // Only an uncertain transport response warrants readback; explicit rejection stays actionable.
      if (mayDisconnect && !rejected) setDaemonPending({ action, pid: daemon?.pid ?? null, deadline: Date.now() + 60_000 });
    } finally {
      if (mountedRef.current) setDaemonBusy(false);
    }
  }, [daemon?.pid, refreshDaemon, t]);

  const restartSessions = useCallback(async () => {
    setRestarting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/omp-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restart" }),
      });
      if (!response.ok) {
        throw new Error("Failed to restart sessions");
      }
      setMessage(t("settingsConfig.sessionsRestarted"));
      onOmpSessionsRestarted();
    } catch {
      setMessage(t("settingsConfig.restartFailed"));
    } finally {
      setRestarting(false);
    }
  }, [onOmpSessionsRestarted, t]);

  const searchResults: SearchResult[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];

    const results: SearchResult[] = [];

    // Search tabs/categories
    for (const cat of SETTINGS_CATEGORIES) {
      const localizedLabel = t(`settingsTabs.${cat.id}`) || cat.label;
      const localizedDesc = t(`settingsTabs.${cat.id}Desc`) || cat.description;
      if (localizedLabel.toLowerCase().includes(q) || localizedDesc.toLowerCase().includes(q) || cat.id.toLowerCase().includes(q)) {
        results.push({
          id: `cat-${cat.id}`,
          kind: "category",
          tab: cat.id,
          label: localizedLabel,
          description: localizedDesc,
        });
      }
    }

    // Search settings entries
    for (const entry of SETTING_INDEX) {
      const localizedLabel = (entry.labelKey ? t(entry.labelKey) : null) || entry.label;
      const localizedDesc = (entry.descriptionKey ? t(entry.descriptionKey) : null) || entry.description;
      const localizedSection = (entry.sectionKey ? t(entry.sectionKey) : null) || entry.section;
      if (localizedLabel.toLowerCase().includes(q) || localizedDesc.toLowerCase().includes(q) || localizedSection.toLowerCase().includes(q)) {
        results.push({
          id: `setting-${entry.tab}-${slugify(entry.label)}`,
          kind: "setting",
          tab: entry.tab,
          label: localizedLabel,
          description: localizedDesc,
          scope: entry.scope,
          section: localizedSection,
        });
      }
    }

    for (const definition of NATIVE_SETTINGS_CATALOG) {
      const language = locale === "ko" ? "ko" : "en";
      const label = definition.label[language];
      const description = definition.description[language];
      const text = `${definition.path} ${definition.group} ${label} ${description}`.toLowerCase();
      if (!text.includes(q)) continue;
      results.push({
        id: `catalog-${definition.path}`,
        kind: "setting",
        tab: definition.admin ? "safety" : MODEL_MANAGER_GLOBAL_PATHS.some((path) => path === definition.path) ? "providers" : CATALOG_CATEGORY_TAB[definition.category],
        label,
        description,
        scope: definition.scope === "global" ? "Global" : "Global / project",
        section: definition.admin ? "Administrator settings" : definition.group,
        path: definition.path,
      });
    }

    return results;
  }, [locale, searchQuery, t]);

  const handleSelectSearchResult = useCallback((result: SearchResult) => {
    setSearchQuery("");
    requestTabChange(result.tab);
    if (result.tab === "extensions") setExtensionTab("tools");
    if (result.kind === "setting") {
      setHighlightSettingId(result.path ?? slugify(result.label));
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => {
        highlightTimerRef.current = null;
        setHighlightSettingId(null);
      }, 2500);
    }
  }, [requestTabChange]);

  return (
    <>
      <Dialog open={true} onOpenChange={(open) => { if (!open) requestClose(); }}>
        <DialogContent
          ariaLabel={t("settingsConfig.title")}
          style={{
            width: 860,
            maxWidth: "96vw",
            height: isMobile ? "92dvh" : "80vh",
            maxHeight: "92dvh",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            padding: 0,
            borderRadius: "var(--radius-modal)",
            boxShadow: "var(--shadow-modal)",
            background: "var(--bg)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: isMobile ? "12px 14px" : "16px 20px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <DialogTitle style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 650, whiteSpace: "nowrap" }}>{t("settingsConfig.title")}</DialogTitle>
              {hasUnsavedChanges && (
                <span style={{ fontSize: "var(--text-xs)", padding: "2px 6px", borderRadius: "calc(var(--radius-control) / 2)", background: "var(--status-warning-bg)", color: "var(--status-warning)", border: "1px solid var(--status-warning-border)" }}>
                  {t("settingsConfig.unsavedChanges")}
                </span>
              )}
            </div>

            {/* Search input */}
            <div style={{ position: "relative", flex: 1, maxWidth: 280, minWidth: 120 }}>
              <Search size={13} aria-hidden="true" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-dim)", pointerEvents: "none" }} />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("settingsConfig.searchPlaceholder")}
                aria-label={t("settingsConfig.searchPlaceholder")}
                style={{
                  width: "100%",
                  height: 28,
                  padding: "0 8px 0 28px",
                  borderRadius: "var(--radius-control)",
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: "var(--text)",
                  fontSize: "var(--text-sm)",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
          </div>

          <div style={{ display: "flex", flex: 1, minHeight: 0, flexDirection: isMobile ? "column" : "row" }}>
            {searchQuery.trim() ? (
              <SearchResultsList results={searchResults} query={searchQuery.trim()} onSelect={handleSelectSearchResult} />
            ) : (
              <SettingsHighlightContext.Provider value={highlightSettingId}>
                <SettingsTabs active={currentTab} onSelect={requestTabChange} layout={isMobile ? "horizontal" : "vertical"} />
                <div style={{ flex: 1, minWidth: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
            {/* RELAY / CONNECT PHONE TAB */}
            {currentTab === "relay" && (
              <div role="tabpanel" id="settings-panel-relay" aria-labelledby="settings-tab-relay" style={{ padding: isMobile ? "12px 14px" : 20, display: "flex", flexDirection: "column", gap: 16 }}>
                <RelayPairPanel embedded />
              </div>
            )}
            {/* GENERAL TAB */}
            {currentTab === "general" && (
              <div role="tabpanel" id="settings-panel-general" aria-labelledby="settings-tab-general" style={{ padding: isMobile ? "12px 14px" : 20, display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <h3 style={{ fontSize: "var(--text-base)", fontWeight: 600, margin: 0 }}>{t("settingsConfig.generalTitle")}</h3>
                  <p style={{ margin: "4px 0 0", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{t("settingsConfig.generalDescription")}</p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <NativeSetting label={t("settingsConfig.themeMode")} description={t("settingsConfig.themeModeDesc")} scope="UI">
                    <div style={{ display: "inline-flex", padding: 2, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", gap: 2 }}>
                      {(["system", "light", "dark"] as const).map((mode) => {
                        const selected = preference === mode;
                        const Icon = mode === "system" ? Monitor : mode === "light" ? Sun : Moon;
                        const label = mode === "system" ? t("settingsConfig.themeModeSystem") : mode === "light" ? t("settingsConfig.themeModeLight") : t("settingsConfig.themeModeDark");
                        return (
                          <button
                            key={mode}
                            type="button"
                            aria-label={label}
                            aria-pressed={selected}
                            onClick={() => setTheme(mode)}
                            title={label}
                            className="ui-focus-ring"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              height: 24,
                              padding: "0 8px",
                              border: "none",
                              borderRadius: "calc(var(--radius-control) - var(--space-1))",
                              background: selected ? "var(--bg-selected)" : "transparent",
                              color: selected ? "var(--text)" : "var(--text-muted)",
                              fontWeight: selected ? 600 : 500,
                              fontSize: "var(--text-sm)",
                              cursor: "pointer",
                              transition: "background var(--dur-fast) var(--ease-out-warm), color var(--dur-fast) var(--ease-out-warm)",
                            }}
                          >
                            <Icon size={12} aria-hidden="true" />
                            <span>{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </NativeSetting>
                  <NativeSetting label={t("settingsConfig.themePalette")} description={t("settingsConfig.themePaletteDesc")} scope="UI">
                    <div style={{ display: "inline-flex", padding: 2, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", gap: 2 }}>
                      {(["warm", "omp"] as const).map((pal) => {
                        const selected = palette === pal;
                        const label = pal === "warm" ? t("settingsConfig.paletteWarm") : t("settingsConfig.paletteOmp");
                        return (
                          <button
                            key={pal}
                            type="button"
                            aria-label={label}
                            aria-pressed={selected}
                            onClick={() => setPalette(pal)}
                            title={label}
                            className="ui-focus-ring"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              height: 24,
                              padding: "0 8px",
                              border: "none",
                              borderRadius: "calc(var(--radius-control) - var(--space-1))",
                              background: selected ? "var(--bg-selected)" : "transparent",
                              color: selected ? "var(--text)" : "var(--text-muted)",
                              fontWeight: selected ? 600 : 500,
                              fontSize: "var(--text-sm)",
                              cursor: "pointer",
                              transition: "background var(--dur-fast) var(--ease-out-warm), color var(--dur-fast) var(--ease-out-warm)",
                            }}
                          >
                            <span
                              aria-hidden="true"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 2.5,
                                padding: "2px 3px",
                                borderRadius: "calc(var(--radius-control) / 2)",
                                background: "var(--bg-subtle)",
                                flexShrink: 0,
                              }}
                            >
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: `var(--palette-${pal}-preview-bg)`, border: "1px solid var(--border)", flexShrink: 0 }} />
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: `var(--palette-${pal}-preview-panel)`, border: "1px solid var(--border)", flexShrink: 0 }} />
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: `var(--palette-${pal}-preview-accent)`, flexShrink: 0 }} />
                            </span>
                            <span>{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </NativeSetting>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <NativeSetting label={t("settingsConfig.toolCallsCollapsed")} description={t("settingsConfig.toolCallsCollapsedDesc")} scope="UI">
                    <Switch
                      checked={toolCallsDefaultCollapsed}
                      onChange={(collapsed: boolean) => onToolCallsDefaultCollapsedChange(collapsed)}
                      aria-label={t("settingsConfig.toolCallsCollapsed")}
                    />
                  </NativeSetting>
                  <NativeSetting label={t("settingsConfig.hideThinking")} description={t("settingsConfig.hideThinkingDesc")} scope="UI">
                    <Switch checked={hideThinking} onChange={setHideThinking} aria-label={t("settingsConfig.hideThinking")} />
                  </NativeSetting>
                  <NativeSetting label={t("settingsConfig.completionSound")} description={t("settingsConfig.completionSoundDesc")} scope="UI">
                    <Switch
                      checked={soundEnabled}
                      onChange={(next: boolean) => {
                        setSoundEnabled(next);
                        persistSoundEnabled(next);
                        window.dispatchEvent(new CustomEvent("omp-sound-pref-change", { detail: next }));
                      }}
                      aria-label={t("settingsConfig.completionSound")}
                    />
                  </NativeSetting>
                </div>
                <NativeSetting label={t("settingsConfig.submitBehavior")} description={t("settingsConfig.submitBehaviorDesc")} scope="UI">
                  <Select
                    value={submitBehavior}
                    onChange={(value: string) => {
                      const next = value as SubmitDuringRunBehavior;
                      setSubmitDuringRunBehavior(next);
                      setSubmitBehavior(next);
                    }}
                    required
                    options={[
                      { value: "steer", label: t("settingsConfig.steerCurrent") },
                      { value: "queue", label: t("settingsConfig.queueFollowUp") },
                    ]}
                    aria-label={t("settingsConfig.submitBehavior")}
                  />
                </NativeSetting>
              </div>
            )}

            {currentTab === "agents" && (
              <div
                role="tabpanel"
                id="settings-panel-agents"
                aria-labelledby="settings-tab-agents"
                style={{ padding: isMobile ? "12px 14px" : 20, display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}
              >
                <NativeSettingsEditor drafts={nativeDrafts} setDrafts={setNativeDrafts} categories={["agents"]} cwd={cwd} focusPath={highlightSettingId} excludeGlobalPaths={AGENT_MANAGER_GLOBAL_PATHS} onApplied={(path, value) => { if (path === "advisor.enabled" && typeof value === "boolean") onAdvisorChange(value); }} />
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                  <div style={{ marginBottom: 10, color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>{t("nativeSettings.agentManagerScope")}</div>
                  <AgentsConfig cwd={cwd ?? undefined} onSaved={onModelsSaved} />
                </div>
              </div>
            )}

            {/* SAFETY & APPROVALS TAB */}
            {currentTab === "safety" && (
              <div role="tabpanel" id="settings-panel-safety" aria-labelledby="settings-tab-safety" style={{ padding: isMobile ? "12px 14px" : 20, display: "flex", flexDirection: "column", gap: 18 }}>
                <div>
                  <h3 style={{ fontSize: "var(--text-base)", fontWeight: 600, margin: 0 }}>{t("settingsConfig.safetyTitle")}</h3>
                  <p style={{ margin: "4px 0 0", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{t("settingsConfig.safetyDescription")}</p>
                </div>
                <NativeSettingsEditor drafts={nativeDrafts} setDrafts={setNativeDrafts} categories={["safety"]} cwd={cwd} focusPath={highlightSettingId} />
                <NativeSettingsEditor drafts={nativeDrafts} setDrafts={setNativeDrafts} adminOnly cwd={cwd} focusPath={highlightSettingId} />
              </div>
            )}

            {/* AI MODEL DEFAULTS TAB */}
            {currentTab === "models" && (
              <div role="tabpanel" id="settings-panel-models" aria-labelledby="settings-tab-models" style={{ padding: isMobile ? "12px 14px" : 20, display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <h3 style={{ fontSize: "var(--text-base)", fontWeight: 600, margin: 0 }}>{t("settingsConfig.modelsTitle")}</h3>
                  <p style={{ margin: "4px 0 0", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{t("settingsConfig.modelsDescription")}</p>
                </div>
                <NativeSettingsEditor drafts={nativeDrafts} setDrafts={setNativeDrafts} categories={["models"]} cwd={cwd} focusPath={highlightSettingId} excludeGlobalPaths={MODEL_MANAGER_GLOBAL_PATHS} />
              </div>
            )}

            {/* API KEYS & PROVIDERS TAB */}
            {(visitedTabs.has("providers") || visitedTabs.has("models")) && (
              <div role="tabpanel" id="settings-panel-providers" aria-labelledby="settings-tab-providers" style={{ display: currentTab === "providers" ? "flex" : "none", height: "100%", minHeight: 0, flexDirection: "column" }}>
                <ModelsConfig key={modelsEditorKey} onSaved={() => { setModelsDirty(false); onModelsSaved(); }} onDirtyChange={setModelsDirty} />
              </div>
            )}

            {/* AGENT INTELLIGENCE TAB */}
            {currentTab === "intelligence" && (
              <div role="tabpanel" id="settings-panel-intelligence" aria-labelledby="settings-tab-intelligence" style={{ padding: isMobile ? "12px 14px" : 20, display: "flex", flexDirection: "column", gap: 16 }}>
                <NativeSettingsEditor drafts={nativeDrafts} setDrafts={setNativeDrafts} categories={["intelligence"]} cwd={cwd} focusPath={highlightSettingId} />
              </div>
            )}

            {/* EXTENSIONS & TOOLS TAB: one internal tablist, one mounted subpanel. */}
            {currentTab === "extensions" && (
              <div role="tabpanel" id="settings-panel-extensions" aria-labelledby="settings-tab-extensions" style={{ display: "flex", height: "100%", minHeight: 0, flexDirection: "column", overflowY: "hidden", padding: 20, gap: 16 }}>
                <div>
                  <h3 style={{ fontSize: "var(--text-base)", fontWeight: 600, margin: 0 }}>{t("settingsTabs.extensions")}</h3>
                  <p style={{ margin: "4px 0 0", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{t("settingsTabs.extensionsDesc")}</p>
                </div>
                <ExtensionsTabs active={extensionTab} onSelect={requestTabChange} />

                {extensionTab === "tools" && (
                  <div role="tabpanel" id="settings-extension-panel-tools" aria-labelledby="settings-extension-tab-tools" style={{ display: "flex", flex: 1, minHeight: 0, flexDirection: "column", overflowY: "auto" }}>
                    <NativeSettingsEditor drafts={nativeDrafts} setDrafts={setNativeDrafts} categories={["tools"]} cwd={cwd} focusPath={highlightSettingId} />
                  </div>
                )}

                {extensionTab === "mcp" && (
                  <div role="tabpanel" id="settings-extension-panel-mcp" aria-labelledby="settings-extension-tab-mcp" style={{ display: "flex", flex: 1, minHeight: 0, flexDirection: "column", overflowY: "auto", gap: 12 }}>
                    <McpConfig cwd={cwd ?? null} sessionId={sessionId ?? undefined} />
                    {!cwd && <p role="status" style={{ margin: 0, color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>{t("settingsConfig.noWorkspaceMcpHint")}</p>}
                  </div>
                )}

                {extensionTab === "skills" && (
                  <div role="tabpanel" id="settings-extension-panel-skills" aria-labelledby="settings-extension-tab-skills" style={{ display: "flex", flex: 1, minHeight: 0, flexDirection: "column", overflowY: "auto" }}>
                    {cwd ? <SkillsConfig cwd={cwd} /> : <div role="status" style={{ padding: 16, border: "1px solid var(--border)", borderRadius: "var(--radius-card)", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>{t("settingsConfig.workspaceRequired")}</div>}
                  </div>
                )}

                {extensionTab === "plugins" && (
                  <div role="tabpanel" id="settings-extension-panel-plugins" aria-labelledby="settings-extension-tab-plugins" style={{ display: "flex", flex: 1, minHeight: 0, flexDirection: "column", overflowY: "auto" }}>
                    {cwd ? <PluginsConfig cwd={cwd} sessionId={sessionId ?? null} onReloaded={onPluginsReloaded} runtimeReady={runtimeReady} /> : <div role="status" style={{ padding: 16, border: "1px solid var(--border)", borderRadius: "var(--radius-card)", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>{t("settingsConfig.workspaceRequired")}</div>}
                  </div>
                )}
              </div>
            )}

            {currentTab === "system" && (
              <div role="tabpanel" id="settings-panel-system" aria-labelledby="settings-tab-system" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
                <div>
                  <h3 style={{ fontSize: "var(--text-base)", fontWeight: 600, margin: 0 }}>{t("settingsConfig.systemUpdates")}</h3>
                  <p style={{ margin: "4px 0 0", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{t("settingsConfig.systemUpdatesDescription")}</p>
                </div>

                <NativeSettingsEditor drafts={nativeDrafts} setDrafts={setNativeDrafts} categories={["system"]} cwd={cwd} focusPath={highlightSettingId} />

                <section data-search-id={slugify("Background service")} aria-label={t("daemon.title")} style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-card)", background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <h4 style={{ margin: 0, fontSize: "var(--text-md)", fontWeight: 600 }}>{t("daemon.title")}</h4>
                    <button type="button" className="ui-focus-ring" disabled={daemonBusy || !!daemonPending} onClick={() => void refreshDaemon()} style={{ padding: "6px 10px", minHeight: 32, border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "transparent", color: "var(--text)", fontSize: "var(--text-sm)", cursor: daemonBusy || daemonPending ? "wait" : "pointer" }}>{t("settingsConfig.refresh")}</button>
                  </div>
                  <div role="status" aria-live="polite" style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                    {daemonPending ? t(daemonPending.action === "restart" ? "daemon.reconnecting" : "daemon.stopping") : daemonBusy ? t("daemon.loading") : !daemon ? t("daemon.unknown") : !daemon.supported ? t("daemon.unsupported") : !daemon.cliAvailable ? t("daemon.cliMissing") : !daemon.installed ? t("daemon.notInstalled") : daemon.running ? t("daemon.running", { pid: daemon.pid ?? "—" }) : t("daemon.stopped")}
                  </div>
                  <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-muted)", lineHeight: 1.5 }}>{t("daemon.description")}</p>
                  {daemon?.supported && (
                    <>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <span style={{ fontSize: "var(--text-sm)" }}>{t("daemon.autoStart")}</span>
                        <Switch aria-label={t("daemon.autoStart")} checked={daemon.autoStart} disabled={daemonBusy || !!daemonPending || !daemon.cliAvailable} onChange={(checked: boolean) => {
                          if (!checked) setDaemonConfirm("disable");
                          else void runDaemonAction(daemon.installed ? "enable" : "install");
                        }} />
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {(["start", "stop", "restart", "uninstall"] as const).map((action) => (
                          <button key={action} type="button" className="ui-focus-ring" style={{ padding: "6px 10px", minHeight: 32, border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "transparent", color: "var(--text)", fontSize: "var(--text-sm)" }} disabled={daemonBusy || !!daemonPending || !daemon.cliAvailable || !daemon.installed || (action === "start" ? daemon.running : (action === "stop" || action === "restart") && !daemon.running)} onClick={() => action === "start" ? void runDaemonAction(action) : setDaemonConfirm(action)}>{t(`daemon.${action}`)}</button>
                        ))}
                      </div>
                      {daemon.logPath && <div style={{ fontSize: "var(--text-sm)", overflowWrap: "anywhere" }}>{t("daemon.logs")}: <code>{daemon.logPath}</code></div>}
                      {!daemon.cliAvailable && <code style={{ fontSize: "var(--text-sm)", overflowWrap: "anywhere" }}>npm install -g ompgui@latest</code>}
                      {!daemon.installed && daemon.cliAvailable && <code style={{ fontSize: "var(--text-sm)", overflowWrap: "anywhere" }}>ompgui service install</code>}
                    </>
                  )}
                  {(daemonError || daemon?.error) && <div role="alert" style={{ fontSize: "var(--text-sm)", color: "var(--danger)", overflowWrap: "anywhere" }}>{daemonError || daemon?.error}</div>}
                  <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-muted)", lineHeight: 1.5 }}>{t("daemon.disconnectWarning")} <code>ompgui start</code></p>
                </section>

                {/* Active session system prompt */}
                <section
                  data-search-id={slugify("Active session system prompt")}
                  style={{
                    padding: "var(--space-5)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-card)",
                    background: "var(--bg-panel)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--space-4)",
                    ...(highlightSettingId === slugify("Active session system prompt") ? { borderColor: "var(--accent)", boxShadow: "0 0 0 2px var(--accent)" } : {}),
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-4)", flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: "var(--text-md)", fontWeight: 650 }}>{t("settingsConfig.sessionSystemPrompt")}</div>
                      <div style={{ marginTop: "var(--space-1)", color: "var(--text-muted)", fontSize: "var(--text-sm)", lineHeight: 1.45 }}>{t("settingsConfig.sessionSystemPromptDescription")}</div>
                    </div>
                    <button
                      type="button"
                      onClick={onLoadSystemPrompt}
                      disabled={!sessionId || systemPromptLoading}
                      aria-label={t("settingsConfig.systemPromptActionAria")}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "var(--space-2)",
                        flexShrink: 0,
                        padding: "var(--space-3) var(--space-4)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-control)",
                        background: "var(--bg)",
                        color: "var(--text)",
                        cursor: !sessionId || systemPromptLoading ? "not-allowed" : "pointer",
                        opacity: !sessionId || systemPromptLoading ? 0.65 : 1,
                        fontSize: "var(--text-sm)",
                      }}
                    >
                      <RefreshCw size={13} aria-hidden="true" className={systemPromptLoading ? "icon-spin" : undefined} />
                      {systemPromptLoading ? t("settingsConfig.systemPromptLoading") : systemPrompt === null ? t("settingsConfig.loadSystemPrompt") : t("settingsConfig.reloadSystemPrompt")}
                    </button>
                  </div>
                  <div
                    aria-live="polite"
                    aria-busy={systemPromptLoading}
                    style={{
                      minHeight: "var(--control-height-lg)",
                      maxHeight: "45dvh",
                      overflowY: "auto",
                      padding: "var(--space-4)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-control)",
                      background: "var(--bg)",
                      color: "var(--text-muted)",
                      fontSize: "var(--text-sm)",
                      lineHeight: 1.5,
                    }}
                  >
                    {systemPromptLoading ? (
                      <div role="status">{t("settingsConfig.systemPromptLoading")}</div>
                    ) : !sessionId ? (
                      <div style={{ fontStyle: "italic" }}>{t("settingsConfig.systemPromptNoSession")}</div>
                    ) : systemPrompt === null ? (
                      <div style={{ fontStyle: "italic" }}>{t("settingsConfig.systemPromptUnavailable")}</div>
                    ) : systemPrompt.length === 0 ? (
                      <div style={{ fontStyle: "italic" }}>{t("settingsConfig.systemPromptEmpty")}</div>
                    ) : (
                      <pre aria-label={t("settingsConfig.sessionSystemPrompt")} style={{ margin: 0, color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{systemPrompt}</pre>
                    )}
                  </div>
                </section>

                {/* ompgui app update card */}
                <section style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-card)", background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>{t("settingsConfig.appLabel")}</div>
                      <div style={{ marginTop: 4, color: appUpdate?.updateAvailable ? "var(--accent)" : "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }}>
                        {checkingAppUpdate ? t("settingsConfig.checkingUpdates") : appUpdate?.updateAvailable ? t("appShell.updateVersion", { current: appUpdate.currentVersion ?? "?", available: appUpdate.availableVersion ?? "?" }) : appUpdateError || appUpdate?.lookupFailed ? t("settingsConfig.appUpdateCheckFailed") : appUpdate?.currentVersion && appUpdate?.availableVersion ? t("settingsConfig.upToDate", { version: appUpdate.currentVersion }) : t("settingsConfig.versionUnavailable")}
                      </div>
                    </div>
                    <button type="button" onClick={() => void checkForAppUpdate(true)} disabled={checkingAppUpdate} aria-label={t("settingsConfig.checkAppUpdates")} style={{ padding: "6px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "transparent", color: "var(--text)", cursor: checkingAppUpdate ? "wait" : "pointer", fontSize: "var(--text-sm)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <RefreshCw size={13} aria-hidden="true" /> {t("settingsConfig.refresh")}
                    </button>
                  </div>
                  {appUpdate?.updateAvailable && (
                    <div style={{ marginTop: 6, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg)", display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{t("settingsConfig.runAppUpdateCommand")}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <code style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", color: "var(--accent)", wordBreak: "break-all" }}>{appUpdate.updateCommand || "ompgui update"}</code>
                        <button
                          type="button"
                          onClick={() => {
                            void copyText(appUpdate.updateCommand || "ompgui update")
                              .then(() => setMessage(t("appShell.commandCopied")))
                              .catch(() => setMessage(t("appShell.commandCopyFailed")));
                          }}
                          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", color: "var(--text)", cursor: "pointer", fontSize: "var(--text-xs)" }}
                        >
                          <Copy size={12} aria-hidden="true" /> {t("appShell.copyCommand")}
                        </button>
                      </div>
                    </div>
                  )}
                </section>

                {/* OMP runtime update card */}
                <section style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-card)", background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>{t("settingsConfig.ompLabel")}</div>
                      <div style={{ marginTop: 4, color: update?.updateAvailable ? "var(--accent)" : "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }}>
                        {checking ? t("settingsConfig.checkingUpdates") : update?.updateAvailable ? t("appShell.updateVersion", { current: update.currentVersion ?? "?", available: update.availableVersion ?? "?" }) : update?.currentVersion ? t("settingsConfig.upToDate", { version: update.currentVersion }) : t("settingsConfig.versionUnavailable")}
                      </div>
                    </div>
                    <button type="button" onClick={() => void checkForUpdate(true)} disabled={checking} aria-label={t("settingsConfig.checkOmpUpdates")} style={{ padding: "6px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "transparent", color: "var(--text)", cursor: checking ? "wait" : "pointer", fontSize: "var(--text-sm)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <RefreshCw size={13} aria-hidden="true" /> {t("settingsConfig.refresh")}
                    </button>
                  </div>
                  {update?.updateAvailable && (
                    <div style={{ marginTop: 6, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg)", display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{t("settingsConfig.runOmpUpdateCommand")}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <code style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", color: "var(--accent)", wordBreak: "break-all" }}>{update.updateCommand || "omp update"}</code>
                        <button
                          type="button"
                          onClick={() => {
                            void copyText(update.updateCommand || "omp update")
                              .then(() => setMessage(t("appShell.commandCopied")))
                              .catch(() => setMessage(t("appShell.commandCopyFailed")));
                          }}
                          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", color: "var(--text)", cursor: "pointer", fontSize: "var(--text-xs)" }}
                        >
                          <Copy size={12} aria-hidden="true" /> {t("appShell.copyCommand")}
                        </button>
                      </div>
                    </div>
                  )}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                    <button
                      type="button"
                      onClick={() => void restartSessions()}
                      disabled={restarting}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", color: "var(--text)", cursor: restarting ? "wait" : "pointer", fontSize: "var(--text-sm)" }}
                    >
                      <RotateCcw size={13} aria-hidden="true" /> {restarting ? t("settingsConfig.restarting") : t("settingsConfig.restartSessions")}
                    </button>
                    <a
                      href="https://github.com/can1357/oh-my-pi/releases"
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", color: "var(--text-muted)", textDecoration: "none", fontSize: "var(--text-sm)" }}
                    >
                      <ExternalLink size={13} aria-hidden="true" /> {t("settingsConfig.changelog")}
                    </a>
                  </div>
                  {message && <p role="status" style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: "var(--text-sm)", lineHeight: 1.5 }}>{message}</p>}
                </section>
              </div>
            )}
              </div>
            </SettingsHighlightContext.Provider>
          )}
        </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={daemonConfirm !== null}
        onOpenChange={(open) => { if (!open) setDaemonConfirm(null); }}
        title={daemonConfirm ? t(`daemon.${daemonConfirm}`) : t("daemon.title")}
        description={t(daemonConfirm === "disable" ? "daemon.disableConfirm" : "daemon.disconnectConfirm")}
        confirmLabel={daemonConfirm ? t(`daemon.${daemonConfirm}`) : t("daemon.title")}
        cancelLabel={t("settingsConfig.cancel")}
        danger
        onConfirm={() => { if (daemonConfirm) void runDaemonAction(daemonConfirm); }}
      />
      <ConfirmDialog
        open={discardDialogOpen}
        onOpenChange={(open) => {
          setDiscardDialogOpen(open);
          if (!open) setPendingAction(null);
        }}
        title={t("settingsConfig.unsavedChangesTitle")}
        description={t("settingsConfig.unsavedChangesDescription")}
        confirmLabel={t("settingsConfig.discardChanges")}
        cancelLabel={t("settingsConfig.cancel")}
        danger
        onConfirm={confirmDiscard}
      />
    </>
  );
}
