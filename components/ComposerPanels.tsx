"use client";

import { memo } from "react";
import type { SubagentInfo } from "@/hooks/useAgentSession";
import type { SubagentActivityEvent } from "@/lib/subagent-types";
import type { TodoPhase } from "@/lib/pi-types";
import { TodoList } from "./TodoList";
import { SubagentHub } from "./SubagentHub";

export type ComposerPanelsProps = {
  todoPhases: TodoPhase[];
  subagents: SubagentInfo[];
  subagentEvents?: Record<string, SubagentActivityEvent[]>;
  onSelectSubagent: (subagent: SubagentInfo) => void;
  /** Initial expansion of both panels (default: collapsed). */
  defaultExpanded?: boolean;
};

/** Reference equality of the observable panel inputs. Token-only parent
 *  rerenders that keep these identities skip the composer tree. */
export function composerPanelsPropsEqual(
  prev: ComposerPanelsProps,
  next: ComposerPanelsProps,
): boolean {
  return prev.todoPhases === next.todoPhases
    && prev.subagents === next.subagents
    && prev.subagentEvents === next.subagentEvents
    && prev.onSelectSubagent === next.onSelectSubagent
    && prev.defaultExpanded === next.defaultExpanded;
}

/** Session panels attached to the composer: live todo plan + subagent hub.
 * Each is independently collapsible via its header row and starts collapsed;
 * the headers always show live progress / running-summary. Rendered pinned
 * above the chat input. */
export const ComposerPanels = memo(function ComposerPanels({
  todoPhases,
  subagents,
  subagentEvents,
  onSelectSubagent,
  defaultExpanded = false,
}: ComposerPanelsProps) {
  if (todoPhases.length === 0 && subagents.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
      <TodoList phases={todoPhases} collapsible defaultExpanded={defaultExpanded} />
      {subagents.length > 0 && (
        <SubagentHub
          subagents={subagents}
          subagentEvents={subagentEvents}
          onSelectSubagent={onSelectSubagent}
          defaultExpanded={defaultExpanded}
        />
      )}
    </div>
  );
}, composerPanelsPropsEqual);
