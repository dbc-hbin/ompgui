// On-disk subagent history + transcript reading for omp-web.
//
// omp writes each subagent's session transcript to the PARENT session's
// sibling artifacts directory: `<session-dir>/<subagent-id>.jsonl` (plus
// `<id>.md` outputs and `<id>.<tool>.log` artifact spills). The parent's task
// toolResult `details` persist `progress: AgentProgress[]` and
// `results: SingleResult[]` snapshots, so the roster can be recovered after a
// page reload without the live RPC registry (get_subagent_messages is
// registry-gated and rejects unknown session files).

import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { getSessionEntries, entryToUiMessage } from "./session-reader";
import { parseJsonlLenient } from "./omp/session-files";
import { parseSubagentProgress } from "./subagent-types";
import type { SubagentHistoryEntry, SubagentHistoryResult, SubagentAgentSource } from "./subagent-types";
import type { AgentMessage, SessionEntry } from "./types";
import { asNumber, asString, isRecord } from "./type-guards";
import { taskResultStructuredOutput, taskResultUsageCost } from "./task-result-details";

/** Sibling artifacts directory for a parent session file. */
export function siblingDirForSession(sessionFilePath: string): string {
  return join(dirname(sessionFilePath), basename(sessionFilePath, ".jsonl"));
}

/** Subagent transcript path for a roster id within a parent session. */
export function subagentTranscriptPath(sessionFilePath: string, subagentId: string): string {
  return join(siblingDirForSession(sessionFilePath), `${subagentId}.jsonl`);
}

export class SubagentArtifactForbiddenError extends Error {}

/**
 * Resolve a subagent artifact (`.jsonl` transcript or `.md` completion) inside
 * the parent session's sibling artifacts dir, with symlink confinement:
 * the candidate's REAL path must land directly inside the REAL artifacts dir
 * and be a regular file. Returns the real path (readable target) or null.
 */
export function resolveSubagentArtifact(
  sessionFilePath: string,
  subagentId: string,
  extension: ".jsonl" | ".md",
  recordedPath?: string,
  strict = false,
): string | null {
  let realDir: string;
  try {
    realDir = realpathSync(siblingDirForSession(sessionFilePath));
  } catch {
    return null;
  }
  const candidate = recordedPath ? resolve(realDir, recordedPath) : join(realDir, `${subagentId}${extension}`);
  let realCandidateDir: string;
  try {
    realCandidateDir = realpathSync(dirname(candidate));
  } catch {
    return null;
  }
  if (realCandidateDir !== realDir) {
    if (strict) throw new SubagentArtifactForbiddenError("Subagent artifact is outside the parent session artifact directory");
    return null;
  }
  let realCandidate: string;
  try {
    realCandidate = realpathSync(candidate);
  } catch {
    return null;
  }
  if (dirname(realCandidate) !== realDir) {
    if (strict) throw new SubagentArtifactForbiddenError("Subagent artifact is outside the parent session artifact directory");
    return null;
  }
  try {
    if (!statSync(realCandidate).isFile()) return null;
  } catch {
    return null;
  }
  return realCandidate;
}

function asAgentSource(value: unknown): SubagentAgentSource | undefined {
  return value === "bundled" || value === "user" || value === "project" ? value : undefined;
}

function progressStatusToRoster(status: string | undefined): SubagentHistoryEntry["status"] {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "aborted") return "aborted";
  return "started";
}

function resultStatus(value: Record<string, unknown>): SubagentHistoryEntry["status"] {
  if (value.aborted === true) return "aborted";
  if (typeof value.error === "string" && value.error) return "failed";
  if (typeof value.exitCode === "number") return value.exitCode === 0 ? "completed" : "failed";
  if (value.status === "completed") return "completed";
  if (value.status === "failed") return "failed";
  if (value.status === "aborted") return "aborted";
  return "started";
}

// Only parse a harness envelope header, never quoted task/output prose. Async
// notifications must additionally name this id in their structured jobs list;
// wake relays must identify the same sender in their structured metadata.
function taskEnvelopeStatus(text: unknown): { id: string; status: SubagentHistoryEntry["status"] } | undefined {
  if (typeof text !== "string") return undefined;
  const header = /^<task-result id="([A-Za-z0-9_-]+)" agent="[^"\r\n]+" status="(completed|aborted|cancelled|failed(?: \(exit -?\d+\))?)" duration="[^"\r\n]+">\r?\n/.exec(text.slice(0, 1024));
  if (!header) return undefined;
  return { id: header[1], status: header[2] === "completed" ? "completed" : header[2] === "aborted" || header[2] === "cancelled" ? "aborted" : "failed" };
}

