"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Check, Edit3, Plus, Search, Trash2, Download, RefreshCw, X, Shield, Wrench, Eye } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { AgentDefinition, AgentSource } from "@/lib/omp/agents-service";

type Props = {
  cwd?: string;
  onSaved?: () => void;
  embedded?: boolean;
  onClose?: () => void;
  isMobile?: boolean;
};

type ScopeFilter = "all" | AgentSource;

export function AgentsConfig({ cwd, onSaved, embedded, onClose, isMobile }: Props) {
  const { t } = useI18n();
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentDefinition | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [disabledMap, setDisabledMap] = useState<Record<string, boolean>>({});
  const [unpacking, setUnpacking] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
      const [agentsRes, modelsRes, settingsRes] = await Promise.all([
        fetch(`/api/agents${qs}`),
        fetch(`/api/models${qs}`),
        fetch("/api/omp-settings"),
      ]);

      if (!agentsRes.ok) throw new Error(`HTTP ${agentsRes.status}`);
      const agentsData = await agentsRes.json();
      setAgents(agentsData.agents ?? []);

      if (modelsRes.ok) {
        const md = await modelsRes.json();
        const list = md.models ?? md.catalog ?? md.modelList ?? [];
        const modelNames = (Array.isArray(list) ? list : [])
          .map((x: unknown) => {
            if (typeof x === "string") return x;
            if (x && typeof x === "object") {
              if ("id" in x && typeof x.id === "string") return x.id;
              if ("name" in x && typeof x.name === "string") return x.name;
            }
            return null;
          })
          .filter((x): x is string => x !== null);
        setModels(modelNames);
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
        if (value === undefined || value === "") {
          delete overrides[agentName];
        } else {
          overrides[agentName] = value as string;
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

      await fetch("/api/omp-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { task } }),
      });
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
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: embedded ? 0 : 20, color: "var(--text)", minHeight: 0, flex: 1, background: "var(--bg)" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            <Bot size={18} style={{ color: "var(--accent)" }} />
            {t("agentsConfig.title")}
          </h2>
          <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
            {t("agentsConfig.description")}
          </p>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "transparent", border: 0, color: "var(--text-muted)", cursor: "pointer", padding: 4 }}>
            <X size={18} />
          </button>
        )}
      </header>

      {statusNotice && (
        <div role="status" style={{ padding: "8px 12px", borderRadius: "var(--radius-control)", background: "color-mix(in srgb, var(--status-success, #10b981) 12%, transparent)", border: "1px solid var(--status-success, #10b981)", color: "var(--status-success, #10b981)", fontSize: 12 }}>
          {statusNotice}
        </div>
      )}

      {error && (
        <div role="alert" style={{ padding: "8px 12px", borderRadius: "var(--radius-control)", background: "color-mix(in srgb, var(--status-error) 12%, transparent)", border: "1px solid var(--status-error)", color: "var(--status-error)", fontSize: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setCreateModalOpen(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: "var(--radius-control)", background: "var(--accent-strong)", color: "var(--on-accent)", border: 0, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            <Plus size={14} /> {t("agentsConfig.newAgent")}
          </button>
          <button
            type="button"
            disabled={unpacking}
            onClick={() => void handleUnpack()}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: "var(--radius-control)", background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, cursor: unpacking ? "wait" : "pointer" }}
          >
            <Download size={14} /> {unpacking ? t("agentsConfig.unpacking") : t("agentsConfig.unpackBundled")}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Refresh"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: "var(--radius-control)", background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer" }}
          >
            <RefreshCw size={13} className={loading ? "spin" : ""} />
          </button>
        </div>

        <div style={{ position: "relative", minWidth: 200, flex: isMobile ? 1 : "0 1 240px" }}>
          <Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-dim)", pointerEvents: "none" }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("agentsConfig.searchPlaceholder")}
            style={{ width: "100%", height: 30, padding: "0 8px 0 28px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-panel)", color: "var(--text)", fontSize: 12, outline: "none" }}
          />
        </div>
      </div>

      <nav aria-label="Agent scopes" style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", overflowX: "auto" }}>
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
                padding: "8px 12px",
                fontSize: 12,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                whiteSpace: "nowrap",
              }}
            >
              {tab.label}
              {typeof tab.count === "number" && (
                <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 10, background: selected ? "var(--accent-subtle, var(--border))" : "var(--bg-panel)", color: "var(--text-muted)" }}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
          <RefreshCw size={16} className="spin" style={{ display: "inline-block", marginRight: 8 }} />
          Loading…
        </div>
      ) : filteredAgents.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-dim)", fontSize: 13, background: "var(--bg-panel)", borderRadius: "var(--radius-card)", border: "1px solid var(--border)" }}>
          {t("agentsConfig.noAgentsFound")}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(320px, 1fr))", gap: 12, overflowY: "auto" }}>
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
  models: string[];
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
      ? "var(--accent)"
      : agent.source === "user"
      ? "#3b82f6"
      : agent.source === "extension"
      ? "#a855f7"
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
        transition: "opacity var(--dur-fast) ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{agent.name}</h3>
            <span
              style={{
                fontSize: 10,
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
                style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "var(--bg-subtle)", color: "var(--text-dim)" }}
              >
                {t("agentsConfig.shadowedBadge")}
              </span>
            )}
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
            {agent.description}
          </p>
        </div>

        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
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
            fontSize: 11,
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
          <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Eye size={11} /> {t("agentsConfig.readOnly")}
          </span>
        ) : (
          <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: "var(--bg)", color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Wrench size={11} /> {agent.tools ? `${agent.tools.length} ${t("agentsConfig.tools")}` : "all tools"}
          </span>
        )}

        {agent.tools?.map((tool) => (
          <span key={tool} style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
            {tool}
          </span>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: "auto", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 11, color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            {t("agentsConfig.modelOverride")}:
            <select
              value={typeof agent.overrideModel === "string" ? agent.overrideModel : ""}
              onChange={(e) => onUpdateOverride("model", e.target.value || undefined)}
              style={{ padding: "3px 6px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 11 }}
            >
              <option value="">default ({Array.isArray(agent.model) ? agent.model[0] : agent.model || "standard"})</option>
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => onUpdateOverride("prewalk", agent.prewalkOverride === true ? false : true)}
            style={{
              padding: "3px 7px",
              borderRadius: "var(--radius-control)",
              border: "1px solid var(--border)",
              background: agent.prewalkOverride ? "color-mix(in srgb, var(--accent) 15%, transparent)" : "var(--bg)",
              color: agent.prewalkOverride ? "var(--accent)" : "var(--text-dim)",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {t("agentsConfig.prewalk")}: {agent.prewalkOverride ? "on" : "off"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 4 }}>
          {isCustom && (
            <button
              type="button"
              onClick={onEdit}
              title={t("agentsConfig.editAgent")}
              aria-label={t("agentsConfig.editAgent")}
              style={{ background: "transparent", border: 0, color: "var(--text-muted)", cursor: "pointer", padding: 4 }}
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
              style={{ background: "transparent", border: 0, color: "var(--status-error)", cursor: "pointer", padding: 4 }}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function AgentModal({
  agent,
  models,
  onCancel,
  onSave,
}: {
  agent: AgentDefinition | null;
  models: string[];
  onCancel: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  const isEdit = Boolean(agent);
  const [name, setName] = useState(agent?.name ?? "");
  const [description, setDescription] = useState(agent?.description ?? "");
  const [scope, setScope] = useState<"user" | "project">(agent?.source === "project" ? "project" : "user");
  const [model, setModel] = useState(typeof agent?.model === "string" ? agent.model : "");
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

      await onSave({
        name: name.trim(),
        description: description.trim(),
        scope,
        tools: toolList.length > 0 ? toolList : undefined,
        model: model || undefined,
        systemPrompt: systemPrompt.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "grid", placeItems: "center", zIndex: 1000, padding: 16 }}>
      <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-modal)", boxShadow: "var(--shadow-modal)", width: "min(100%, 540px)", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            {isEdit ? t("agentsConfig.editAgent") : t("agentsConfig.createTitle")}
          </h3>
          <button type="button" onClick={onCancel} style={{ background: "transparent", border: 0, color: "var(--text-muted)", cursor: "pointer" }}>
            <X size={17} />
          </button>
        </header>

        <form onSubmit={handleSubmit} style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
          {error && <div role="alert" style={{ color: "var(--status-error)", fontSize: 12 }}>{error}</div>}

          {!isEdit && (
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
              Scope
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as "user" | "project")}
                style={{ height: 32, padding: "0 8px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12 }}
              >
                <option value="user">User (~/.omp/agent/agents)</option>
                <option value="project">Project (.omp/agents)</option>
              </select>
            </label>
          )}

          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
            {t("agentsConfig.nameLabel")}
            <input
              type="text"
              required
              disabled={isEdit}
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder={t("agentsConfig.namePlaceholder")}
              style={{ height: 32, padding: "0 8px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12 }}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
            {t("agentsConfig.descLabel")}
            <input
              type="text"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("agentsConfig.descPlaceholder")}
              style={{ height: 32, padding: "0 8px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12 }}
            />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
              {t("agentsConfig.toolsLabel")}
              <input
                type="text"
                value={tools}
                onChange={(e) => setTools(e.target.value)}
                placeholder="read, write, edit, bash"
                style={{ height: 32, padding: "0 8px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12 }}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
              Model
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                style={{ height: 32, padding: "0 8px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12 }}
              >
                <option value="">default</option>
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
          </div>

          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
            {t("agentsConfig.promptLabel")}
            <textarea
              required
              rows={6}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={t("agentsConfig.promptPlaceholder")}
              style={{ padding: 8, borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, fontFamily: "var(--font-mono)", lineHeight: 1.4, resize: "vertical" }}
            />
          </label>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <button
              type="button"
              onClick={onCancel}
              style={{ padding: "7px 14px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "transparent", color: "var(--text)", fontSize: 12, cursor: "pointer" }}
            >
              {t("agentsConfig.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{ padding: "7px 16px", borderRadius: "var(--radius-control)", background: "var(--accent-strong)", color: "var(--on-accent)", border: 0, fontSize: 12, fontWeight: 600, cursor: saving ? "wait" : "pointer" }}
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
