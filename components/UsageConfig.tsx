"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/lib/i18n";
import { Dialog, DialogContent, DialogTitle, MOBILE_SAFE_AREA_DIALOG_STYLE } from "@/components/ui/primitives";
import { AlertCircle, Gauge, RefreshCw, X } from "lucide-react";
import type {
  UsageLimit,
  UsageReport,
  UsageResponse,
} from "@/lib/api-types";

function formatProviderName(provider: string): string {
  return provider
    .split(/[-_]/g)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
    .join(" ");
}

const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms";
  if (ms < SEC) return `${ms}ms`;
  if (ms < MIN) return `${(ms / SEC).toFixed(1)}s`;
  if (ms < HOUR) {
    const mins = Math.floor(ms / MIN);
    const secs = Math.floor((ms % MIN) / SEC);
    return secs > 0 ? `${mins}m${secs}s` : `${mins}m`;
  }
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    const mins = Math.floor((ms % HOUR) / MIN);
    return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
  }
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  return hours > 0 ? `${days}d${hours}h` : `${days}d`;
}

function resolveUsageUsedFraction(limit: UsageLimit): number | undefined {
  const amount = limit.amount;
  if (amount.usedFraction !== undefined) return amount.usedFraction;
  if (amount.used !== undefined && amount.limit !== undefined && amount.limit > 0) {
    return amount.used / amount.limit;
  }
  if (amount.unit === "percent" && amount.used !== undefined) return amount.used / 100;
  if (amount.remainingFraction !== undefined) return Math.max(0, 1 - amount.remainingFraction);
  return undefined;
}

function formatUsageAmount(
  limit: UsageLimit,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const amount = limit.amount;
  const used =
    amount.used ??
    (amount.usedFraction !== undefined ? amount.usedFraction * 100 : undefined);
  const unit =
    amount.unit === "percent"
      ? "%"
      : amount.unit && amount.unit !== "unknown"
        ? ` ${amount.unit}`
        : "";
  const usedText =
    used === undefined
      ? t("usageConfig.unknownUsed")
      : `${Number.isInteger(used) ? used : used.toFixed(2)}${unit} ${t("usageConfig.used")}`;

  if (amount.remainingFraction !== undefined) {
    const leftPct = (amount.remainingFraction * 100).toFixed(1);
    return `${usedText} (${leftPct}% ${t("usageConfig.left")})`;
  }
  return usedText;
}

