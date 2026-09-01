import { countToolCallBlocks, getDisplayableAssistantBlocks, splitFinalAssistantBlocks } from "./message-display";
import type { AgentMessage, AssistantMessage, CustomMessage } from "./types";

export type TranscriptRenderItem =
  | { kind: "message"; idx: number }
  | {
      kind: "process-group";
      userIdx: number;
      finalAssistantIdx: number;
      visibleProcessIndices: number[];
    }
  | { kind: "answer"; idx: number };

export function isGroupAnchor(message: AgentMessage): boolean {
  if (message.role === "user") return true;
  return message.role === "custom" && (message as CustomMessage).customType === "compaction";
}

export function hasFinalAssistantAnswer(message: AgentMessage): boolean {
  if (message.role !== "assistant") return false;
  return splitFinalAssistantBlocks(message as AssistantMessage).answerBlocks.some((block) => (
    block.type === "image" || (block.type === "text" && block.text.trim().length > 0)
  ));
}

export function findFinalAssistantIndex(messages: AgentMessage[], userIdx: number, endIdx: number): number {
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (hasFinalAssistantAnswer(messages[candidateIdx])) return candidateIdx;
  }
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (messages[candidateIdx]?.role === "assistant") return candidateIdx;
  }
  return -1;
}

export function hasDisplayableProcessMessage(message: AgentMessage): boolean {
  if (message.role === "assistant") {
    return getDisplayableAssistantBlocks(message as AssistantMessage).length > 0;
  }
  return message.role === "custom";
}

export function processGroupToolCallCount(
  messages: AgentMessage[],
  visibleProcessIndices: number[],
  finalAssistantIdx: number,
): number {
  let count = 0;
  for (const idx of visibleProcessIndices) {
    const msg = messages[idx];
    if (msg?.role !== "assistant") continue;
    count += countToolCallBlocks(getDisplayableAssistantBlocks(msg as AssistantMessage));
  }
  const finalAssistant = messages[finalAssistantIdx] as AssistantMessage;
  count += countToolCallBlocks(splitFinalAssistantBlocks(finalAssistant).processBlocks);
  return count;
}

/**
 * One linear grouping pass over the committed transcript. The result is a
 * compact render-item list (process folds occupy one slot) so the lazy
 * window can slice without a second scan or extra React allocation.
 */
export function buildTranscriptRenderPlan(
  messages: AgentMessage[],
  options: { lastAnchorIdx: number; isStreaming: boolean; sessionBusy: boolean },
): TranscriptRenderItem[] {
  const plan: TranscriptRenderItem[] = [];
  for (let idx = 0; idx < messages.length;) {
    const msg = messages[idx];
    if (!isGroupAnchor(msg)) {
      plan.push({ kind: "message", idx });
      idx += 1;
      continue;
    }

    const userIdx = idx;
    let endIdx = userIdx + 1;
    while (endIdx < messages.length && !isGroupAnchor(messages[endIdx])) endIdx += 1;

    const finalAssistantIdx = findFinalAssistantIndex(messages, userIdx, endIdx);
    const isLiveTail = (options.sessionBusy || options.isStreaming)
      && endIdx === messages.length
      && userIdx === options.lastAnchorIdx;

    if (finalAssistantIdx === -1 || isLiveTail) {
      for (let renderIdx = userIdx; renderIdx < endIdx; renderIdx++) {
        plan.push({ kind: "message", idx: renderIdx });
      }
      idx = endIdx;
      continue;
    }

    plan.push({ kind: "message", idx: userIdx });

    const visibleProcessIndices: number[] = [];
    for (let processIdx = userIdx + 1; processIdx < finalAssistantIdx; processIdx++) {
      if (hasDisplayableProcessMessage(messages[processIdx])) {
        visibleProcessIndices.push(processIdx);
      }
    }
    const finalSplit = splitFinalAssistantBlocks(messages[finalAssistantIdx] as AssistantMessage);
    const includeFinalProcess = finalSplit.processBlocks.length > 0;
    const includeAnswer = finalSplit.answerBlocks.length > 0;
    if (visibleProcessIndices.length + (includeFinalProcess ? 1 : 0) > 0) {
      plan.push({
        kind: "process-group",
        userIdx,
        finalAssistantIdx,
        visibleProcessIndices,
      });
    }
    if (includeAnswer) {
      plan.push({ kind: "answer", idx: finalAssistantIdx });
    }
    for (let renderIdx = finalAssistantIdx + 1; renderIdx < endIdx; renderIdx++) {
      plan.push({ kind: "message", idx: renderIdx });
    }
    idx = endIdx;
  }
  return plan;
}
