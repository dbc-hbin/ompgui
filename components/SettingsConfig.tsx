"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getSubmitDuringRunBehavior, setSubmitDuringRunBehavior, type SubmitDuringRunBehavior } from "@/lib/composer-prefs";
import dynamic from "next/dynamic";
import { Copy, ExternalLink, RefreshCw, RotateCcw, Sparkles, Search, Monitor, Moon, Sun } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/primitives";
import { ConfirmDialog, Select, Switch } from "@/components/ui/field";
import { ExtensionsTabs, type ExtensionsTab, SettingsTabs, type SettingsTab, SETTINGS_CATEGORIES, getNormalizedActive } from "./SettingsTabs";
import { useI18n } from "@/lib/i18n";
import { copyText } from "@/lib/clipboard";
import { useTheme } from "@/hooks/useTheme";
import { getSoundEnabled, setSoundEnabled as persistSoundEnabled } from "@/lib/sound-prefs";
import { loadClientModels } from "@/lib/client-model-store";
import { mergeClientNativeSettings, shouldApplyRemoteSettings } from "@/lib/native-settings-client";

const SettingsTabLoading = () => <div role="status" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>Loading settings…</div>;
const BuiltInToolsConfig = dynamic(() => import("./BuiltInToolsConfig").then((module) => module.BuiltInToolsConfig), { loading: SettingsTabLoading });
const ModelsConfig = dynamic(() => import("./ModelsConfig").then((module) => module.ModelsConfig), { loading: SettingsTabLoading });
const SkillsConfig = dynamic(() => import("./SkillsConfig").then((module) => module.SkillsConfig), { loading: SettingsTabLoading });
const PluginsConfig = dynamic(() => import("./PluginsConfig").then((module) => module.PluginsConfig), { loading: SettingsTabLoading });
const McpConfig = dynamic(() => import("./McpConfig").then((module) => module.McpConfig), { loading: SettingsTabLoading });
const AgentsConfig = dynamic(() => import("./AgentsConfig").then((m) => m.AgentsConfig), { ssr: false });

type UpdateState = {
  currentVersion: string | null;
  availableVersion: string | null;
  updateAvailable: boolean;
  updateCommand?: string;
  lookupFailed?: boolean;
};

type NativeApplication = {
  mode: "new-session" | "runtime-refresh";
  restartRequired: boolean;
};

type RuntimeModelOption = {
  id: string;
  provider: string;
  name?: string;
};

type NativeSettings = {
  defaultThinkingLevel?: "auto" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  hideThinkingBlock?: boolean;
  externalThinking?: boolean;
  textVerbosity?: "low" | "medium" | "high";
  personality?: "default" | "friendly" | "pragmatic" | "none";
  advisor?: { enabled?: boolean; subagents?: boolean; syncBacklog?: "off" | "1" | "3" | "5"; immuneTurns?: number };
  tools?: { approvalMode?: "always-ask" | "write" | "yolo"; approval?: { bash?: "allow" | "prompt" | "deny"; extension?: "allow" | "prompt" } };
  compaction?: { enabled?: boolean; midTurnEnabled?: boolean; strategy?: "snapcompact" | "handoff" | "context-full" | "shake" | "off"; autoContinue?: boolean; remoteEnabled?: boolean; keepRecentTokens?: number };
  memory?: { backend?: "off" | "local" | "mnemopi" | "hindsight" };
  autolearn?: { enabled?: boolean; autoContinue?: boolean; minToolCalls?: number };
  mnemopi?: { scoping?: "global" | "per-project" | "per-project-tagged"; autoRecall?: boolean; autoRetain?: boolean; noEmbeddings?: boolean };
  mcp?: { enableProjectConfig?: boolean; renderMarkdownResults?: boolean; notifications?: boolean; notificationDebounceMs?: number };
  retry?: {
    enabled?: boolean;
    maxRetries?: number;
    modelFallback?: boolean;
    fallbackRevertPolicy?: "cooldown-expiry" | "never";
    fallbackChains?: Record<string, string[]>;
  };
  task?: { eager?: "default" | "preferred" | "always" };
  browser?: { enabled?: boolean; relay?: boolean; headless?: boolean };
  computer?: { enabled?: boolean; display?: string };
  web_search?: { enabled?: boolean };
  github?: { enabled?: boolean };
  security?: { enabled?: boolean };
  checkpoint?: { enabled?: boolean };
};

// These are the native OMP defaults used when config.yml omits a retry field.
// Keep this single set in the settings surface so the editor never suggests a
// different behavior from a new OMP session.
const NATIVE_RETRY_DEFAULTS = {
  enabled: true,
  maxRetries: 10,
  modelFallback: true,
  fallbackRevertPolicy: "cooldown-expiry" as const,
};