/**
 * Recover the subagent roster from a parent session file. Walks task
 * toolResults, merging `progress` (live-snapshot fields) with `results`
 * (settled per-subagent telemetry), then resolves sibling transcript files.
 */
export function extractSubagentHistory(sessionFilePath: string): SubagentHistoryEntry[] {
  let entries: readonly SessionEntry[];
  try {
    entries = getSessionEntries(sessionFilePath);
  } catch {
    return [];
  }

  const byId = new Map<string, SubagentHistoryEntry>();
  const taskCalls = new Map<string, string>();
  const upsert = (entry: SubagentHistoryEntry) => {
    const existing = byId.get(entry.id);
    if (!existing) {
      byId.set(entry.id, entry);
      return;
    }
    byId.set(entry.id, { ...existing, ...entry, result: entry.result ?? (entry.status === "started" && existing.status !== "started" ? undefined : existing.result) });
  };

  const applyStatus = (id: string, status: SubagentHistoryEntry["status"], durationMs?: number) => {
    const prior = byId.get(id);
    // Notifications cannot invent agents absent from a task spawn record.
    // Conflicting terminal evidence belongs to an earlier outcome and must
    // not override this delivery in consumers. Matching telemetry/artifact
    // paths remain useful; an explicit new task invocation clears them above.
    if (prior) byId.set(id, { ...prior, status, result: prior.status === status ? prior.result : undefined, durationMs: durationMs ?? prior.durationMs });
  };

  for (const entry of entries) {
    if (entry.type === "custom_message") {
      const details = isRecord(entry.details) ? entry.details : undefined;
      if (entry.customType === "async-result" && details && Array.isArray(details.jobs) && typeof entry.content === "string") {
        // The fixed notice introduction is outside the agent-controlled output.
        const notice = /^<system-notice>\r?\nBackground job ([A-Za-z0-9_-]+) has (?:completed|failed|been cancelled|been canceled). Resume your work using the result below.\r?\n/.exec(entry.content.slice(0, 512));
        if (notice) {
          const envelope = taskEnvelopeStatus(entry.content.slice(notice[0].length, notice[0].length + 1024));
          const job = details.jobs.find((value: unknown) => isRecord(value) && value.type === "task" && value.jobId === notice[1]);
          if (envelope && envelope.id === notice[1] && isRecord(job)) applyStatus(envelope.id, envelope.status, asNumber(job.durationMs));
        } else if (/^<system-notice>\r?\n\d+ background jobs have completed\. Resume your work using the results below\.\r?\n/.test(entry.content.slice(0, 512))) {
          const content = entry.content.slice(0, MAX_SUBAGENT_COMPLETION_BYTES);
          for (const job of details.jobs) {
            if (!isRecord(job) || job.type !== "task" || typeof job.jobId !== "string" || typeof job.label !== "string" || /[\r\n]/.test(job.label)) continue;
            const marker = `\n── Job ${job.jobId} (${job.label}) ──\n`;
            const offset = content.indexOf(marker);
            if (offset < 0 || content.indexOf(marker, offset + marker.length) >= 0) continue;
            const envelope = taskEnvelopeStatus(content.slice(offset + marker.length, offset + marker.length + 1024));
            if (envelope?.id === job.jobId) applyStatus(envelope.id, envelope.status, asNumber(job.durationMs));
          }
        }
      } else if (entry.customType === "irc:incoming" && details?.wakeRelay === true) {
        const envelope = taskEnvelopeStatus(details.message);
        if (envelope && details.from === envelope.id) applyStatus(envelope.id, envelope.status);
      }
      continue;
    }
    if (entry.type !== "message" || entry.message?.role !== "toolResult") continue;
    const message = entry.message as { toolName?: unknown; details?: unknown };
    const details = isRecord(message.details) ? message.details : {};
    if (message.toolName === "hub" && Array.isArray(details.jobs)) {
      for (const job of details.jobs) {
        if (!isRecord(job) || job.type !== "task" || typeof job.id !== "string") continue;
        if (job.status === "completed" || job.status === "failed" || job.status === "aborted") applyStatus(job.id, job.status, asNumber(job.durationMs));
        else if (job.status === "cancelled") applyStatus(job.id, "aborted", asNumber(job.durationMs));
        // Running registry snapshots can describe the initial run after its
        // final delivery. Only a later task spawn can start a new run here.
      }
      continue;
    }
    if (message.toolName !== "task") continue;
    const callId = asString(entry.message.toolCallId);
    const statusForTask = (id: string, status: SubagentHistoryEntry["status"]) => {
      const previousCall = taskCalls.get(id);
      if (callId) taskCalls.set(id, callId);
      const prior = byId.get(id);
      // Replayed startup snapshots from the same invocation cannot erase its
      // delivered result. A distinct task invocation explicitly renews the id.
      return status === "started" && prior && prior.status !== "started" && callId !== undefined && previousCall === callId ? prior.status : status;
    };
    const progressArr = Array.isArray(details.progress) ? details.progress : [];
    const resultsArr = Array.isArray(details.results) ? details.results : [];
    const asyncInfo = isRecord(details.async) ? details.async : undefined;

    for (const raw of progressArr) {
      const progress = parseSubagentProgress(raw);
      if (!progress?.id) continue;
      upsert({
        id: progress.id,
        agent: progress.agent ?? "subagent",
        agentSource: progress.agentSource,
        status: statusForTask(progress.id, progressStatusToRoster(progress.status)),
        task: progress.task,
        assignment: progress.assignment,
        description: progress.description,
        index: progress.index ?? 0,
        lastIntent: progress.lastIntent,
        toolCount: progress.toolCount,
        requests: progress.requests,
        tokens: progress.tokens,
        contextTokens: progress.contextTokens,
        contextWindow: progress.contextWindow,
        cost: progress.cost,
        durationMs: progress.durationMs,
        modelOverride: progress.modelOverride,
        modelRole: progress.modelRole,
        resolvedModel: progress.resolvedModel,
        resolvedModelIsFallback: progress.resolvedModelIsFallback,
        retryFailure: progress.retryFailure,
        transcriptAvailable: false,
      });
    }

    for (const raw of resultsArr) {
      if (!isRecord(raw)) continue;
      const id = asString(raw.id);
      if (!id) continue;
      const prior = byId.get(id);
      const result: SubagentHistoryResult = {};
      const exitCode = asNumber(raw.exitCode);
      if (exitCode !== undefined) result.exitCode = exitCode;
      // NOTE: `output`/`stderr` are deliberately NOT copied — the roster route
      // must stay telemetry-only (task outputs can be ~500KB per agent).
      if (raw.truncated === true) result.truncated = true;
      const cost = asNumber(raw.cost) ?? taskResultUsageCost(raw.usage);
      if (cost !== undefined) result.cost = cost;
      const structured = taskResultStructuredOutput(raw.structuredOutput);
      if (structured !== undefined) result.structuredOutput = structured;
      const error = asString(raw.error);
      if (error !== undefined) result.error = error;
      if (raw.aborted === true) result.aborted = true;
      const abortReason = asString(raw.abortReason);
      if (abortReason !== undefined) result.abortReason = abortReason;
      const outputPath = asString(raw.outputPath);
      if (outputPath !== undefined) result.outputPath = outputPath;
      const patchPath = asString(raw.patchPath);
      if (patchPath !== undefined) result.patchPath = patchPath;
      const branchName = asString(raw.branchName);
      if (branchName !== undefined) result.branchName = branchName;
      const retryFailure = isRecord(raw.retryFailure)
        ? {
            attempt: asNumber(raw.retryFailure.attempt) ?? 0,
            errorMessage: asString(raw.retryFailure.errorMessage) ?? "",
          }
        : prior?.retryFailure;
      upsert({
        id,
        agent: asString(raw.agent) ?? prior?.agent ?? "subagent",
        agentSource: asAgentSource(raw.agentSource) ?? prior?.agentSource,
        status: statusForTask(id, resultStatus(raw)),
        task: asString(raw.task) ?? prior?.task,
        assignment: asString(raw.assignment) ?? prior?.assignment,
        description: asString(raw.description) ?? prior?.description,
        index: asNumber(raw.index) ?? prior?.index ?? 0,
        lastIntent: asString(raw.lastIntent) ?? prior?.lastIntent,
        toolCount: asNumber(raw.toolCount) ?? prior?.toolCount,
        requests: asNumber(raw.requests) ?? prior?.requests,
        tokens: asNumber(raw.tokens) ?? prior?.tokens,
        contextTokens: asNumber(raw.contextTokens) ?? prior?.contextTokens,
        contextWindow: asNumber(raw.contextWindow) ?? prior?.contextWindow,
        cost: asNumber(raw.cost) ?? taskResultUsageCost(raw.usage) ?? prior?.cost,
        durationMs: asNumber(raw.durationMs) ?? prior?.durationMs,
        modelOverride: typeof raw.modelOverride === "string" || Array.isArray(raw.modelOverride) ? raw.modelOverride : prior?.modelOverride,
        modelRole: asString(raw.modelRole) ?? prior?.modelRole,
        resolvedModel: asString(raw.resolvedModel) ?? prior?.resolvedModel,
        resolvedModelIsFallback: typeof raw.resolvedModelIsFallback === "boolean" ? raw.resolvedModelIsFallback : prior?.resolvedModelIsFallback,
        retryFailure,
        transcriptAvailable: false,
        result: Object.keys(result).length > 0 ? result : undefined,
      });
    }

    // Detached async spawns can persist with an empty results[] while still
    // running — async.jobId still names the agent.
    if (asyncInfo) {
      const jobId = asString(asyncInfo.jobId);
      if (jobId && !byId.has(jobId)) {
        upsert({
          id: jobId,
          agent: "task",
          status: asyncInfo.state === "completed" ? "completed" : asyncInfo.state === "failed" ? "failed" : "started",
          index: byId.size,
          transcriptAvailable: false,
        });
      }
    }
  }

  // Resolve sibling transcript files and async/detached markers.
  const detachedIds = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message?.role !== "toolResult") continue;
    const message = entry.message as { toolName?: unknown; details?: unknown };
    if (message.toolName !== "task") continue;
    const details = isRecord(message.details) ? message.details : {};
    const asyncInfo = isRecord(details.async) ? details.async : undefined;
    const jobId = asyncInfo ? asString(asyncInfo.jobId) : undefined;
    if (jobId) detachedIds.add(jobId);
  }
  const roster = [...byId.values()];
  for (const entry of roster) {
    if (detachedIds.has(entry.id)) entry.detached = true;
    const candidate = resolveSubagentArtifact(sessionFilePath, entry.id, ".jsonl");
    if (candidate) {
      entry.sessionFile = subagentTranscriptPath(sessionFilePath, entry.id);
      entry.transcriptAvailable = true;
    }
  }
  return roster.sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
}

