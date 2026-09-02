"use client";
import { registerAbortHandler } from "@/hooks/useKeyboardShortcuts";
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { AgentMessage, AssistantContentBlock, AssistantMessage, BashExecutionMessage, ExtensionUiRequest, SessionInfo, SessionTreeNode, ToolResultMessage } from "@/lib/types";
import { translate, useI18n } from "@/lib/i18n";
import { splitFinalAssistantBlocks } from "@/lib/message-display";
import { MessageView } from "./MessageView";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ExtensionDialog } from "./ExtensionDialog";
import { SubagentTranscriptDialog } from "./SubagentTranscriptDialog";
import { ChatMinimap, minimapMeasureKey, useMessageRefs } from "./ChatMinimap";
import { ComposerPanels } from "./ComposerPanels";
import {
  CHAT_COLUMN_MAX_WIDTH,
  CHAT_BASE_HORIZONTAL_PADDING,
  CHAT_DESKTOP_MINIMAP_WIDTH,
} from "@/lib/chat-layout";
import { useAgentSession, type AgentPhase, type NoticeItem, type SubagentInfo } from "@/hooks/useAgentSession";
import { useAudio } from "@/hooks/useAudio";
import { useDragDrop } from "@/hooks/useDragDrop";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { SessionStatsInfo } from "@/lib/pi-types";
import { normalizeCustomPanelLines, parseAnsiLine } from "@/lib/ansi";
import { resolveAvailableThinkingLevels } from "@/lib/thinking-levels";
import { asBracketedPaste, toTerminalKeyData } from "@/lib/terminal-input";
import {
  initialRenderWindow,
  overlappingAnchorIndex,
  reconcileRenderWindow,
  restoreScrollTopFromRectDelta,
  shiftRenderWindowDown,
  shiftRenderWindowUp,
  commitResolvedRenderWindow,
  historyLoadModeFromSentinel,
  shouldLoadOlderAtExactTop,
  type RenderWindow,
} from "@/lib/chat-lazy-load";
import {
  buildTranscriptRenderPlan,
  isGroupAnchor,
  processGroupToolCallCount,
  type TranscriptRenderItem,
} from "@/lib/chat-transcript-groups";

