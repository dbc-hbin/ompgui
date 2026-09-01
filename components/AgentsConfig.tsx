"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Edit3, Plus, Search, Trash2, Download, RefreshCw, X, Wrench, Eye } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { AgentDefinition, AgentSource } from "@/lib/omp/agents-service";
import { agentModelOptionsFromResponse, formatAgentModelDisplay, parseAgentModelOverrideInput, type AgentModelOption } from "@/lib/agent-model-options";
import { loadClientModels } from "@/lib/client-model-store";

type Props = {
  cwd?: string;
  onSaved?: () => void;
};

type ScopeFilter = "all" | AgentSource;

export function AgentsConfig({ cwd, onSaved }: Props) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentDefinition | null>(null);
  const [models, setModels] = useState<AgentModelOption[]>([]);
  const [disabledMap, setDisabledMap] = useState<Record<string, boolean>>({});
  const [unpacking, setUnpacking] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
      const [agentsRes, models, settingsRes] = await Promise.all([
        fetch(`/api/agents${qs}`),
        loadClientModels(cwd).catch(() => null),
        fetch("/api/omp-settings"),
      ]);

      if (!agentsRes.ok) throw new Error(`HTTP ${agentsRes.status}`);
      const agentsData = await agentsRes.json();
      setAgents(agentsData.agents ?? []);

      if (models) {
        setModels(agentModelOptionsFromResponse(models));
      }

      if (settingsRes.ok) {
        const sd = await settingsRes.json();
        const taskSettings = sd.settings?.task;
        const disabledList = Array.isArray(taskSettings?.disabledAgents) ? taskSettings.disabledAgents : [];
        const map: Record<string, boolean> = {};
        for (const name of disabledList) {
          map[name] = true;
        }
        setDisabledMap(map);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredAgents = useMemo(() => {
    return agents.filter((a) => {
      const matchScope = scopeFilter === "all" || a.source === scopeFilter;
      const matchQuery =
        !searchQuery ||
        `${a.name} ${a.description} ${a.systemPrompt}`.toLowerCase().includes(searchQuery.toLowerCase());
      return matchScope && matchQuery;
    });
  }, [agents, scopeFilter, searchQuery]);

  const toggleAgentDisabled = async (name: string, disable: boolean) => {
    const nextDisabled = { ...disabledMap, [name]: disable };
    setDisabledMap(nextDisabled);
    const disabledArray = Object.keys(nextDisabled).filter((k) => nextDisabled[k]);
    try {
      await fetch("/api/omp-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { task: { disabledAgents: disabledArray } } }),
      });
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const updateAgentOverride = async (
    agentName: string,
    overrideType: "model" | "prewalk" | "advisor",
    value: string | boolean | undefined,
  ) => {
    try {
      const settingsRes = await fetch("/api/omp-settings");
      const current = settingsRes.ok ? (await settingsRes.json()).settings : {};
      const task = current.task || {};

      if (overrideType === "model") {
        const overrides = { ...(task.agentModelOverrides || {}) };
        const parsed = parseAgentModelOverrideInput(typeof value === "string" ? value : undefined);
        if (!parsed) {
          delete overrides[agentName];
        } else {
          overrides[agentName] = parsed;
        }
        task.agentModelOverrides = overrides;
      } else if (overrideType === "prewalk") {
        const prewalks = { ...(task.agentPrewalk || {}) };
        if (value === undefined) {
          delete prewalks[agentName];
        } else {
          prewalks[agentName] = value;
        }
        task.agentPrewalk = prewalks;
      } else if (overrideType === "advisor") {
        const advisors = { ...(task.agentAdvisor || {}) };
        if (value === undefined) {
          delete advisors[agentName];
        } else {
          advisors[agentName] = value;
        }
        task.agentAdvisor = advisors;
      }

      const response = await fetch("/api/omp-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { task } }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      await load();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleUnpack = async () => {
    setUnpacking(true);
    setStatusNotice(null);
    try {
      const res = await fetch("/api/agents/unpack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope: "user" }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setStatusNotice(t("agentsConfig.unpackedSuccess"));
      await load();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUnpacking(false);
    }
  };

  const handleDelete = async (agent: AgentDefinition) => {
    if (!confirm(`${t("agentsConfig.deleteConfirm")} (${agent.name})`)) return;
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agent.name)}?cwd=${encodeURIComponent(cwd ?? "")}&scope=${agent.source}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setStatusNotice(t("agentsConfig.deleteSuccess"));
      await load();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaveAgent = async (payload: Record<string, unknown>, isEdit: boolean, originalName?: string) => {
    const url = isEdit && originalName ? `/api/agents/${encodeURIComponent(originalName)}` : "/api/agents";
    const method = isEdit ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, cwd }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    setCreateModalOpen(false);
    setEditingAgent(null);
    setStatusNotice(t("agentsConfig.saveSuccess"));
    await load();
    onSaved?.();
  };

  const scopeTabs: Array<{ id: ScopeFilter; label: string; count?: number }> = [
    { id: "all", label: t("agentsConfig.filterAll"), count: agents.length },
    { id: "project", label: t("agentsConfig.filterProject"), count: agents.filter((a) => a.source === "project").length },
    { id: "user", label: t("agentsConfig.filterUser"), count: agents.filter((a) => a.source === "user").length },
    { id: "bundled", label: t("agentsConfig.filterBundled"), count: agents.filter((a) => a.source === "bundled").length },
    { id: "extension", label: t("agentsConfig.filterExtension"), count: agents.filter((a) => a.source === "extension").length },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-5)",
        padding: 0,
        color: "var(--text)",
        minHeight: 0,
        flex: 1,
        background: "var(--bg)",
        overflowX: "hidden",
      }}
    >
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-5)", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
            <Bot size={18} style={{ color: "var(--accent)" }} />
            {t("agentsConfig.title")}
          </h2>
          <p style={{ margin: "3px 0 0", fontSize: "var(--text-md)", color: "var(--text-muted)" }}>
            {t("agentsConfig.description")}
          </p>
        </div>
      </header>

      {statusNotice && (
        <div role="status" style={{ padding: "8px 12px", borderRadius: "var(--radius-control)", background: "var(--status-success-subtle)", border: "1px solid var(--status-success)", color: "var(--status-success)", fontSize: "var(--text-md)" }}>
          {statusNotice}
        </div>
      )}

      {error && (
        <div role="alert" style={{ padding: "8px 12px", borderRadius: "var(--radius-control)", background: "color-mix(in srgb, var(--status-error) 12%, transparent)", border: "1px solid var(--status-error)", color: "var(--status-error)", fontSize: "var(--text-md)" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-4)", flexWrap: "wrap", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            onClick={() => setCreateModalOpen(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: "var(--radius-control)", background: "var(--accent-strong)", color: "var(--on-accent)", border: 0, fontSize: "var(--text-md)", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            <Plus size={13} /> {t("agentsConfig.newAgent")}
          </button>
          <button
            type="button"
            disabled={unpacking}
            onClick={() => void handleUnpack()}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: "var(--radius-control)", background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text)", fontSize: "var(--text-md)", cursor: unpacking ? "wait" : "pointer", whiteSpace: "nowrap" }}
          >
            <Download size={13} /> {unpacking ? t("agentsConfig.unpacking") : t("agentsConfig.unpackBundled")}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Refresh"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "var(--control-height-sm)", height: "var(--control-height-sm)", borderRadius: "var(--radius-control)", background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer", flexShrink: 0 }}
          >
            <RefreshCw size={13} className={loading ? "spin" : ""} />
          </button>
        </div>

        <div style={{ position: "relative", minWidth: 140, flex: "1 1 180px", maxWidth: isMobile ? "100%" : 240 }}>
          <Search size={13} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--text-dim)", pointerEvents: "none" }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("agentsConfig.searchPlaceholder")}
            style={{ width: "100%", height: "var(--control-height-sm)", padding: "0 8px 0 26px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-panel)", color: "var(--text)", fontSize: "var(--text-md)", outline: "none" }}
          />
        </div>
      </div>

      <nav aria-label="Agent scopes" style={{ display: "flex", gap: "var(--space-2)", borderBottom: "1px solid var(--border)", overflowX: "auto", flexShrink: 0, WebkitOverflowScrolling: "touch", paddingBottom: 2 }}>
        {scopeTabs.map((tab) => {
          const selected = scopeFilter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setScopeFilter(tab.id)}
              style={{
                border: 0,
                borderBottom: selected ? "2px solid var(--accent)" : "2px solid transparent",
                background: "transparent",
                color: selected ? "var(--text)" : "var(--text-muted)",
                fontWeight: selected ? 600 : 400,
                padding: "6px 10px",
                fontSize: "var(--text-md)",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-3)",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {tab.label}
              {typeof tab.count === "number" && (
                <span style={{ fontSize: "var(--text-xs)", padding: "1px 6px", borderRadius: 10, background: selected ? "var(--accent-subtle)" : "var(--bg-panel)", color: "var(--text-muted)" }}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: "var(--text-base)" }}>
          <RefreshCw size={16} className="spin" style={{ display: "inline-block", marginRight: 8 }} />
          Loading…
        </div>
      ) : filteredAgents.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-dim)", fontSize: "var(--text-base)", background: "var(--bg-panel)", borderRadius: "var(--radius-card)", border: "1px solid var(--border)" }}>
          {t("agentsConfig.noAgentsFound")}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(280px, 1fr))", gap: 10, overflowY: "auto", minHeight: 0 }}>
          {filteredAgents.map((agent) => {
            const isAgentDisabled = Boolean(disabledMap[agent.name] ?? agent.disabled);
            return (
              <AgentCard
                key={`${agent.source}-${agent.name}`}
                agent={agent}
                disabled={isAgentDisabled}
                models={models}
                onToggleDisabled={(val) => void toggleAgentDisabled(agent.name, val)}
                onEdit={() => setEditingAgent(agent)}
                onDelete={() => void handleDelete(agent)}
                onUpdateOverride={(type, val) => void updateAgentOverride(agent.name, type, val)}
              />
            );
          })}
        </div>
      )}

      {(createModalOpen || editingAgent) && (
        <AgentModal
          agent={editingAgent}
          models={models}
          isMobile={isMobile}
          onCancel={() => {
            setCreateModalOpen(false);
            setEditingAgent(null);
          }}
          onSave={(data) => handleSaveAgent(data, Boolean(editingAgent), editingAgent?.name)}
        />
      )}
    </div>
  );
}

