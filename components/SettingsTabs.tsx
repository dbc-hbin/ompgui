"use client";

import { Bot, Cable, Cpu, KeyRound, RefreshCw, Settings2, ShieldCheck, Sparkles } from "lucide-react";
import type { ComponentType, CSSProperties } from "react";
import { useI18n } from "@/lib/i18n";

export type SettingsTab =
  | "general"
  | "safety"
  | "models"
  | "providers"
  | "intelligence"
  | "extensions"
  | "tools"
  | "mcp"
  | "skills"
  | "plugins"
  | "system"
  | "agents";

export interface TabItem {
  id: SettingsTab;
  label: string;
  description: string;
  Icon: ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean | "true" | "false"; style?: CSSProperties }>;
}

export const SETTINGS_CATEGORIES: TabItem[] = [
  { id: "general", label: "Interface & Behavior", description: "UI preferences, completion sound, submission mode", Icon: Settings2 },
  { id: "safety", label: "Safety & Approvals", description: "Tool safety rules, YOLO mode, terminal permissions", Icon: ShieldCheck },
  { id: "models", label: "AI Model Defaults", description: "Reasoning budget, verbosity, personality, scratchpad", Icon: Cpu },
  { id: "providers", label: "API Keys & Providers", description: "Connected OAuth accounts, API keys, and model registry", Icon: KeyRound },
  { id: "intelligence", label: "Agent & Intelligence", description: "Advisor, memory, autolearn, compaction and retry", Icon: Sparkles },
  { id: "agents", label: "Agents & Subagents", description: "Configured subagents, model routing, prewalk, and advisor", Icon: Bot },
  { id: "extensions", label: "Extensions & Tools", description: "Optional tools, MCP servers, managed skills, and OMP plugins", Icon: Cable },
  { id: "system", label: "System & Updates", description: "App updates, runtime version, and active session restart", Icon: RefreshCw },
];

export type ExtensionsTab = "tools" | "mcp" | "skills" | "plugins";

export const EXTENSION_TABS: Array<{ id: ExtensionsTab; label: string; description: string }> = [
  { id: "tools", label: "Optional Tools", description: "Toggle optional built-in tool capabilities" },
  { id: "mcp", label: "MCP Servers", description: "Configure global and project MCP servers" },
  { id: "skills", label: "Skills", description: "Manage reusable workspace skills" },
  { id: "plugins", label: "Plugins", description: "Manage OMP plugins for this workspace" },
];

export const getNormalizedActive = (tab: SettingsTab): SettingsTab => {
  if (tab === "tools" || tab === "mcp" || tab === "skills" || tab === "plugins" || tab === "extensions") return "extensions";
  return tab;
};