const NATIVE_MODEL_ROLES = ["default", "smol", "slow", "vision", "plan", "designer", "commit", "tiny", "task", "advisor"] as const;
const NATIVE_RETRY_COUNTS = Array.from({ length: 21 }, (_, index) => index);

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
};

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
  // Appearance
  { tab: "general", section: "Appearance", label: "Color mode", description: "Choose between light, dark, or system color mode.", scope: "UI" },
  { tab: "general", section: "Appearance", label: "Theme palette", description: "Select warm paper/ember or canonical OMP birch/graphite palette.", scope: "UI" },
  // Interface & Behavior
  { tab: "general", section: "Interface & Behavior", label: "Keep tool calls collapsed", description: "Show only compact headers while tools execute.", scope: "UI" },
  { tab: "general", section: "Interface & Behavior", label: "Completion sound", description: "Play a tone when the agent completes a run.", scope: "UI" },
  { tab: "general", section: "Interface & Behavior", label: "Message during active run", description: "What composer does on submit while agent runs. Steer interrupts; Queue follow-up delivers after finish.", scope: "UI" },
  // Tool Safety & Approvals
  { tab: "safety", section: "Tool Safety & Approvals", label: "Approval Mode", description: "Choose when OMP asks before tool calls.", scope: "New sessions" },
  { tab: "safety", section: "Tool Safety & Approvals", label: "Bash Override", description: "Override default approval policy specifically for terminal commands.", scope: "New sessions" },
  { tab: "safety", section: "Tool Safety & Approvals", label: "Extension Tool Requests", description: "Automatically approve extension tool authorization requests.", scope: "New sessions" },
  // AI Model Defaults
  { tab: "models", section: "AI Model Defaults", label: "Reasoning", description: "Default effort level for thinking-capable models.", scope: "New sessions" },
  { tab: "models", section: "AI Model Defaults", label: "Verbosity", description: "Response detail level for supporting providers.", scope: "New sessions" },
  { tab: "models", section: "AI Model Defaults", label: "Personality", description: "Style included in OMP's system prompt.", scope: "New sessions" },
  { tab: "models", section: "AI Model Defaults", label: "Thinking Blocks", description: "Hide model reasoning from output view.", scope: "New sessions" },
  { tab: "models", section: "AI Model Defaults", label: "External Thinking", description: "Private scratchpad reasoning via think tool.", scope: "New sessions" },
  // Agent & Intelligence — Advisor Review
  { tab: "intelligence", section: "Advisor Review", label: "Enable Advisor", description: "Enable Advisor for new sessions with the advisor role.", scope: "New sessions" },
  { tab: "intelligence", section: "Advisor Review", label: "Advisor Backlog", description: "Wait briefly when advisor falls behind.", scope: "New sessions" },
  { tab: "intelligence", section: "Advisor Review", label: "Review Subagents", description: "Apply Advisor passive review to subagent tasks.", scope: "New sessions" },
  // Context Compaction
  { tab: "intelligence", section: "Context Compaction", label: "Automatic Compaction", description: "Compact context before model context limit is hit.", scope: "New sessions" },
  { tab: "intelligence", section: "Context Compaction", label: "Continue After Compaction", description: "Resume task execution after compaction completes.", scope: "New sessions" },
  { tab: "intelligence", section: "Context Compaction", label: "Maintenance Strategy", description: "Select algorithm used to reduce context pressure.", scope: "New sessions" },
  { tab: "intelligence", section: "Context Compaction", label: "Compact Mid-Turn", description: "Check context limits between tool execution steps.", scope: "New sessions" },
  // Memory & Auto-Learn
  { tab: "intelligence", section: "Memory & Auto-Learn", label: "Memory Backend", description: "Where durable knowledge is stored across sessions.", scope: "New sessions" },
  { tab: "intelligence", section: "Memory & Auto-Learn", label: "Enable Auto-Learn", description: "Capture reusable lessons after completed runs.", scope: "New sessions" },
  { tab: "intelligence", section: "Memory & Auto-Learn", label: "Private Capture Turn", description: "Run private lesson-capture turn at completion.", scope: "New sessions" },
  { tab: "intelligence", section: "Memory & Auto-Learn", label: "Memory Scope", description: "Scoping for Mnemopi knowledge storage.", scope: "New sessions" },
  { tab: "intelligence", section: "Memory & Auto-Learn", label: "Recall on Session Start", description: "Load relevant memories into first turn.", scope: "New sessions" },
  { tab: "intelligence", section: "Memory & Auto-Learn", label: "Retain Completed Turns", description: "Store completed conversation turns in memory.", scope: "New sessions" },
  // Automatic Retry
  { tab: "intelligence", section: "Automatic Retry", label: "Automatic Retry", description: "Retry failed turns automatically.", scope: "New sessions" },
  { tab: "intelligence", section: "Automatic Retry", label: "Max Attempts", description: "Retry limit before giving up.", scope: "New sessions" },
  { tab: "intelligence", section: "Automatic Retry", label: "Model Fallback", description: "Fall back to alternative model when retries exhaust.", scope: "New sessions" },
  { tab: "intelligence", section: "Automatic Retry", label: "Return to primary", description: "Choose when OMP should leave a fallback model after its cooldown.", scope: "New sessions" },
  { tab: "intelligence", section: "Automatic Retry", label: "Fallback chain", description: "Choose ordered fallback models for each native model role.", scope: "New sessions" },
  // Extensions & Tools
  { tab: "mcp", section: "Extensions & Tools", label: "Load Project MCP Servers", description: "Allow project-root MCP configuration to be discovered.", scope: "New sessions" },
  { tab: "mcp", section: "Extensions & Tools", label: "Render MCP Markdown", description: "Render non-JSON MCP results as Markdown in transcript.", scope: "New sessions" },
  { tab: "mcp", section: "Extensions & Tools", label: "MCP Resource Updates", description: "Inject server resource updates into conversation.", scope: "New sessions" },
  // System & Updates — active session diagnostics
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