function AgentCard({
  agent,
  disabled,
  models,
  onToggleDisabled,
  onEdit,
  onDelete,
  onUpdateOverride,
}: {
  agent: AgentDefinition;
  disabled: boolean;
  models: AgentModelOption[];
  onToggleDisabled: (disabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onUpdateOverride: (type: "model" | "prewalk" | "advisor", val: string | boolean | undefined) => void;
}) {
  const { t } = useI18n();
  const isCustom = agent.source === "user" || agent.source === "project";
  const isReadOnly = agent.tools?.every((tool) => tool === "read" || tool === "grep" || tool === "glob" || tool.startsWith("web_"));

  const scopeBadgeColor =
    agent.source === "project"
      ? "var(--source-project)"
      : agent.source === "user"
      ? "var(--source-user)"
      : agent.source === "extension"
      ? "var(--source-extension)"
      : "var(--text-muted)";

  return (
    <article
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-card)",
        background: "var(--bg-panel)",
        padding: 14,
        boxShadow: "var(--shadow-card)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        opacity: disabled ? 0.6 : 1,
        transition: "opacity var(--dur-fast) var(--ease-out-warm)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-4)" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 600, color: "var(--text)" }}>{agent.name}</h3>
            <span
              style={{
                fontSize: "var(--text-xs)",
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: 4,
                border: `1px solid ${scopeBadgeColor}`,
                color: scopeBadgeColor,
                textTransform: "uppercase",
              }}
            >
              {agent.source}
            </span>
            {agent.isShadowed && (
              <span
                title={t("agentsConfig.shadowedHint")}
                style={{ fontSize: "var(--text-xs)", padding: "1px 6px", borderRadius: 4, background: "var(--bg-subtle)", color: "var(--text-dim)" }}
              >
                {t("agentsConfig.shadowedBadge")}
              </span>
            )}
          </div>
          <p style={{ margin: "4px 0 0", fontSize: "var(--text-md)", color: "var(--text-muted)", lineHeight: 1.4 }}>
            {agent.description}
          </p>
        </div>

        <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-3)", cursor: "pointer", fontSize: "var(--text-sm)", color: "var(--text-muted)", flexShrink: 0 }}>
          <input
            type="checkbox"
            checked={!disabled}
            onChange={(e) => onToggleDisabled(!e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          {disabled ? t("agentsConfig.disabled") : t("agentsConfig.enabled")}
        </label>
      </div>

      {agent.systemPrompt && (
        <div
          style={{
            padding: "8px 10px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-control)",
            fontSize: "var(--text-sm)",
            color: "var(--text-dim)",
            maxHeight: 60,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "pre-wrap",
            fontFamily: "var(--font-mono)",
            lineHeight: 1.35,
          }}
        >
          {agent.systemPrompt}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
        {isReadOnly ? (
          <span style={{ fontSize: "var(--text-sm)", padding: "2px 7px", borderRadius: 4, background: "var(--accent-subtle)", color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Eye size={11} /> {t("agentsConfig.readOnly")}
          </span>
        ) : (
          <span style={{ fontSize: "var(--text-sm)", padding: "2px 7px", borderRadius: 4, background: "var(--bg)", color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Wrench size={11} /> {agent.tools ? `${agent.tools.length} ${t("agentsConfig.tools")}` : "all tools"}
          </span>
        )}

        {agent.tools?.map((tool) => (
          <span key={tool} style={{ fontSize: "var(--text-xs)", padding: "1px 5px", borderRadius: 3, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
            {tool}
          </span>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: "auto" }}>
          <AgentModelOverrideEditor agent={agent} models={models} onChange={(value) => onUpdateOverride("model", value)} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => onUpdateOverride("advisor", agent.advisorOverride === true ? false : true)}
            style={{
              padding: "3px 7px",
              borderRadius: "var(--radius-control)",
              border: "1px solid var(--border)",
              background: agent.advisorOverride ? "color-mix(in srgb, var(--accent) 15%, transparent)" : "var(--bg)",
              color: agent.advisorOverride ? "var(--accent)" : "var(--text-dim)",
              fontSize: "var(--text-sm)",
              cursor: "pointer",
            }}
          >
            {t("agentsConfig.advisor")}: {agent.advisorOverride ? "on" : "off"}
          </button>
          <button
            type="button"
            onClick={() => onUpdateOverride("prewalk", agent.prewalkOverride === true ? false : true)}
            style={{
              padding: "3px 7px",
              borderRadius: "var(--radius-control)",
              border: "1px solid var(--border)",
              background: agent.prewalkOverride ? "color-mix(in srgb, var(--accent) 15%, transparent)" : "var(--bg)",
              color: agent.prewalkOverride ? "var(--accent)" : "var(--text-dim)",
              fontSize: "var(--text-sm)",
              cursor: "pointer",
            }}
          >
            {t("agentsConfig.prewalk")}: {agent.prewalkOverride ? "on" : "off"}
          </button>
        </div>

          <div style={{ display: "flex", gap: "var(--space-2)", marginLeft: "auto" }}>
            {isCustom && (
              <button
                type="button"
                onClick={onEdit}
                title={t("agentsConfig.editAgent")}
                aria-label={t("agentsConfig.editAgent")}
                style={{ background: "transparent", border: 0, color: "var(--text-muted)", cursor: "pointer", padding: "var(--space-2)" }}
              >
                <Edit3 size={14} />
              </button>
            )}
            {isCustom && (
              <button
                type="button"
                onClick={onDelete}
                title={t("agentsConfig.deleteAgent")}
                aria-label={t("agentsConfig.deleteAgent")}
                style={{ background: "transparent", border: 0, color: "var(--status-error)", cursor: "pointer", padding: "var(--space-2)" }}
              >
                <Trash2 size={14} />
              </button>
            )}
        </div>
      </div>
      </div>
    </article>
  );
}

function AgentModelOverrideEditor({
  agent,
  models,
  onChange,
}: {
  agent: AgentDefinition;
  models: AgentModelOption[];
  onChange: (value: string | undefined) => void;
}) {
  const { t } = useI18n();
  const persisted = formatAgentModelDisplay(agent.overrideModel);
  const [draft, setDraft] = useState(persisted);
  const listId = `agent-models-${agent.source}-${agent.name}`;

  useEffect(() => setDraft(persisted), [persisted]);

  const commit = () => {
    const next = draft.trim();
    if (next !== persisted.trim()) onChange(next || undefined);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, width: "100%" }}>
      <label htmlFor={listId} style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
        {t("agentsConfig.modelOverride")}
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", width: "100%" }}>
        <input
          id={listId}
          list={`${listId}-options`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setDraft(persisted);
              event.currentTarget.blur();
            }
          }}
          placeholder={t("agentsConfig.modelOverridePlaceholder")}
          title={t("agentsConfig.modelOverrideHint")}
          style={{ minWidth: 0, flex: 1, width: "100%", padding: "4px 7px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}
        />
        {persisted && (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => { setDraft(""); onChange(undefined); }}
            title={t("agentsConfig.clearModelOverride")}
            aria-label={t("agentsConfig.clearModelOverride")}
            style={{ border: 0, background: "transparent", color: "var(--text-dim)", cursor: "pointer", padding: 3, flexShrink: 0 }}
          >
            <X size={13} />
          </button>
        )}
        <datalist id={`${listId}-options`}>
          {models.map((model) => <option key={model.selector} value={model.selector}>{model.label}</option>)}
        </datalist>
      </div>
      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {persisted ? (
          <span style={{ color: "var(--accent)" }}>✓ {persisted}</span>
        ) : (
          t("agentsConfig.agentDefaultModel", { model: formatAgentModelDisplay(agent.model) || "session model" })
        )}
      </span>
    </div>
  );
}

function AgentModal({
  agent,
  models,
  onCancel,
  onSave,
  isMobile,
}: {
  agent: AgentDefinition | null;
  models: AgentModelOption[];
  onCancel: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  isMobile?: boolean;
}) {
  const { t } = useI18n();
  const isEdit = Boolean(agent);
  const [name, setName] = useState(agent?.name ?? "");
  const [description, setDescription] = useState(agent?.description ?? "");
  const [scope, setScope] = useState<"user" | "project">(agent?.source === "project" ? "project" : "user");
  const [model, setModel] = useState(formatAgentModelDisplay(agent?.model));
  const [tools, setTools] = useState((agent?.tools ?? []).join(", "));
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const toolList = tools
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const parsedModel = parseAgentModelOverrideInput(model);

      await onSave({
        name: name.trim(),
        description: description.trim(),
        scope,
        tools: toolList.length > 0 ? toolList : undefined,
        model: parsedModel,
        systemPrompt: systemPrompt.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--overlay-backdrop)", display: "grid", placeItems: "center", zIndex: 1000, padding: "var(--space-6)" }}>
      <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-modal)", boxShadow: "var(--shadow-modal)", width: "min(100%, 540px)", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            {isEdit ? t("agentsConfig.editAgent") : t("agentsConfig.createTitle")}
          </h3>
          <button type="button" onClick={onCancel} style={{ background: "transparent", border: 0, color: "var(--text-muted)", cursor: "pointer" }}>
            <X size={17} />
          </button>
        </header>

        <form onSubmit={handleSubmit} style={{ padding: 18, display: "flex", flexDirection: "column", gap: "var(--space-5)", overflowY: "auto" }}>
          {error && <div role="alert" style={{ color: "var(--status-error)", fontSize: "var(--text-md)" }}>{error}</div>}

          {!isEdit && (
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: "var(--text-md)", fontWeight: 600, color: "var(--text-muted)" }}>
              Scope
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as "user" | "project")}
                style={{ height: "var(--control-height)", padding: "0 8px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "var(--text-md)" }}
              >
                <option value="user">User (~/.omp/agent/agents)</option>
                <option value="project">Project (.omp/agents)</option>
              </select>
            </label>
          )}

          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: "var(--text-md)", fontWeight: 600, color: "var(--text-muted)" }}>
            {t("agentsConfig.nameLabel")}
            <input
              type="text"
              required
              disabled={isEdit}
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder={t("agentsConfig.namePlaceholder")}
              style={{ height: "var(--control-height)", padding: "0 8px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "var(--text-md)" }}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: "var(--text-md)", fontWeight: 600, color: "var(--text-muted)" }}>
            {t("agentsConfig.descLabel")}
            <input
              type="text"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("agentsConfig.descPlaceholder")}
              style={{ height: "var(--control-height)", padding: "0 8px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "var(--text-md)" }}
            />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: "var(--text-md)", fontWeight: 600, color: "var(--text-muted)" }}>
              {t("agentsConfig.toolsLabel")}
              <input
                type="text"
                value={tools}
                onChange={(e) => setTools(e.target.value)}
                placeholder="read, write, edit, bash"
                style={{ height: "var(--control-height)", padding: "0 8px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "var(--text-md)" }}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: "var(--text-md)", fontWeight: 600, color: "var(--text-muted)" }}>
              Model
              <input
                list="modal-agent-models-list"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={t("agentsConfig.modelOverridePlaceholder")}
                style={{ height: "var(--control-height)", padding: "0 8px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "var(--text-md)", fontFamily: "var(--font-mono)" }}
              />
              <datalist id="modal-agent-models-list">
                {models.map((m) => (
                  <option key={m.selector} value={m.selector}>{m.label}</option>
                ))}
              </datalist>
            </label>
          </div>

          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: "var(--text-md)", fontWeight: 600, color: "var(--text-muted)" }}>
            {t("agentsConfig.promptLabel")}
            <textarea
              required
              rows={6}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={t("agentsConfig.promptPlaceholder")}
              style={{ padding: "var(--space-4)", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "var(--text-md)", fontFamily: "var(--font-mono)", lineHeight: 1.4, resize: "vertical" }}
            />
          </label>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-4)", marginTop: 8 }}>
            <button
              type="button"
              onClick={onCancel}
              style={{ padding: "7px 14px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "transparent", color: "var(--text)", fontSize: "var(--text-md)", cursor: "pointer" }}
            >
              {t("agentsConfig.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{ padding: "7px 16px", borderRadius: "var(--radius-control)", background: "var(--accent-strong)", color: "var(--on-accent)", border: 0, fontSize: "var(--text-md)", fontWeight: 600, cursor: saving ? "wait" : "pointer" }}
            >
              {saving ? t("agentsConfig.saving") : t("agentsConfig.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AgentsConfig;
