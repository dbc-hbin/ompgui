"use client";

import { useState, type CSSProperties } from "react";
import { Ban, CheckCircle2, ChevronDown, Circle, CircleAlert, CircleDotDashed, ListChecks } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { TodoItem, TodoPhase } from "@/lib/pi-types";

const TODO_HEADER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-4)",
  padding: "var(--space-4) var(--space-5)",
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
};

function TodoStatusIcon({ status }: { status: TodoItem["status"] }) {
  const props = { size: 14, strokeWidth: 1.8, "aria-hidden": true as const };
  if (status === "completed") return <CheckCircle2 {...props} color="var(--accent)" />;
  if (status === "in_progress") return <CircleDotDashed {...props} color="var(--accent)" />;
  if (status === "blocked") return <CircleAlert {...props} color="var(--text-muted)" />;
  if (status === "abandoned") return <Ban {...props} color="var(--text-dim)" />;
  return <Circle {...props} color="var(--text-dim)" />;
}

interface TodoListProps {
  phases?: TodoPhase[];
  /** Render as a composer-attached panel: the header row becomes a
   * collapse/expand toggle and the section margin is dropped. */
  collapsible?: boolean;
  /** Initial expansion when `collapsible` (default: collapsed). */
  defaultExpanded?: boolean;
}

export function TodoList({ phases = [], collapsible = false, defaultExpanded = false }: TodoListProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState(collapsible ? !defaultExpanded : false);

  if (phases.length === 0) return null;

  const tasks = phases.flatMap((phase) => phase.tasks);
  const done = tasks.filter((task) => task.status === "completed").length;
  let remainingPreviewTasks = 5;
  const displayedPhases = (expanded ? phases : phases.slice(0, 4)).map((phase) => {
    const displayedTasks = expanded ? phase.tasks : phase.tasks.slice(0, remainingPreviewTasks);
    remainingPreviewTasks -= displayedTasks.length;
    return { ...phase, tasks: displayedTasks };
  }).filter((phase) => phase.tasks.length > 0);
  const isTruncated = displayedPhases.reduce((count, phase) => count + phase.tasks.length, 0) < tasks.length;

  const headerBorderClass = collapsed ? "" : "border-b border-border";
  const progress = t("chatWindow.todoProgress", { done, total: tasks.length });

  return (
    <section
      aria-label={t("chatWindow.todoList")}
      className="overflow-hidden border border-border bg-bg-subtle"
      style={{
        borderRadius: "var(--radius-card)",
        marginBlock: collapsible ? undefined : "var(--space-4)",
      }}
    >
      {collapsible ? (
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? t("chatWindow.expandPanel") : t("chatWindow.collapsePanel")}
          className={`${headerBorderClass} w-full cursor-pointer text-left`}
          style={{ ...TODO_HEADER_STYLE, background: "none" }}
        >
          <ListChecks size={15} strokeWidth={1.8} aria-hidden />
          <strong className="font-medium text-text">{t("chatWindow.todoList")}</strong>
          <span className="ml-auto">{progress}</span>
          <ChevronDown
            size={14}
            strokeWidth={1.8}
            aria-hidden
            style={{
              color: "var(--text-dim)",
              transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
              transition: "transform var(--dur-med) var(--ease-out-warm)",
            }}
          />
        </button>
      ) : (
        <div className={headerBorderClass} style={TODO_HEADER_STYLE}>
          <ListChecks size={15} strokeWidth={1.8} aria-hidden />
          <strong className="font-medium text-text">{t("chatWindow.todoList")}</strong>
          <span className="ml-auto">{progress}</span>
        </div>
      )}
      {!collapsed && (
        <>
      <div
        className="animate-slide-down"
        style={{
          display: "grid",
          gap: "var(--space-5)",
          padding: "calc(var(--space-4) + var(--space-1)) var(--space-5)",
        }}
      >
        {displayedPhases.map((phase, phaseIndex) => (
          <div
            key={phase.id ?? `${phase.name}-${phaseIndex}`}
            style={{ display: "grid", gap: "var(--space-3)" }}
          >
            <div className="text-sm font-medium text-text-muted">{phase.name}</div>
            <div style={{ display: "grid", gap: "var(--space-3)" }}>
              {phase.tasks.map((task, taskIndex) => (
                <div
                  key={task.id ?? `${task.content}-${taskIndex}`}
                  style={{
                    display: "flex",
                    minWidth: 0,
                    alignItems: "flex-start",
                    gap: "var(--space-4)",
                    fontSize: "var(--text-base)",
                    color: "var(--text)",
                  }}
                  aria-label={`${t(`chatWindow.todoStatus.${task.status}`)}: ${task.content}`}
                >
                  <span style={{ marginTop: "var(--space-1)", flexShrink: 0 }}><TodoStatusIcon status={task.status} /></span>
                  <span className="min-w-0">
                    <span className={task.status === "completed" || task.status === "abandoned" ? "text-text-dim line-through" : undefined}>
                      {task.content}
                    </span>
                    {task.blocker && (
                      <span
                        style={{
                          display: "block",
                          marginTop: "var(--space-1)",
                          fontSize: "var(--text-sm)",
                          color: "var(--text-muted)",
                        }}
                      >
                        {t("chatWindow.todoBlocker", { blocker: task.blocker })}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {(isTruncated || expanded) && (
        <button
          type="button"
          className="border-t border-border text-left text-xs text-accent hover:text-accent-hover"
          style={{ padding: "var(--space-4) var(--space-5)" }}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t("chatWindow.todoShowLess") : t("chatWindow.todoShowAll")}
        </button>
      )}
        </>
      )}
    </section>
  );
}
