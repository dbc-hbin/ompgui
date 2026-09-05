import { createSseMessageUpdateCoalescer } from "../sse-message-update-coalescer";
import { authenticateRelayHello, type RelayAuthSuccess, type RelayAuthFailure } from "./auth";
import { encodeRelayFrames, RelayChunkAssembler } from "./chunks";
import { handleFilesRequest, cleanupRelayFileTransfers } from "./files-requests";
import { handleSessionsRequest } from "./sessions-requests";
import { handleModelsRequest, getModelsCatalog, cancelModelLoginsForDevice } from "./models-requests";
import { handleExtensionsRequest } from "./extensions-requests";
import { handleSystemRequest } from "./system-requests";
import { listRelayDevices } from "./registry";
import type { RelayRequestHandler } from "./request-types";
import type { RelayRequestDomain } from "./protocol";

import {
  commandFromRelayCmd,
  isRelayParseError,
  parseClientFrame,
  relayModelsFrame,
  RELAY_HELLO_TIMEOUT_MS,
  RELAY_PROTOCOL_VERSION,
  type RelayClientFrame,
  type RelayHelloFrame,
  type RelayModelOption,
  type RelayServerFrame,
  type RelaySessionListItem,
} from "./protocol";
import { clearSessionExportTransfers, exportRelaySession, listRelayBranches, listRelaySessions, openRelaySession, sendRelayCommand, snapshotRelayLeaf } from "./session-runtime";
import {
  addRelayProject,
  addRelayWorktree,
  createRelaySession,
  gitRelayDiff,
  gitRelayStatus,
  listRelayFiles,
  listRelayProjects,
  listRelaySlashCommands,
  listRelayWorktrees,
  readRelayFile,
  removeRelayProject,
  searchRelayFileIndex,
  writeRelayFile,
} from "./workspace";
import {
  archiveRelaySession,
  deleteRelaySession,
  importRelaySession,
  listRelayArchives,
  renameRelaySession,
  restoreRelayArchive,
} from "./session-actions";
import {
  deleteRelayAgent,
  deleteRelayMcp,
  installRelaySkill,
  listRelayAgents,
  listRelayAuthProviders,
  listRelayMcp,
  listRelayPlugins,
  listRelaySkills,
  runRelayPluginAction,
  saveRelayAgent,
  searchRelaySkills,
  toggleRelaySkill,
  upsertRelayMcp,
} from "./extensions";
import { fetchUsagePayload, type UsageFetchResult } from "../usage";
import { invalidateModelsCache } from "../models-cache";
import { disposeUtilityRpc } from "../omp/rpc-utility";
import { mergeNativeSettings, readNativeSettings, writeNativeSettings, type NativeSettings } from "../omp/settings-config";

const deviceConnections = new Map<string, Set<() => void>>();
export function revokeRelayDeviceConnections(deviceId: string): void {
  for (const close of deviceConnections.get(deviceId) ?? []) close();
}

export interface RelaySocket {
  sendText(text: string): boolean;
  close(code?: number, reason?: string): void;
  get bufferedAmount(): number;
}

