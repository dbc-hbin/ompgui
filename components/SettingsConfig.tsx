"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getSubmitDuringRunBehavior, setSubmitDuringRunBehavior, type SubmitDuringRunBehavior } from "@/lib/composer-prefs";
import dynamic from "next/dynamic";
import { Copy, ExternalLink, RefreshCw, RotateCcw, Sparkles, Search, AlertCircle, Monitor, Moon, Sun } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/field";
import { ExtensionsTabs, type ExtensionsTab, SettingsTabs, type SettingsTab, SETTINGS_CATEGORIES, getNormalizedActive } from "./SettingsTabs";
import { useI18n } from "@/lib/i18n";
import { copyText } from "@/lib/clipboard";
import { useTheme } from "@/hooks/useTheme";
import { getSoundEnabled, setSoundEnabled as persistSoundEnabled } from "@/lib/sound-prefs";

const SettingsTabLoading = () => <div role="status" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>Loading settings…</div>;
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

const nativeSelectStyle = {
  minHeight: 32,
  padding: "4px 28px 4px 10px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-control)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 12,
  cursor: "pointer",
  outline: "none",
  colorScheme: "dark light",
} as const;

const nativeOptionStyle = {
  background: "var(--bg-panel)",
  color: "var(--text)",
} as const;

const chipStyle = {
  fontSize: 10,
  padding: "1px 6px",
  borderRadius: 4,
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
      <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
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
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{result.label}</span>
            {result.kind === "category" && (
              <span style={chipStyle}>Section</span>
            )}
            {result.scope && (
              <span style={chipStyle}>{result.scope}</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.45 }}>{result.description}</div>
          {result.section && <div style={{ fontSize: 10, color: "var(--text-dim)" }}>{result.section}</div>}
        </button>
      ))}
    </div>
  );
}

function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        width: 36,
        height: 20,
        borderRadius: 10,
        border: "none",
        background: checked ? "var(--accent)" : "var(--border)",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background var(--dur-fast) var(--ease-out-warm)",
        padding: 2,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          background: "var(--on-accent)",
          transform: checked ? "translateX(16px)" : "translateX(0px)",
          transition: "transform var(--dur-fast) var(--ease-out-warm)",
          boxShadow: "var(--shadow-card)",
        }}
      />
    </button>
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
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>{label}</span>
          {scope && (
            <span style={chipStyle}>
              {scope === "New sessions" ? t("settingsConfig.newSessions") : scope}
            </span>
          )}
        </div>
        <span style={{ flexShrink: 0 }}>{children}</span>
      </div>
      {!hideDescription && (
        <span style={{ color: "var(--text-muted)", fontSize: compact ? 10.5 : 11, lineHeight: compact ? 1.3 : 1.45 }}>{description}</span>
      )}
    </div>
  );
}