interface Props {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  advisorEnabled?: boolean;
  toolCallsDefaultCollapsed?: boolean;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  ompVersionRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSystemPromptLoaderChange?: (loader: (() => Promise<void>) | null) => void;
  onSessionStatsChange?: (stats: SessionStatsInfo | null) => void;
  onSessionStatsPanelOpen?: () => void;
  onOpenSettingsTab?: (tab: "agents") => void;
  onContextUsageChange?: (usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => void;
  onOpenFile?: (filePath: string) => void;
  onRuntimeReadyChange?: (ready: boolean) => void;
}

function phaseLabel(phase: AgentPhase): string {
  if (phase?.kind === "running_tools") {
    const names = phase.tools.map((tool) => tool.name);
    if (names.length === 0) return translate("chatWindow.runningTool");
    if (names.length <= 3) return translate("chatWindow.runningNamed", { names: names.join(", ") });
    return translate("chatWindow.runningNamedMore", { names: names.slice(0, 2).join(", "), more: names.length - 2 });
  }
  if (phase?.kind === "waiting_model") return translate("chatWindow.waitingModel");
  if (phase?.kind === "running_command") return translate("chatWindow.runningCommand");
  return translate("chatWindow.thinking");
}

// Trigger the next history page while the sentinel is still this far below
// the top edge, so a normal upward scroll seamlessly continues into the newly
// loaded messages. Triggering only at the very top made the load invisible:
// the restore anchored the viewport to the old content, so the user parked on
// the banner and the load looked like a no-op.
const LOAD_MORE_ROOT_MARGIN = "400px 0px 0px 0px";
const LOAD_MORE_BELOW_ROOT_MARGIN = "0px 0px 400px 0px";

function getUserInputText(message: AgentMessage): string | null {
  if (message.role !== "user") return null;
  if (typeof message.content === "string") {
    const text = message.content.trim();
    return text.length > 0 ? text : null;
  }
  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}

function withAssistantBlocks(
  message: AssistantMessage,
  content: AssistantContentBlock[],
  options: { omitUsage?: boolean } = {},
): AssistantMessage {
  const next = { ...message, content };
  if (options.omitUsage) next.usage = undefined;
  return next;
}

function OmpRuntimeVersion({ refreshKey = 0 }: { refreshKey?: number }) {
  const { t } = useI18n();
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/omp-version")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { version: string | null } | null) => {
        // omp reports "omp/17.1.3"; show just the number next to the label.
        if (!cancelled && data?.version) setVersion(data.version.replace(/^omp\//, ""));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);
  return (
    <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
      omp <span style={{ color: "var(--text)" }}>{version ? `v${version}` : t("chatWindow.versionNotFound")}</span>
    </span>
  );
}

function ProcessDetailsGroup({ messageCount, toolCallCount, children }: { messageCount: number; toolCallCount: number; children: ReactNode }) {
  const { t, tn } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const parts = [t("chatWindow.processDetails"), tn("chatWindow.messageCount", messageCount)];
  if (toolCallCount > 0) parts.push(tn("chatWindow.toolCallCount", toolCallCount));

  return (
    <div style={{ marginBottom: "var(--space-5)" }}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="process-details-toggle"
        title={expanded ? t("chatWindow.collapseProcessDetails") : t("chatWindow.expandProcessDetails")}
      >
        <ChevronDown
          size={12}
          strokeWidth={1.8}
          aria-hidden="true"
          style={{
            flexShrink: 0,
            transform: expanded ? "rotate(180deg)" : "none",
            transition: "transform var(--dur-fast) var(--ease-out-warm)",
          }}
        />
        <span className="process-details-label">
          {parts.join(" · ")}
        </span>
      </button>
      {expanded && (
        <div style={{ marginTop: "var(--space-4)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

interface CommittedTranscriptProps {
  messages: AgentMessage[];
  entryIds: string[];
  conversationMeta: { toolResultsMap: Map<string, ToolResultMessage>; lastAnchorIdx: number; visibleRefIndexByMessage: Map<number, number> };
  messageRefs: React.RefObject<(HTMLDivElement | null)[]>;
  isStreaming: boolean;
  sessionBusy: boolean;
  runtimeReady: boolean;
  isNew: boolean;
  forkingEntryId: string | null;
  handleFork: (entryId: string) => void;
  handleNavigate: (entryId: string) => void;
  handleEditContent: (content: string) => void;
  modelNames: Record<string, string>;
  messageCwd: string | undefined;
  onOpenFile?: (filePath: string) => void;
  sessionId: string | undefined;
  toolCallsDefaultCollapsed: boolean;
  sessionKey: string;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  onRenderWindowChange?: (startIndex: number, endIndex: number) => void;
}

/**
 * The committed (non-streaming) transcript. Extracted from ChatWindow and
 * memoized over the committed messages so token-streaming updates (which only
 * change `streamingMessage`, rendered separately) do not re-run the O(history)
 * grouping/splitting work at display-frame cadence.
 */
const CommittedTranscript = memo(function CommittedTranscript({
  messages, entryIds, conversationMeta, messageRefs, isStreaming, sessionBusy, runtimeReady, isNew, forkingEntryId,
  handleFork, handleNavigate, handleEditContent, modelNames, messageCwd, onOpenFile, sessionId,
  toolCallsDefaultCollapsed, sessionKey, scrollContainerRef, onRenderWindowChange,
}: CommittedTranscriptProps) {
  const { t } = useI18n();
  const { toolResultsMap, lastAnchorIdx, visibleRefIndexByMessage } = conversationMeta;
  const [requestedWindow, setRequestedWindow] = useState<RenderWindow>(() => initialRenderWindow(0));
  const [followingEnd, setFollowingEnd] = useState(true);
  const topSentinelRef = useRef<HTMLButtonElement>(null);
  const bottomSentinelRef = useRef<HTMLButtonElement>(null);
  const hasLeftTopRef = useRef(false);
  const pendingAnchorRef = useRef<{
    index: number;
    previousTop: number;
    scrollTop: number;
    mode: "auto" | "click-above";
  } | null>(null);
  const resolvedWindowRef = useRef<ReturnType<typeof reconcileRenderWindow>>(initialRenderWindow(0));
  const plan = useMemo(
    () => buildTranscriptRenderPlan(messages, { lastAnchorIdx, isStreaming, sessionBusy }),
    [messages, lastAnchorIdx, isStreaming, sessionBusy],
  );
  const planLength = plan.length;
  const resolvedWindow = reconcileRenderWindow(planLength, requestedWindow, { pinToEnd: followingEnd });
  const { startIndex, endIndex, hasMoreAbove, hasMoreBelow } = resolvedWindow;
  const visiblePlan = plan.slice(startIndex, endIndex);

  useLayoutEffect(() => {
    commitResolvedRenderWindow(resolvedWindowRef, resolvedWindow);
  }, [resolvedWindow]);

  const attachVisibleRef = (idx: number, refIndex: number) => (el: HTMLDivElement | null) => {
    messageRefs.current[refIndex] = el;
  };

  const renderMessage = (idx: number, options: { attachRef?: boolean; keyPrefix?: string; messageOverride?: AgentMessage; showTimestamp?: boolean } = {}): ReactNode => {
    const msg = options.messageOverride ?? messages[idx];
    const prevAssistantEntryId =
      msg.role === "user" && idx > 0 && messages[idx - 1].role === "assistant"
        ? entryIds[idx - 1]
        : undefined;
    const isVisible = msg.role === "user" || msg.role === "assistant";
    const currentRefIdx = visibleRefIndexByMessage.get(idx);
    const keyPrefix = options.keyPrefix ?? "message";
    let showTimestamp = false;
    if (msg.role === "assistant") {
      showTimestamp = true;
      for (let j = idx + 1; j < messages.length; j++) {
        const r = messages[j].role;
        if (r === "user") break;
        if (r === "assistant") { showTimestamp = false; break; }
      }
      // Hide on the currently-streaming tail (the streaming bubble owns the live timestamp)
      if (showTimestamp && isStreaming && idx === messages.length - 1) {
        showTimestamp = false;
      }
    }
    if (options.showTimestamp !== undefined) showTimestamp = options.showTimestamp;
    const view = (
      <MessageView
        key={`${keyPrefix}-view-${idx}`}
        message={msg}
        toolResults={toolResultsMap}
        modelNames={modelNames}
        cwd={messageCwd}
        onOpenFile={onOpenFile}
        entryId={entryIds[idx]}
        onFork={!runtimeReady || sessionBusy || isNew || (idx === 0 && msg.role === "user") ? undefined : handleFork}
        forking={forkingEntryId === entryIds[idx]}
        onNavigate={!runtimeReady || sessionBusy ? undefined : handleNavigate}
        prevAssistantEntryId={!runtimeReady || sessionBusy ? undefined : prevAssistantEntryId}
        onEditContent={runtimeReady ? handleEditContent : undefined}
        showTimestamp={showTimestamp}
        prevTimestamp={idx > 0 ? (messages[idx - 1] as AgentMessage & { timestamp?: number }).timestamp : undefined}
        sessionId={sessionId}
        toolCallsDefaultCollapsed={toolCallsDefaultCollapsed}
      />
    );
    if (!isVisible || options.attachRef === false || currentRefIdx === undefined) return view;
    return (
      <div key={`${keyPrefix}-${idx}`} ref={attachVisibleRef(idx, currentRefIdx)}>
        {view}
      </div>
    );
  };

  const renderPlanItem = (item: TranscriptRenderItem): ReactNode => {
    if (item.kind === "message") return renderMessage(item.idx);
    if (item.kind === "answer") {
      const finalAssistant = messages[item.idx] as AssistantMessage;
      const finalSplit = splitFinalAssistantBlocks(finalAssistant);
      const finalAnswerMessage = withAssistantBlocks(finalAssistant, finalSplit.answerBlocks);
      return renderMessage(item.idx, { messageOverride: finalAnswerMessage });
    }

    const { userIdx, finalAssistantIdx, visibleProcessIndices } = item;
    const finalAssistant = messages[finalAssistantIdx] as AssistantMessage;
    const finalSplit = splitFinalAssistantBlocks(finalAssistant);
    const finalProcessMessage = finalSplit.processBlocks.length > 0
      ? withAssistantBlocks(finalAssistant, finalSplit.processBlocks, { omitUsage: true })
      : null;
    const includeAnswer = finalSplit.answerBlocks.length > 0;
    const processCount = visibleProcessIndices.length + (finalProcessMessage ? 1 : 0);
    const processRefIdx = visibleProcessIndices
      .map((processIdx) => visibleRefIndexByMessage.get(processIdx))
      .find((value): value is number => typeof value === "number")
      ?? (includeAnswer ? undefined : visibleRefIndexByMessage.get(finalAssistantIdx));
    return (
      <div
        key={`process-group-${userIdx}-${finalAssistantIdx}`}
        ref={processRefIdx === undefined ? undefined : (el) => { messageRefs.current[processRefIdx] = el; }}
      >
        <ProcessDetailsGroup
          messageCount={processCount}
          toolCallCount={processGroupToolCallCount(messages, visibleProcessIndices, finalAssistantIdx)}
        >
          {visibleProcessIndices.map((processIdx) => renderMessage(processIdx, { attachRef: false, keyPrefix: "process" }))}
          {finalProcessMessage && renderMessage(finalAssistantIdx, { attachRef: false, keyPrefix: "process-final", messageOverride: finalProcessMessage, showTimestamp: false })}
        </ProcessDetailsGroup>
      </div>
    );
  };

  const planItemKey = (item: TranscriptRenderItem): string => {
    if (item.kind === "message") return `message-${item.idx}`;
    if (item.kind === "answer") return `answer-${item.idx}`;
    return `process-group-${item.userIdx}-${item.finalAssistantIdx}`;
  };

  const captureAnchor = useCallback((nextWindow: RenderWindow, mode: "auto" | "click-above") => {
    const container = scrollContainerRef.current;
    const current = resolvedWindowRef.current;
    const anchorIndex = overlappingAnchorIndex(current, nextWindow);
    const anchor = container?.querySelector(`[data-render-index="${anchorIndex}"]`);
    pendingAnchorRef.current = {
      index: anchorIndex,
      previousTop: anchor?.getBoundingClientRect().top ?? 0,
      scrollTop: container?.scrollTop ?? 0,
      mode,
    };
  }, [scrollContainerRef]);

  const loadOlder = useCallback((mode: "auto" | "click-above") => {
    const current = resolvedWindowRef.current;
    if (!current.hasMoreAbove) return;
    const next = shiftRenderWindowUp(planLength, current);
    if (next.startIndex === current.startIndex && next.endIndex === current.endIndex) return;
    captureAnchor(next, mode);
    setFollowingEnd(false);
    setRequestedWindow(next);
  }, [planLength, captureAnchor]);

  const loadNewer = useCallback(() => {
    const current = resolvedWindowRef.current;
    if (!current.hasMoreBelow) return;
    const next = shiftRenderWindowDown(planLength, current);
    if (next.startIndex === current.startIndex && next.endIndex === current.endIndex) return;
    captureAnchor(next, "auto");
    setRequestedWindow(next);
  }, [planLength, captureAnchor]);

  useEffect(() => {
    setRequestedWindow(initialRenderWindow(0));
    setFollowingEnd(true);
    hasLeftTopRef.current = false;
  }, [sessionKey]);

  useLayoutEffect(() => {
    onRenderWindowChange?.(startIndex, endIndex);
  }, [startIndex, endIndex, onRenderWindowChange]);

  useLayoutEffect(() => {
    const pending = pendingAnchorRef.current;
    if (!pending) return;
    pendingAnchorRef.current = null;
    const container = scrollContainerRef.current;
    if (!container) return;
    if (pending.mode === "click-above") {
      const sentinel = topSentinelRef.current;
      if (sentinel) {
        const containerRect = container.getBoundingClientRect();
        const sentinelRect = sentinel.getBoundingClientRect();
        container.scrollTop = container.scrollTop + (sentinelRect.bottom - containerRect.top) + 1;
      } else {
        container.scrollTop = 0;
      }
      return;
    }
    const anchor = container.querySelector(`[data-render-index="${pending.index}"]`);
    if (!anchor) return;
    container.scrollTop = restoreScrollTopFromRectDelta(
      pending.scrollTop,
      pending.previousTop,
      anchor.getBoundingClientRect().top,
    );
  }, [startIndex, endIndex, scrollContainerRef]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    let raf: number | null = null;
    const update = () => {
      raf = null;
      if (container.scrollTop > 0) hasLeftTopRef.current = true;
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 96;
      if (!atBottom) {
        const resolved = resolvedWindowRef.current;
        setRequestedWindow((prev) => (
          prev.startIndex === resolved.startIndex && prev.endIndex === resolved.endIndex
            ? prev
            : resolved
        ));
        setFollowingEnd(false);
        if (shouldLoadOlderAtExactTop({
          scrollTop: container.scrollTop,
          hasLeftTop: hasLeftTopRef.current,
          hasMoreAbove: resolved.hasMoreAbove,
        })) {
          loadOlder("click-above");
        }
        return;
      }
      if (resolvedWindowRef.current.endIndex >= planLength) {
        setFollowingEnd(true);
      }
    };
    const onScroll = () => {
      if (raf === null) raf = requestAnimationFrame(update);
    };
    update();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [scrollContainerRef, planLength, sessionKey, startIndex, endIndex, loadOlder]);

  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const mode = historyLoadModeFromSentinel({
          intersecting: Boolean(entries[0]?.isIntersecting),
          scrollTop: container.scrollTop,
          hasLeftTop: hasLeftTopRef.current,
        });
        if (mode) loadOlder(mode);
      },
      { root: container, rootMargin: LOAD_MORE_ROOT_MARGIN, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [startIndex, endIndex, planLength, scrollContainerRef, loadOlder]);

  useEffect(() => {
    const sentinel = bottomSentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadNewer();
      },
      { root: container, rootMargin: LOAD_MORE_BELOW_ROOT_MARGIN, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [startIndex, endIndex, planLength, scrollContainerRef, loadNewer]);

  return (
    <>
      {hasMoreAbove && (
        <button
          ref={topSentinelRef}
          type="button"
          onClick={() => loadOlder("click-above")}
          className="py-3 w-full min-h-[44px] text-center text-xs text-text-muted hover:text-text transition-colors cursor-pointer inline-flex items-center justify-center gap-1"
        >
          <ChevronUp size={12} strokeWidth={1.8} aria-hidden="true" />
          {t("chatWindow.scrollUpToLoad", { count: startIndex })}
        </button>
      )}
      {visiblePlan.map((item, offset) => (
        <div key={planItemKey(item)} data-render-index={startIndex + offset}>
          {renderPlanItem(item)}
        </div>
      ))}
      {hasMoreBelow && (
        <button
          ref={bottomSentinelRef}
          type="button"
          onClick={loadNewer}
          className="py-3 w-full min-h-[44px] text-center text-xs text-text-muted hover:text-text transition-colors cursor-pointer inline-flex items-center justify-center gap-1"
        >
          {t("chatWindow.scrollDownToLoad", { count: planLength - endIndex })}
          <ChevronDown size={12} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}
    </>
  );
});

export function ChatWindow({ session, newSessionCwd, advisorEnabled, toolCallsDefaultCollapsed = true, onAgentEnd, onSessionCreated, onSessionForked, modelsRefreshKey, ompVersionRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSystemPromptLoaderChange, onSessionStatsChange, onSessionStatsPanelOpen, onOpenSettingsTab, onContextUsageChange, onOpenFile, onRuntimeReadyChange }: Props) {
  const { t, tn } = useI18n();
  const { playDoneSound, unlockAudio } = useAudio();
  const isMobile = useIsMobile();

  // Wrap onAgentEnd to play the completion sound. This is more reliable than
  // wrapping handleAgentEventRef because useAgentSession overwrites that ref
  // on every render (it syncs the latest callback), which would blow away an
  // externally-installed wrapper after the first re-render. playDoneSound
  // checks the sound preference itself.
  const playDoneSoundRef = useRef(playDoneSound);
  playDoneSoundRef.current = playDoneSound;
  const wrappedOnAgentEnd = useCallback(() => {
    playDoneSoundRef.current();
    onAgentEnd?.();
  }, [onAgentEnd]);

  // 稳定化 onEditContent 引用，配合 React.memo 防止历史消息重渲染
  const handleEditContent = useCallback((content: string) => {
    chatInputRef?.current?.insertIfEmpty(content);
  }, [chatInputRef]);

  const {
    loading, error, messages, entryIds, streamState,
    sessionReadiness, runtimeError, runtimeReady, retryRuntimeState,
    agentRunning, bashRunning, pendingBash, modelNames, modelList, modelsLoading, modelError, modelThinkingLevels, modelThinkingLevelMaps, thinkingLevel, fastModeEnabled, fastModeActive,
    liveModelMeta,
    retryInfo, contextUsage, forkingEntryId,
    isCompacting, compactResult, displayModel: displayModelValue, sessionStats,
    slashCommands, slashCommandsLoading, queuedMessages,
    notices, extensionDialog, extensionCustomUi, extensionStatuses, extensionWidgets, respondToExtensionUi, sendExtensionCustomInput,
    isAutoModelSelection,
    agentPhase, activeGoal, activePlan,
    subagents, subagentEvents, subagentTranscriptVersions, activeSubagentCount, currentTodoPhase, todoPhases,
    isNew,
    sessionIdRef, messagesEndRef, scrollContainerRef,
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleSteer, handleFollowUp, handlePromptWithStreamingBehavior, handleAbortCompaction,
    removeQueuedMessage, promoteQueuedToSteer,
    handleBuiltinSlashCommand,
    handleThinkingLevelChange, handleFastModeChange, handleCycleModel, handleCycleThinkingLevel, handleAbortRetry, loadSlashCommands,
  } = useAgentSession({
    session, newSessionCwd, advisorEnabled, onAgentEnd: wrappedOnAgentEnd, onSessionCreated, onSessionForked,
    modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSystemPromptLoaderChange, onSessionStatsPanelOpen, onOpenSettingsTab,
    onOpenFile,
  });
  const sessionBusy = agentRunning || bashRunning;

  useEffect(() => {
    onRuntimeReadyChange?.(runtimeReady);
    return () => {
      onRuntimeReadyChange?.(false);
    };
  }, [onRuntimeReadyChange, runtimeReady]);

  // Register the abort handler for the global Esc shortcut. The cleanup
  // matters: unmounting mid-run must not leave the module-global handler
  // pointing at this (now unmounted) instance's handleAbort.
  useEffect(() => {
    registerAbortHandler(sessionBusy ? handleAbort : null);
    return () => registerAbortHandler(null);
  }, [sessionBusy, handleAbort]);

  // Cycle model / thinking level via ⌘/Ctrl+Alt+M and ⌘/Ctrl+Alt+T (RPC
  // cycle_model / cycle_thinking_level). Meta/Alt combos avoid clashing with
  // ordinary typing in the composer.
  useEffect(() => {
    if (!session) return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "m") {
        e.preventDefault();
        void handleCycleModel();
      } else if (key === "t") {
        e.preventDefault();
        void handleCycleThinkingLevel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [session, handleCycleModel, handleCycleThinkingLevel]);

  const sessionKeyForPaging = session?.id ?? (newSessionCwd ? `new:${newSessionCwd}` : "empty");
  const [minimapLayoutKey, setMinimapLayoutKey] = useState(() => minimapMeasureKey(0, 0, 0));
  const handleRenderWindowChange = useCallback((startIndex: number, endIndex: number) => {
    const next = minimapMeasureKey(messages.length, startIndex, endIndex);
    setMinimapLayoutKey((prev) => (prev === next ? prev : next));
  }, [messages.length]);
  const [selectedSubagent, setSelectedSubagent] = useState<SubagentInfo | null>(null);
  // Push session stats up to AppShell for the top bar.
  // Compare scalar fields to avoid loops from new object identity each render.
  const statsKey = sessionStats
    ? [
      sessionStats.sessionId,
      sessionStats.sessionFile ?? "",
      sessionStats.sessionName ?? "",
      sessionStats.userMessages,
      sessionStats.assistantMessages,
      sessionStats.toolCalls,
      sessionStats.toolResults,
      sessionStats.totalMessages,
      sessionStats.tokens.input,
      sessionStats.tokens.output,
      sessionStats.tokens.cacheRead,
      sessionStats.tokens.cacheWrite,
      sessionStats.tokens.total,
      sessionStats.cost ?? 0,
    ].join("|")
    : null;
  const sessionStatsRef = useRef(sessionStats);
  sessionStatsRef.current = sessionStats;
  useEffect(() => {
    onSessionStatsChange?.(sessionStatsRef.current);
  }, [statsKey, onSessionStatsChange]);
  useEffect(() => () => { onSessionStatsChange?.(null); }, [onSessionStatsChange]);

  // Push context usage up to AppShell as well.
  const ctxKey = contextUsage
    ? `${contextUsage.percent ?? "null"}|${contextUsage.contextWindow}|${contextUsage.tokens ?? "null"}`
    : null;
  const contextUsageRef = useRef(contextUsage);
  contextUsageRef.current = contextUsage;
  useEffect(() => {
    onContextUsageChange?.(contextUsageRef.current);
  }, [ctxKey, onContextUsageChange]);
  useEffect(() => () => { onContextUsageChange?.(null); }, [onContextUsageChange]);

  const onDrop = useCallback((files: File[]) => {
    if (sessionBusy || !runtimeReady) return;
    chatInputRef?.current?.addFiles(files);
  }, [runtimeReady, sessionBusy, chatInputRef]);

  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);

  const inputHistory = useMemo(() => {
    const seen = new Set<string>();
    const history: string[] = [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const text = getUserInputText(messages[i]);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      history.push(text);
      if (history.length >= 50) break;
    }
    return history.reverse();
  }, [messages]);
  const conversationMeta = useMemo(() => {
    const toolResultsMap = new Map<string, ToolResultMessage>();
    let lastAnchorIdx = -1;
    const visibleRefIndexByMessage = new Map<number, number>();
    let refIdx = 0;

    messages.forEach((message, index) => {
      if (message.role === "toolResult") toolResultsMap.set((message as ToolResultMessage).toolCallId, message as ToolResultMessage);
      if (isGroupAnchor(message)) lastAnchorIdx = index;
      if (message.role === "user" || message.role === "assistant") visibleRefIndexByMessage.set(index, refIdx++);
    });

    return { toolResultsMap, lastAnchorIdx, visibleRefIndexByMessage };
  }, [messages]);
  // The ref array is sized by the count of user/assistant messages — exactly
  // what conversationMeta's visibleRefIndexByMessage already tallies, so no
  // separate filter pass (which would re-run on every streaming frame).
  const messageRefs = useMessageRefs(conversationMeta.visibleRefIndexByMessage.size);
  // Tool-call ids already rendered by COMMITTED messages — memoized away from
  // the streaming path so a per-token update only re-scans the live bubble.
  const committedToolCallIds = useMemo(() => {
    const renderedIds = new Set<string>();
    for (const message of messages) {
      if (message?.role !== "assistant") continue;
      for (const block of (message as Partial<AssistantMessage>).content ?? []) {
        if (block.type === "toolCall") renderedIds.add(block.toolCallId);
      }
    }
    return renderedIds;
  }, [messages]);
  const pendingToolHeaders = useMemo(() => {
    if (agentPhase?.kind !== "running_tools") return [];
    const renderedIds = new Set(committedToolCallIds);
    const streaming = streamState.streamingMessage;
    if (streaming?.role === "assistant") {
      for (const block of (streaming as Partial<AssistantMessage>).content ?? []) {
        if (block.type === "toolCall") renderedIds.add(block.toolCallId);
      }
    }
    return agentPhase.tools.filter((tool) => !renderedIds.has(tool.id));
  }, [agentPhase, committedToolCallIds, streamState.streamingMessage]);

  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !sessionBusy;
  const messageCwd = session?.cwd ?? newSessionCwd ?? undefined;

  const availableThinkingLevels = displayModelValue
    ? resolveAvailableThinkingLevels(
        modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`],
        displayModelValue,
        liveModelMeta,
      )
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const chatInputElement = (
    <ChatInput
      ref={chatInputRef}
      onSend={handleSend}
      onAbort={handleAbort}
      runtimeReady={runtimeReady}
      onSteer={runtimeReady && agentRunning ? handleSteer : undefined}
      onFollowUp={runtimeReady && agentRunning ? handleFollowUp : undefined}
      onPromptWithStreamingBehavior={runtimeReady && agentRunning ? handlePromptWithStreamingBehavior : undefined}
      isStreaming={sessionBusy}
      model={displayModelValue}
      isAutoModelSelection={isAutoModelSelection}
      modelNames={modelNames}
      modelList={modelList}
      modelsLoading={modelsLoading}
      modelError={modelError}
      onModelChange={runtimeReady ? handleModelChange : undefined}
      onAbortCompaction={runtimeReady ? handleAbortCompaction : undefined}
      isCompacting={isCompacting}
      compactResult={compactResult}
      thinkingLevel={thinkingLevel}
      onThinkingLevelChange={runtimeReady && (session || isNew) ? handleThinkingLevelChange : undefined}
      fastModeEnabled={fastModeEnabled}
      fastModeActive={fastModeActive}
      fastModeSupported={Boolean(displayModelValue && modelList.some((entry) => entry.provider === displayModelValue.provider && entry.id === displayModelValue.modelId && entry.supportsFastMode))}
      onFastModeChange={runtimeReady && (session || isNew) ? handleFastModeChange : undefined}
      onAbortRetry={runtimeReady && session ? handleAbortRetry : undefined}
      availableThinkingLevels={availableThinkingLevels}
      thinkingLevelMap={currentThinkingLevelMap}
      modelNameOverride={liveModelMeta?.name ?? null}
      retryInfo={retryInfo}
      activeGoal={activeGoal}
      activePlan={activePlan}
      advisorEnabled={advisorEnabled}
      queuedMessages={queuedMessages}
      inputHistory={inputHistory}
      contextUsage={contextUsage}
      sessionCost={sessionStats?.cost ?? null}
      onRemoveQueuedMessage={removeQueuedMessage}
      onPromoteQueuedToSteer={promoteQueuedToSteer}
      slashCommands={slashCommands}
      slashCommandsLoading={slashCommandsLoading}
      onLoadSlashCommands={runtimeReady ? loadSlashCommands : undefined}
      onBuiltinCommand={runtimeReady ? handleBuiltinSlashCommand : undefined}
      onAudioUnlock={unlockAudio}
      draftKey={session?.id ?? (newSessionCwd ? `new:${newSessionCwd}` : undefined)}
      cwd={session?.cwd ?? newSessionCwd}
    />
  );

  const aboveEditorWidgets = extensionWidgets.filter((widget) => widget.placement !== "belowEditor");
  const belowEditorWidgets = extensionWidgets.filter((widget) => widget.placement === "belowEditor");

  if (loading) {
    return (
      <div role="status" className="flex h-full items-center justify-center" style={{ color: "var(--text-muted)" }}>
        {t("chatWindow.loadingSession")}
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="flex h-full items-center justify-center" style={{ color: "var(--accent-strong)", padding: "0 var(--space-6)", textAlign: "center", fontSize: "var(--text-base)" }}>
        {error}
      </div>
    );
  }

  const runtimeUnavailable = !isNew && sessionReadiness.runtime !== "ready";
  const runtimeBanner = runtimeUnavailable ? (
    <div
      role={sessionReadiness.runtime === "error" ? "alert" : "status"}
      aria-live="polite"
      style={{
        display: "flex", alignItems: "center", gap: 10,
        margin: "0 auto var(--space-3)", maxWidth: CHAT_COLUMN_MAX_WIDTH,
        padding: "8px 10px", border: "1px solid color-mix(in srgb, var(--status-warning) 35%, var(--border))",
        borderRadius: "var(--radius-control)", background: "color-mix(in srgb, var(--status-warning) 8%, var(--bg-panel))",
        color: "var(--text-muted)", fontSize: "var(--text-sm)",
      }}
    >
      <span style={{ minWidth: 0, flex: 1, overflowWrap: "anywhere" }}>
        {sessionReadiness.runtime === "error"
          ? runtimeError
            ? t("chatWindow.runtimeUnavailableDetail", { error: runtimeError })
            : t("chatWindow.runtimeUnavailable")
          : t("chatWindow.runtimePreparing")}
      </span>
      {sessionReadiness.runtime === "error" && (
        <button
          type="button"
          onClick={() => void retryRuntimeState()}
          style={{
            flexShrink: 0, padding: "4px 9px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)",
            background: "var(--bg)", color: "var(--text)", cursor: "pointer", fontSize: "var(--text-sm)",
          }}
        >
          {t("chatWindow.runtimeRetry")}
        </button>
      )}
    </div>
  ) : null;

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && runtimeReady && !sessionBusy && (
        <div className="drop-zone-overlay pointer-events-none absolute inset-0 flex items-center justify-center backdrop-blur-[1px]" style={{ zIndex: "var(--z-dropdown)" }}>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {[0, 0.8, 1.6].map((delay) => (
              <div
                key={delay}
                className="drop-ripple-ring absolute h-[720px] w-[720px] rounded-full border-[1.5px] border-solid"
                style={{ transformOrigin: "center", animationDelay: `${delay}s` }}
              />
            ))}
          </div>
          <svg
            width="280" height="280" viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg"
            className="drop-zone-illustration"
          >
            <rect x="28" y="44" width="84" height="60" rx="8" fill="color-mix(in srgb, var(--accent) 8%, transparent)" stroke="color-mix(in srgb, var(--accent) 50%, transparent)" strokeWidth="1.8"/>
            <path d="M36 100 L54 72 L68 88 L80 74 L104 100Z" fill="color-mix(in srgb, var(--accent) 16%, transparent)" stroke="color-mix(in srgb, var(--accent) 40%, transparent)" strokeWidth="1.4" strokeLinejoin="round"/>
            <circle cx="96" cy="58" r="8" fill="color-mix(in srgb, var(--accent) 22%, transparent)" stroke="color-mix(in srgb, var(--accent) 55%, transparent)" strokeWidth="1.6"/>
            <g stroke="color-mix(in srgb, var(--accent) 45%, transparent)" strokeWidth="1.4" strokeLinecap="round">
              <line x1="96" y1="46" x2="96" y2="43"/>
              <line x1="96" y1="70" x2="96" y2="73"/>
              <line x1="84" y1="58" x2="81" y2="58"/>
              <line x1="108" y1="58" x2="111" y2="58"/>
              <line x1="87.5" y1="49.5" x2="85.4" y2="47.4"/>
              <line x1="104.5" y1="66.5" x2="106.6" y2="68.6"/>
              <line x1="104.5" y1="49.5" x2="106.6" y2="47.4"/>
              <line x1="87.5" y1="66.5" x2="85.4" y2="68.6"/>
            </g>
          </svg>
        </div>
      )}

      {extensionDialog && (
        <ExtensionDialog
          request={extensionDialog}
          onRespond={respondToExtensionUi}
          runtimeReady={runtimeReady}
        />
      )}

      <SubagentTranscriptDialog
        subagent={selectedSubagent}
        sessionId={session?.id ?? sessionIdRef.current ?? null}
        transcriptVersion={selectedSubagent ? (subagentTranscriptVersions[selectedSubagent.id] ?? 0) : 0}
        events={selectedSubagent ? (subagentEvents[selectedSubagent.id] ?? []) : undefined}
        onClose={() => setSelectedSubagent(null)}
      />

      {extensionCustomUi && (
        <ExtensionCustomPanel
          request={extensionCustomUi}
          onInput={sendExtensionCustomInput}
          runtimeReady={runtimeReady}
        />
      )}

      {isEmptyNew ? (
        <div className="relative flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto py-8" style={{ minHeight: 0 }}>
            <div className="w-full">
              <div
                style={{
                  paddingLeft: CHAT_BASE_HORIZONTAL_PADDING,
                  paddingRight: CHAT_BASE_HORIZONTAL_PADDING,
                }}
              >
                <div style={{ maxWidth: CHAT_COLUMN_MAX_WIDTH, margin: "0 auto" }}>
                  <div
                    className="mb-3 empty-chat-brand"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "var(--space-5)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0, flex: 1, lineHeight: 1.4, overflow: "hidden" }}>
                      <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "0.04em", color: "var(--accent)", flexShrink: 0, whiteSpace: "nowrap" }}>⌥</span>
                      <span style={{ fontSize: 18, color: "var(--text)", fontWeight: 600, letterSpacing: "0.02em", flexShrink: 0, whiteSpace: "nowrap" }}>ompgui</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "var(--space-1)", flexShrink: 0 }}>
                      <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                        gui <span style={{ color: "var(--text)" }}>v{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.4.1"}</span>
                      </span>
                      <OmpRuntimeVersion refreshKey={ompVersionRefreshKey} />
                    </div>
                  </div>
                  <NoticeShelf notices={notices} align="right" />
                </div>
              </div>
              {chatInputElement}
            </div>
          </div>
        </div>
      ) : (
      <>
      {runtimeBanner}
      <div className="relative flex flex-1 overflow-hidden">
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 0,
            right: isMobile ? 0 : CHAT_DESKTOP_MINIMAP_WIDTH,
            zIndex: 40,
            padding: `0 ${CHAT_BASE_HORIZONTAL_PADDING}px`,
            pointerEvents: "none",
          }}
        >
          <div style={{ maxWidth: CHAT_COLUMN_MAX_WIDTH, margin: "0 auto" }}>
            <NoticeShelf notices={notices} floating align="right" />
          </div>
        </div>
        {/* Hide the Firefox scrollbar on desktop only: ChatMinimap provides the
            position indicator there, but on mobile there is no minimap and
            users need the scrollbar (Chrome's overlay scrollbar still shows). */}
        <div ref={scrollContainerRef} className={`flex-1 overflow-y-auto pt-6` + (isMobile ? "" : " [scrollbar-width:none]")}>
          <div
            style={{
              paddingLeft: CHAT_BASE_HORIZONTAL_PADDING,
              paddingRight: CHAT_BASE_HORIZONTAL_PADDING,
            }}
          >
            <div style={{ maxWidth: CHAT_COLUMN_MAX_WIDTH, margin: "0 auto" }}>
              <ExtensionStatusBar statuses={extensionStatuses} />
              <ExtensionWidgets widgets={aboveEditorWidgets} />

            <CommittedTranscript
              messages={messages}
              entryIds={entryIds}
              conversationMeta={conversationMeta}
              messageRefs={messageRefs}
              isStreaming={streamState.isStreaming}
              sessionBusy={sessionBusy}
              runtimeReady={runtimeReady}
              isNew={isNew}
              forkingEntryId={forkingEntryId}
              handleFork={handleFork}
              handleNavigate={handleNavigate}
              handleEditContent={handleEditContent}
              modelNames={modelNames}
              messageCwd={messageCwd}
              onOpenFile={onOpenFile}
              sessionId={session?.id ?? sessionIdRef.current ?? undefined}
              toolCallsDefaultCollapsed={toolCallsDefaultCollapsed}
              sessionKey={sessionKeyForPaging}
              scrollContainerRef={scrollContainerRef}
              onRenderWindowChange={handleRenderWindowChange}
            />
            {streamState.isStreaming && streamState.streamingMessage && (
              <MessageView message={streamState.streamingMessage as AgentMessage} isStreaming modelNames={modelNames} cwd={messageCwd} onOpenFile={onOpenFile} toolCallsDefaultCollapsed={toolCallsDefaultCollapsed} />
            )}

            {toolCallsDefaultCollapsed && pendingToolHeaders.map((tool) => (
              <div
                key={tool.id}
                role="status"
                aria-label={t("chatWindow.runningNamed", { names: tool.name })}
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  marginBottom: "var(--space-4)", padding: "var(--space-3) 10px",
                  border: "1px solid color-mix(in srgb, var(--status-success) 25%, transparent)",
                  borderRadius: "var(--radius-control)",
                  background: "color-mix(in srgb, var(--status-success) 4%, transparent)",
                  color: "var(--text-muted)", fontSize: "var(--text-md)",
                }}
              >
                <span aria-hidden className="live-status-dot live-pulse inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span style={{ color: "var(--status-success)", fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "var(--text-sm)" }}>{tool.name}</span>
              </div>
            ))}

            {agentRunning && !streamState.streamingMessage && pendingToolHeaders.length === 0 && (
              <div role="status" aria-live="polite" className="py-2 text-text-muted flex items-center gap-2" style={{ fontSize: "var(--text-base)" }}>
                <span
                  aria-hidden
                  className="live-status-dot live-pulse inline-block h-2 w-2 shrink-0 rounded-full bg-accent"
                />
                <span>
                  {[
                    phaseLabel(agentPhase),
                    activeSubagentCount > 0 ? tn("chatWindow.subagentCount", activeSubagentCount) : null,
                    currentTodoPhase
                      ? t("chatWindow.todoPhaseStatus", {
                          name: currentTodoPhase.name,
                          done: currentTodoPhase.done,
                          total: currentTodoPhase.total,
                        })
                      : null,
                  ].filter(Boolean).join(" · ")}
                </span>
              </div>
            )}

            {bashRunning && !pendingBash && (
              <div role="status" aria-live="polite" className="py-2 text-text-muted flex items-center gap-2" style={{ fontSize: "var(--text-base)" }}>
                <span
                  aria-hidden
                  className="live-status-dot live-pulse inline-block h-2 w-2 shrink-0 rounded-full bg-accent"
                />
                <span>{t("chatWindow.runningCommand")}</span>
              </div>
            )}

            {pendingBash && (
              <MessageView
                message={{
                  role: "bashExecution",
                  command: pendingBash.command,
                  output: "",
                  excludeFromContext: pendingBash.excludeFromContext,
                } as BashExecutionMessage}
                sessionId={session?.id ?? sessionIdRef.current ?? undefined}
              />
            )}

            <div ref={messagesEndRef} />
            </div>
          </div>
        </div>
        {isMobile ? null : (
          <ChatMinimap
            messages={messages}
            scrollContainer={scrollContainerRef}
            messageRefs={messageRefs}
            layoutKey={minimapLayoutKey}
          />
        )}
      </div>

      <div className="relative" style={{ flexShrink: 0 }}>
        <div
          style={{
            paddingLeft: CHAT_BASE_HORIZONTAL_PADDING,
            paddingRight: CHAT_BASE_HORIZONTAL_PADDING,
          }}
        >
          <div style={{ maxWidth: CHAT_COLUMN_MAX_WIDTH, margin: "0 auto" }}>
            <ComposerPanels
              todoPhases={todoPhases}
              subagents={subagents}
              subagentEvents={subagentEvents}
              onSelectSubagent={setSelectedSubagent}
            />
            <ExtensionWidgets widgets={belowEditorWidgets} />
          </div>
        </div>
        {chatInputElement}
      </div>
      </>
      )}
    </div>
  );
}

function ExtensionStatusBar({ statuses }: { statuses: Array<{ key: string; text: string }> }) {
  if (statuses.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
      {statuses.map((status) => (
        <div
          key={status.key}
          className="ui-compact-surface"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            maxWidth: "100%",
            padding: "var(--space-2) var(--space-4)",
            border: "1px solid color-mix(in srgb, var(--accent) 24%, var(--border))",
            borderRadius: "var(--radius-control)",
            background: "color-mix(in srgb, var(--accent) 7%, var(--bg))",
            color: "var(--text-muted)",
            fontSize: "var(--text-md)",
          }}
        >
          <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }}>{status.key}</span>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{status.text}</span>
        </div>
      ))}
    </div>
  );
}

function ExtensionWidgets({ widgets }: { widgets: Array<{ key: string; lines: string[] }> }) {
  if (widgets.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
      {widgets.map((widget) => (
        <div
          key={widget.key}
          className="ui-compact-surface"
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-control)",
            background: "var(--bg-panel)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "5px 9px", borderBottom: "1px solid var(--border)", color: "var(--text-dim)", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
            {widget.key}
          </div>
          <pre style={{ margin: 0, padding: "var(--space-4) 9px", color: "var(--text-muted)", fontSize: "var(--text-md)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-mono)" }}>
            {widget.lines.join("\n")}
          </pre>
        </div>
      ))}
    </div>
  );
}

function NoticeShelf({ notices, floating = false, align = "left" }: { notices: NoticeItem[]; floating?: boolean; align?: "left" | "right" }) {
  if (notices.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "right" ? "flex-end" : "stretch",
        marginBottom: floating ? 0 : 10,
      }}
    >
      {notices.map((notice, index) => {
        const color = notice.type === "error"
          ? "var(--status-error)"
          : notice.type === "warning"
            ? "var(--status-warning)"
            : notice.type === "success"
              ? "var(--status-success)"
              : "var(--accent)";
        return (
          <div
            key={notice.id}
            className="notice-shelf-item"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-4)",
              minHeight: "var(--control-height-lg)",
              height: "var(--control-height-lg)",
              maxHeight: 48,
              marginBottom: index === notices.length - 1 ? 0 : "var(--space-2)",
              overflow: "hidden",
              borderRadius: "var(--radius-control)",
              border: "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              width: "fit-content",
              maxWidth: "min(100%, 620px)",
              boxShadow: floating ? "var(--shadow-pop)" : "var(--shadow-card)",
              fontSize: "var(--text-md)",
              lineHeight: 1.35,
              transformOrigin: "top center",
              animation: notice.exiting
                ? "notice-shelf-out var(--dur-med) ease-in forwards"
                : "notice-shelf-in var(--dur-med) var(--ease-out-warm) both",
              padding: "0 10px",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: color,
                flexShrink: 0,
              }}
            />
            <span style={{ padding: "8px 0", minWidth: 0, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {notice.message}
            </span>
          </div>
        );
      })}
    </div>
  );
}

type ExtensionCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;

function renderAnsiLine(line: string, keyPrefix: string): ReactNode[] {
  return parseAnsiLine(line).map((segment, index) => (
    Object.keys(segment.style).length > 0
      ? <span key={`${keyPrefix}-${index}`} style={segment.style}>{segment.text}</span>
      : segment.text
  ));
}

function ExtensionCustomPanel({
  request,
  onInput,
  runtimeReady = true,
}: {
  request: ExtensionCustomRequest;
  onInput: (request: ExtensionCustomRequest, data: string) => void;
  runtimeReady?: boolean;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const displayLines = normalizeCustomPanelLines(request.lines);

  useEffect(() => {
    if (runtimeReady) {
      inputRef.current?.focus();
    }
  }, [request.id, runtimeReady]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: "var(--z-extension-dialog)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "var(--overlay-backdrop)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(event) => {
          if (!runtimeReady) return;
          if (!(event.target as HTMLElement).closest("button")) inputRef.current?.focus();
        }}
        style={{
          position: "relative",
          width: "min(920px, 100%)",
          maxHeight: "min(760px, calc(100vh - 40px))",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg)",
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden",
          outline: "none",
        }}
      >
        <textarea
          ref={inputRef}
          aria-label={t("chatWindow.extensionTerminalInput")}
          aria-disabled={!runtimeReady}
          disabled={!runtimeReady}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(event) => {
            if (!runtimeReady || composingRef.current || event.nativeEvent.isComposing) return;
            const data = toTerminalKeyData(event);
            if (!data) return;
            event.preventDefault();
            event.stopPropagation();
            onInput(request, data);
          }}
          onInput={(event) => {
            if (!runtimeReady || composingRef.current || event.nativeEvent.isComposing) return;
            const text = event.currentTarget.value;
            event.currentTarget.value = "";
            if (text) onInput(request, text);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            if (!runtimeReady) return;
            const input = event.currentTarget;
            queueMicrotask(() => {
              const text = input.value;
              input.value = "";
              if (text && runtimeReady) onInput(request, text);
            });
          }}
          onPaste={(event) => {
            event.preventDefault();
            if (!runtimeReady) return;
            const text = event.clipboardData.getData("text");
            if (text) onInput(request, asBracketedPaste(text));
          }}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            border: 0,
            opacity: 0,
            pointerEvents: "none",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-5)", padding: "10px var(--space-5)", borderBottom: "1px solid var(--border)" }}>
          <div style={{ color: "var(--text)", fontSize: "var(--text-base)", fontWeight: 650 }}>{t("chatWindow.extensionPanel")}</div>
          <button
            onClick={() => {
              if (!runtimeReady) return;
              onInput(request, "\x03");
            }}
            disabled={!runtimeReady}
            aria-disabled={!runtimeReady}
            style={{
              padding: "5px 9px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text-muted)",
              cursor: !runtimeReady ? "not-allowed" : "pointer",
              opacity: !runtimeReady ? 0.5 : undefined,
              fontSize: "var(--text-md)",
            }}
          >
            {t("chatWindow.close")}
          </button>
        </div>
        <pre
          style={{
            margin: 0,
            padding: 14,
            maxHeight: "calc(min(760px, 100vh - 40px) - 48px)",
            overflow: "auto",
            background: "var(--bg-panel)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-base)",
            lineHeight: 1.45,
            whiteSpace: "pre",
          }}
        >
          {(displayLines.length ? displayLines : [""]).map((line, index, allLines) => (
            <Fragment key={index}>
              {renderAnsiLine(line, `line-${index}`)}
              {index < allLines.length - 1 ? "\n" : null}
            </Fragment>
          ))}
        </pre>
      </div>
    </div>
  );
}
