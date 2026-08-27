"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  Bot,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Cpu,
  Gauge,
  GitBranch,
  Info,
  Network,
  RefreshCw,
  UserRound,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { SubagentActivityEvent, SubagentInfo } from "@/lib/subagent-types";
import {
  filterSubagentHubRows,
  getSubagentFreshness,
  SUBAGENT_STALE_AFTER_MS,
  type SubagentFreshness,
  type SubagentHubFilter,
} from "@/lib/subagent-hub-state";
import {
  countNestedSubagents,
  formatCost,
  formatDuration,
  formatTokens,
  shortModel,
} from "@/lib/subagent-format";
import { SubagentStatusIcon } from "./SubagentStatusIcon";

const SUBAGENT_STATE_KEYS: Record<SubagentInfo["status"], string> = {
  started: "chatWindow.subagentState.started",
  completed: "chatWindow.subagentState.completed",
  failed: "chatWindow.subagentState.failed",
  aborted: "chatWindow.subagentState.aborted",
  lost: "chatWindow.subagentState.lost",
};

const SUBAGENT_HUB_FILTERS: Array<{ value: SubagentHubFilter; key: string }> = [
  { value: "all", key: "chatWindow.subagentHub.filter.all" },
  { value: "active", key: "chatWindow.subagentHub.filter.active" },
  { value: "completed", key: "chatWindow.subagentHub.filter.completed" },
  { value: "failed", key: "chatWindow.subagentHub.filter.failed" },
];

type SubagentHubProps = {
  subagents: SubagentInfo[];
  subagentEvents?: Record<string, SubagentActivityEvent[]>;
  onSelectSubagent: (subagent: SubagentInfo) => void;
  /** Initial expansion (default: collapsed so the composer remains compact). */
  defaultExpanded?: boolean;
  /** Optional fixed clock for deterministic rendering and tests. */
  now?: number;
};

function Metric({ icon: Icon, label, children }: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-label={label}
      title={label}
      data-subagent-metric={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2)",
        minWidth: 0,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Icon
        aria-hidden
        style={{
          width: "var(--text-md)",
          height: "var(--text-md)",
          flexShrink: 0,
        }}
      />
      <span>{children}</span>
    </span>
  );
}