export function SettingsTabs({
  active,
  onSelect,
  layout = "vertical",
}: {
  active: SettingsTab;
  onSelect: (tab: SettingsTab) => void;
  layout?: "horizontal" | "vertical";
}) {
  const { t } = useI18n();
  const currentActive = getNormalizedActive(active);

  const onKeyDown = (event: React.KeyboardEvent, id: SettingsTab) => {
    const currentIndex = SETTINGS_CATEGORIES.findIndex((tab) => tab.id === id);
    if (currentIndex < 0 || SETTINGS_CATEGORIES.length === 0) return;

    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % SETTINGS_CATEGORIES.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + SETTINGS_CATEGORIES.length) % SETTINGS_CATEGORIES.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = SETTINGS_CATEGORIES.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      onSelect(SETTINGS_CATEGORIES[nextIndex].id);
    }
  };

  if (layout === "vertical") {
    return (
      <nav
        aria-label="Settings sections"
        role="tablist"
        aria-orientation="vertical"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          padding: "12px 8px",
          width: 230,
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          background: "var(--bg-panel)",
          overflowY: "auto",
        }}
      >
        {SETTINGS_CATEGORIES.map(({ id, label, description, Icon }) => {
          const selected = id === currentActive;
          const localizedLabel = t(`settingsTabs.${id}`) || label;
          const localizedDesc = t(`settingsTabs.${id}Desc`) || description;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`settings-tab-${id}`}
              aria-selected={selected}
              aria-controls={`settings-panel-${id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(id)}
              onKeyDown={(event) => onKeyDown(event, id)}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                minHeight: "var(--control-touch, 44px)",
                padding: "8px 10px",
                border: selected ? "1px solid var(--accent)" : "1px solid transparent",
                borderRadius: "var(--radius-control)",
                background: selected ? "var(--bg-selected)" : "transparent",
                color: selected ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer",
                textAlign: "left",
                transition: "background var(--dur-fast) var(--ease-out-warm), color var(--dur-fast) var(--ease-out-warm), border-color var(--dur-fast) var(--ease-out-warm)",
                width: "100%",
                boxSizing: "border-box",
                touchAction: "manipulation",
              }}
            >
              <Icon size={16} aria-hidden="true" style={{ marginTop: 2, flexShrink: 0, color: selected ? "var(--accent)" : "currentColor" }} />
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ fontSize: "var(--text-base)", fontWeight: selected ? 600 : 500, lineHeight: 1.3, color: selected ? "var(--text)" : "inherit" }}>
                  {localizedLabel}
                </div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-dim)", lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {localizedDesc}
                </div>
              </div>
            </button>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      aria-label="Settings sections"
      role="tablist"
      style={{
        display: "flex",
        gap: 6,
        padding: "8px 12px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)",
        flexShrink: 0,
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {SETTINGS_CATEGORIES.map(({ id, label, description, Icon }) => {
        const selected = id === currentActive;
        const localizedLabel = t(`settingsTabs.${id}`) || label;
        const localizedDesc = t(`settingsTabs.${id}Desc`) || description;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={`settings-tab-${id}`}
            aria-selected={selected}
            aria-controls={`settings-panel-${id}`}
            aria-label={`${localizedLabel}: ${localizedDesc}`}
            title={localizedDesc}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(id)}
            onKeyDown={(event) => onKeyDown(event, id)}
            style={{
              display: "inline-flex",
              alignItems: "flex-start",
              gap: 7,
              minHeight: "var(--control-touch, 44px)",
              padding: "6px 10px",
              border: selected ? "1px solid var(--accent)" : "1px solid var(--border)",
              borderRadius: "var(--radius-control)",
              background: selected ? "var(--bg-selected)" : "var(--bg)",
              color: selected ? "var(--text)" : "var(--text-muted)",
              fontWeight: selected ? 600 : 500,
              cursor: "pointer",
              fontSize: "var(--text-sm)",
              whiteSpace: "nowrap",
              textAlign: "left",
              flexShrink: 0,
              boxSizing: "border-box",
              touchAction: "manipulation",
              transition: "all var(--dur-fast) var(--ease-out-warm)",
            }}
          >
            <Icon size={14} aria-hidden="true" style={{ marginTop: 2, flexShrink: 0, color: selected ? "var(--accent)" : "currentColor" }} />
            <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
              <span style={{ fontWeight: selected ? 600 : 500, fontSize: "var(--text-base)", color: selected ? "var(--text)" : "inherit" }}>{localizedLabel}</span>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text-dim)", lineHeight: 1.25, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{localizedDesc}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

export function ExtensionsTabs({ active, onSelect }: { active: ExtensionsTab; onSelect: (tab: ExtensionsTab) => void }) {
  const { t } = useI18n();
  const selectedIndex = Math.max(0, EXTENSION_TABS.findIndex((tab) => tab.id === active));

  const onKeyDown = (event: React.KeyboardEvent) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (selectedIndex + 1) % EXTENSION_TABS.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (selectedIndex - 1 + EXTENSION_TABS.length) % EXTENSION_TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = EXTENSION_TABS.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      onSelect(EXTENSION_TABS[nextIndex].id);
    }
  };

  return (
    <div
      role="tablist"
      aria-label={t("settingsConfig.extensionsTabsAria")}
      aria-orientation="horizontal"
      style={{
        display: "flex",
        gap: 4,
        padding: 4,
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-control)",
        background: "var(--bg-panel)",
        alignSelf: "flex-start",
        maxWidth: "100%",
        overflowX: "auto",
      }}
    >
      {EXTENSION_TABS.map((tab) => {
        const selected = tab.id === active;
        const label = t(`settingsConfig.extensionsTab.${tab.id}`) || tab.label;
        const description = t(`settingsConfig.extensionsTab.${tab.id}Desc`) || tab.description;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`settings-extension-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`settings-extension-panel-${tab.id}`}
            aria-label={`${label}: ${description}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={onKeyDown}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "var(--control-touch, 44px)",
              padding: "6px 12px",
              border: selected ? "1px solid var(--accent)" : "1px solid transparent",
              borderRadius: "calc(var(--radius-control) - var(--space-1))",
              background: selected ? "var(--bg-selected)" : "transparent",
              color: selected ? "var(--text)" : "var(--text-muted)",
              fontSize: "var(--text-sm)",
              fontWeight: selected ? 600 : 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
              boxSizing: "border-box",
              touchAction: "manipulation",
              transition: "all var(--dur-fast) var(--ease-out-warm)",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
