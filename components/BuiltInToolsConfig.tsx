"use client";

import { useId, useState } from "react";
import {
  ChevronDown,
  GitBranch,
  Globe,
  History,
  Monitor,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/lib/i18n";
import { ConfirmDialog, Switch, TextInput } from "@/components/ui/field";

export type OptionalToolSettings = {
  browser?: { enabled?: boolean; relay?: boolean; headless?: boolean };
  computer?: { enabled?: boolean; display?: string };
  web_search?: { enabled?: boolean };
  github?: { enabled?: boolean };
  security?: { enabled?: boolean };
  checkpoint?: { enabled?: boolean };
};

export interface BuiltInToolsConfigProps {
  settings?: OptionalToolSettings | null;
  onPatch: (patch: Partial<OptionalToolSettings>) => void;
}

export function BuiltInToolsConfig({ settings, onPatch }: BuiltInToolsConfigProps) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [computerConfirmOpen, setComputerConfirmOpen] = useState(false);
  const [browserExpanded, setBrowserExpanded] = useState(false);
  const [computerExpanded, setComputerExpanded] = useState(false);

  const browserDetailsId = useId();
  const computerDetailsId = useId();

  // Resolved values with OMP defaults
  const browserEnabled = settings?.browser?.enabled ?? true;
  const browserRelay = settings?.browser?.relay ?? false;
  const browserHeadless = settings?.browser?.headless ?? true;

  const computerEnabled = settings?.computer?.enabled ?? false;
  const computerDisplay = settings?.computer?.display ?? "all";

  const webSearchEnabled = settings?.web_search?.enabled ?? true;
  const githubEnabled = settings?.github?.enabled ?? false;
  const securityEnabled = settings?.security?.enabled ?? false;
  const checkpointEnabled = settings?.checkpoint?.enabled ?? false;

  const patchBrowser = (patch: Partial<NonNullable<OptionalToolSettings["browser"]>>) => {
    onPatch({
      browser: {
        ...(settings?.browser ?? {}),
        ...patch,
      },
    });
  };

  const patchComputer = (patch: Partial<NonNullable<OptionalToolSettings["computer"]>>) => {
    onPatch({
      computer: {
        ...(settings?.computer ?? {}),
        ...patch,
      },
    });
  };

  const patchWebSearch = (patch: Partial<NonNullable<OptionalToolSettings["web_search"]>>) => {
    onPatch({
      web_search: {
        ...(settings?.web_search ?? {}),
        ...patch,
      },
    });
  };

  const patchGithub = (patch: Partial<NonNullable<OptionalToolSettings["github"]>>) => {
    onPatch({
      github: {
        ...(settings?.github ?? {}),
        ...patch,
      },
    });
  };

  const patchSecurity = (patch: Partial<NonNullable<OptionalToolSettings["security"]>>) => {
    onPatch({
      security: {
        ...(settings?.security ?? {}),
        ...patch,
      },
    });
  };

  const patchCheckpoint = (patch: Partial<NonNullable<OptionalToolSettings["checkpoint"]>>) => {
    onPatch({
      checkpoint: {
        ...(settings?.checkpoint ?? {}),
        ...patch,
      },
    });
  };

  const handleComputerToggle = (nextChecked: boolean) => {
    if (nextChecked) {
      setComputerConfirmOpen(true);
    } else {
      patchComputer({ enabled: false });
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        width: "100%",
        minHeight: 0,
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      {/* Scope banner / note */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
          padding: "8px 12px",
          borderRadius: "var(--radius-control)",
          background: "var(--bg-subtle)",
          border: "1px solid var(--border)",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
          {t("settingsConfig.tools.scopeNote") || "Optional capabilities configure built-in tool availability for sessions."}
        </span>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: "var(--radius-control)",
            background: "var(--bg-selected)",
            color: "var(--text)",
            whiteSpace: "nowrap",
            letterSpacing: "0.02em",
          }}
        >
          {t("settingsConfig.tools.scopeBadge") || "Global · New sessions"}
        </span>
      </div>

      {/* 2-column responsive card grid (1-column on mobile) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
          gap: 12,
          width: "100%",
        }}
      >
        {/* 1. Browser Card */}
        <div
          data-tool-card="browser"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "14px 16px",
            borderRadius: "var(--radius-card)",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "var(--radius-control)",
                  background: browserEnabled ? "color-mix(in srgb, var(--accent) 12%, var(--bg-selected))" : "var(--bg-selected)",
                  color: browserEnabled ? "var(--accent)" : "var(--text-muted)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Globe size={16} aria-hidden="true" />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.3 }}>
                  {t("settingsConfig.tools.browser") || "Browser"}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button
                type="button"
                aria-expanded={browserExpanded}
                aria-controls={browserDetailsId}
                aria-label={
                  browserExpanded
                    ? t("settingsConfig.tools.collapseBrowserDetails") || "Collapse browser settings"
                    : t("settingsConfig.tools.expandBrowserDetails") || "Expand browser settings"
                }
                onClick={() => setBrowserExpanded((prev) => !prev)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 44,
                  height: 44,
                  borderRadius: "var(--radius-control)",
                  border: "1px solid var(--border)",
                  background: browserExpanded ? "var(--bg-selected)" : "transparent",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  transition: "all var(--dur-fast) var(--ease-out-warm)",
                }}
              >
                <ChevronDown
                  size={14}
                  aria-hidden="true"
                  style={{
                    transform: browserExpanded ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform var(--dur-fast) var(--ease-out-warm)",
                  }}
                />
              </button>
              <Switch
                checked={browserEnabled}
                onChange={(checked) => patchBrowser({ enabled: checked })}
                aria-label={t("settingsConfig.tools.browserAria") || "Toggle Browser capability"}
              />
            </div>
          </div>

          <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.45 }}>
            {t("settingsConfig.tools.browserDesc") || "Interactive web automation and headless page rendering via Chrome DevTools Protocol."}
          </p>

          {/* Inline expandable details */}
          {browserExpanded && (
            <div
              id={browserDetailsId}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                paddingTop: 10,
                marginTop: 2,
                borderTop: "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>
                    {t("settingsConfig.tools.browserRelay") || "Browser Relay"}
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--text-dim)", lineHeight: 1.3 }}>
                    {t("settingsConfig.tools.browserRelayDesc") || "Connect to existing browser session via extension relay"}
                  </div>
                </div>
                <Switch
                  checked={browserRelay}
                  onChange={(checked) => patchBrowser({ relay: checked })}
                  aria-label={t("settingsConfig.tools.browserRelayAria") || "Toggle Browser Relay"}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>
                    {t("settingsConfig.tools.browserHeadless") || "Headless Mode"}
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--text-dim)", lineHeight: 1.3 }}>
                    {t("settingsConfig.tools.browserHeadlessDesc") || "Launch browser in background without visible window"}
                  </div>
                </div>
                <Switch
                  checked={browserHeadless}
                  onChange={(checked) => patchBrowser({ headless: checked })}
                  aria-label={t("settingsConfig.tools.browserHeadlessAria") || "Toggle Browser Headless Mode"}
                />
              </div>
            </div>
          )}
        </div>

        {/* 2. Computer Card */}
        <div
          data-tool-card="computer"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "14px 16px",
            borderRadius: "var(--radius-card)",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "var(--radius-control)",
                  background: computerEnabled ? "color-mix(in srgb, var(--accent) 12%, var(--bg-selected))" : "var(--bg-selected)",
                  color: computerEnabled ? "var(--accent)" : "var(--text-muted)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Monitor size={16} aria-hidden="true" />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.3 }}>
                  {t("settingsConfig.tools.computer") || "Computer Use"}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button
                type="button"
                aria-expanded={computerExpanded}
                aria-controls={computerDetailsId}
                aria-label={
                  computerExpanded
                    ? t("settingsConfig.tools.collapseComputerDetails") || "Collapse computer settings"
                    : t("settingsConfig.tools.expandComputerDetails") || "Expand computer settings"
                }
                onClick={() => setComputerExpanded((prev) => !prev)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 44,
                  height: 44,
                  borderRadius: "var(--radius-control)",
                  border: "1px solid var(--border)",
                  background: computerExpanded ? "var(--bg-selected)" : "transparent",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  transition: "all var(--dur-fast) var(--ease-out-warm)",
                }}
              >
                <ChevronDown
                  size={14}
                  aria-hidden="true"
                  style={{
                    transform: computerExpanded ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform var(--dur-fast) var(--ease-out-warm)",
                  }}
                />
              </button>
              <Switch
                checked={computerEnabled}
                onChange={handleComputerToggle}
                aria-label={t("settingsConfig.tools.computerAria") || "Toggle Computer Use capability"}
              />
            </div>
          </div>

          <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.45 }}>
            {t("settingsConfig.tools.computerDesc") || "Direct OS desktop automation with screenshot capture, mouse movement, and keyboard input."}
          </p>

          {/* Inline expandable details */}
          {computerExpanded && (
            <div
              id={computerDetailsId}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                paddingTop: 10,
                marginTop: 2,
                borderTop: "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label
                  htmlFor="computer-display-input"
                  style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}
                >
                  {t("settingsConfig.tools.computerDisplay") || "Target Display"}
                </label>
                <div style={{ fontSize: 10.5, color: "var(--text-dim)", lineHeight: 1.3 }}>
                  {t("settingsConfig.tools.computerDisplayDesc") || "Target display identifier (default: all)"}
                </div>
                <TextInput
                  id="computer-display-input"
                  value={computerDisplay}
                  placeholder="all"
                  onChange={(val) => patchComputer({ display: val.trim() || "all" })}
                />
              </div>
            </div>
          )}
        </div>

        {/* 3. Web Search Card */}
        <div
          data-tool-card="web_search"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "14px 16px",
            borderRadius: "var(--radius-card)",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "var(--radius-control)",
                  background: webSearchEnabled ? "color-mix(in srgb, var(--accent) 12%, var(--bg-selected))" : "var(--bg-selected)",
                  color: webSearchEnabled ? "var(--accent)" : "var(--text-muted)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Search size={16} aria-hidden="true" />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.3 }}>
                  {t("settingsConfig.tools.webSearch") || "Web Search"}
                </div>
              </div>
            </div>
            <Switch
              checked={webSearchEnabled}
              onChange={(checked) => patchWebSearch({ enabled: checked })}
              aria-label={t("settingsConfig.tools.webSearchAria") || "Toggle Web Search capability"}
            />
          </div>

          <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.45 }}>
            {t("settingsConfig.tools.webSearchDesc") || "Live web retrieval and webpage text extraction for up-to-date documentation and answers."}
          </p>
        </div>

        {/* 4. GitHub Card */}
        <div
          data-tool-card="github"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "14px 16px",
            borderRadius: "var(--radius-card)",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "var(--radius-control)",
                  background: githubEnabled ? "color-mix(in srgb, var(--accent) 12%, var(--bg-selected))" : "var(--bg-selected)",
                  color: githubEnabled ? "var(--accent)" : "var(--text-muted)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <GitBranch size={16} aria-hidden="true" />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.3 }}>
                  {t("settingsConfig.tools.github") || "GitHub"}
                </div>
              </div>
            </div>
            <Switch
              checked={githubEnabled}
              onChange={(checked) => patchGithub({ enabled: checked })}
              aria-label={t("settingsConfig.tools.githubAria") || "Toggle GitHub capability"}
            />
          </div>

          <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.45 }}>
            {t("settingsConfig.tools.githubDesc") || "Interact with issues, pull requests, commits, repositories, and CI workflows via GitHub API."}
          </p>
        </div>

        {/* 5. Security Scan Card */}
        <div
          data-tool-card="security"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "14px 16px",
            borderRadius: "var(--radius-card)",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "var(--radius-control)",
                  background: securityEnabled ? "color-mix(in srgb, var(--accent) 12%, var(--bg-selected))" : "var(--bg-selected)",
                  color: securityEnabled ? "var(--accent)" : "var(--text-muted)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <ShieldCheck size={16} aria-hidden="true" />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.3 }}>
                  {t("settingsConfig.tools.security") || "Security Scan"}
                </div>
              </div>
            </div>
            <Switch
              checked={securityEnabled}
              onChange={(checked) => patchSecurity({ enabled: checked })}
              aria-label={t("settingsConfig.tools.securityAria") || "Toggle Security Scan capability"}
            />
          </div>

          <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.45 }}>
            {t("settingsConfig.tools.securityDesc") || "Automated static security analysis, vulnerability detection, and dependency audits."}
          </p>
        </div>

        {/* 6. Checkpoint / Rewind Card */}
        <div
          data-tool-card="checkpoint"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "14px 16px",
            borderRadius: "var(--radius-card)",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "var(--radius-control)",
                  background: checkpointEnabled ? "color-mix(in srgb, var(--accent) 12%, var(--bg-selected))" : "var(--bg-selected)",
                  color: checkpointEnabled ? "var(--accent)" : "var(--text-muted)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <History size={16} aria-hidden="true" />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.3 }}>
                  {t("settingsConfig.tools.checkpoint") || "Checkpoint & Rewind"}
                </div>
              </div>
            </div>
            <Switch
              checked={checkpointEnabled}
              onChange={(checked) => patchCheckpoint({ enabled: checked })}
              aria-label={t("settingsConfig.tools.checkpointAria") || "Toggle Checkpoint & Rewind capability"}
            />
          </div>

          <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.45 }}>
            {t("settingsConfig.tools.checkpointDesc") || "Save conversation checkpoints and rewind filesystem changes to previous turns."}
          </p>
        </div>
      </div>

      {/* Confirmation dialog for Computer OFF->ON */}
      <ConfirmDialog
        open={computerConfirmOpen}
        onOpenChange={setComputerConfirmOpen}
        title={t("settingsConfig.tools.computerConfirmTitle") || "Enable Computer Use?"}
        description={
          t("settingsConfig.tools.computerConfirmDesc") ||
          "Computer Use allows the agent to interact directly with your desktop, mouse, keyboard, and display. Ensure you trust the tasks and model executing with this capability."
        }
        confirmLabel={t("settingsConfig.tools.computerConfirmAction") || "Enable Computer Use"}
        cancelLabel={t("settingsConfig.cancel") || "Cancel"}
        onConfirm={() => {
          patchComputer({ enabled: true });
          setComputerConfirmOpen(false);
        }}
      />
    </div>
  );
}