export function SettingsConfig({ activeTab, advisorEnabled, onAdvisorChange, toolCallsDefaultCollapsed, onToolCallsDefaultCollapsedChange, cwd, sessionId, systemPrompt, systemPromptLoading, onLoadSystemPrompt, onModelsSaved, onPluginsReloaded, onOmpSessionsRestarted, onOmpUpdateAvailabilityChange, onAppUpdateAvailabilityChange, onSelectTab, onClose, runtimeReady }: {
  activeTab: SettingsTab;
  advisorEnabled: boolean;
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
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [currentTab, setCurrentTab] = useState<SettingsTab>(getNormalizedActive(activeTab));
  const [extensionTab, setExtensionTab] = useState<ExtensionsTab>(() => {
    if (activeTab === "mcp" || activeTab === "skills" || activeTab === "plugins") return activeTab;
    return "tools";
  });
  const [visitedTabs, setVisitedTabs] = useState<Set<SettingsTab>>(() => new Set([getNormalizedActive(activeTab)]));
  const [modelsDirty, setModelsDirty] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [modelsEditorKey, setModelsEditorKey] = useState(0);

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
  const [nativeSettings, setNativeSettings] = useState<NativeSettings | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [submitBehavior, setSubmitBehavior] = useState<SubmitDuringRunBehavior>("steer");
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightSettingId, setHighlightSettingId] = useState<string | null>(null);
  const [runtimeModels, setRuntimeModels] = useState<RuntimeModelOption[]>([]);
  const [fallbackRole, setFallbackRole] = useState<string>("default");
  const [fallbackCandidate, setFallbackCandidate] = useState<string>("");

  const { preference, setTheme, palette, setPalette } = useTheme();
  const nativeSettingsRef = useRef<NativeSettings>({});
  const settingsGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const saveChainRef = useRef(Promise.resolve());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadNativeSettings = useCallback(async () => {
    const requestGeneration = settingsGenerationRef.current;
    try {
      const response = await fetch("/api/omp-settings");
      if (!response.ok) return;
      const data = await response.json() as { settings?: NativeSettings };
      if (!shouldApplyRemoteSettings({
        mounted: mountedRef.current,
        requestGeneration,
        latestGeneration: settingsGenerationRef.current,
      })) return;
      const settings = data.settings ?? {};
      nativeSettingsRef.current = settings;
      setNativeSettings(settings);
    } catch {
      // ignore
    }
  }, []);

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
    void loadNativeSettings();
  }, [loadNativeSettings]);

  useEffect(() => {
    setSoundEnabled(getSoundEnabled());
    setSubmitBehavior(getSubmitDuringRunBehavior());
  }, []);

  useEffect(() => {
    let unmounted = false;
    void (async () => {
      try {
        const catalog = await loadClientModels();
        if (unmounted) return;
        const flat: RuntimeModelOption[] = catalog.modelList.map((m) => ({
          id: m.id,
          provider: m.provider,
          name: m.name,
        }));
        setRuntimeModels(flat);
      } catch {
        // Fall back to empty options if model catalog is unreachable.
      }
    })();
    return () => {
      unmounted = true;
    };
  }, []);

  const patchSettings = useCallback(async (patch: Partial<NativeSettings>): Promise<boolean> => {
    const merged = mergeClientNativeSettings(nativeSettingsRef.current, patch);
    nativeSettingsRef.current = merged;
    setNativeSettings(merged);
    const requestGeneration = ++settingsGenerationRef.current;
    let succeeded = false;
    saveChainRef.current = saveChainRef.current.then(async () => {
      if (!mountedRef.current) return;
      try {
        const response = await fetch("/api/omp-settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: nativeSettingsRef.current }),
        });
        if (!response.ok) return;
        const data = await response.json() as { settings?: NativeSettings; application?: NativeApplication };
        succeeded = true;
        if (!shouldApplyRemoteSettings({
          mounted: mountedRef.current,
          requestGeneration,
          latestGeneration: settingsGenerationRef.current,
        })) return;
        if (data.settings) {
          nativeSettingsRef.current = data.settings;
          setNativeSettings(data.settings);
        }
        if (data.application?.restartRequired) {
          setMessage(t("settingsConfig.restartPrompt"));
        }
      } catch {
        succeeded = false;
      }
    });
    await saveChainRef.current;
    return succeeded;
  }, [t]);

  const patchSection = useCallback(<K extends keyof NativeSettings>(
    section: K,
    patch: Partial<NonNullable<NativeSettings[K]>>,
  ) => {
    return patchSettings({ [section]: patch } as unknown as Partial<NativeSettings>);
  }, [patchSettings]);

  const patchApproval = useCallback((patch: Partial<NonNullable<NonNullable<NativeSettings["tools"]>["approval"]>>) => {
    return patchSettings({
      tools: {
        approval: patch,
      },
    });
  }, [patchSettings]);

  const retrySettings = useMemo(() => nativeSettings?.retry ?? {}, [nativeSettings?.retry]);
  const fallbackChains = useMemo(() => retrySettings.fallbackChains ?? {}, [retrySettings.fallbackChains]);
  const fallbackChain = useMemo(() => fallbackChains[fallbackRole] ?? [], [fallbackChains, fallbackRole]);

  const fallbackModelOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const model of runtimeModels) {
      if (model.id) unique.add(model.id);
      if (model.provider && model.id) unique.add(`${model.provider}/${model.id}`);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [runtimeModels]);

  const updateFallbackChain = useCallback((nextChain: string[]) => {
    const currentChains = nativeSettingsRef.current.retry?.fallbackChains ?? {};
    const nextChains: Record<string, string[]> = { ...currentChains };
    if (nextChain.length === 0) {
      delete nextChains[fallbackRole];
    } else {
      nextChains[fallbackRole] = nextChain;
    }
    return patchSection("retry", { fallbackChains: nextChains });
  }, [fallbackRole, patchSection]);

  const requestAction = useCallback((action: () => void) => {
    if (modelsDirty) {
      setPendingAction(() => action);
      setDiscardDialogOpen(true);
      return;
    }
    action();
  }, [modelsDirty]);

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

    return results;
  }, [searchQuery, t]);

  const handleSelectSearchResult = useCallback((result: SearchResult) => {
    setSearchQuery("");
    requestTabChange(result.tab);
    if (result.kind === "setting") {
      setHighlightSettingId(slugify(result.label));
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
              {modelsDirty && (
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
                <NativeSetting
                  label={t("settingsConfig.preferTaskDelegation")}
                  description={t("settingsConfig.preferTaskDelegationDesc")}
                  scope="New sessions"
                  compact
                  hideDescription={isMobile}
                >
                  <Select
                    value={nativeSettings?.task?.eager ?? "default"}
                    onChange={(value: string) => patchSection("task", { eager: value as NonNullable<NativeSettings["task"]>["eager"] })}
                    required
                    options={[
                      { value: "default", label: t("settingsConfig.delegationDefault") },
                      { value: "preferred", label: t("settingsConfig.delegationPreferred") },
                      { value: "always", label: t("settingsConfig.delegationAlways") },
                    ]}
                    aria-label={t("settingsConfig.preferTaskDelegation")}
                  />
                </NativeSetting>
                <AgentsConfig cwd={cwd ?? undefined} onSaved={onModelsSaved} />
              </div>
            )}

            {/* SAFETY & APPROVALS TAB */}
            {currentTab === "safety" && (
              <div role="tabpanel" id="settings-panel-safety" aria-labelledby="settings-tab-safety" style={{ padding: isMobile ? "12px 14px" : 20, display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <h3 style={{ fontSize: "var(--text-base)", fontWeight: 600, margin: 0 }}>{t("settingsConfig.safetyTitle")}</h3>
                  <p style={{ margin: "4px 0 0", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{t("settingsConfig.safetyDescription")}</p>
                </div>
                <NativeSetting label={t("settingsConfig.approvalMode")} description={t("settingsConfig.approvalModeDesc")} scope="New sessions" compact hideDescription={isMobile}>
                  <Select
                    value={nativeSettings?.tools?.approvalMode ?? "yolo"}
                    onChange={(value: string) => patchSection("tools", { approvalMode: value as "always-ask" | "write" | "yolo" })}
                    required
                    options={[
                      { value: "always-ask", label: t("settingsConfig.approvalAlwaysAsk") },
                      { value: "write", label: t("settingsConfig.approvalWrite") },
                      { value: "yolo", label: t("settingsConfig.approvalYolo") },
                    ]}
                    aria-label={t("settingsConfig.approvalMode")}
                  />
                </NativeSetting>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <NativeSetting label={t("settingsConfig.bashApproval")} description={t("settingsConfig.bashApprovalDesc")} scope="New sessions">
                    <Select
                      value={nativeSettings?.tools?.approval?.bash ?? "prompt"}
                      onChange={(value: string) => patchApproval({ bash: value as "allow" | "prompt" | "deny" })}
                      required
                      options={[
                        { value: "allow", label: t("settingsConfig.allow") },
                        { value: "prompt", label: t("settingsConfig.alwaysAsk") },
                        { value: "deny", label: t("settingsConfig.deny") },
                      ]}
                      aria-label={t("settingsConfig.bashApproval")}
                    />
                  </NativeSetting>
                  <NativeSetting label={t("settingsConfig.extensionApproval")} description={t("settingsConfig.extensionApprovalDesc")} scope="New sessions">
                    <Select
                      value={nativeSettings?.tools?.approval?.extension ?? "prompt"}
                      onChange={(value: string) => patchApproval({ extension: value as "allow" | "prompt" })}
                      required
                      options={[
                        { value: "prompt", label: t("settingsConfig.askEveryTime") },
                        { value: "allow", label: t("settingsConfig.autoApprove") },
                      ]}
                      aria-label={t("settingsConfig.extensionApproval")}
                    />
                  </NativeSetting>
                </div>
              </div>
            )}

            {/* AI MODEL DEFAULTS TAB */}
            {currentTab === "models" && (
              <div role="tabpanel" id="settings-panel-models" aria-labelledby="settings-tab-models" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <h3 style={{ fontSize: "var(--text-base)", fontWeight: 600, margin: 0 }}>{t("settingsConfig.modelsTitle")}</h3>
                  <p style={{ margin: "4px 0 0", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{t("settingsConfig.modelsDescription")}</p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <NativeSetting label={t("settingsConfig.reasoning")} description={t("settingsConfig.reasoningDesc")} scope="New sessions">
                    <Select
                      value={nativeSettings?.defaultThinkingLevel ?? "high"}
                      onChange={(value: string) => patchSettings({ defaultThinkingLevel: value as NativeSettings["defaultThinkingLevel"] })}
                      required
                      options={["auto", "minimal", "low", "medium", "high", "xhigh", "max"]}
                      aria-label={t("settingsConfig.reasoning")}
                    />
                  </NativeSetting>
                  <NativeSetting label={t("settingsConfig.verbosity")} description={t("settingsConfig.verbosityDesc")} scope="New sessions">
                    <Select
                      value={nativeSettings?.textVerbosity ?? "medium"}
                      onChange={(value: string) => patchSettings({ textVerbosity: value as NativeSettings["textVerbosity"] })}
                      required
                      options={["low", "medium", "high"]}
                      aria-label={t("settingsConfig.verbosity")}
                    />
                  </NativeSetting>
                  <NativeSetting label={t("settingsConfig.personality")} description={t("settingsConfig.personalityDesc")} scope="New sessions">
                    <Select
                      value={nativeSettings?.personality ?? "default"}
                      onChange={(value: string) => patchSettings({ personality: value as NativeSettings["personality"] })}
                      required
                      options={["default", "friendly", "pragmatic", "none"]}
                      aria-label={t("settingsConfig.personality")}
                    />
                  </NativeSetting>
                  <NativeSetting label={t("settingsConfig.hideThinking")} description={t("settingsConfig.hideThinkingDesc")} scope="New sessions">
                    <Switch
                      checked={nativeSettings?.hideThinkingBlock ?? false}
                      onChange={(checked: boolean) => patchSettings({ hideThinkingBlock: checked })}
                      aria-label={t("settingsConfig.hideThinking")}
                    />
                  </NativeSetting>
                  <NativeSetting label={t("settingsConfig.externalThinking")} description={t("settingsConfig.externalThinkingDesc")} scope="New sessions">
                    <Switch
                      checked={nativeSettings?.externalThinking ?? false}
                      onChange={(checked: boolean) => patchSettings({ externalThinking: checked })}
                      aria-label={t("settingsConfig.externalThinking")}
                    />
                  </NativeSetting>
                </div>
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
              <div role="tabpanel" id="settings-panel-intelligence" aria-labelledby="settings-tab-intelligence" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
                {/* Advisor Section */}
                <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-md)", fontWeight: 600 }}>
                    <Sparkles size={14} aria-hidden="true" style={{ color: "var(--accent)" }} /> {t("settingsConfig.advisorReview")}
                  </div>
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>{t("settingsConfig.advisorReviewDesc")}</p>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    <NativeSetting label={t("settingsConfig.enableAdvisor")} description={t("settingsConfig.enableAdvisorDesc")} scope="New sessions">
                      <Switch
                        checked={nativeSettings?.advisor?.enabled ?? advisorEnabled}
                        onChange={(enabled: boolean) => {
                          onAdvisorChange(enabled);
                          patchSection("advisor", { enabled });
                        }}
                        aria-label={t("settingsConfig.enableAdvisor")}
                      />
                    </NativeSetting>
                    {(nativeSettings?.advisor?.enabled ?? advisorEnabled) && (
                      <NativeSetting label={t("settingsConfig.advisorBacklog")} description={t("settingsConfig.advisorBacklogDesc")} scope="New sessions">
                        <Select
                          value={nativeSettings?.advisor?.syncBacklog ?? "off"}
                          onChange={(value: string) => patchSection("advisor", { syncBacklog: value as "off" | "1" | "3" | "5" })}
                          required
                          options={[
                            { value: "off", label: t("settingsConfig.backlogOff") },
                            { value: "1", label: t("settingsConfig.backlog1") },
                            { value: "3", label: t("settingsConfig.backlog3") },
                            { value: "5", label: t("settingsConfig.backlog5") },
                          ]}
                          aria-label={t("settingsConfig.advisorBacklog")}
                        />
                      </NativeSetting>
                    )}
                  </div>
                  {(nativeSettings?.advisor?.enabled ?? advisorEnabled) && (
                    <NativeSetting label={t("settingsConfig.reviewSubagents")} description={t("settingsConfig.reviewSubagentsDesc")} scope="New sessions">
                      <Switch
                        checked={nativeSettings?.advisor?.subagents ?? false}
                        onChange={(checked: boolean) => patchSection("advisor", { subagents: checked })}
                        aria-label={t("settingsConfig.reviewSubagents")}
                      />
                    </NativeSetting>
                  )}
                </section>

                {/* Context Compaction Section */}
                <section style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                  <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>{t("settingsConfig.contextCompaction")}</div>
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>{t("settingsConfig.contextCompactionDesc")}</p>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    <NativeSetting label={t("settingsConfig.autoCompaction")} description={t("settingsConfig.autoCompactionDesc")} scope="New sessions">
                      <Switch
                        checked={nativeSettings?.compaction?.enabled ?? true}
                        onChange={(checked: boolean) => patchSection("compaction", { enabled: checked })}
                        aria-label={t("settingsConfig.autoCompaction")}
                      />
                    </NativeSetting>
                    <NativeSetting label={t("settingsConfig.autoContinueCompaction")} description={t("settingsConfig.autoContinueCompactionDesc")} scope="New sessions">
                      <Switch
                        checked={nativeSettings?.compaction?.autoContinue ?? true}
                        onChange={(checked: boolean) => patchSection("compaction", { autoContinue: checked })}
                        aria-label={t("settingsConfig.autoContinueCompaction")}
                      />
                    </NativeSetting>
                    <NativeSetting label={t("settingsConfig.compactionStrategy")} description={t("settingsConfig.compactionStrategyDesc")} scope="New sessions">
                      <Select
                        value={nativeSettings?.compaction?.strategy ?? "snapcompact"}
                        onChange={(value: string) => patchSection("compaction", { strategy: value as NonNullable<NativeSettings["compaction"]>["strategy"] })}
                        required
                        options={[
                          { value: "snapcompact", label: "Snapcompact" },
                          { value: "handoff", label: "Handoff" },
                          { value: "context-full", label: "Context full" },
                          { value: "shake", label: "Shake" },
                          { value: "off", label: "Off" },
                        ]}
                        aria-label={t("settingsConfig.compactionStrategy")}
                      />
                    </NativeSetting>
                    <NativeSetting label={t("settingsConfig.compactMidTurn")} description={t("settingsConfig.compactMidTurnDesc")} scope="New sessions">
                      <Switch
                        checked={nativeSettings?.compaction?.midTurnEnabled ?? true}
                        onChange={(checked: boolean) => patchSection("compaction", { midTurnEnabled: checked })}
                        aria-label={t("settingsConfig.compactMidTurn")}
                      />
                    </NativeSetting>
                  </div>
                </section>

                {/* Memory & Auto-Learn Section */}
                <section style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                  <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>{t("settingsConfig.memoryAndAutoLearn")}</div>
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>{t("settingsConfig.memoryAndAutoLearnDesc")}</p>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    <NativeSetting label={t("settingsConfig.memoryBackend")} description={t("settingsConfig.memoryBackendDesc")} scope="New sessions">
                      <Select
                        value={nativeSettings?.memory?.backend ?? "mnemopi"}
                        onChange={(value: string) => patchSection("memory", { backend: value as NonNullable<NativeSettings["memory"]>["backend"] })}
                        required
                        options={[
                          { value: "off", label: t("settingsConfig.backlogOff") },
                          { value: "local", label: t("settingsConfig.memoryLocal") },
                          { value: "mnemopi", label: t("settingsConfig.memoryMnemopi") },
                          { value: "hindsight", label: t("settingsConfig.memoryHindsight") },
                        ]}
                        aria-label={t("settingsConfig.memoryBackend")}
                      />
                    </NativeSetting>
                    <NativeSetting label={t("settingsConfig.enableAutolearn")} description={t("settingsConfig.enableAutolearnDesc")} scope="New sessions">
                      <Switch
                        checked={nativeSettings?.autolearn?.enabled ?? true}
                        onChange={(checked: boolean) => patchSection("autolearn", { enabled: checked })}
                        aria-label={t("settingsConfig.enableAutolearn")}
                      />
                    </NativeSetting>
                    <NativeSetting label={t("settingsConfig.privateCaptureTurn")} description={t("settingsConfig.privateCaptureTurnDesc")} scope="New sessions">
                      <Switch
                        checked={nativeSettings?.autolearn?.autoContinue ?? true}
                        onChange={(checked: boolean) => patchSection("autolearn", { autoContinue: checked })}
                        aria-label={t("settingsConfig.privateCaptureTurn")}
                      />
                    </NativeSetting>
                    <NativeSetting label={t("settingsConfig.memoryScope")} description={t("settingsConfig.memoryScopeDesc")} scope="New sessions">
                      <Select
                        value={nativeSettings?.mnemopi?.scoping ?? "per-project"}
                        onChange={(value: string) => patchSection("mnemopi", { scoping: value as NonNullable<NativeSettings["mnemopi"]>["scoping"] })}
                        required
                        options={[
                          { value: "per-project", label: t("settingsConfig.scopePerProject") },
                          { value: "per-project-tagged", label: t("settingsConfig.scopePerProjectTagged") },
                          { value: "global", label: t("settingsConfig.scopeGlobal") },
                        ]}
                        aria-label={t("settingsConfig.memoryScope")}
                      />
                    </NativeSetting>
                    <NativeSetting label={t("settingsConfig.autoRecall")} description={t("settingsConfig.autoRecallDesc")} scope="New sessions">
                      <Switch
                        checked={nativeSettings?.mnemopi?.autoRecall ?? true}
                        onChange={(checked: boolean) => patchSection("mnemopi", { autoRecall: checked })}
                        aria-label={t("settingsConfig.autoRecall")}
                      />
                    </NativeSetting>
                    <NativeSetting label={t("settingsConfig.autoRetain")} description={t("settingsConfig.autoRetainDesc")} scope="New sessions">
                      <Switch
                        checked={nativeSettings?.mnemopi?.autoRetain ?? true}
                        onChange={(checked: boolean) => patchSection("mnemopi", { autoRetain: checked })}
                        aria-label={t("settingsConfig.autoRetain")}
                      />
                    </NativeSetting>
                  </div>
                </section>

                {/* Retry and fallback are edited here only; provider/model setup stays in ModelsConfig. */}
                <section style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                  <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>{t("settingsConfig.autoRetry")}</div>
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>{t("settingsConfig.autoRetryDesc")}</p>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    <NativeSetting label={t("settingsConfig.enableRetry")} description={t("settingsConfig.enableRetryDesc")} scope="New sessions">
                      <Switch
                        checked={retrySettings.enabled ?? NATIVE_RETRY_DEFAULTS.enabled}
                        onChange={(checked: boolean) => patchSection("retry", { enabled: checked })}
                        aria-label={t("settingsConfig.enableRetry")}
                      />
                    </NativeSetting>
                    <NativeSetting label={t("settingsConfig.maxAttempts")} description={t("settingsConfig.maxAttemptsDesc")} scope="New sessions">
                      <Select
                        value={String(retrySettings.maxRetries ?? NATIVE_RETRY_DEFAULTS.maxRetries)}
                        onChange={(value: string) => patchSection("retry", { maxRetries: Number(value) })}
                        required
                        options={NATIVE_RETRY_COUNTS.map(String)}
                        aria-label={t("settingsConfig.maxAttempts")}
                      />
                    </NativeSetting>
                    <NativeSetting label={t("settingsConfig.modelFallback")} description={t("settingsConfig.modelFallbackDesc")} scope="New sessions">
                      <Switch
                        checked={retrySettings.modelFallback ?? NATIVE_RETRY_DEFAULTS.modelFallback}
                        onChange={(checked: boolean) => patchSection("retry", { modelFallback: checked })}
                        aria-label={t("settingsConfig.modelFallback")}
                      />
                    </NativeSetting>
                    <NativeSetting label={t("settingsConfig.fallbackRevertPolicy")} description={t("settingsConfig.fallbackRevertPolicyDesc")} scope="New sessions">
                      <Select
                        value={retrySettings.fallbackRevertPolicy ?? NATIVE_RETRY_DEFAULTS.fallbackRevertPolicy}
                        onChange={(value: string) => patchSection("retry", { fallbackRevertPolicy: value as NonNullable<NativeSettings["retry"]>["fallbackRevertPolicy"] })}
                        required
                        options={[
                          { value: "cooldown-expiry", label: t("settingsConfig.fallbackRevertCooldown") },
                          { value: "never", label: t("settingsConfig.fallbackRevertNever") },
                        ]}
                        aria-label={t("settingsConfig.fallbackRevertPolicy")}
                      />
                    </NativeSetting>
                  </div>

                  <section data-search-id={slugify("Fallback chain")} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4, border: "1px solid var(--border)", borderRadius: "var(--radius-card)", overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 12px", background: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--text)", fontSize: "var(--text-base)", fontWeight: 600 }}>
                        {t("settingsConfig.fallbackChainFor")}
                        <span style={chipStyle}>{t("settingsConfig.newSessions")}</span>
                      </span>
                      <Select
                        aria-label={t("settingsConfig.fallbackChainRole")}
                        value={fallbackRole}
                        onChange={(value: string) => { setFallbackRole(value); setFallbackCandidate(""); }}
                        required
                        options={NATIVE_MODEL_ROLES}
                        style={{ width: "auto", minWidth: 120 }}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 8, padding: "10px 12px" }}>
                      <Select
                        aria-label={t("settingsConfig.selectFallbackModel")}
                        value={fallbackCandidate}
                        onChange={(value: string) => setFallbackCandidate(value)}
                        placeholder={t("settingsConfig.selectFallbackModel")}
                        options={fallbackModelOptions.filter((model) => !fallbackChain.includes(model))}
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      <button
                        type="button"
                        disabled={!fallbackCandidate}
                        onClick={() => { updateFallbackChain([...fallbackChain, fallbackCandidate]); setFallbackCandidate(""); }}
                        style={{ padding: "6px 10px", border: "none", borderRadius: "var(--radius-control)", background: "var(--accent)", color: "var(--on-accent)", cursor: fallbackCandidate ? "pointer" : "not-allowed", opacity: fallbackCandidate ? 1 : 0.5, fontSize: "var(--text-sm)", whiteSpace: "nowrap" }}
                      >
                        {t("settingsConfig.addFallback")}
                      </button>
                    </div>
                    {fallbackChain.length === 0 ? (
                      <div style={{ padding: "0 12px 12px", color: "var(--text-dim)", fontSize: "var(--text-sm)" }}>{t("settingsConfig.noFallbackChain")}</div>
                    ) : (
                      <div style={{ borderTop: "1px solid var(--border)" }}>
                        {fallbackChain.map((selector, index) => (
                          <div key={`${selector}-${index}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
                            <span style={{ width: 18, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{index + 1}</span>
                            <code style={{ flex: 1 }}>{selector}</code>
                            <button type="button" aria-label={t("settingsConfig.moveFallbackUp", { model: selector })} title={t("settingsConfig.moveFallbackUp", { model: selector })} disabled={index === 0} onClick={() => { const next = [...fallbackChain]; const previous = next[index - 1]; next[index - 1] = next[index]; next[index] = previous; updateFallbackChain(next); }} className="ui-focus-ring" style={{ width: 24, height: 24, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", borderRadius: "calc(var(--radius-control) / 2)", background: "transparent", color: "var(--text-muted)", cursor: index === 0 ? "default" : "pointer" }}><span aria-hidden="true">↑</span></button>
                            <button type="button" aria-label={t("settingsConfig.moveFallbackDown", { model: selector })} title={t("settingsConfig.moveFallbackDown", { model: selector })} disabled={index === fallbackChain.length - 1} onClick={() => { const next = [...fallbackChain]; const following = next[index + 1]; next[index + 1] = next[index]; next[index] = following; updateFallbackChain(next); }} className="ui-focus-ring" style={{ width: 24, height: 24, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", borderRadius: "calc(var(--radius-control) / 2)", background: "transparent", color: "var(--text-muted)", cursor: index === fallbackChain.length - 1 ? "default" : "pointer" }}><span aria-hidden="true">↓</span></button>
                            <button type="button" aria-label={t("settingsConfig.removeFallback", { model: selector })} title={t("settingsConfig.removeFallback", { model: selector })} onClick={() => updateFallbackChain(fallbackChain.filter((value, valueIndex) => valueIndex !== index))} className="ui-focus-ring" style={{ width: 24, height: 24, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", borderRadius: "calc(var(--radius-control) / 2)", background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}><span aria-hidden="true">×</span></button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </section>
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
                    <BuiltInToolsConfig
                      settings={nativeSettings}
                      onPatch={patchSettings}
                    />
                  </div>
                )}

                {extensionTab === "mcp" && (
                  <div role="tabpanel" id="settings-extension-panel-mcp" aria-labelledby="settings-extension-tab-mcp" style={{ display: "flex", flex: 1, minHeight: 0, flexDirection: "column", overflowY: "auto", gap: 12 }}>
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                      <NativeSetting label={t("settingsConfig.loadProjectMcp")} description={t("settingsConfig.loadProjectMcpDesc")} scope="New sessions">
                        <Switch
                          checked={nativeSettings?.mcp?.enableProjectConfig ?? true}
                          onChange={(checked: boolean) => patchSection("mcp", { enableProjectConfig: checked })}
                          aria-label={t("settingsConfig.loadProjectMcp")}
                        />
                      </NativeSetting>
                      <NativeSetting label={t("settingsConfig.renderMcpMarkdown")} description={t("settingsConfig.renderMcpMarkdownDesc")} scope="New sessions">
                        <Switch
                          checked={nativeSettings?.mcp?.renderMarkdownResults ?? true}
                          onChange={(checked: boolean) => patchSection("mcp", { renderMarkdownResults: checked })}
                          aria-label={t("settingsConfig.renderMcpMarkdown")}
                        />
                      </NativeSetting>
                      <NativeSetting label={t("settingsConfig.mcpResourceUpdates")} description={t("settingsConfig.mcpResourceUpdatesDesc")} scope="New sessions">
                        <Switch
                          checked={nativeSettings?.mcp?.notifications ?? false}
                          onChange={(checked: boolean) => patchSection("mcp", { notifications: checked })}
                          aria-label={t("settingsConfig.mcpResourceUpdates")}
                        />
                      </NativeSetting>
                    </div>
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