function ActivityLine({ subagent }: { subagent: SubagentInfo }) {
  const { t } = useI18n();
  const progress = subagent.progress;
  const retryActive = Boolean(progress?.retryState ?? progress?.retryFailure);
  const parts: ReactNode[] = [];

  if (retryActive) {
    const attempt = progress?.retryState?.attempt ?? progress?.retryFailure?.attempt ?? 0;
    const maxAttempts = progress?.retryState?.maxAttempts ?? 0;
    const label = maxAttempts > 0
      ? t("chatWindow.subagentRetrying", { attempt, max: maxAttempts })
      : t("chatWindow.subagentRetryAttempt", { attempt });
    parts.push(
      <Metric key="retry" icon={RefreshCw} label={label}>
        {maxAttempts > 0 ? `${attempt}/${maxAttempts}` : attempt}
      </Metric>,
    );
  } else if (subagent.status === "started") {
    const activity = progress?.currentTool
      ? `${progress.currentTool}${progress.lastIntent ? ` — ${progress.lastIntent}` : ""}`
      : progress?.lastIntent;
    if (activity) {
      parts.push(
        <Metric key="activity" icon={progress?.currentTool ? Wrench : Activity} label={activity}>
          {activity}
        </Metric>,
      );
    }
  }

  const nested = countNestedSubagents(progress);
  const source = subagent.agentSource && subagent.agentSource !== "bundled" ? subagent.agentSource : null;
  const tokens = formatTokens(progress?.tokens);
  const cost = formatCost(progress?.cost ?? subagent.result?.cost);
  const ctxTokens = formatTokens(progress?.contextTokens);
  const context = ctxTokens
    ? `${ctxTokens}/${formatTokens(progress?.contextWindow) ?? "?"}`
    : null;
  const model = shortModel(progress?.resolvedModel);
  const duration = formatDuration(progress?.durationMs);
  const meta: ReactNode[] = [
    source ? <Metric key="source" icon={UserRound} label={source}>{source === "user" ? null : source}</Metric> : null,
    nested > 0 ? <Metric key="nested" icon={GitBranch} label={t("chatWindow.subagentNestedCount", { count: nested })}>{nested}</Metric> : null,
    tokens ? <Metric key="tokens" icon={Cpu} label={t("chatWindow.tokensUnit", { count: tokens })}>{tokens}</Metric> : null,
    cost ? <Metric key="cost" icon={CircleDollarSign} label={cost}>{cost}</Metric> : null,
    context ? <Metric key="context" icon={Gauge} label={t("chatWindow.contextGauge", { used: ctxTokens ?? "?", total: formatTokens(progress?.contextWindow) ?? "?" })}>{context}</Metric> : null,
    model ? <Metric key="model" icon={Bot} label={model}>{model}</Metric> : null,
    duration ? <Metric key="duration" icon={Clock3} label={duration}>{duration}</Metric> : null,
  ].filter(Boolean);
  if (meta.length > 0) {
    parts.push(
      <span key="meta" style={{ display: "inline-flex", flexWrap: "wrap", gap: "var(--space-2) var(--space-4)" }}>
        {meta}
      </span>,
    );
  }

  if (parts.length === 0) return null;
  return (
    <span
      data-subagent-activity-line
      className="subagent-hub-activity-line"
      style={{
        display: "flex",
        minWidth: 0,
        overflow: "hidden",
        fontSize: "var(--text-xs)",
        fontFamily: "var(--font-mono)",
        color: retryActive ? "var(--accent)" : "var(--text-dim)",
        lineHeight: 1.4,
        fontVariantNumeric: "tabular-nums",
        gap: "var(--space-4)",
        flexWrap: "wrap",
      }}
    >
      {parts}
    </span>
  );
}

function ActivityPreview({ events }: { events: SubagentActivityEvent[] | undefined }) {
  const { t } = useI18n();
  const labels = (events ?? [])
    .slice(-2)
    .map((event) => event.label.trim())
    .filter(Boolean);
  if (labels.length === 0) return null;

  const preview = labels.join(" · ");
  const label = `${t("chatWindow.subagentHub.preview")}: ${preview}`;
  return (
    <span
      data-subagent-activity-preview
      className="subagent-hub-activity-preview"
      title={label}
      aria-label={label}
      style={{
        display: "flex",
        minWidth: 0,
        overflow: "hidden",
        color: "var(--text-dim)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-xs)",
        lineHeight: 1.4,
        wordBreak: "keep-all",
      }}
    >
      <span style={{ flexShrink: 0, color: "var(--text-muted)" }}>
        {t("chatWindow.subagentHub.preview")}:
      </span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginLeft: "var(--space-2)" }}>
        {preview}
      </span>
    </span>
  );
}

function GroupLabel({ children, depth = 0 }: { children: ReactNode; depth?: number }) {
  return (
    <div
      data-subagent-group-label
      className="subagent-hub-group-label"
      style={{
        marginLeft: depth > 0 ? `calc(var(--space-6) * ${depth})` : undefined,
        color: "var(--text-dim)",
        fontSize: "var(--text-xs)",
        fontWeight: 650,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        padding: "var(--space-2) var(--space-5) var(--space-2)",
        wordBreak: "keep-all",
      }}
    >
      {children}
    </div>
  );
}