export function SettingsConfig({ activeTab, advisorEnabled, onAdvisorChange, toolCallsDefaultCollapsed, onToolCallsDefaultCollapsedChange, cwd, sessionId, systemPrompt, systemPromptLoading, onLoadSystemPrompt, onModelsSaved, onPluginsReloaded, onOmpUpdateAvailabilityChange, onSelectTab, onClose, runtimeReady }: {
  activeTab: SettingsTab;
  advisorEnabled: boolean;
  onAdvisorChange: (enabled: boolean) => void;
  toolCallsDefaultCollapsed: boolean;
  onToolCallsDefaultCollapsedChange: (collapsed: boolean) => void;
  cwd: string | null;
  sessionId: string | null;
  systemPrompt: string | null;
  systemPromptLoading: boolean;
  onLoadSystemPrompt: () => void;
  onModelsSaved: () => void;
  onPluginsReloaded: () => void;
  onOmpUpdateAvailabilityChange: (available: boolean) => void;
  onSelectTab: (tab: SettingsTab) => void;
  onClose: () => void;
  runtimeReady?: boolean;
}) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const { preference, setTheme, palette, setPalette } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [submitBehavior, setSubmitBehavior] = useState<SubmitDuringRunBehavior>(() => getSubmitDuringRunBehavior());
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => getSoundEnabled());
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [checking, setChecking] = useState(true);
  const [appUpdate, setAppUpdate] = useState<UpdateState | null>(null);
  const [checkingAppUpdate, setCheckingAppUpdate] = useState(true);
  const [restarting, setRestarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [nativeSettings, setNativeSettings] = useState<NativeSettings | null>(null);
  const [nativeSettingsError, setNativeSettingsError] = useState<string | null>(null);
  const [nativeSavesInFlight, setNativeSavesInFlight] = useState<number>(0);
  const [nativeApplication, setNativeApplication] = useState<NativeApplication>({ mode: "new-session", restartRequired: false });
  const [availableModels, setAvailableModels] = useState<RuntimeModelOption[]>([]);
  const [fallbackRole, setFallbackRole] = useState<string>("default");
  const [fallbackCandidate, setFallbackCandidate] = useState("");
  const [modelsDirty, setModelsDirty] = useState(false);
  const [modelsEditorKey, setModelsEditorKey] = useState(0);
  const [pendingAction, setPendingAction] = useState<{ kind: "close" } | { kind: "tab"; tab: SettingsTab } | null>(null);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [visitedTabs, setVisitedTabs] = useState<Set<SettingsTab>>(() => new Set(["general", activeTab]));
  const latestNativeSettingsRef = useRef<NativeSettings | null>(null);
  const nativeSaveDrainingRef = useRef(false);
  const nativeSettingsMutatedRef = useRef(false);

  useEffect(() => {
    setVisitedTabs((tabs) => (tabs.has(activeTab) ? tabs : new Set([...tabs, activeTab])));
  }, [activeTab]);

  useEffect(() => {
    fetch("/api/omp-settings")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((data: { settings?: NativeSettings; application?: NativeApplication }) => {
        if (!nativeSettingsMutatedRef.current) setNativeSettings(data.settings ?? {});
        if (data.application && (data.application.mode === "new-session" || data.application.mode === "runtime-refresh") && typeof data.application.restartRequired === "boolean") {
          setNativeApplication(data.application);
        }
      })
      .catch((error) => setNativeSettingsError(error instanceof Error ? error.message : String(error)));
  }, []);

  useEffect(() => {
    fetch("/api/models", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((data: { modelList?: RuntimeModelOption[] }) => {
        setAvailableModels(Array.isArray(data.modelList) ? data.modelList.filter((model) => typeof model?.provider === "string" && typeof model?.id === "string") : []);
      })
      .catch(() => setAvailableModels([]));
  }, []);

  const saveNativeSettings = useCallback((next: NativeSettings) => {
    nativeSettingsMutatedRef.current = true;
    setNativeSettings(next);
    setNativeSettingsError(null);
    latestNativeSettingsRef.current = next;
    if (nativeSaveDrainingRef.current) return;
    nativeSaveDrainingRef.current = true;
    setNativeSavesInFlight((count) => count + 1);

    void (async () => {
      try {
        while (latestNativeSettingsRef.current !== null) {
          const snapshot = latestNativeSettingsRef.current;
          latestNativeSettingsRef.current = null;
          try {
            const response = await fetch("/api/omp-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: snapshot }) });
            const data = (await response.json()) as { settings?: NativeSettings; error?: string; application?: NativeApplication };
            if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
            if (data.application && (data.application.mode === "new-session" || data.application.mode === "runtime-refresh") && typeof data.application.restartRequired === "boolean") {
              setNativeApplication(data.application);
            }
            if (latestNativeSettingsRef.current === null) setNativeSettings(data.settings ?? snapshot);
          } catch (error) {
            setNativeSettingsError(error instanceof Error ? error.message : String(error));
            break;
          }
        }
      } finally {
        nativeSaveDrainingRef.current = false;
        setNativeSavesInFlight((count) => Math.max(0, count - 1));
      }
    })();
  }, []);

  const currentSettings = (): NativeSettings => latestNativeSettingsRef.current ?? nativeSettings ?? {};

  const patchSettings = (patch: Partial<NativeSettings>) => {
    void saveNativeSettings({ ...currentSettings(), ...patch });
  };

  // `key` is always an object-valued section here (tools/advisor/compaction/...),
  // so the section spread is safe; the cast keeps the generic index type-checkable.
  const patchSection = <K extends keyof NativeSettings>(key: K, patch: Partial<NonNullable<NativeSettings[K]>>) => {
    const base = latestNativeSettingsRef.current;
    const section = (base ?? nativeSettings?.[key] ?? {}) as object;
    void saveNativeSettings({
      ...currentSettings(),
      [key]: { ...section, ...patch },
    });
  };

  const fallbackModelOptions = useMemo(
    () => Array.from(new Set(availableModels.map((model) => `${model.provider}/${model.id}`))),
    [availableModels],
  );
  const retrySettings = nativeSettings?.retry ?? {};
  const fallbackChain = retrySettings.fallbackChains?.[fallbackRole] ?? [];
  const updateFallbackChain = (chain: string[]) => {
    const currentRetry = currentSettings().retry ?? {};
    patchSection("retry", {
      fallbackChains: {
        ...(currentRetry.fallbackChains ?? {}),
        [fallbackRole]: chain,
      },
    });
  };

  // tools.approval is itself a nested object, so it needs its own base spread.
  const patchApproval = (patch: Partial<NonNullable<NonNullable<NativeSettings["tools"]>["approval"]>>) => {
    const base = latestNativeSettingsRef.current ?? nativeSettings ?? {};
    const tools = base.tools ?? {};
    void saveNativeSettings({ ...base, tools: { ...tools, approval: { ...(tools.approval ?? {}), ...patch } } });
  };

  const checkForUpdate = useCallback(async () => {
    setChecking(true);
    setMessage(null);
    try {
      const response = await fetch("/api/omp-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check" }) });
      const data = (await response.json()) as UpdateState & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
      setUpdate(data);
      onOmpUpdateAvailabilityChange(data.updateAvailable);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  }, [onOmpUpdateAvailabilityChange]);

  useEffect(() => {
    void checkForUpdate();
  }, [checkForUpdate]);

  const checkForAppUpdate = useCallback(async (force = false) => {
    setCheckingAppUpdate(true);
    try {
      const response = await fetch(force ? "/api/app-update?force=1" : "/api/app-update");
      const data = (await response.json()) as UpdateState & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
      setAppUpdate(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCheckingAppUpdate(false);
    }
  }, []);

  useEffect(() => {
    void checkForAppUpdate();
  }, [checkForAppUpdate]);

  const restartSessions = useCallback(async () => {
    setRestarting(true);
    try {
      const response = await fetch("/api/omp-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restart" }) });
      const data = (await response.json()) as { error?: string; sessionsRestarted?: number };
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
      setMessage(t("settingsConfig.restartSuccess", { count: data.sessionsRestarted ?? 0 }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRestarting(false);
    }
  }, [t]);

  const currentTab = getNormalizedActive(activeTab);
  const extensionTab: ExtensionsTab = activeTab === "skills" ? "skills" : activeTab === "plugins" ? "plugins" : "mcp";

  const requestClose = useCallback(() => {
    if (!modelsDirty) {
      onClose();
      return;
    }
    setPendingAction({ kind: "close" });
    setDiscardDialogOpen(true);
  }, [modelsDirty, onClose]);

  const requestTabChange = useCallback((tab: SettingsTab) => {
    if (tab === activeTab) return;
    if (!modelsDirty) {
      onSelectTab(tab);
      return;
    }
    setPendingAction({ kind: "tab", tab });
    setDiscardDialogOpen(true);
  }, [activeTab, modelsDirty, onSelectTab]);

  const confirmDiscard = useCallback(() => {
    const action = pendingAction;
    setPendingAction(null);
    setDiscardDialogOpen(false);
    setModelsDirty(false);
    if (action?.kind === "tab") {
      setModelsEditorKey((key) => key + 1);
      onSelectTab(action.tab);
    } else if (action?.kind === "close") {
      onClose();
    }
  }, [onClose, onSelectTab, pendingAction]);

  const requestCategoryChange = useCallback((tab: SettingsTab) => {
    if (getNormalizedActive(tab) === currentTab) return;
    requestTabChange(tab);
  }, [currentTab, requestTabChange]);

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const searchActive = trimmedQuery.length > 0;

  const searchResults = useMemo<SearchResult[]>(() => {
    if (!trimmedQuery) return [];
    const results: SearchResult[] = [];
    for (const category of SETTINGS_CATEGORIES) {
      const haystack = `${category.label} ${category.description}`.toLowerCase();
      if (haystack.includes(trimmedQuery)) {
        results.push({ id: `tab-${category.id}`, kind: "category", tab: category.id, label: category.label, description: category.description });
      }
    }
    for (const setting of SETTING_INDEX) {
      const label = setting.labelKey ? t(setting.labelKey) : setting.label;
      const description = setting.descriptionKey ? t(setting.descriptionKey) : setting.description;
      const section = setting.sectionKey ? t(setting.sectionKey) : setting.section;
      const haystack = `${label} ${description} ${section}`.toLowerCase();
      if (haystack.includes(trimmedQuery)) {
        results.push({ id: slugify(setting.label), kind: "setting", tab: setting.tab, label, description, scope: setting.scope, section });
      }
    }
    return results;
  }, [trimmedQuery, t]);

  const openSearchResult = useCallback((result: SearchResult) => {
    requestTabChange(result.tab);
    setHighlightId(result.kind === "setting" ? result.id : null);
    setSearchQuery("");
  }, [requestTabChange]);

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>
      <DialogContent ariaLabel="Settings" style={{ width: isMobile ? "calc(100vw - 16px)" : 940, maxWidth: "calc(100vw - 16px)", height: isMobile ? "calc(100dvh - 16px)" : "82vh", maxHeight: "calc(100dvh - 16px)", padding: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: isMobile ? 8 : 14, padding: isMobile ? "10px 14px" : "12px 18px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <DialogTitle style={{ fontSize: 16, margin: 0, fontWeight: 600 }}>{t("settingsConfig.title")}</DialogTitle>
            {nativeSavesInFlight > 0 ? (
              <span style={{ fontSize: 11, color: "var(--accent)", padding: "2px 8px", borderRadius: 10, background: "var(--bg-subtle)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <RefreshCw size={11} className="spin" aria-hidden="true" /> {t("settingsConfig.saving")}
              </span>
            ) : (
              <span style={{ fontSize: 11, color: "var(--text-dim)", padding: "2px 8px", borderRadius: 10, background: "var(--bg-subtle)" }}>
                {t("settingsConfig.autoSaved")}
              </span>
            )}
            <span
              aria-live="polite"
              title={nativeApplication.mode === "runtime-refresh" ? `${t("settingsConfig.activeSessionsUnchanged")}${nativeApplication.restartRequired ? ` · ${t("settingsConfig.restartRequired")}` : ""}` : nativeApplication.restartRequired ? t("settingsConfig.restartRequired") : undefined}
              style={{ fontSize: 10.5, color: "var(--text-muted)", padding: "2px 7px", borderRadius: 10, background: "var(--bg-subtle)", whiteSpace: "nowrap" }}
            >
              {nativeApplication.mode === "runtime-refresh" ? t("settingsConfig.runtimeRefresh") : t("settingsConfig.newSessions")}
              {nativeApplication.restartRequired ? ` · ${t("settingsConfig.restartRequired")}` : ""}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, maxWidth: 360, justifyContent: "flex-end" }}>
            <div style={{ position: "relative", width: "100%", maxWidth: 260 }}>
              <Search size={13} aria-hidden="true" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
              <input
                type="text"
                aria-label={t("settingsConfig.searchAria")}
                placeholder={t("settingsConfig.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setSearchQuery("");
                    setHighlightId(null);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                style={{ width: "100%", height: 28, padding: "0 8px 0 28px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none" }}
              />
            </div>
            <button type="button" onClick={requestClose} aria-label={t("settingsConfig.close")} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
          </div>
        </header>

        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden" }}>
          {searchActive ? (
            <SearchResultsList results={searchResults} query={searchQuery.trim()} onSelect={openSearchResult} />
          ) : (
            <SettingsHighlightContext.Provider value={highlightId}>
              {isMobile ? (
                <SettingsTabs active={currentTab} onSelect={requestCategoryChange} layout="horizontal" />
              ) : (
                <SettingsTabs active={currentTab} onSelect={requestCategoryChange} layout="vertical" />
              )}

              <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflowY: "auto", background: "var(--bg)" }}>
            {nativeSettingsError && (
              <div role="alert" style={{ margin: 16, padding: "10px 14px", borderRadius: "var(--radius-card)", background: "var(--bg-panel)", border: "1px solid var(--status-error)", color: "var(--status-error)", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <AlertCircle size={14} aria-hidden="true" /> {nativeSettingsError}
              </div>
            )}

            {/* GENERAL & UI TAB */}
            {currentTab === "general" && (
              <div role="tabpanel" id="settings-panel-general" aria-labelledby="settings-tab-general" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{t("settingsConfig.generalTitle")}</h3>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>{t("settingsConfig.generalDescription")}</p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <NativeSetting label={t("settingsConfig.themeMode")} description={t("settingsConfig.themeModeDesc")} scope="UI">
                    <div
                      role="radiogroup"
                      aria-label={t("settingsConfig.themeMode")}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 2,
                        padding: 2,
                        background: "var(--bg)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-control)",
                      }}
                    >
                      {(["system", "light", "dark"] as const).map((mode) => {
                        const selected = preference === mode;
                        const label = mode === "system"
                          ? t("settingsConfig.themeModeSystem")
                          : mode === "light"
                          ? t("settingsConfig.themeModeLight")
                          : t("settingsConfig.themeModeDark");
                        const Icon = mode === "system" ? Monitor : mode === "light" ? Sun : Moon;
                        return (
                          <button
                            key={mode}
                            type="button"
                            className="ui-focus-ring"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => setTheme(mode)}
                            title={label}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              height: 24,
                              padding: "0 8px",
                              border: "none",
                              borderRadius: "calc(var(--radius-control) - 2px)",
                              background: selected ? "var(--bg-selected)" : "transparent",
                              color: selected ? "var(--text)" : "var(--text-muted)",
                              fontWeight: selected ? 600 : 500,
                              fontSize: 11,
                              cursor: "pointer",
                              transition: "background var(--dur-fast) var(--ease-out-warm), color var(--dur-fast) var(--ease-out-warm)",
                              outline: "none",
                            }}
                          >
                            <Icon size={12} aria-hidden="true" style={{ color: selected ? "var(--accent)" : "currentColor", flexShrink: 0 }} />
                            <span>{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </NativeSetting>
                  <NativeSetting label={t("settingsConfig.themePalette")} description={t("settingsConfig.themePaletteDesc")} scope="UI">
                    <div
                      role="radiogroup"
                      aria-label={t("settingsConfig.themePalette")}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 2,
                        padding: 2,
                        background: "var(--bg)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-control)",
                      }}
                    >
                      {(["warm", "omp"] as const).map((pal) => {
                        const selected = palette === pal;
                        const label = pal === "warm"
                          ? t("settingsConfig.paletteWarm")
                          : t("settingsConfig.paletteOmp");
                        return (
                          <button
                            key={pal}
                            type="button"
                            className="ui-focus-ring"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => setPalette(pal)}
                            title={label}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              height: 24,
                              padding: "0 8px",
                              border: "none",
                              borderRadius: "calc(var(--radius-control) - 2px)",
                              background: selected ? "var(--bg-selected)" : "transparent",
                              color: selected ? "var(--text)" : "var(--text-muted)",
                              fontWeight: selected ? 600 : 500,
                              fontSize: 11,
                              cursor: "pointer",
                              transition: "background var(--dur-fast) var(--ease-out-warm), color var(--dur-fast) var(--ease-out-warm)",
                              outline: "none",
                            }}
                          >
                            <span
                              aria-hidden="true"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 2.5,
                                padding: "2px 3px",
                                borderRadius: 3,
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
                    <ToggleSwitch checked={toolCallsDefaultCollapsed} onChange={onToolCallsDefaultCollapsedChange} />
                  </NativeSetting>
                  <NativeSetting label={t("settingsConfig.completionSound")} description={t("settingsConfig.completionSoundDesc")} scope="UI">
                    <ToggleSwitch
                      checked={soundEnabled}
                      onChange={(next) => {
                        setSoundEnabled(next);
                        persistSoundEnabled(next);
                        window.dispatchEvent(new CustomEvent("omp-sound-pref-change", { detail: next }));
                      }}
                    />
                  </NativeSetting>
                </div>
                <NativeSetting label={t("settingsConfig.submitBehavior")} description={t("settingsConfig.submitBehaviorDesc")} scope="UI">
                  <select
                    style={nativeSelectStyle}
                    value={submitBehavior}
                    onChange={(event) => {
                      const next = event.target.value as SubmitDuringRunBehavior;
                      setSubmitDuringRunBehavior(next);
                      setSubmitBehavior(next);
                    }}
                  >
                    <option value="steer" style={nativeOptionStyle}>{t("settingsConfig.steerCurrent")}</option>
                    <option value="queue" style={nativeOptionStyle}>{t("settingsConfig.queueFollowUp")}</option>
                  </select>
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
                  <select
                    style={nativeSelectStyle}
                    value={nativeSettings?.task?.eager ?? "default"}
                    onChange={(event) => patchSection("task", { eager: event.target.value as NonNullable<NativeSettings["task"]>["eager"] })}
                  >
                    <option value="default" style={nativeOptionStyle}>{t("settingsConfig.delegationDefault")}</option>
                    <option value="preferred" style={nativeOptionStyle}>{t("settingsConfig.delegationPreferred")}</option>
                    <option value="always" style={nativeOptionStyle}>{t("settingsConfig.delegationAlways")}</option>
                  </select>
                </NativeSetting>
                <AgentsConfig cwd={cwd ?? undefined} onSaved={onModelsSaved} />
              </div>
            )}

            {/* SAFETY & APPROVALS TAB */}
            {currentTab === "safety" && (
              <div role="tabpanel" id="settings-panel-safety" aria-labelledby="settings-tab-safety" style={{ padding: isMobile ? "12px 14px" : 20, display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{t("settingsConfig.safetyTitle")}</h3>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>{t("settingsConfig.safetyDescription")}</p>
                </div>
                <NativeSetting label={t("settingsConfig.approvalMode")} description={t("settingsConfig.approvalModeDesc")} scope="New sessions" compact hideDescription={isMobile}>
                  <select
                    style={nativeSelectStyle}
                    value={nativeSettings?.tools?.approvalMode ?? "yolo"}
                    onChange={(event) => patchSection("tools", { approvalMode: event.target.value as "always-ask" | "write" | "yolo" })}
                  >
                    <option value="always-ask" style={nativeOptionStyle}>{t("settingsConfig.approvalAlwaysAsk")}</option>
                    <option value="write" style={nativeOptionStyle}>{t("settingsConfig.approvalWrite")}</option>
                    <option value="yolo" style={nativeOptionStyle}>{t("settingsConfig.approvalYolo")}</option>
                  </select>
                </NativeSetting>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <NativeSetting label={t("settingsConfig.bashApproval")} description={t("settingsConfig.bashApprovalDesc")} scope="New sessions">
                    <select
                      style={nativeSelectStyle}
                      value={nativeSettings?.tools?.approval?.bash ?? "prompt"}
                      onChange={(event) => patchApproval({ bash: event.target.value as "allow" | "prompt" | "deny" })}
                    >
                      <option value="allow" style={nativeOptionStyle}>{t("settingsConfig.allow")}</option>
                      <option value="prompt" style={nativeOptionStyle}>{t("settingsConfig.alwaysAsk")}</option>
                      <option value="deny" style={nativeOptionStyle}>{t("settingsConfig.deny")}</option>
                    </select>
                  </NativeSetting>
                  <NativeSetting label={t("settingsConfig.extensionApproval")} description={t("settingsConfig.extensionApprovalDesc")} scope="New sessions">
                    <select
                      style={nativeSelectStyle}
                      value={nativeSettings?.tools?.approval?.extension ?? "prompt"}
                      onChange={(event) => patchApproval({ extension: event.target.value as "allow" | "prompt" })}
                    >
                      <option value="prompt" style={nativeOptionStyle}>{t("settingsConfig.askEveryTime")}</option>
                      <option value="allow" style={nativeOptionStyle}>{t("settingsConfig.autoApprove")}</option>
                    </select>
                  </NativeSetting>
                </div>
              </div>
            )}

            {/* AI MODEL DEFAULTS TAB */}
            {currentTab === "models" && (
              <div role="tabpanel" id="settings-panel-models" aria-labelledby="settings-tab-models" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{t("settingsConfig.modelsTitle")}</h3>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>{t("settingsConfig.modelsDescription")}</p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <NativeSetting label={t("settingsConfig.reasoning")} description={t("settingsConfig.reasoningDesc")} scope="New sessions">
                    <select
                      style={nativeSelectStyle}
                      value={nativeSettings?.defaultThinkingLevel ?? "high"}
                      onChange={(e) => patchSettings({ defaultThinkingLevel: e.target.value as NativeSettings["defaultThinkingLevel"] })}
                    >
                      {["auto", "minimal", "low", "medium", "high", "xhigh", "max"].map((l) => (
                        <option key={l} value={l} style={nativeOptionStyle}>{l}</option>
                      ))}
                    </select>
                  </NativeSetting>
                  <NativeSetting label={t("settingsConfig.verbosity")} description={t("settingsConfig.verbosityDesc")} scope="New sessions">
                    <select
                      style={nativeSelectStyle}
                      value={nativeSettings?.textVerbosity ?? "medium"}
                      onChange={(e) => patchSettings({ textVerbosity: e.target.value as NativeSettings["textVerbosity"] })}
                    >
                      {["low", "medium", "high"].map((l) => (
                        <option key={l} value={l} style={nativeOptionStyle}>{l}</option>
                      ))}
                    </select>
                  </NativeSetting>
                  <NativeSetting label={t("settingsConfig.personality")} description={t("settingsConfig.personalityDesc")} scope="New sessions">
                    <select
                      style={nativeSelectStyle}
                      value={nativeSettings?.personality ?? "default"}
                      onChange={(e) => patchSettings({ personality: e.target.value as NativeSettings["personality"] })}
                    >
                      {["default", "friendly", "pragmatic", "none"].map((p) => (
                        <option key={p} value={p} style={nativeOptionStyle}>{p}</option>
                      ))}
                    </select>
                  </NativeSetting>
                  <NativeSetting label={t("settingsConfig.hideThinking")} description={t("settingsConfig.hideThinkingDesc")} scope="New sessions">
                    <ToggleSwitch
                      checked={nativeSettings?.hideThinkingBlock ?? false}
                      onChange={(checked) => patchSettings({ hideThinkingBlock: checked })}
                    />
                  </NativeSetting>
                  <NativeSetting label={t("settingsConfig.externalThinking")} description={t("settingsConfig.externalThinkingDesc")} scope="New sessions">
                    <ToggleSwitch
                      checked={nativeSettings?.externalThinking ?? false}
                      onChange={(checked) => patchSettings({ externalThinking: checked })}
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
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
                    <Sparkles size={14} aria-hidden="true" style={{ color: "var(--accent)" }} /> {t("settingsConfig.advisorReview")}
                  </div>
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>{t("settingsConfig.advisorReviewDesc")}</p>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    <NativeSetting label={t("settingsConfig.enableAdvisor")} description={t("settingsConfig.enableAdvisorDesc")} scope="New sessions">
                      <ToggleSwitch
                        checked={nativeSettings?.advisor?.enabled ?? advisorEnabled}
                        onChange={(enabled) => {
                          onAdvisorChange(enabled);
                          patchSection("advisor", { enabled });
                        }}
                      />
                    </NativeSetting>
                    {(nativeSettings?.advisor?.enabled ?? advisorEnabled) && (
                      <NativeSetting label={t("settingsConfig.advisorBacklog")} description={t("settingsConfig.advisorBacklogDesc")} scope="New sessions">
                        <select
                          style={nativeSelectStyle}
                          value={nativeSettings?.advisor?.syncBacklog ?? "off"}
                          onChange={(e) => patchSection("advisor", { syncBacklog: e.target.value as "off" | "1" | "3" | "5" })}
                        >
                          <option value="off" style={nativeOptionStyle}>{t("settingsConfig.backlogOff")}</option>
                          <option value="1" style={nativeOptionStyle}>{t("settingsConfig.backlog1")}</option>
                          <option value="3" style={nativeOptionStyle}>{t("settingsConfig.backlog3")}</option>
                          <option value="5" style={nativeOptionStyle}>{t("settingsConfig.backlog5")}</option>
                        </select>
                      </NativeSetting>
                    )}
                  </div>
                  {(nativeSettings?.advisor?.enabled ?? advisorEnabled) && (
                    <NativeSetting label={t("settingsConfig.reviewSubagents")} description={t("settingsConfig.reviewSubagentsDesc")} scope="New sessions">
                      <ToggleSwitch
                        checked={nativeSettings?.advisor?.subagents ?? false}
                        onChange={(checked) => patchSection("advisor", { subagents: checked })}
                      />
                    </NativeSetting>
                  )}
                </section>

                {/* Context Compaction Section */}
                <section style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t("settingsConfig.contextCompaction")}</div>
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>{t("settingsConfig.contextCompactionDesc")}</p>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    <NativeSetting label={t("settingsConfig.autoCompaction")} description={t("settingsConfig.autoCompactionDesc")} scope="New sessions">
                      <ToggleSwitch
                        checked={nativeSettings?.compaction?.enabled ?? true}
                        onChange={(checked) => patchSection("compaction", { enabled: checked })}
                      />
                    </NativeSetting>
                    <NativeSetting label={t("settingsConfig.autoContinueCompaction")} description={t("settingsConfig.autoContinueCompactionDesc")} scope="New sessions">
                      <ToggleSwitch
                        checked={nativeSettings?.compaction?.autoContinue ?? true}
                        onChange={(checked) => patchSection("compaction", { autoContinue: checked })}
                      />
                    </NativeSetting>
                    <NativeSetting label={t("settingsConfig.compactionStrategy")} description={t("settingsConfig.compactionStrategyDesc")} scope="New sessions">
                      <select
                        style={nativeSelectStyle}
                        value={nativeSettings?.compaction?.strategy ?? "snapcompact"}
                        onChange={(e) => patchSection("compaction", { strategy: e.target.value as NonNullable<NativeSettings["compaction"]>["strategy"] })}
                      >
                        <option value="snapcompact" style={nativeOptionStyle}>Snapcompact</option>
                        <option value="handoff" style={nativeOptionStyle}>Handoff</option>
                        <option value="context-full" style={nativeOptionStyle}>Context full</option>
                        <option value="shake" style={nativeOptionStyle}>Shake</option>
                        <option value="off" style={nativeOptionStyle}>Off</option>
                      </select>
                    </NativeSetting>
                    <NativeSetting label={t("settingsConfig.compactMidTurn")} description={t("settingsConfig.compactMidTurnDesc")} scope="New sessions">
                      <ToggleSwitch
                        checked={nativeSettings?.compaction?.midTurnEnabled ?? true}
                        onChange={(checked) => patchSection("compaction", { midTurnEnabled: checked })}
                      />
                    </NativeSetting>
                  </div>
                </section>

                {/* Memory & Auto-Learn Section */}
                <section style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t("settingsConfig.memoryAndAutoLearn")}</div>
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>{t("settingsConfig.memoryAndAutoLearnDesc")}</p>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    <NativeSetting label={t("settingsConfig.memoryBackend")} description={t("settingsConfig.memoryBackendDesc")} scope="New sessions">
                      <select
                        style={nativeSelectStyle}
                        value={nativeSettings?.memory?.backend ?? "mnemopi"}
                        onChange={(e) => patchSection("memory", { backend: e.target.value as NonNullable<NativeSettings["memory"]>["backend"] })}
                      >
                        <option value="off" style={nativeOptionStyle}>{t("settingsConfig.backlogOff")}</option>
                        <option value="local" style={nativeOptionStyle}>{t("settingsConfig.memoryLocal")}</option>
                        <option value="mnemopi" style={nativeOptionStyle}>{t("settingsConfig.memoryMnemopi")}</option>
                        <option value="hindsight" style={nativeOptionStyle}>{t("settingsConfig.memoryHindsight")}</option>
                      </select>
                    </NativeSetting>
                    <NativeSetting label={t("settingsConfig.enableAutolearn")} description={t("settingsConfig.enableAutolearnDesc")} scope="New sessions">
                      <ToggleSwitch
                        checked={nativeSettings?.autolearn?.enabled ?? true}
                        onChange={(checked) => patchSection("autolearn", { enabled: checked })}
                      />
                    </NativeSetting>
                    <NativeSetting label={t("settingsConfig.privateCaptureTurn")} description={t("settingsConfig.privateCaptureTurnDesc")} scope="New sessions">
                      <ToggleSwitch
                        checked={nativeSettings?.autolearn?.autoContinue ?? true}
                        onChange={(checked) => patchSection("autolearn", { autoContinue: checked })}
                      />
                    </NativeSetting>
                    <NativeSetting label={t("settingsConfig.memoryScope")} description={t("settingsConfig.memoryScopeDesc")} scope="New sessions">
                      <select
                        style={nativeSelectStyle}
                        value={nativeSettings?.mnemopi?.scoping ?? "per-project"}
                        onChange={(e) => patchSection("mnemopi", { scoping: e.target.value as NonNullable<NativeSettings["mnemopi"]>["scoping"] })}
                      >
                        <option value="per-project" style={nativeOptionStyle}>{t("settingsConfig.scopePerProject")}</option>
                        <option value="per-project-tagged" style={nativeOptionStyle}>{t("settingsConfig.scopePerProjectTagged")}</option>
                        <option value="global" style={nativeOptionStyle}>{t("settingsConfig.scopeGlobal")}</option>
                      </select>
                    </NativeSetting>
                    <NativeSetting label={t("settingsConfig.autoRecall")} description={t("settingsConfig.autoRecallDesc")} scope="New sessions">
                      <ToggleSwitch
                        checked={nativeSettings?.mnemopi?.autoRecall ?? true}
                        onChange={(checked) => patchSection("mnemopi", { autoRecall: checked })}
                      />
                    </NativeSetting>
                    <NativeSetting label={t("settingsConfig.autoRetain")} description={t("settingsConfig.autoRetainDesc")} scope="New sessions">
                      <ToggleSwitch
                        checked={nativeSettings?.mnemopi?.autoRetain ?? true}
                        onChange={(checked) => patchSection("mnemopi", { autoRetain: checked })}
                      />
                    </NativeSetting>
                  </div>
                </section>

                {/* Retry and fallback are edited here only; provider/model setup stays in ModelsConfig. */}
                <section style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t("settingsConfig.autoRetry")}</div>
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>{t("settingsConfig.autoRetryDesc")}</p>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    <NativeSetting label={t("settingsConfig.enableRetry")} description={t("settingsConfig.enableRetryDesc")} scope="New sessions">
                      <ToggleSwitch
                        checked={retrySettings.enabled ?? NATIVE_RETRY_DEFAULTS.enabled}
                        onChange={(checked) => patchSection("retry", { enabled: checked })}
                      />
                    </NativeSetting>
                    <NativeSetting label={t("settingsConfig.maxAttempts")} description={t("settingsConfig.maxAttemptsDesc")} scope="New sessions">
                      <select
                        style={nativeSelectStyle}
                        value={String(retrySettings.maxRetries ?? NATIVE_RETRY_DEFAULTS.maxRetries)}
                        onChange={(e) => patchSection("retry", { maxRetries: Number(e.target.value) })}
                      >
                        {NATIVE_RETRY_COUNTS.map((n) => (
                          <option key={n} value={n} style={nativeOptionStyle}>{n}</option>
                        ))}
                      </select>
                    </NativeSetting>
                    <NativeSetting label={t("settingsConfig.modelFallback")} description={t("settingsConfig.modelFallbackDesc")} scope="New sessions">
                      <ToggleSwitch
                        checked={retrySettings.modelFallback ?? NATIVE_RETRY_DEFAULTS.modelFallback}
                        onChange={(checked) => patchSection("retry", { modelFallback: checked })}
                      />
                    </NativeSetting>
                    <NativeSetting label={t("settingsConfig.fallbackRevertPolicy")} description={t("settingsConfig.fallbackRevertPolicyDesc")} scope="New sessions">
                      <select
                        style={nativeSelectStyle}
                        value={retrySettings.fallbackRevertPolicy ?? NATIVE_RETRY_DEFAULTS.fallbackRevertPolicy}
                        onChange={(e) => patchSection("retry", { fallbackRevertPolicy: e.target.value as NonNullable<NativeSettings["retry"]>["fallbackRevertPolicy"] })}
                      >
                        <option value="cooldown-expiry" style={nativeOptionStyle}>{t("settingsConfig.fallbackRevertCooldown")}</option>
                        <option value="never" style={nativeOptionStyle}>{t("settingsConfig.fallbackRevertNever")}</option>
                      </select>
                    </NativeSetting>
                  </div>

                  <section data-search-id={slugify("Fallback chain")} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4, border: "1px solid var(--border)", borderRadius: "var(--radius-card)", overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 12px", background: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--text)", fontSize: 12.5, fontWeight: 600 }}>
                        {t("settingsConfig.fallbackChainFor")}
                        <span style={chipStyle}>{t("settingsConfig.newSessions")}</span>
                      </span>
                      <select
                        aria-label={t("settingsConfig.fallbackChainRole")}
                        value={fallbackRole}
                        onChange={(event) => { setFallbackRole(event.target.value); setFallbackCandidate(""); }}
                        style={{ ...nativeSelectStyle, minHeight: 28, padding: "3px 26px 3px 8px" }}
                      >
                        {NATIVE_MODEL_ROLES.map((role) => <option key={role} value={role} style={nativeOptionStyle}>{role}</option>)}
                      </select>
                    </div>
                    <div style={{ display: "flex", gap: 8, padding: "10px 12px" }}>
                      <select
                        aria-label={t("settingsConfig.selectFallbackModel")}
                        value={fallbackCandidate}
                        onChange={(event) => setFallbackCandidate(event.target.value)}
                        style={{ ...nativeSelectStyle, flex: 1, minWidth: 0 }}
                      >
                        <option value="" style={nativeOptionStyle}>{t("settingsConfig.selectFallbackModel")}</option>
                        {fallbackModelOptions.filter((model) => !fallbackChain.includes(model)).map((model) => <option key={model} value={model} style={nativeOptionStyle}>{model}</option>)}
                      </select>
                      <button
                        type="button"
                        disabled={!fallbackCandidate}
                        onClick={() => { updateFallbackChain([...fallbackChain, fallbackCandidate]); setFallbackCandidate(""); }}
                        style={{ padding: "6px 10px", border: "none", borderRadius: "var(--radius-control)", background: "var(--accent)", color: "var(--on-accent)", cursor: fallbackCandidate ? "pointer" : "not-allowed", opacity: fallbackCandidate ? 1 : 0.5, fontSize: 12, whiteSpace: "nowrap" }}
                      >
                        {t("settingsConfig.addFallback")}
                      </button>
                    </div>
                    {fallbackChain.length === 0 ? (
                      <div style={{ padding: "0 12px 12px", color: "var(--text-dim)", fontSize: 11.5 }}>{t("settingsConfig.noFallbackChain")}</div>
                    ) : (
                      <div style={{ borderTop: "1px solid var(--border)" }}>
                        {fallbackChain.map((selector, index) => (
                          <div key={`${selector}-${index}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", color: "var(--text-muted)", fontSize: 11.5 }}>
                            <span style={{ width: 18, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{index + 1}</span>
                            <code style={{ flex: 1 }}>{selector}</code>
                            <button type="button" aria-label={t("settingsConfig.moveFallbackUp", { model: selector })} title={t("settingsConfig.moveFallbackUp", { model: selector })} disabled={index === 0} onClick={() => { const next = [...fallbackChain]; const previous = next[index - 1]; next[index - 1] = next[index]; next[index] = previous; updateFallbackChain(next); }} className="ui-focus-ring" style={{ width: 24, height: 24, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", borderRadius: 4, background: "transparent", color: "var(--text-muted)", cursor: index === 0 ? "default" : "pointer" }}><span aria-hidden="true">↑</span></button>
                            <button type="button" aria-label={t("settingsConfig.moveFallbackDown", { model: selector })} title={t("settingsConfig.moveFallbackDown", { model: selector })} disabled={index === fallbackChain.length - 1} onClick={() => { const next = [...fallbackChain]; const following = next[index + 1]; next[index + 1] = next[index]; next[index] = following; updateFallbackChain(next); }} className="ui-focus-ring" style={{ width: 24, height: 24, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", borderRadius: 4, background: "transparent", color: "var(--text-muted)", cursor: index === fallbackChain.length - 1 ? "default" : "pointer" }}><span aria-hidden="true">↓</span></button>
                            <button type="button" aria-label={t("settingsConfig.removeFallback", { model: selector })} title={t("settingsConfig.removeFallback", { model: selector })} onClick={() => updateFallbackChain(fallbackChain.filter((value, valueIndex) => valueIndex !== index))} className="ui-focus-ring" style={{ width: 24, height: 24, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", borderRadius: 4, background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}><span aria-hidden="true">×</span></button>
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
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{t("settingsTabs.extensions")}</h3>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>{t("settingsTabs.extensionsDesc")}</p>
                </div>
                <ExtensionsTabs active={extensionTab} onSelect={requestTabChange} />

                {extensionTab === "mcp" && (
                  <div role="tabpanel" id="settings-extension-panel-mcp" aria-labelledby="settings-extension-tab-mcp" style={{ display: "flex", flex: 1, minHeight: 0, flexDirection: "column", overflowY: "auto", gap: 12 }}>
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                      <NativeSetting label={t("settingsConfig.loadProjectMcp")} description={t("settingsConfig.loadProjectMcpDesc")} scope="New sessions">
                        <ToggleSwitch
                          checked={nativeSettings?.mcp?.enableProjectConfig ?? true}
                          onChange={(checked) => patchSection("mcp", { enableProjectConfig: checked })}
                        />
                      </NativeSetting>
                      <NativeSetting label={t("settingsConfig.renderMcpMarkdown")} description={t("settingsConfig.renderMcpMarkdownDesc")} scope="New sessions">
                        <ToggleSwitch
                          checked={nativeSettings?.mcp?.renderMarkdownResults ?? true}
                          onChange={(checked) => patchSection("mcp", { renderMarkdownResults: checked })}
                        />
                      </NativeSetting>
                      <NativeSetting label={t("settingsConfig.mcpResourceUpdates")} description={t("settingsConfig.mcpResourceUpdatesDesc")} scope="New sessions">
                        <ToggleSwitch
                          checked={nativeSettings?.mcp?.notifications ?? false}
                          onChange={(checked) => patchSection("mcp", { notifications: checked })}
                        />
                      </NativeSetting>
                    </div>
                    <McpConfig cwd={cwd} sessionId={sessionId} />
                    {!cwd && <p role="status" style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>{t("settingsConfig.noWorkspaceMcpHint")}</p>}
                  </div>
                )}

                {extensionTab === "skills" && (
                  <div role="tabpanel" id="settings-extension-panel-skills" aria-labelledby="settings-extension-tab-skills" style={{ display: "flex", flex: 1, minHeight: 0, flexDirection: "column", overflowY: "auto" }}>
                    {cwd ? <SkillsConfig cwd={cwd} /> : <div role="status" style={{ padding: 16, border: "1px solid var(--border)", borderRadius: "var(--radius-card)", color: "var(--text-muted)", fontSize: 12 }}>{t("settingsConfig.workspaceRequired")}</div>}
                  </div>
                )}

                {extensionTab === "plugins" && (
                  <div role="tabpanel" id="settings-extension-panel-plugins" aria-labelledby="settings-extension-tab-plugins" style={{ display: "flex", flex: 1, minHeight: 0, flexDirection: "column", overflowY: "auto" }}>
                    {cwd ? <PluginsConfig cwd={cwd} sessionId={sessionId} onReloaded={onPluginsReloaded} runtimeReady={runtimeReady} /> : <div role="status" style={{ padding: 16, border: "1px solid var(--border)", borderRadius: "var(--radius-card)", color: "var(--text-muted)", fontSize: 12 }}>{t("settingsConfig.workspaceRequired")}</div>}
                  </div>
                )}
              </div>
            )}

            {/* SYSTEM & UPDATES TAB */}
            {currentTab === "system" && (
              <div role="tabpanel" id="settings-panel-system" aria-labelledby="settings-tab-system" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{t("settingsConfig.systemUpdates")}</h3>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>{t("settingsConfig.systemUpdatesDescription")}</p>
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
                    ...(highlightId === slugify("Active session system prompt") ? { borderColor: "var(--accent)", boxShadow: "0 0 0 2px var(--accent)" } : {}),
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
                      <RefreshCw size={13} aria-hidden="true" className={systemPromptLoading ? "spin" : undefined} />
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
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{t("settingsConfig.appLabel")}</div>
                      <div style={{ marginTop: 4, color: appUpdate?.updateAvailable ? "var(--accent)" : "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                        {checkingAppUpdate ? t("settingsConfig.checkingUpdates") : appUpdate?.updateAvailable ? t("appShell.updateVersion", { current: appUpdate.currentVersion ?? "?", available: appUpdate.availableVersion ?? "?" }) : appUpdate?.currentVersion ? t("settingsConfig.upToDate", { version: appUpdate.currentVersion }) : t("settingsConfig.versionUnavailable")}
                      </div>
                    </div>
                    <button type="button" onClick={() => void checkForAppUpdate(true)} disabled={checkingAppUpdate} aria-label={t("settingsConfig.checkAppUpdates")} style={{ padding: "6px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "transparent", color: "var(--text)", cursor: checkingAppUpdate ? "wait" : "pointer", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <RefreshCw size={13} aria-hidden="true" /> {t("settingsConfig.refresh")}
                    </button>
                  </div>
                  {appUpdate?.updateAvailable && (
                    <div style={{ marginTop: 6, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg)", display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("settingsConfig.runAppUpdateCommand")}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <code style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)", wordBreak: "break-all" }}>{appUpdate.updateCommand || "npm install -g ompgui"}</code>
                        <button
                          type="button"
                          onClick={() => {
                            void copyText(appUpdate.updateCommand || "npm install -g ompgui")
                              .then(() => setMessage(t("appShell.commandCopied")))
                              .catch(() => setMessage(t("appShell.commandCopyFailed")));
                          }}
                          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", color: "var(--text)", cursor: "pointer", fontSize: 11 }}
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
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{t("settingsConfig.ompLabel")}</div>
                      <div style={{ marginTop: 4, color: update?.updateAvailable ? "var(--accent)" : "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                        {checking ? t("settingsConfig.checkingUpdates") : update?.updateAvailable ? t("appShell.updateVersion", { current: update.currentVersion ?? "?", available: update.availableVersion ?? "?" }) : update?.currentVersion ? t("settingsConfig.upToDate", { version: update.currentVersion }) : t("settingsConfig.versionUnavailable")}
                      </div>
                    </div>
                    <button type="button" onClick={() => void checkForUpdate()} disabled={checking} aria-label={t("settingsConfig.checkOmpUpdates")} style={{ padding: "6px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "transparent", color: "var(--text)", cursor: checking ? "wait" : "pointer", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <RefreshCw size={13} aria-hidden="true" /> {t("settingsConfig.refresh")}
                    </button>
                  </div>
                  {update?.updateAvailable && (
                    <div style={{ marginTop: 6, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg)", display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("settingsConfig.runOmpUpdateCommand")}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <code style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)", wordBreak: "break-all" }}>{update.updateCommand || "omp update"}</code>
                        <button
                          type="button"
                          onClick={() => {
                            void copyText(update.updateCommand || "omp update")
                              .then(() => setMessage(t("appShell.commandCopied")))
                              .catch(() => setMessage(t("appShell.commandCopyFailed")));
                          }}
                          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", color: "var(--text)", cursor: "pointer", fontSize: 11 }}
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
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", color: "var(--text)", cursor: restarting ? "wait" : "pointer", fontSize: 12 }}
                    >
                      <RotateCcw size={13} aria-hidden="true" /> {restarting ? t("settingsConfig.restarting") : t("settingsConfig.restartSessions")}
                    </button>
                    <a
                      href="https://github.com/can1357/oh-my-pi/releases"
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", color: "var(--text-muted)", textDecoration: "none", fontSize: 12 }}
                    >
                      <ExternalLink size={13} aria-hidden="true" /> {t("settingsConfig.changelog")}
                    </a>
                  </div>
                  {message && <p role="status" style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>{message}</p>}
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