export function UsageConfig({ onClose }: { onClose: () => void }) {
  const isMobile = useIsMobile();
  const { t } = useI18n();

  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [payload, setPayload] = useState<UsageResponse | undefined>();
  const [errorCode, setErrorCode] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setStatus("loading");
    }
    try {
      const res = await fetch(isRefresh ? "/api/usage?refresh=1" : "/api/usage");
      const json = await res.json();
      if (!res.ok) {
        setStatus("error");
        setErrorCode(json?.code ?? `${res.status}`);
        return;
      }
      setPayload(json as UsageResponse);
      setStatus("ready");
      setErrorCode(undefined);
    } catch {
      setStatus("error");
      setErrorCode("network_error");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const isEmpty =
    payload &&
    (Boolean(payload.emptyReason) ||
      (payload.reports.length === 0 &&
        (payload.accountsWithoutUsage?.length ?? 0) === 0 &&
        (payload.disabledCredentials?.length ?? 0) === 0));

  const groupedReports = useMemo(() => {
    if (!payload?.reports) return new Map<string, UsageReport[]>();
    const map = new Map<string, UsageReport[]>();
    for (const r of payload.reports) {
      const list = map.get(r.provider) ?? [];
      list.push(r);
      map.set(r.provider, list);
    }
    return map;
  }, [payload?.reports]);

  const sortedProviders = useMemo(() => {
    return Array.from(groupedReports.keys()).sort((a, b) => a.localeCompare(b));
  }, [groupedReports]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        ariaLabel={t("usageConfig.title")}
        style={{
          ...(isMobile
            ? MOBILE_SAFE_AREA_DIALOG_STYLE
            : {
                width: 720,
                maxWidth: "calc(100vw - 16px)",
                height: "80vh",
                maxHeight: "calc(100dvh - 16px)",
              }),
          padding: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            height: 48,
            padding: "0 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
            background: "var(--bg-panel)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Gauge size={16} strokeWidth={2} style={{ color: "var(--accent)" }} aria-hidden="true" />
            <DialogTitle style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
              {t("usageConfig.title")}
            </DialogTitle>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {payload?.generatedAt ? (
              <span style={{ fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap" }}>
                {t("usageConfig.fetchedAgo", {
                  time: formatDuration(
                    Math.max(
                      0,
                      now -
                        (typeof payload.generatedAt === "number"
                          ? payload.generatedAt
                          : Date.parse(payload.generatedAt)),
                    ),
                  ),
                })}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing || status === "loading"}
              title={t(refreshing ? "usageConfig.refreshing" : "usageConfig.refresh")}
              aria-label={t(refreshing ? "usageConfig.refreshing" : "usageConfig.refresh")}
              style={{
                width: 28,
                height: 28,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-control)",
                color: refreshing ? "var(--accent)" : "var(--text-muted)",
                cursor: refreshing || status === "loading" ? "default" : "pointer",
                transition: "all var(--dur-fast) var(--ease-out-warm)",
              }}
              onMouseEnter={(e) => {
                if (!refreshing && status !== "loading") {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text)";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "none";
                e.currentTarget.style.color = refreshing ? "var(--accent)" : "var(--text-muted)";
              }}
            >
              <RefreshCw
                size={13}
                strokeWidth={2}
                className={refreshing ? "animate-spin" : undefined}
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              onClick={onClose}
              title={t("usageConfig.close")}
              aria-label={t("usageConfig.close")}
              style={{
                width: 28,
                height: 28,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "none",
                border: "none",
                borderRadius: "var(--radius-control)",
                color: "var(--text-muted)",
                cursor: "pointer",
                transition: "all var(--dur-fast) var(--ease-out-warm)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "none";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
            >
              <X size={15} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {status === "loading" && (
            <div
              role="status"
              style={{
                flex: 1,
                minHeight: 200,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                color: "var(--text-dim)",
                fontSize: 13,
              }}
            >
              <RefreshCw size={18} className="animate-spin" style={{ color: "var(--accent)" }} aria-hidden="true" />
              <span>{t("appShell.loading")}</span>
            </div>
          )}

          {status === "error" && (
            <div
              role="alert"
              style={{
                flex: 1,
                minHeight: 200,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                padding: 24,
                textAlign: "center",
              }}
            >
              <AlertCircle size={24} style={{ color: "var(--status-error)" }} aria-hidden="true" />
              <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 500 }}>
                {t("usageConfig.fetchFailed")}
                {errorCode ? ` (${errorCode})` : ""}
              </div>
              <button
                type="button"
                onClick={() => void load(false)}
                style={{
                  padding: "6px 14px",
                  background: "var(--accent)",
                  color: "var(--on-accent)",
                  border: "none",
                  borderRadius: "var(--radius-control)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                {t("usageConfig.retry")}
              </button>
            </div>
          )}

          {status === "ready" && payload && (
            <>
              {isEmpty ? (
                <div
                  style={{
                    flex: 1,
                    minHeight: 200,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 12,
                    padding: 24,
                    textAlign: "center",
                    color: "var(--text-muted)",
                  }}
                >
                  <Gauge size={32} strokeWidth={1.5} style={{ color: "var(--text-dim)" }} aria-hidden="true" />
                  <div style={{ maxWidth: 440, fontSize: 13, lineHeight: 1.6 }}>
                    {t(
                      payload.emptyReason === "no-usage-endpoint"
                        ? "usageConfig.emptyNoUsageEndpoint"
                        : "usageConfig.emptyNoCredentials",
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {sortedProviders.map((provider) => {
                    const reports = groupedReports.get(provider) ?? [];
                    const rawStats = payload.capacity?.[provider] ?? [];
                    const capacityStats = [...rawStats].sort(
                      (a, b) =>
                        (a.durationMs ?? Number.POSITIVE_INFINITY) -
                        (b.durationMs ?? Number.POSITIVE_INFINITY),
                    );

                    return (
                      <div
                        key={provider}
                        style={{
                          background: "var(--bg-panel)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-card)",
                          padding: 14,
                          display: "flex",
                          flexDirection: "column",
                          gap: 12,
                        }}
                      >
                        {/* Provider Header + Capacity Chips */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            gap: 8,
                            borderBottom: "1px solid var(--border)",
                            paddingBottom: 10,
                          }}
                        >
                          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                            {formatProviderName(provider)}
                          </span>
                          {capacityStats.length > 0 && (
                            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                              {capacityStats.map((stat, idx) => {
                                const remainingStr =
                                  stat.remainingAccounts % 1 === 0
                                    ? String(stat.remainingAccounts)
                                    : stat.remainingAccounts.toFixed(1);
                                const isExhausted = stat.remainingAccounts === 0;
                                return (
                                  <span
                                    key={idx}
                                    title={t("usageConfig.capacityTooltip", { window: stat.window })}
                                    style={{
                                      fontSize: 11,
                                      padding: "2px 8px",
                                      borderRadius: "var(--radius-control)",
                                      background: isExhausted
                                        ? "color-mix(in srgb, var(--status-error) 15%, transparent)"
                                        : "var(--bg)",
                                      border: `1px solid ${isExhausted ? "var(--status-error)" : "var(--border)"}`,
                                      color: isExhausted ? "var(--status-error)" : "var(--text-muted)",
                                      fontWeight: 500,
                                      fontVariantNumeric: "tabular-nums",
                                    }}
                                  >
                                    {t("usageConfig.capacityChip", {
                                      window: stat.window,
                                      remaining: remainingStr,
                                      accounts: stat.accounts,
                                    })}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Reports */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {reports.map((report, reportIdx) => {
                            const meta = (report.metadata ?? {}) as Record<string, unknown>;
                            const baseAccount =
                              (typeof meta.email === "string" && meta.email) ||
                              (typeof meta.accountId === "string" && meta.accountId) ||
                              (typeof meta.projectId === "string" && meta.projectId) ||
                              t("usageConfig.unknownAccount");
                            const orgName = typeof meta.orgName === "string" ? meta.orgName : undefined;
                            const accountTitle =
                              orgName && orgName !== baseAccount
                                ? `${baseAccount} (${orgName})`
                                : baseAccount;

                            return (
                              <div
                                key={reportIdx}
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 10,
                                  padding: 12,
                                  background: "var(--bg)",
                                  border: "1px solid var(--border)",
                                  borderRadius: "var(--radius-control)",
                                }}
                              >
                                {/* Account header */}
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    flexWrap: "wrap",
                                    gap: 6,
                                  }}
                                >
                                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                                    {accountTitle}
                                  </span>
                                  {report.resetCredits?.availableCount &&
                                  report.resetCredits.availableCount > 0 ? (
                                    <span
                                      style={{
                                        fontSize: 11,
                                        color: "var(--accent)",
                                        fontWeight: 500,
                                      }}
                                    >
                                      ✦{" "}
                                      {t("usageConfig.savedResets", {
                                        count: report.resetCredits.availableCount,
                                      })}
                                    </span>
                                  ) : null}
                                </div>

                                {/* Limits */}
                                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                  {report.limits.map((limit) => {
                                    let label = limit.label;
                                    const tier = limit.scope?.tier;
                                    if (tier && !label.toLowerCase().includes(tier.toLowerCase())) {
                                      label = `${label} (${tier})`;
                                    }
                                    const usedFraction = resolveUsageUsedFraction(limit);
                                    const widthPct = Math.min(
                                      100,
                                      Math.max(0, (usedFraction ?? 0) * 100),
                                    );
                                    const barColor =
                                      usedFraction !== undefined && usedFraction >= 1
                                        ? "var(--status-error)"
                                        : usedFraction !== undefined && usedFraction >= 0.9
                                          ? "var(--status-warning)"
                                          : "var(--accent)";

                                    const resetsAt = limit.window?.resetsAt;
                                    const hasResetCountdown =
                                      resetsAt !== undefined && resetsAt > now;

                                    return (
                                      <div
                                        key={limit.id}
                                        style={{ display: "flex", flexDirection: "column", gap: 4 }}
                                      >
                                        <div
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            gap: 8,
                                            fontSize: 12,
                                          }}
                                        >
                                          <span style={{ color: "var(--text)", fontWeight: 500 }}>
                                            {label}
                                          </span>
                                          <span
                                            style={{
                                              color: "var(--text-muted)",
                                              fontSize: 11,
                                              fontVariantNumeric: "tabular-nums",
                                              textAlign: "right",
                                            }}
                                          >
                                            {formatUsageAmount(limit, t)}
                                          </span>
                                        </div>

                                        {/* Progress Bar */}
                                        <div
                                          style={{
                                            width: "100%",
                                            height: 6,
                                            borderRadius: "var(--radius-control)",
                                            background: "var(--bg-subtle)",
                                            overflow: "hidden",
                                          }}
                                        >
                                          <div
                                            style={{
                                              width: `${widthPct}%`,
                                              height: "100%",
                                              background: barColor,
                                              borderRadius: "inherit",
                                              transition: "width var(--dur-med) var(--ease-out-warm)",
                                            }}
                                          />
                                        </div>

                                        {/* Reset countdown & notes */}
                                        {(hasResetCountdown ||
                                          (limit.notes && limit.notes.length > 0)) && (
                                          <div
                                            style={{
                                              display: "flex",
                                              flexDirection: "column",
                                              gap: 2,
                                              fontSize: 11,
                                              color: "var(--text-dim)",
                                            }}
                                          >
                                            {hasResetCountdown && (
                                              <div>
                                                {
                                                  t("usageConfig.resetsIn", {
                                                    label: limit.window?.resetLabel ?? t("usageConfig.resets"),
                                                    duration: formatDuration(resetsAt - now),
                                                  })
                                                }
                                              </div>
                                            )}
                                            {limit.notes && limit.notes.length > 0 && (
                                              <div>{limit.notes.join(" · ")}</div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>

                                {/* Report-level notes */}
                                {report.notes && report.notes.length > 0 && (
                                  <div
                                    style={{
                                      fontSize: 11,
                                      color: "var(--text-dim)",
                                      fontStyle: "italic",
                                      borderTop: "1px dashed var(--border)",
                                      paddingTop: 6,
                                    }}
                                  >
                                    {report.notes.join(" · ")}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  {/* Disabled credentials */}
                  {payload.disabledCredentials && payload.disabledCredentials.length > 0 && (
                    <div
                      style={{
                        background: "var(--bg-panel)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-card)",
                        padding: 14,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--status-error)",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <AlertCircle size={14} aria-hidden="true" />
                        <span>{t("usageConfig.disabledCredentials")}</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {payload.disabledCredentials.map((summary, idx) => {
                          const base = summary.email ?? summary.accountId ?? t("usageConfig.unknownAccount");
                          const title =
                            summary.orgName && summary.orgName !== base
                              ? `${base} (${summary.orgName})`
                              : base;
                          const ago = summary.disabledAtMs
                            ? ` · ${t("usageConfig.ago", { time: formatDuration(Math.max(0, now - summary.disabledAtMs)) })}`
                            : "";
                          return (
                            <div
                              key={idx}
                              style={{
                                fontSize: 12,
                                color: "var(--text-muted)",
                                display: "flex",
                                flexDirection: "column",
                                gap: 2,
                                padding: "6px 10px",
                                background: "var(--bg)",
                                borderRadius: "var(--radius-control)",
                                border: "1px solid var(--border)",
                              }}
                            >
                              <div style={{ fontWeight: 500, color: "var(--text)" }}>
                                {title} ({formatProviderName(summary.provider)})
                              </div>
                              <div style={{ fontSize: 11, color: "var(--status-error)" }}>
                                {summary.cause}
                                {ago}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Accounts without usage */}
                  {payload.accountsWithoutUsage && payload.accountsWithoutUsage.length > 0 && (
                    <div
                      style={{
                        background: "var(--bg-panel)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-card)",
                        padding: 14,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--text-muted)",
                        }}
                      >
                        {t("usageConfig.accountsWithoutUsage")}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {payload.accountsWithoutUsage.map((account, idx) => {
                          const base =
                            account.email ??
                            account.accountId ??
                            account.projectId ??
                            t("usageConfig.unknownAccount");
                          const title =
                            account.orgName && account.orgName !== base
                              ? `${base} (${account.orgName})`
                              : base;
                          return (
                            <div
                              key={idx}
                              style={{
                                fontSize: 12,
                                color: "var(--text-muted)",
                                padding: "6px 10px",
                                background: "var(--bg)",
                                borderRadius: "var(--radius-control)",
                                border: "1px solid var(--border)",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: 8,
                              }}
                            >
                              <span style={{ color: "var(--text)" }}>{title}</span>
                              <span style={{ fontSize: 11, color: "var(--text-dim)", flexShrink: 0 }}>
                                {formatProviderName(account.provider)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