function SubagentRow({
  subagent,
  events,
  freshnessNow,
  onSelectSubagent,
}: {
  subagent: SubagentInfo;
  events: SubagentActivityEvent[] | undefined;
  freshnessNow: number | undefined;
  onSelectSubagent: (subagent: SubagentInfo) => void;
}) {
  const { t } = useI18n();
  const live = subagent.source !== "history";
  const stateLabel = t(SUBAGENT_STATE_KEYS[subagent.status]);
  const showStateLabel = !(subagent.source === "history" && subagent.status === "started");
  const task = subagent.task ?? subagent.description ?? subagent.assignment ?? t("chatWindow.subagentHub.noTask");
  const freshness: SubagentFreshness = freshnessNow === undefined
    ? subagent.source === "history" ? "history" : "live"
    : getSubagentFreshness(subagent, freshnessNow);
  const freshnessLabel = t(`chatWindow.subagentHub.fresh.${freshness}`);
  const staleSeconds = freshness === "stale" && freshnessNow !== undefined && typeof subagent.lastUpdate === "number"
    ? Math.max(
        Math.ceil(SUBAGENT_STALE_AFTER_MS / 1_000),
        Math.floor(Math.max(0, freshnessNow - subagent.lastUpdate) / 1_000),
      )
    : null;
  const freshnessAge = staleSeconds === null
    ? null
    : t("chatWindow.subagentHub.lastUpdated", { value: `${staleSeconds}s` });
  const freshnessLabelWithAge = freshnessAge ? `${freshnessLabel} · ${freshnessAge}` : freshnessLabel;
  const freshnessColor = freshness === "live"
    ? "var(--status-success)"
    : freshness === "stale"
      ? "var(--status-warning)"
      : "var(--text-dim)";
  const rowLabel = [subagent.agent, task, showStateLabel ? stateLabel : null, freshnessLabelWithAge].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      className="ui-focus-ring subagent-hub-row"
      onClick={() => onSelectSubagent(subagent)}
      aria-label={rowLabel}
      title={rowLabel}
      style={{
        display: "flex",
        width: "100%",
        minWidth: 0,
        minHeight: "var(--control-touch, 44px)",
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: "center",
        gap: "var(--space-2)",
        padding: "var(--space-4) var(--space-5)",
        border: "thin solid var(--border)",
        borderRadius: "var(--radius-control)",
        background: live ? "var(--bg)" : "var(--bg-panel)",
        color: live ? "var(--text)" : "var(--text-dim)",
        opacity: live ? 1 : 0.72,
        fontFamily: "inherit",
        fontSize: "var(--text-sm)",
        textAlign: "left",
        cursor: "pointer",
        wordBreak: "keep-all",
        transition: "border-color var(--dur-fast) var(--ease-out-warm), background var(--dur-fast) var(--ease-out-warm), opacity var(--dur-fast) var(--ease-out-warm)",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 40%, var(--border))";
        event.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.borderColor = "var(--border)";
        event.currentTarget.style.background = live ? "var(--bg)" : "var(--bg-panel)";
      }}
    >
      <span className="subagent-hub-row-main" style={{ display: "flex", minWidth: 0, alignItems: "center", gap: "var(--space-3)" }}>
        <SubagentStatusIcon status={subagent.status} live={live} />
        <span className="subagent-hub-row-agent" style={{ flexShrink: 0, color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", fontWeight: 650 }}>
          {subagent.agent}
        </span>
        <span
          title={task}
          className="subagent-hub-row-task"
          style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "inherit" }}
        >
          {task}
        </span>
        {showStateLabel && (
          <span className="subagent-hub-row-state" style={{ flexShrink: 0, color: live ? "var(--text-muted)" : "var(--text-dim)", fontSize: "var(--text-xs)" }}>
            {stateLabel}
          </span>
        )}
        <span
          data-subagent-freshness={freshness}
          className="subagent-hub-freshness"
          aria-label={freshnessLabelWithAge}
          title={freshnessLabelWithAge}
          style={{
            display: "inline-flex",
            flexShrink: 0,
            alignItems: "center",
            gap: "var(--space-2)",
            color: freshnessColor,
            fontSize: "var(--text-xs)",
            fontVariantNumeric: "tabular-nums",
            opacity: freshness === "history" ? 0.8 : 0.9,
          }}
        >
          <span
            aria-hidden
            style={{
              width: "var(--space-2)",
              height: "var(--space-2)",
              flexShrink: 0,
              borderRadius: "var(--radius-control)",
              background: freshnessColor,
            }}
          />
          <span>{freshnessLabel}</span>
          {freshnessAge && <span>{freshnessAge}</span>}
        </span>
        {subagent.detached && (
          <span
            aria-hidden
            data-subagent-detached
            className="subagent-hub-detached"
            style={{ flexShrink: 0, color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }}
          >
            ⤴
          </span>
        )}
      </span>
      <ActivityLine subagent={subagent} />
      <ActivityPreview events={events} />
    </button>
  );
}