/** Cap on transcript bytes materialized for the dialog (files are small). */
export const MAX_SUBAGENT_TRANSCRIPT_BYTES = 16 * 1024 * 1024;

/** Bytes read per page call — the total cap above bounds the file, this
 * bounds the per-response window so large transcripts are delivered
 * incrementally instead of serialized whole. */
export const SUBAGENT_TRANSCRIPT_PAGE_BYTES = 256 * 1024;

export interface SubagentTranscriptPage {
  sessionFile: string;
  fromByte: number;
  nextByte: number;
  reset: boolean;
  messages: AgentMessage[];
  error?: string;
  /** Full file size — lets the dialog hide Load more once fully read. */
  totalBytes?: number;
}

/**
 * Byte-window transcript paging mirroring omp's readRpcSubagentTranscript:
 * parse complete lines from `fromByte`, return UI messages + nextByte.
 */
export function readSubagentTranscriptPage(sessionFilePath: string, fromByte = 0): SubagentTranscriptPage {
  const empty: SubagentTranscriptPage = {
    sessionFile: sessionFilePath,
    fromByte: typeof fromByte === "number" && Number.isFinite(fromByte) ? Math.max(0, Math.trunc(fromByte)) : 0,
    nextByte: typeof fromByte === "number" && Number.isFinite(fromByte) ? Math.max(0, Math.trunc(fromByte)) : 0,
    reset: false,
    messages: [],
  };
  let startByte = empty.fromByte;
  let reset = false;
  let fd: number | undefined;
  try {
    fd = openSync(sessionFilePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { ...empty, error: "Subagent transcript is not a regular file" };
    const size = stat.size;
    if (startByte > size) {
      startByte = 0;
      reset = true;
    }
    if (size > MAX_SUBAGENT_TRANSCRIPT_BYTES) {
      return { ...empty, fromByte: startByte, nextByte: startByte, reset, error: "Subagent transcript exceeds the readable size limit" };
    }
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    let completeBytes = 0;
    while (startByte + bytesRead < size) {
      const buffer = Buffer.allocUnsafe(Math.min(SUBAGENT_TRANSCRIPT_PAGE_BYTES, size - startByte - bytesRead));
      const count = readSync(fd, buffer, 0, buffer.length, startByte + bytesRead);
      if (count === 0) break;
      const chunk = buffer.subarray(0, count);
      // A normal page stops at its last complete record. If its first record
      // exceeds the window, extend only until that record's newline appears.
      const newline = bytesRead === 0 ? chunk.lastIndexOf(10) : chunk.indexOf(10);
      if (newline >= 0) {
        chunks.push(chunk.subarray(0, newline + 1));
        completeBytes = bytesRead + newline + 1;
        break;
      }
      chunks.push(chunk);
      bytesRead += count;
    }
    const messages: AgentMessage[] = [];
    if (completeBytes > 0) {
      const body = (chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, completeBytes)).toString("utf8");
      for (const entry of parseJsonlLenient<SessionEntry>(body)) {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
        const message = entryToUiMessage(entry, {});
        if (message !== null) messages.push(message);
      }
    }
    // An unterminated tail stays pending: append can complete it on a later call.
    return { sessionFile: sessionFilePath, fromByte: startByte, nextByte: startByte + completeBytes, reset, messages, totalBytes: size };
  } catch {
    return { ...empty, fromByte: startByte, nextByte: startByte, reset, error: "Subagent transcript could not be read" };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Cap on completion bytes materialized for the dialog (final outputs are small). */
export const MAX_SUBAGENT_COMPLETION_BYTES = 1024 * 1024;

/**
 * Read a subagent's final output — the `<id>.md` sibling artifact omp writes
 * when the task settles. Returns null when no output file exists yet (still
 * running, aborted before producing output, or the session predates it).
 * Output files can exceed the transcript cap, so the read is bounded.
 */
/**
 * Read a subagent's final output artifact (`<id>.md`) from an ALREADY-RESOLVED
 * path (the route confines via resolveSubagentArtifact first — reading the raw
 * derived path here would reopen a symlink swapped after the check). Reads at
 * most MAX_SUBAGENT_COMPLETION_BYTES bytes, trimming a trailing incomplete
 * UTF-8 sequence before decoding.
 */
export function readCompletionArtifact(
  outputFile: string,
): { completion: string; truncated: boolean } | null {
  let fd: number;
  try {
    fd = openSync(outputFile, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size <= 0) return null;
    const truncated = stat.size > MAX_SUBAGENT_COMPLETION_BYTES;
    const readBytes = Math.min(stat.size, MAX_SUBAGENT_COMPLETION_BYTES);
    const buffer = Buffer.alloc(readBytes);
    const bytesRead = readSync(fd, buffer, 0, readBytes, 0);
    const slice = buffer.subarray(0, bytesRead);
    // Trim a trailing INCOMPLETE UTF-8 sequence before decoding. A complete
    // multibyte char may also end in continuation bytes, so walk back over the
    // trailing continuations to the lead and keep the char only when its full
    // width fits inside the buffer.
    let end = slice.length;
    let trailing = 0;
    while (end - trailing > 0 && (slice[end - 1 - trailing] & 0xc0) === 0x80) trailing += 1;
    const leadPos = end - 1 - trailing;
    if (leadPos >= 0) {
      const lead = slice[leadPos];
      const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
      if (leadPos + need > slice.length) end = leadPos;
    } else {
      // Continuation bytes with no lead at the tail — garbage.
      end = 0;
    }
    return { completion: slice.subarray(0, end).toString("utf8"), truncated };
  } finally {
    closeSync(fd);
  }
}