export interface RelayConnectionDeps {
  authenticate(hello: RelayHelloFrame, now: number): RelayAuthSuccess | RelayAuthFailure;
  listSessions(): Promise<{ sessions: RelaySessionListItem[]; runningIds: string[] }>;
  listModels(): Promise<RelayModelOption[]>;
  fetchUsage(): Promise<UsageFetchResult>;
  openSession: typeof openRelaySession;
  sendCommand: typeof sendRelayCommand;
  createSession?: typeof createRelaySession;
  listProjects?: typeof listRelayProjects;
  listFiles?: typeof listRelayFiles;
  readFile?: typeof readRelayFile;
  listSlash?: typeof listRelaySlashCommands;
  deleteSession?: typeof deleteRelaySession;
  archiveSession?: typeof archiveRelaySession;
  renameSession?: typeof renameRelaySession;
  listArchives?: typeof listRelayArchives;
  restoreArchive?: typeof restoreRelayArchive;
  listWorktrees?: typeof listRelayWorktrees;
  addWorktree?: typeof addRelayWorktree;
  writeFile?: typeof writeRelayFile;
  gitStatus?: typeof gitRelayStatus;
  gitDiff?: typeof gitRelayDiff;
  listBranches?: typeof listRelayBranches;
  snapshotLeaf?: typeof snapshotRelayLeaf;
  exportSession?: typeof exportRelaySession;
  listSkills?: typeof listRelaySkills;
  toggleSkill?: typeof toggleRelaySkill;
  searchSkills?: typeof searchRelaySkills;
  installSkill?: typeof installRelaySkill;
  listAgents?: typeof listRelayAgents;
  saveAgent?: typeof saveRelayAgent;
  deleteAgent?: typeof deleteRelayAgent;
  listAuthProviders?: typeof listRelayAuthProviders;
  listPlugins?: typeof listRelayPlugins;
  pluginAction?: typeof runRelayPluginAction;
  listMcp?: typeof listRelayMcp;
  deleteMcp?: typeof deleteRelayMcp;
  upsertMcp?: typeof upsertRelayMcp;
  importSession?: typeof importRelaySession;
  addProject?: typeof addRelayProject;
  removeProject?: typeof removeRelayProject;
  searchFiles?: typeof searchRelayFileIndex;
  requestHandlers?: Partial<Record<RelayRequestDomain, RelayRequestHandler>>;
  isDeviceAuthorized?: (deviceId: string) => boolean;
  now?: () => number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

const defaultDeps: RelayConnectionDeps = {
  authenticate: authenticateRelayHello,
  listSessions: listRelaySessions,
  listModels: async () => relayModelsFrame((await getModelsCatalog()).models).models,
  fetchUsage: fetchUsagePayload,
  openSession: openRelaySession,
  sendCommand: sendRelayCommand,
  createSession: createRelaySession,
  listProjects: listRelayProjects,
  listFiles: listRelayFiles,
  readFile: readRelayFile,
  listSlash: listRelaySlashCommands,
  deleteSession: deleteRelaySession,
  archiveSession: archiveRelaySession,
  renameSession: renameRelaySession,
  listArchives: listRelayArchives,
  restoreArchive: restoreRelayArchive,
  listWorktrees: listRelayWorktrees,
  addWorktree: addRelayWorktree,
  writeFile: writeRelayFile,
  gitStatus: gitRelayStatus,
  gitDiff: gitRelayDiff,
  listBranches: listRelayBranches,
  snapshotLeaf: snapshotRelayLeaf,
  exportSession: exportRelaySession,
  listSkills: listRelaySkills,
  toggleSkill: toggleRelaySkill,
  searchSkills: searchRelaySkills,
  installSkill: installRelaySkill,
  listAgents: listRelayAgents,
  saveAgent: saveRelayAgent,
  deleteAgent: deleteRelayAgent,
  listAuthProviders: listRelayAuthProviders,
  listPlugins: listRelayPlugins,
  pluginAction: runRelayPluginAction,
  listMcp: listRelayMcp,
  deleteMcp: deleteRelayMcp,
  upsertMcp: upsertRelayMcp,
  importSession: importRelaySession,
  addProject: addRelayProject,
  removeProject: removeRelayProject,
  searchFiles: searchRelayFileIndex,
};

export function attachRelayConnection(socket: RelaySocket, deps: Partial<RelayConnectionDeps> = {}): {
  onText(raw: string): void;
  onClose(): void;
} {
  const resolved: RelayConnectionDeps = { ...defaultDeps, ...deps };
  const now = resolved.now ?? Date.now;
  const schedule = resolved.setTimeout ?? setTimeout;
  const cancel = resolved.clearTimeout ?? clearTimeout;

  const handlers: Record<RelayRequestDomain, RelayRequestHandler> = {
    files: handleFilesRequest, sessions: handleSessionsRequest, models: handleModelsRequest,
    extensions: handleExtensionsRequest, system: handleSystemRequest, ...resolved.requestHandlers,
  };
  const chunks = new RelayChunkAssembler(now);
  const authorized = resolved.isDeviceAuthorized ?? (deps.authenticate ? () => true : (id: string) => listRelayDevices().some(device => device.id === id));
  let deviceId: string | null = null;
  let epoch = 0;
  let selectedLeaf = false;
  let queued = 0;
  let urgentQueued = 0;
  let urgentHandling = Promise.resolve();
  let revocationTimer: NodeJS.Timeout | undefined;
  let authed = false;
  let closed = false;
  let openedSessionId: string | null = null;
  let disposeSession: (() => void) | null = null;
  let handling = Promise.resolve();

  const send = (frame: RelayServerFrame, allowRevoked = false): boolean => {
    if (closed) return false;
    if (!allowRevoked && deviceId && !authorized(deviceId)) { revoke(); return false; }
    try {
      if (frame.op === "error" || frame.op === "session.err" || frame.op === "cmd_err") {
        frame = { ...frame, code: /^[A-Za-z0-9_-]{1,64}$/.test(frame.code) ? frame.code : "operation_failed", message: "Relay operation failed" };
      } else if (frame.op === "settings_updated" && !frame.success) {
        frame = { op: "settings_updated", success: false, error: "Settings update failed" };
      }
      for (const text of encodeRelayFrames(frame)) {
        if (!socket.sendText(text)) { dispose(); socket.close(1013, "Relay backpressure"); return false; }
      }
      return true;
    } catch {
      socket.sendText(JSON.stringify({ op: "error", code: "frame_too_large", message: "Relay frame exceeds transport limits" }));
      dispose(); socket.close(1009, "Relay frame too large"); return false;
    }
  };

  const failHello = (code: string, message: string) => {
    cancel(helloTimer);
    send({ op: "hello_err", code, message });
    dispose();
    socket.close(1008, message);
  };

  const helloTimer = schedule(() => {
    if (!authed && !closed) failHello("hello_timeout", "hello was not received in time");
  }, RELAY_HELLO_TIMEOUT_MS);

  const coalescer = createSseMessageUpdateCoalescer({
    emit: (event) => {
      if (!openedSessionId || selectedLeaf || typeof event !== "object" || event === null || Array.isArray(event)) return true;
      return send({ op: "event", id: openedSessionId, payload: event as Record<string, unknown> });
    },
    isBackpressured: () => socket.bufferedAmount > 256_000,
  });

  const dispose = () => {
    if (closed) return;
    closed = true;
    cancel(helloTimer);
    cancel(revocationTimer);
    chunks.clear();
    epoch++;
    if (deviceId) {
      const connections = deviceConnections.get(deviceId);
      connections?.delete(revoke);
      if (connections?.size === 0) deviceConnections.delete(deviceId);
      cleanupRelayFileTransfers(deviceId);
      clearSessionExportTransfers(deviceId);
      void cancelModelLoginsForDevice(deviceId).catch(() => {});
    }
    coalescer.reset();
    disposeSession?.();
    disposeSession = null;
    openedSessionId = null;
  };

  const revoke = () => { dispose(); socket.close(1008, "Device revoked"); };
  const checkDevice = () => {
    if (closed || !deviceId) return;
    if (!authorized(deviceId)) { revoke(); return; }
    revocationTimer = schedule(checkDevice, 1000);
  };

  const handle = async (frame: RelayClientFrame): Promise<void> => {
    if (closed) return;
    if (!authed) {
      if (frame.op !== "hello") {
        failHello("unauthorized", "hello is required");
        return;
      }
      const result = resolved.authenticate(frame, now());
      if (!result.ok) {
        failHello(result.code, result.message);
        return;
      }
      deviceId = result.deviceId;
      let connections = deviceConnections.get(deviceId);
      if (!connections) { connections = new Set(); deviceConnections.set(deviceId, connections); }
      connections.add(revoke);
      authed = true;
      revocationTimer = schedule(checkDevice, 1000);
      cancel(helloTimer);
      send({
        op: "hello_ok",
        protocol: RELAY_PROTOCOL_VERSION,
        serverId: result.serverId,
        deviceId: result.deviceId,
        ...(result.token ? { token: result.token } : {}),
      });
      return;
    }

    if (!deviceId || !authorized(deviceId)) { revoke(); return; }
    switch (frame.op) {
      case "request": {
        try {
          const sessionAction = frame.domain === "sessions";
          const command = frame.args.command;
          const commandType = typeof command === "object" && command !== null && "type" in command ? command.type : null;
          const navigation = sessionAction && (frame.action === "leaf" || (frame.action === "command" && commandType === "fork")
            || ((frame.action === "delete" || frame.action === "archive") && frame.args.id === openedSessionId));
          if (navigation) {
            epoch++;
            selectedLeaf = frame.action === "leaf";
            disposeSession?.(); disposeSession = null; coalescer.reset();
            if (frame.action === "delete" || frame.action === "archive") openedSessionId = null;
            else if (typeof frame.args.id === "string") openedSessionId = frame.args.id;
          }
          const data = await handlers[frame.domain](frame.action, frame.args, { deviceId, sessionId: openedSessionId });
          const revoked = frame.domain === "system" && frame.action === "devices.revoke" && typeof data.deviceId === "string" ? data.deviceId : null;
          send({ op: "result", req: frame.req, success: true, data }, revoked === deviceId);
          if (revoked) revokeRelayDeviceConnections(revoked);
          if (sessionAction && frame.action === "command" && typeof data.result === "object" && data.result !== null
            && "newSessionId" in data.result && typeof data.result.newSessionId === "string") {
            await handle({ op: "session.open", id: data.result.newSessionId });
          }
        } catch (error) {
          const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(error.code) ? error.code : "request_failed";
          send({ op: "result", req: frame.req, success: false, error: { code, message: "Relay request failed (" + code + ")" } });
        }
        return;
      }
      case "hello":
        send({ op: "error", code: "already_authed", message: "Already authenticated" });
        return;
      case "sessions.list": {
        const listed = await resolved.listSessions();
        send({ op: "sessions", sessions: listed.sessions, runningIds: listed.runningIds });
        return;
      }
      case "models.list": {
        const models = await resolved.listModels();
        send(relayModelsFrame(models));
        return;
      }
      case "usage": {
        const result = await resolved.fetchUsage();
        if (result.ok) {
          send({ op: "usage", data: result.payload });
          return;
        }
        send({ op: "usage", data: { error: result.error, status: result.status } });
        return;
      }
      case "session.close":
        epoch++;
        selectedLeaf = false;
        disposeSession?.();
        disposeSession = null;
        openedSessionId = null;
        coalescer.reset();
        return;
      case "projects.list": {
        try {
          const projects = await (resolved.listProjects ?? listRelayProjects)();
          send({ op: "projects", projects });
        } catch (error) {
          send({ op: "error", code: "projects_failed", message: error instanceof Error ? error.message : String(error) });
        }
        return;
      }
      case "files.list": {
        try {
          const listed = await (resolved.listFiles ?? listRelayFiles)(frame.path);
          send({ op: "files", path: listed.path, entries: listed.entries });
        } catch (error) {
          const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
            ? error.code
            : "files_failed";
          send({ op: "error", code, message: error instanceof Error ? error.message : String(error) });
        }
        return;
      }
      case "slash.list": {
        send({ op: "slash", commands: (resolved.listSlash ?? listRelaySlashCommands)() });
        return;
      }
      case "files.read": {
        try {
          const file = await (resolved.readFile ?? readRelayFile)(frame.path);
          send({
            op: "file",
            path: file.path,
            name: file.name,
            ...(file.language ? { language: file.language } : {}),
            ...(file.text !== undefined ? { text: file.text } : {}),
            ...(file.truncated ? { truncated: true } : {}),
            ...(file.bytes !== undefined ? { bytes: file.bytes } : {}),
            ...(file.encoding ? { encoding: file.encoding } : {}),
          });
        } catch (error) {
          sendRelayError(send, error, "files_failed");
        }
        return;
      }
      case "session.delete": {
        try {
          if (openedSessionId === frame.id) {
            disposeSession?.();
            disposeSession = null;
            openedSessionId = null;
            coalescer.reset();
          }
          const deleted = await (resolved.deleteSession ?? deleteRelaySession)(frame.id);
          send({ op: "session.deleted", id: deleted.id });
          const listed = await resolved.listSessions();
          send({ op: "sessions", sessions: listed.sessions, runningIds: listed.runningIds });
        } catch (error) {
          sendRelayError(send, error, "session_delete_failed", frame.id);
        }
        return;
      }
      case "session.archive": {
        try {
          if (openedSessionId === frame.id) {
            disposeSession?.();
            disposeSession = null;
            openedSessionId = null;
            coalescer.reset();
          }
          const archived = await (resolved.archiveSession ?? archiveRelaySession)(frame.id);
          send({ op: "session.archived", id: archived.id });
          const listed = await resolved.listSessions();
          send({ op: "sessions", sessions: listed.sessions, runningIds: listed.runningIds });
        } catch (error) {
          sendRelayError(send, error, "session_archive_failed", frame.id);
        }
        return;
      }
      case "session.rename": {
        try {
          const renamed = await (resolved.renameSession ?? renameRelaySession)(frame.id, frame.name);
          send({ op: "session.renamed", id: renamed.id, name: renamed.name });
          const listed = await resolved.listSessions();
          send({ op: "sessions", sessions: listed.sessions, runningIds: listed.runningIds });
        } catch (error) {
          sendRelayError(send, error, "session_rename_failed", frame.id);
        }
        return;
      }
      case "sessions.archives": {
        try {
          const archives = await (resolved.listArchives ?? listRelayArchives)();
          send({ op: "archives", archives });
        } catch (error) {
          sendRelayError(send, error, "archives_failed");
        }
        return;
      }
      case "session.restore": {
        try {
          const restored = await (resolved.restoreArchive ?? restoreRelayArchive)(frame.key);
          send({ op: "session.restored", id: restored.id });
          const listed = await resolved.listSessions();
          send({ op: "sessions", sessions: listed.sessions, runningIds: listed.runningIds });
        } catch (error) {
          sendRelayError(send, error, "session_restore_failed");
        }
        return;
      }
      case "worktrees.list": {
        try {
          const listed = await (resolved.listWorktrees ?? listRelayWorktrees)(frame.cwd);
          send({
            op: "worktrees",
            cwd: listed.cwd,
            projectRoot: listed.projectRoot,
            isGit: listed.isGit,
            currentWorktreePath: listed.currentWorktreePath,
            worktrees: listed.worktrees,
          });
        } catch (error) {
          sendRelayError(send, error, "worktrees_failed");
        }
        return;
      }
      case "worktrees.add": {
        try {
          const added = await (resolved.addWorktree ?? addRelayWorktree)(frame.cwd, frame.branch);
          send({ op: "worktree.added", path: added.path, branch: added.branch });
          const listed = await (resolved.listWorktrees ?? listRelayWorktrees)(frame.cwd);
          send({
            op: "worktrees",
            cwd: listed.cwd,
            projectRoot: listed.projectRoot,
            isGit: listed.isGit,
            currentWorktreePath: listed.currentWorktreePath,
            worktrees: listed.worktrees,
          });
        } catch (error) {
          sendRelayError(send, error, "worktree_add_failed");
        }
        return;
      }
      case "files.write": {
        try {
          const written = await (resolved.writeFile ?? writeRelayFile)(frame.path, frame.text, frame.revision, frame.baseContentHash, frame.createIfMissing);
          send({ op: "file.written", path: written.path, bytes: written.bytes });
        } catch (error) {
          sendRelayError(send, error, "files_failed");
        }
        return;
      }
      case "git.status": {
        try {
          const status = await (resolved.gitStatus ?? gitRelayStatus)(frame.cwd);
          send({
            op: "git.status",
            cwd: status.cwd,
            isGitRepository: status.isGitRepository,
            repositoryRoot: status.repositoryRoot,
            files: status.files,
          });
        } catch (error) {
          sendRelayError(send, error, "git_failed");
        }
        return;
      }
      case "git.diff": {
        try {
          const diff = await (resolved.gitDiff ?? gitRelayDiff)(frame.cwd, frame.path);
          send({
            op: "git.diff",
            path: diff.path,
            supported: diff.supported,
            ...(diff.status ? { status: diff.status } : {}),
            ...(diff.patch ? { patch: diff.patch } : {}),
            ...(diff.truncated ? { truncated: true } : {}),
          });
        } catch (error) {
          sendRelayError(send, error, "git_failed");
        }
        return;
      }
      case "session.branches": {
        try {
          const listed = await (resolved.listBranches ?? listRelayBranches)(frame.id);
          send({ op: "branches", id: listed.id, leafId: listed.leafId, branches: listed.branches });
        } catch (error) {
          sendRelayError(send, error, "branches_failed", frame.id);
        }
        return;
      }
      case "session.leaf": {
        try {
          const navigationEpoch = ++epoch;
          selectedLeaf = true;
          coalescer.reset();
          disposeSession?.();
          disposeSession = null;
          openedSessionId = frame.id;
          const snapshot = await (resolved.snapshotLeaf ?? snapshotRelayLeaf)(frame.id, frame.leafId);
          if (closed || epoch !== navigationEpoch) return;
          send({
            op: "session.snapshot",
            id: frame.id,
            ...(snapshot.title ? { title: snapshot.title } : {}),
            ...(snapshot.cwd ? { cwd: snapshot.cwd } : {}),
            leafId: snapshot.leafId,
            messages: snapshot.messages,
            agent: snapshot.agent,
          });
          try {
            const listed = await (resolved.listBranches ?? listRelayBranches)(frame.id);
            send({ op: "branches", id: listed.id, leafId: listed.leafId, branches: listed.branches });
          } catch {
            // Branches are best-effort after leaf switch; snapshot already delivered.
          }
        } catch (error) {
          sendRelayError(send, error, "leaf_failed", frame.id);
        }
        return;
      }
      case "session.export": {
        try {
          const exported = await (resolved.exportSession ?? exportRelaySession)(frame.id, deviceId);
          send({
            op: "session.exported",
            id: exported.id,
            fileName: exported.fileName,
            bytes: exported.bytes,
            ...(exported.transferId ? { transferId: exported.transferId } : {}),
            ...(exported.size !== undefined ? { size: exported.size } : {}),
            ...(exported.html ? { html: exported.html } : {}),
          });
        } catch (error) {
          sendRelayError(send, error, "export_failed", frame.id);
        }
        return;
      }
      case "skills.list": {
        try {
          const listed = await (resolved.listSkills ?? listRelaySkills)(frame.cwd);
          send({ op: "skills", cwd: listed.cwd, skills: listed.skills });
        } catch (error) {
          sendRelayError(send, error, "skills_failed");
        }
        return;
      }
      case "skills.toggle": {
        try {
          const updated = await (resolved.toggleSkill ?? toggleRelaySkill)(frame.cwd, frame.filePath, frame.disableModelInvocation);
          send({ op: "skill.updated", filePath: updated.filePath, disableModelInvocation: updated.disableModelInvocation });
          const listed = await (resolved.listSkills ?? listRelaySkills)(frame.cwd);
          send({ op: "skills", cwd: listed.cwd, skills: listed.skills });
        } catch (error) {
          sendRelayError(send, error, "skills_failed");
        }
        return;
      }
      case "plugins.list": {
        try {
          const listed = await (resolved.listPlugins ?? listRelayPlugins)(frame.cwd);
          send({ op: "plugins", cwd: listed.cwd, packages: listed.packages });
        } catch (error) {
          sendRelayError(send, error, "plugins_failed");
        }
        return;
      }
      case "plugins.action": {
        try {
          const listed = await (resolved.pluginAction ?? runRelayPluginAction)(frame.cwd, frame.action, frame.source, frame.scope);
          send({ op: "plugins", cwd: listed.cwd, packages: listed.packages });
        } catch (error) {
          sendRelayError(send, error, "plugins_failed");
        }
        return;
      }
      case "mcp.list": {
        try {
          const listed = await (resolved.listMcp ?? listRelayMcp)(frame.cwd);
          send({ op: "mcp", inventory: listed.inventory });
        } catch (error) {
          sendRelayError(send, error, "mcp_failed");
        }
        return;
      }
      case "mcp.delete": {
        try {
          const deleted = await (resolved.deleteMcp ?? deleteRelayMcp)(frame.cwd, frame.name);
          send({ op: "mcp.deleted", name: deleted.name });
          const listed = await (resolved.listMcp ?? listRelayMcp)(frame.cwd);
          send({ op: "mcp", inventory: listed.inventory });
        } catch (error) {
          sendRelayError(send, error, "mcp_failed");
        }
        return;
      }
      case "mcp.upsert": {
        try {
          const upserted = await (resolved.upsertMcp ?? upsertRelayMcp)(frame);
          send({ op: "mcp.upserted", name: upserted.name });
          const listed = await (resolved.listMcp ?? listRelayMcp)(frame.cwd);
          send({ op: "mcp", inventory: listed.inventory });
        } catch (error) {
          sendRelayError(send, error, "mcp_failed");
        }
        return;
      }
      case "session.create": {
        try {
          const created = await (resolved.createSession ?? createRelaySession)({
            cwd: frame.cwd,
            message: frame.message,
            provider: frame.provider,
            modelId: frame.modelId,
            thinkingLevel: frame.thinkingLevel,
          });
          send({ op: "session.created", id: created.sessionId, cwd: frame.cwd });
          disposeSession?.();
          disposeSession = null;
          coalescer.reset();
          openedSessionId = created.sessionId;
          const navigationEpoch = ++epoch;
          selectedLeaf = false;
          const opened = await resolved.openSession(created.sessionId, (event) => {
            if (!closed && epoch === navigationEpoch && !selectedLeaf) coalescer.push(event);
          });
          if (closed || epoch !== navigationEpoch || openedSessionId !== created.sessionId) {
            opened.dispose();
            return;
          }
          disposeSession = opened.dispose;
          coalescer.reset();
          send({
            op: "session.snapshot",
            id: created.sessionId,
            ...(opened.snapshot.title ? { title: opened.snapshot.title } : {}),
            ...(opened.snapshot.cwd ? { cwd: opened.snapshot.cwd } : {}),
            leafId: opened.snapshot.leafId,
            messages: opened.snapshot.messages,
            agent: opened.snapshot.agent,
          });
        } catch (error) {
          openedSessionId = null;
          epoch++;
          coalescer.reset();
          const message = error instanceof Error ? error.message : String(error);
          const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
            ? error.code
            : "session_create_failed";
          send({ op: "session.err", code, message });
        }
        return;
      }
      case "session.import": {
        try {
          const imported = await (resolved.importSession ?? importRelaySession)(frame.fileName, frame.content);
          send({ op: "session.imported", id: imported.id, cwd: imported.cwd });
          const listed = await resolved.listSessions();
          send({ op: "sessions", sessions: listed.sessions, runningIds: listed.runningIds });
        } catch (error) {
          sendRelayError(send, error, "session_import_failed");
        }
        return;
      }
      case "skills.search": {
        try {
          const found = await (resolved.searchSkills ?? searchRelaySkills)(frame.query, frame.limit ?? 10);
          send({ op: "skill.results", query: found.query, results: found.results });
        } catch (error) {
          sendRelayError(send, error, "skills_failed");
        }
        return;
      }
      case "skills.install": {
        try {
          const installed = await (resolved.installSkill ?? installRelaySkill)(frame.package, frame.scope, frame.cwd);
          send({ op: "skill.installed", package: installed.package, scope: installed.scope });
          if (frame.cwd) {
            const listed = await (resolved.listSkills ?? listRelaySkills)(frame.cwd);
            send({ op: "skills", cwd: listed.cwd, skills: listed.skills });
          }
        } catch (error) {
          sendRelayError(send, error, "skills_failed");
        }
        return;
      }
      case "agents.list": {
        try {
          const listed = await (resolved.listAgents ?? listRelayAgents)(frame.cwd);
          send({ op: "agents", ...(listed.cwd ? { cwd: listed.cwd } : {}), agents: listed.agents });
        } catch (error) {
          sendRelayError(send, error, "agents_failed");
        }
        return;
      }
      case "agents.save": {
        try {
          const saved = await (resolved.saveAgent ?? saveRelayAgent)({
            name: frame.name,
            description: frame.description,
            systemPrompt: frame.systemPrompt,
            scope: frame.scope,
            ...(frame.cwd ? { cwd: frame.cwd } : {}),
          });
          send({ op: "agent.saved", name: saved.name, ...(saved.filePath ? { filePath: saved.filePath } : {}) });
          const listed = await (resolved.listAgents ?? listRelayAgents)(frame.cwd);
          send({ op: "agents", ...(listed.cwd ? { cwd: listed.cwd } : {}), agents: listed.agents });
        } catch (error) {
          sendRelayError(send, error, "agents_failed");
        }
        return;
      }
      case "agents.delete": {
        try {
          const deleted = await (resolved.deleteAgent ?? deleteRelayAgent)({
            name: frame.name,
            scope: frame.scope,
            ...(frame.cwd ? { cwd: frame.cwd } : {}),
          });
          send({ op: "agent.deleted", name: deleted.name });
          const listed = await (resolved.listAgents ?? listRelayAgents)(frame.cwd);
          send({ op: "agents", ...(listed.cwd ? { cwd: listed.cwd } : {}), agents: listed.agents });
        } catch (error) {
          sendRelayError(send, error, "agents_failed");
        }
        return;
      }
      case "auth.providers": {
        try {
          const listed = await (resolved.listAuthProviders ?? listRelayAuthProviders)();
          send({ op: "auth.providers", providers: listed.providers });
        } catch (error) {
          sendRelayError(send, error, "auth_failed");
        }
        return;
      }
      case "files.index": {
        try {
          const found = await (resolved.searchFiles ?? searchRelayFileIndex)(frame.cwd, frame.query);
          send({ op: "files.index", cwd: found.cwd, query: found.query, matches: found.matches });
        } catch (error) {
          sendRelayError(send, error, "files_failed");
        }
        return;
      }
      case "projects.add": {
        try {
          const added = await (resolved.addProject ?? addRelayProject)(frame.cwd);
          send({ op: "project.added", path: added.path, ...(added.name ? { name: added.name } : {}) });
          const projects = await (resolved.listProjects ?? listRelayProjects)();
          send({ op: "projects", projects });
        } catch (error) {
          sendRelayError(send, error, "projects_failed");
        }
        return;
      }
      case "projects.remove": {
        try {
          const removed = await (resolved.removeProject ?? removeRelayProject)(frame.cwd);
          send({ op: "project.removed", path: removed.path });
          const projects = await (resolved.listProjects ?? listRelayProjects)();
          send({ op: "projects", projects });
        } catch (error) {
          sendRelayError(send, error, "projects_failed");
        }
        return;
      }
      case "settings.get": {
        try {
          const data = readNativeSettings();
          send({ op: "settings", settings: data.settings as Record<string, unknown> });
        } catch (error) {
          send({ op: "error", code: "settings_read_failed", message: String(error) });
        }
        return;
      }
      case "settings.update": {
        try {
          const current = readNativeSettings();
          const next = mergeNativeSettings(current.settings, frame.settings as NativeSettings);
          writeNativeSettings(next);
          const patchRecord = frame.settings as Record<string, unknown>;
          const registryInvalidated = patchRecord.enabledModels !== undefined
            || patchRecord.disabledProviders !== undefined
            || patchRecord.modelProviderOrder !== undefined;
          if (registryInvalidated) {
            invalidateModelsCache();
            disposeUtilityRpc();
          }
          const updated = readNativeSettings();
          send({ op: "settings_updated", success: true, settings: updated.settings as Record<string, unknown> });
        } catch (error) {
          send({ op: "settings_updated", success: false, error: String(error) });
        }
        return;
      }
      case "session.open": {
        const navigationEpoch = ++epoch;
        selectedLeaf = false;
        disposeSession?.();
        disposeSession = null;
        coalescer.reset();
        openedSessionId = frame.id;
        try {
          const opened = await resolved.openSession(frame.id, (event) => {
            if (!closed && epoch === navigationEpoch && !selectedLeaf) coalescer.push(event);
          });
          if (closed || epoch !== navigationEpoch || openedSessionId !== frame.id) {
            opened.dispose();
            return;
          }
          disposeSession = opened.dispose;
          coalescer.reset();
          const snapshotSent = send({
            op: "session.snapshot",
            id: frame.id,
            ...(opened.snapshot.title ? { title: opened.snapshot.title } : {}),
            ...(opened.snapshot.cwd ? { cwd: opened.snapshot.cwd } : {}),
            leafId: opened.snapshot.leafId,
            messages: opened.snapshot.messages,
            agent: opened.snapshot.agent,
          });
          if (!snapshotSent) {
            send({ op: "session.err", id: frame.id, code: "snapshot_too_large", message: "Session snapshot exceeded maximum frame size" });
          }
          try {
            const listed = await (resolved.listBranches ?? listRelayBranches)(frame.id);
            send({ op: "branches", id: listed.id, leafId: listed.leafId, branches: listed.branches });
          } catch {
            // Branches are best-effort after open; snapshot already delivered.
          }
        } catch (error) {
          openedSessionId = null;
          epoch++;
          coalescer.reset();
          const message = error instanceof Error ? error.message : String(error);
          const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
            ? error.code
            : "session_open_failed";
          send({ op: "session.err", id: frame.id, code, message });
        }
        return;
      }
      case "cmd": {
        if (!openedSessionId) {
          send({ op: "cmd_err", req: frame.req, code: "session_not_open", message: "Open a session first" });
          return;
        }
        try {
          const commandEpoch = epoch;
          const commandSession = openedSessionId;
          const data = await resolved.sendCommand(commandSession, commandFromRelayCmd(frame));
          if (closed || epoch !== commandEpoch || openedSessionId !== commandSession) return;
          send({ op: "cmd_ok", req: frame.req, data: data ?? null });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
            ? error.code
            : "rpc_command_failed";
          send({ op: "cmd_err", req: frame.req, code, message });
        }
      }
    }
  };

  return {
    onText(raw: string) {
      if (closed) return;
      let logical = raw;
      let assembled = false;
      try {
        if (Buffer.byteLength(raw, "utf8") > 256 * 1024) throw new Error("Frame exceeds transport limit");
        const envelope: unknown = JSON.parse(raw);
        if (typeof envelope === "object" && envelope !== null && "op" in envelope && envelope.op === "chunk") {
          if (!authed) { failHello("unauthorized", "hello is required before chunks"); return; }
          const complete = chunks.accept(envelope);
          if (complete === null) return;
          logical = complete;
          assembled = true;
        }
      } catch {
        chunks.clear();
        if (!authed) failHello("invalid_frame", "Invalid relay frame");
        else send({ op: "error", code: "invalid_frame", message: "Invalid relay frame" });
        return;
      }
      const parsed = parseClientFrame(logical, assembled);
      if (isRelayParseError(parsed)) {
        if (!authed) { failHello(parsed.code, parsed.message); return; }
        send({ op: "error", code: parsed.code, message: parsed.message });
        return;
      }
      const urgent = authed && ((parsed.op === "cmd" && (parsed.type === "abort"))
        || (parsed.op === "request" && parsed.domain === "sessions" && parsed.action === "command"
          && typeof parsed.args.command === "object" && parsed.args.command !== null && "type" in parsed.args.command
          && (parsed.args.command.type === "abort" || parsed.args.command.type === "extension_ui_response")));
      if ((urgent ? urgentQueued : queued) >= (urgent ? 16 : 64)) {
        if (parsed.op === "request") send({ op: "result", req: parsed.req, success: false, error: { code: "busy", message: "Too many pending relay operations" } });
        else if (parsed.op === "cmd") send({ op: "cmd_err", req: parsed.req, code: "busy", message: "Too many pending relay operations" });
        else send({ op: "error", code: "busy", message: "Too many pending relay operations" });
        return;
      }
      if (urgent) urgentQueued++; else queued++;
      const run = () => handle(parsed).catch(() => {
        send({ op: "error", code: "internal_error", message: "Relay operation failed" });
      }).finally(() => { if (urgent) urgentQueued--; else queued--; });
      if (urgent) urgentHandling = urgentHandling.then(run);
      else handling = handling.then(run);
    },
    onClose() {
      dispose();
    },
  };
}

function sendRelayError(
  send: (frame: RelayServerFrame) => boolean,
  error: unknown,
  fallback: string,
  sessionId?: string,
): void {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : fallback;
  if (sessionId) {
    send({ op: "session.err", id: sessionId, code, message });
    return;
  }
  send({ op: "error", code, message });
}