export type SubagentHubTreeItem =
  | { kind: "group"; key: string; group: "roots" | "nested" | "orphans"; parentLabel?: string; depth: number }
  | { kind: "row"; key: string; subagent: SubagentInfo; depth: number };

/** Build the display order without mutating the input roster or render state. */
export function buildSubagentHubTree(subagents: SubagentInfo[]): SubagentHubTreeItem[] {
  const sorted = [...subagents].sort((left, right) => left.index - right.index || left.id.localeCompare(right.id));
  const ids = new Set(sorted.map((subagent) => subagent.id));
  const childrenByParent = new Map<string, SubagentInfo[]>();
  const roots: SubagentInfo[] = [];
  const unknownParentGroups = new Map<string, SubagentInfo[]>();

  for (const subagent of sorted) {
    const parentId = subagent.parentToolCallId;
    if (!parentId) {
      roots.push(subagent);
      continue;
    }
    const group = childrenByParent.get(parentId) ?? [];
    group.push(subagent);
    childrenByParent.set(parentId, group);
    if (!ids.has(parentId)) {
      const orphanGroup = unknownParentGroups.get(parentId) ?? [];
      orphanGroup.push(subagent);
      unknownParentGroups.set(parentId, orphanGroup);
    }
  }

  const tree: SubagentHubTreeItem[] = [];
  const visited = new Set<string>();
  const appendSubtree = (items: SubagentInfo[], depth: number) => {
    for (const subagent of items) {
      if (visited.has(subagent.id)) continue;
      visited.add(subagent.id);
      tree.push({ kind: "row", key: `row-${subagent.id}`, subagent, depth });
      const children = (childrenByParent.get(subagent.id) ?? []).filter((child) => !visited.has(child.id));
      if (children.length === 0) continue;
      tree.push({
        kind: "group",
        key: `group-nested-${subagent.id}`,
        group: "nested",
        parentLabel: subagent.agent,
        depth: depth + 1,
      });
      appendSubtree(children, depth + 1);
    }
  };

  if (roots.length > 0) {
    tree.push({ kind: "group", key: "group-roots", group: "roots", depth: 0 });
    appendSubtree(roots, 0);
  }
  if (unknownParentGroups.size > 0) {
    tree.push({ kind: "group", key: "group-orphans", group: "orphans", depth: 0 });
    for (const [parentId, items] of unknownParentGroups) {
      tree.push({
        kind: "group",
        key: `group-parent-${parentId}`,
        group: "nested",
        parentLabel: parentId,
        depth: 0,
      });
      appendSubtree(items, 0);
    }
  }

  const remaining = sorted.filter((subagent) => !visited.has(subagent.id));
  if (remaining.length > 0) appendSubtree(remaining, 0);
  return tree;
}

export function SubagentHub({
  subagents,
  subagentEvents = {},
  onSelectSubagent,
  defaultExpanded = false,
  now,
}: SubagentHubProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(!defaultExpanded);
  const [filter, setFilter] = useState<SubagentHubFilter>("all");
  const [clockNow, setClockNow] = useState<number | null>(null);
  const hasLiveStartedSubagent = subagents.some(
    (subagent) => subagent.source !== "history" && subagent.status === "started",
  );
  useEffect(() => {
    if (now !== undefined || !hasLiveStartedSubagent) return;
    const updateClock = () => setClockNow(Date.now());
    updateClock();
    const interval = window.setInterval(updateClock, 5_000);
    return () => window.clearInterval(interval);
  }, [hasLiveStartedSubagent, now]);
  const freshnessNow = now ?? clockNow ?? 0;
  const freshnessReady = now !== undefined || clockNow !== null;
  const filterCounts = useMemo<Record<SubagentHubFilter, number>>(() => ({
    all: subagents.length,
    active: filterSubagentHubRows(subagents, "active", freshnessNow).length,
    completed: filterSubagentHubRows(subagents, "completed", freshnessNow).length,
    failed: filterSubagentHubRows(subagents, "failed", freshnessNow).length,
  }), [subagents, freshnessNow]);
  const runningCount = filterCounts.active;
  const visibleSubagents = useMemo(
    () => filterSubagentHubRows(subagents, filter, freshnessNow),
    [subagents, filter, freshnessNow],
  );
  const treeItems = useMemo(() => buildSubagentHubTree(visibleSubagents), [visibleSubagents]);

  return (
    <section
      aria-label={t("chatWindow.subagentsPanel")}
      className="subagent-hub-root"
      style={{
        width: "100%",
        minWidth: 0,
        overflow: "hidden",
        border: "thin solid var(--border)",
        borderRadius: "var(--radius-card)",
        background: "var(--bg-panel)",
      }}
    >
      <button
        type="button"
        className="ui-focus-ring subagent-hub-header-trigger"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((value) => !value)}
        title={collapsed ? t("chatWindow.subagentHub.expand") : t("chatWindow.subagentHub.collapse")}
        style={{
          display: "flex",
          width: "100%",
          minHeight: "var(--control-touch, 44px)",
          alignItems: "center",
          gap: "var(--space-3)",
          padding: "var(--space-4) var(--space-5)",
          border: "none",
          borderBottom: collapsed ? "none" : "thin solid var(--border)",
          background: "transparent",
          color: "var(--text-muted)",
          fontFamily: "inherit",
          fontSize: "var(--text-sm)",
          textAlign: "left",
          cursor: "pointer",
          wordBreak: "keep-all",
        }}
      >
        <Network aria-hidden style={{ width: "var(--text-lg)", height: "var(--text-lg)", flexShrink: 0 }} />
        <strong style={{ color: "var(--text)", fontWeight: 650 }}>{t("chatWindow.subagentsPanel")}</strong>
        <span
          aria-label={t("chatWindow.subagentSummary", { running: runningCount, total: subagents.length })}
          title={t("chatWindow.subagentSummary", { running: runningCount, total: subagents.length })}
          style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", fontVariantNumeric: "tabular-nums" }}
        >
          <span>{runningCount}</span>
          <span aria-hidden>/</span>
          <span>{subagents.length}</span>
        </span>
        <ChevronDown
          aria-hidden
          style={{
            width: "var(--text-lg)",
            height: "var(--text-lg)",
            flexShrink: 0,
            color: "var(--text-dim)",
            transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            transition: "transform var(--dur-med) var(--ease-out-warm)",
          }}
        />
      </button>
      {!collapsed && (
        <div
          className="subagent-hub-content"
          style={{
            display: "grid",
            maxHeight: "30vh",
            gap: "var(--space-4)",
            overflowY: "auto",
            padding: "var(--space-4) var(--space-5) var(--space-5)",
          }}
        >
          <div
            data-subagent-filter-row
            className="subagent-hub-filters"
            role="group"
            style={{
              display: "flex",
              minWidth: 0,
              flexWrap: "wrap",
              gap: "var(--space-1)",
              alignItems: "center",
              padding: "var(--space-1)",
              border: "thin solid var(--border)",
              borderRadius: "var(--radius-control)",
              background: "var(--bg-subtle)",
            }}
          >
            {SUBAGENT_HUB_FILTERS.map(({ value, key }) => {
              const selected = filter === value;
              const label = t(key);
              return (
                <button
                  key={value}
                  type="button"
                  className="ui-focus-ring"
                  data-subagent-filter={value}
                  aria-pressed={selected}
                  title={`${label} (${filterCounts[value]})`}
                  onClick={() => setFilter(value)}
                  style={{
                    display: "inline-flex",
                    minHeight: "var(--control-touch, 44px)",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    padding: "var(--space-2) var(--space-3)",
                    border: "none",
                    borderRadius: "var(--radius-control)",
                    background: selected
                      ? "color-mix(in srgb, var(--accent) 16%, var(--bg))"
                      : "transparent",
                    color: selected ? "var(--accent)" : "var(--text-muted)",
                    fontFamily: "inherit",
                    fontSize: "var(--text-xs)",
                    fontWeight: selected ? 650 : 550,
                    cursor: "pointer",
                    wordBreak: "keep-all",
                    transition: "background var(--dur-fast) var(--ease-out-warm), color var(--dur-fast) var(--ease-out-warm)",
                  }}
                >
                  <span>{label}</span>
                  <span
                    aria-hidden
                    style={{
                      display: "inline-flex",
                      minWidth: "var(--space-8)",
                      height: "var(--space-6)",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "0 var(--space-2)",
                      borderRadius: "var(--radius-control)",
                      background: selected ? "color-mix(in srgb, var(--accent) 20%, transparent)" : "var(--bg-subtle)",
                      color: selected ? "var(--accent)" : "var(--text-dim)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--text-xs)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {filterCounts[value]}
                  </span>
                </button>
              );
            })}
          </div>
          {visibleSubagents.length === 0 ? (
            <div style={{ padding: "var(--space-5)", color: "var(--text-dim)", fontSize: "var(--text-sm)", textAlign: "center", wordBreak: "keep-all" }}>
              {t("chatWindow.subagentHub.empty")}
            </div>
          ) : (
            treeItems.map((item) => {
              if (item.kind === "group") {
                const label = item.group === "roots"
                  ? t("chatWindow.subagentHub.group.roots")
                  : item.group === "orphans"
                    ? t("chatWindow.subagentHub.group.orphans")
                    : t("chatWindow.subagentHub.group.nested", { agent: item.parentLabel ?? "" });
                return (
                  <GroupLabel key={item.key} depth={item.depth}>
                    {label}
                  </GroupLabel>
                );
              }
              const nestedStyle = item.depth > 0
                ? {
                    marginLeft: `calc(var(--space-6) * ${item.depth})`,
                    paddingLeft: "var(--space-5)",
                    borderLeft: "thin solid var(--border)",
                  }
                : undefined;
              return (
                <div
                  key={item.key}
                  data-subagent-row-wrap
                  data-subagent-depth={item.depth}
                  className={`subagent-hub-row-wrap${item.depth > 0 ? " subagent-hub-nested" : ""}`}
                  style={{ display: "grid", gap: "var(--space-3)", ...nestedStyle }}
                >
                  <SubagentRow
                    subagent={item.subagent}
                    events={subagentEvents[item.subagent.id]}
                    freshnessNow={freshnessReady ? freshnessNow : undefined}
                    onSelectSubagent={onSelectSubagent}
                  />
                </div>
              );
            })
          )}
          <div
            data-subagent-observe-only
            className="subagent-hub-observe-only"
            role="note"
            style={{
              display: "flex",
              minWidth: 0,
              alignItems: "flex-start",
              gap: "var(--space-3)",
              padding: "var(--space-3) var(--space-4)",
              border: "thin solid var(--border)",
              borderRadius: "var(--radius-control)",
              background: "var(--bg-subtle)",
              color: "var(--text-dim)",
              wordBreak: "keep-all",
            }}
          >
            <Info aria-hidden style={{ width: "var(--text-md)", height: "var(--text-md)", flexShrink: 0, marginTop: "var(--space-1)" }} />
            <span style={{ display: "grid", minWidth: 0, gap: "var(--space-1)", fontSize: "var(--text-xs)", lineHeight: 1.4 }}>
              <strong style={{ color: "var(--text-muted)", fontWeight: 650 }}>
                {t("chatWindow.subagentHub.observeOnly")}
              </strong>
              <span title={t("chatWindow.subagentHub.observeOnlyHint")}>
                {t("chatWindow.subagentHub.observeOnlyHint")}
              </span>
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
