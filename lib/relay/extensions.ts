import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "../file-access";
import { runNpx } from "../npx";
import {
  createAgent,
  deleteAgent,
  discoverAgents,
  unpackBundledAgents,
  updateAgent,
} from "../omp/agents-service";
import { parseOmpJsonStdout, runOmpCli } from "../omp/omp-cli";
import { runUtilityCommand } from "../omp/rpc-utility";
import {
  deleteMcpServer,
  readDiscoveredMcpServers,
  readMcpConfig,
  redactMcpServer,
  type McpFile,
  readUserMcpConfig,
  validateMcpServer,
  writeMcpServer,
  type McpLiveServer,
  type McpServer,
} from "../omp/mcp-config";
import {
  getSkillScanRootDirs,
  loadSkillsWithInstallInfo,
  parseSkillFrontmatter,
  readDisableModelInvocation,
  setDisableModelInvocation,
} from "../skills-service";
import type {
  RelayAgentItem,
  RelayAuthProvider,
  RelayMcpItem,
  RelayPluginAction,
  RelayPluginItem,
  RelaySkillItem,
  RelaySkillSearchResult,
} from "./protocol";
import { RelaySessionError } from "./session-runtime";
import { buildSkillUpdateArgs, checkSkillUpdates } from "../skill-updates";
import type { SkillUpdateResult } from "../api-types";

type RelayMcpConfigFile = { root: string; path: string; config: McpFile; exists: boolean };

// Legacy frame caps removed: domain dispatch paginates (extensions-requests)
// and the transport chunks large frames. PLUGIN_CAP/MCP_CAP/SKILL_CAP/AGENT
// constants are intentionally deleted — do not reintroduce silent truncation.

async function assertAllowedCwd(rawCwd: string): Promise<string> {
  const cwd = rawCwd.trim();
  const roots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, roots)) {
    throw new RelaySessionError("access_denied", "Path is outside allowed workspaces");
  }
  return cwd;
}

export async function listRelaySkills(rawCwd: string): Promise<{ cwd: string; skills: RelaySkillItem[] }> {
  const cwd = await assertAllowedCwd(rawCwd);
  const loaded = await loadSkillsWithInstallInfo(cwd);
  // No fixed cap: callers paginate (extensions-requests skills.list) and the
  // transport chunks large frames. Keep the full description so detail views
  // do not need a second read.
  const skills = loaded.skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    filePath: skill.filePath,
    disableModelInvocation: skill.disableModelInvocation,
    ...(skill.sourceInfo.scope ? { scope: skill.sourceInfo.scope } : {}),
  }));
  return { cwd, skills };
}

export async function toggleRelaySkill(
  rawCwd: string,
  filePath: string,
  disableModelInvocation: boolean,
): Promise<{ filePath: string; disableModelInvocation: boolean }> {
  const cwd = await assertAllowedCwd(rawCwd);
  if (basename(filePath) !== "SKILL.md") {
    throw new RelaySessionError("not_a_skill_file", "not a SKILL.md file");
  }
  if (!existsSync(filePath)) {
    throw new RelaySessionError("file_not_found", "file not found");
  }
  const allowedRoots = new Set(await getAllowedFileRoots());
  for (const dir of getSkillScanRootDirs(cwd)) allowedRoots.add(dir);
  const resolvedFilePath = realpathSync(filePath);
  if (!isExistingFilePathAllowed(resolvedFilePath, allowedRoots)) {
    throw new RelaySessionError("access_denied", "Path is outside allowed workspaces");
  }
  const content = readFileSync(resolvedFilePath, "utf8");
  const updated = setDisableModelInvocation(content, disableModelInvocation);
  if (updated !== content) {
    // Atomic same-dir write so a crash never leaves a half-written SKILL.md.
    const temp = `${resolvedFilePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      mkdirSync(dirname(resolvedFilePath), { recursive: true });
      writeFileSync(temp, updated, "utf8");
      renameSync(temp, resolvedFilePath);
    } catch (error) {
      try {
        if (existsSync(temp)) unlinkSync(temp);
      } catch {
        // Cleanup is best-effort.
      }
      throw error;
    }
  }
  const { frontmatter } = parseSkillFrontmatter(updated);
  return { filePath: resolvedFilePath, disableModelInvocation: readDisableModelInvocation(frontmatter) };
}

function slimPlugin(source: string, extra: Partial<RelayPluginItem> = {}): RelayPluginItem {
  return {
    source,
    scope: extra.scope ?? "global",
    status: extra.status ?? "installed",
    disabled: extra.disabled ?? false,
    ...(extra.version ? { version: extra.version } : {}),
    ...(extra.counts ? { counts: extra.counts } : {}),
  };
}

export async function listRelayPlugins(rawCwd: string): Promise<{ cwd: string; packages: RelayPluginItem[] }> {
  const cwd = await assertAllowedCwd(rawCwd);
  const { stdout } = await runOmpCli(["plugin", "list", "--json"], { cwd, timeout: 60_000 });
  const parsed = parseOmpJsonStdout<{
    npm?: Array<{ name?: string; version?: string; enabled?: boolean }>;
    marketplace?: Array<{ id?: string; scope?: string; enabled?: boolean; version?: string }>;
  }>(stdout);
  const packages: RelayPluginItem[] = [];
  for (const plugin of parsed?.npm ?? []) {
    if (!plugin.name) continue;
    const enabled = plugin.enabled !== false;
    packages.push(slimPlugin(plugin.name, {
      scope: "global",
      status: enabled ? "loaded" : "disabled",
      disabled: !enabled,
      version: plugin.version,
    }));
  }
  for (const plugin of parsed?.marketplace ?? []) {
    if (!plugin.id) continue;
    const enabled = plugin.enabled !== false;
    packages.push(slimPlugin(plugin.id, {
      scope: plugin.scope === "project" ? "project" : "global",
      status: enabled ? "loaded" : "disabled",
      disabled: !enabled,
      version: plugin.version,
    }));
  }
  return { cwd, packages };
}

export async function runRelayPluginAction(
  rawCwd: string,
  action: RelayPluginAction,
  source?: string,
  scope?: "global" | "project",
): Promise<{ cwd: string; packages: RelayPluginItem[]; output: string }> {
  const cwd = await assertAllowedCwd(rawCwd);
  const trimmedSource = source?.trim();
  const scopeArgs = scope === "project" ? ["--scope", "project"] : [];
  let output = "";
  const run = async (args: string[], timeout: number): Promise<string> => {
    try {
      const result = await runOmpCli(args, { cwd, timeout });
      return `${result.stdout}${result.stderr}`.slice(-2000);
    } catch (error) {
      const detail = error as { stdout?: string; stderr?: string; message?: string };
      const text = `${detail.stdout ?? ""}${detail.stderr ?? ""}`.trim() || detail.message || String(error);
      throw new RelaySessionError("plugin_action_failed", text.slice(-500));
    }
  };
  if (action === "install") {
    if (!trimmedSource) throw new RelaySessionError("invalid_source", "source is required");
    output = await run(["plugin", "install", trimmedSource, "--json", ...scopeArgs], 300_000);
  } else if (action === "remove") {
    if (!trimmedSource) throw new RelaySessionError("invalid_source", "source is required");
    output = await run(["plugin", "uninstall", trimmedSource, "--json", ...scopeArgs], 120_000);
  } else if (action === "update") {
    output = await run(["plugin", "upgrade", ...(trimmedSource ? [trimmedSource, ...scopeArgs] : [])], 300_000);
  } else if (action === "disable" || action === "enable") {
    if (!trimmedSource) throw new RelaySessionError("invalid_source", "source is required");
    output = await run(["plugin", action, trimmedSource, "--json", ...scopeArgs], 60_000);
  }
  const listed = await listRelayPlugins(cwd);
  return { cwd: listed.cwd, packages: listed.packages, output };
}

function toMcpItem(server: McpLiveServer): RelayMcpItem {
  return {
    name: server.name,
    source: server.source,
    status: server.status,
    ...(server.type ? { type: server.type } : {}),
    enabled: server.status !== "disabled",
  };
}

export async function listRelayMcp(rawCwd?: string): Promise<{ inventory: RelayMcpItem[] }> {
  const cwd = rawCwd?.trim() ? await assertAllowedCwd(rawCwd) : null;
  const file = cwd ? readMcpConfig(cwd) : null;
  const user = readUserMcpConfig();
  const inventory: RelayMcpItem[] = [];
  for (const { name, config } of user.servers) {
    const enabled = config.enabled !== false;
    inventory.push({
      name,
      source: "User level",
      status: enabled ? "configured" : "disabled",
      type: typeof config.type === "string" ? config.type : typeof config.url === "string" ? "http" : "stdio",
      enabled,
    });
  }
  for (const name of user.disabledServers) {
    inventory.push({ name, source: "Disabled", status: "disabled", enabled: false });
  }
  for (const [name, config] of Object.entries(file?.config.mcpServers ?? {})) {
    const enabled = config.enabled !== false;
    inventory.push({
      name,
      source: "Project level",
      status: enabled ? "configured" : "disabled",
      type: typeof config.type === "string" ? config.type : typeof config.url === "string" ? "http" : "stdio",
      enabled,
    });
  }
  for (const server of readDiscoveredMcpServers(cwd ?? undefined, user.disabledServers)) {
    inventory.push(toMcpItem(server));
  }
  return { inventory };
}

export async function deleteRelayMcp(rawCwd: string, name: string): Promise<{ name: string }> {
  const cwd = await assertAllowedCwd(rawCwd);
  deleteMcpServer(cwd, name);
  return { name };
}

export async function upsertRelayMcp(input: {
  cwd: string;
  name: string;
  type: "stdio" | "http" | "sse";
  command?: string;
  url?: string;
  args?: string[];
  env?: Record<string, string> | null;
  headers?: Record<string, string> | null;
  serverCwd?: string;
  enabled?: boolean;
  timeout?: number;
  requestIdFormat?: "number" | "string";
  previousName?: string;
}): Promise<{ name: string }> {
  // writeMcpServer preserves omitted env/headers from the stored server and
  // never echoes them back; validate the merged candidate the same way the
  // desktop PUT route does. previousName supports rename without losing
  // credentials when env/headers are omitted.
  const server: McpServer = { type: input.type };
  if (input.command !== undefined) server.command = input.command;
  if (input.url !== undefined) server.url = input.url;
  if (input.args !== undefined) server.args = input.args;
  if (input.env !== undefined) server.env = input.env ?? {};
  if (input.headers !== undefined) server.headers = input.headers ?? {};
  if (input.serverCwd !== undefined) server.cwd = input.serverCwd;
  if (input.enabled !== undefined) server.enabled = input.enabled;
  if (input.timeout !== undefined) server.timeout = input.timeout;
  if (input.requestIdFormat !== undefined) server.requestIdFormat = input.requestIdFormat;
  return saveRelayMcpServer(input.cwd, input.name, server, input.previousName);
}

export async function saveRelayMcpServer(rawCwd: string, name: string, value: unknown, previousName?: string): Promise<{ name: string }> {
  const cwd = await assertAllowedCwd(rawCwd);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RelaySessionError("invalid_mcp", "server must be an object");
  }
  const server: McpServer = { ...value };
  if (server.env === null) server.env = {};
  if (server.headers === null) server.headers = {};
  try {
    validateMcpServer(name, server);
  } catch (error) {
    throw new RelaySessionError("invalid_mcp", error instanceof Error ? error.message : String(error));
  }
  try {
    writeMcpServer(cwd, name, server, previousName);
  } catch {
    throw new RelaySessionError("mcp_write_failed", "Unable to write MCP configuration");
  }
  return { name };
}

const SKILLS_SEARCH_API_BASE = process.env.SKILLS_API_URL || "https://skills.sh";
const SKILL_SEARCH_ANSI_RE = /\x1B\[[0-9;]*m/g;

function parseSkillSearchOutput(raw: string): RelaySkillSearchResult[] {
  const clean = raw.replace(SKILL_SEARCH_ANSI_RE, "");
  const results: RelaySkillSearchResult[] = [];
  const lines = clean.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const pkgMatch = line.match(/^([\w.\-]+\/[\w.\-@:]+)\s+([\d.,]+[KMB]?\s+installs)$/);
    if (pkgMatch) {
      const urlLine = lines[i + 1]?.trim().replace(/^└\s*/, "");
      results.push({
        package: pkgMatch[1],
        installs: pkgMatch[2],
        ...(urlLine?.startsWith("https://") ? { url: urlLine } : {}),
      });
    }
  }
  return results;
}

export async function searchRelaySkills(query: string, limit = 10): Promise<{ query: string; results: RelaySkillSearchResult[] }> {
  const trimmed = query.trim();
  if (!trimmed) throw new RelaySessionError("invalid_query", "query is required");
  const capped = Math.min(20, Math.max(1, Math.floor(limit) || 10));
  try {
    const res = await fetch(`${SKILLS_SEARCH_API_BASE}/api/search?q=${encodeURIComponent(trimmed)}&limit=${capped}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`skills.sh search failed: HTTP ${res.status}`);
    const data: unknown = await res.json();
    if (typeof data !== "object" || data === null || !("skills" in data) || !Array.isArray(data.skills)) {
      throw new Error("Invalid skills search response");
    }
    const results: RelaySkillSearchResult[] = [];
    for (const value of data.skills) {
      const skill: unknown = value;
      if (typeof skill !== "object" || skill === null || Array.isArray(skill)) continue;
      const name = "name" in skill && typeof skill.name === "string" ? skill.name.trim() : undefined;
      const source = "source" in skill && typeof skill.source === "string" ? skill.source.trim() : undefined;
      const slug = "id" in skill && typeof skill.id === "string" ? skill.id.trim() : undefined;
      if (!name || (!source && !slug)) continue;
      const count = "installs" in skill && typeof skill.installs === "number" ? skill.installs : 0;
      results.push({
        package: `${source || slug}@${name}`,
        ...(count > 0 ? { installs: `${count} installs` } : {}),
        ...(slug ? { url: `${SKILLS_SEARCH_API_BASE}/${slug}` } : {}),
      });
      if (results.length >= capped) break;
    }
    return { query: trimmed, results };
  } catch {
    const { stdout, stderr } = await runNpx(["skills", "find", trimmed], {
      timeout: 20_000,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    return { query: trimmed, results: parseSkillSearchOutput(stdout + stderr).slice(0, capped) };
  }
}

export async function installRelaySkill(
  pkg: string,
  scope: "global" | "project",
  rawCwd?: string,
): Promise<{ package: string; scope: string }> {
  const trimmed = pkg.trim();
  if (!trimmed) throw new RelaySessionError("invalid_package", "package is required");
  const isGlobal = scope !== "project";
  let cwd: string | undefined;
  if (!isGlobal) {
    if (!rawCwd?.trim()) throw new RelaySessionError("invalid_cwd", "cwd is required for project install");
    cwd = await assertAllowedCwd(rawCwd);
  } else if (rawCwd?.trim()) {
    cwd = await assertAllowedCwd(rawCwd);
  }
  const args = ["skills", "add", trimmed, "-y", "--agent", "universal"];
  if (isGlobal) args.push("-g");
  try {
    const { stdout, stderr } = await runNpx(args, {
      timeout: 60_000,
      cwd,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    const output = (stdout + stderr).replace(SKILL_SEARCH_ANSI_RE, "");
    if (!/Installation complete|Installed \d+ skill/.test(output)) {
      throw new RelaySessionError("skill_install_failed", output.slice(-300) || "Install failed");
    }
  } catch (error) {
    if (error instanceof RelaySessionError) throw error;
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const output = (((err.stdout ?? "") + (err.stderr ?? "")).replace(SKILL_SEARCH_ANSI_RE, "") || err.message || String(error)).slice(-300);
    throw new RelaySessionError("skill_install_failed", output || "Install failed");
  }
  return { package: trimmed, scope: isGlobal ? "global" : "project" };
}

export async function listRelayAgents(rawCwd?: string): Promise<{ cwd?: string; agents: RelayAgentItem[] }> {
  const cwd = rawCwd?.trim() ? await assertAllowedCwd(rawCwd) : undefined;
  const discovered = await discoverAgents(cwd ?? process.cwd());
  // No cap, no prompt truncation in the core inventory: extensions-requests
  // paginates and agents.get returns the full systemPrompt on demand.
  const agents: RelayAgentItem[] = discovered.agents.map((agent) => ({
    name: agent.name,
    description: agent.description,
    source: agent.source,
    ...(agent.filePath ? { filePath: agent.filePath } : {}),
    systemPrompt: agent.systemPrompt,
    ...(agent.disabled ? { disabled: true } : {}),
  }));
  return cwd ? { cwd, agents } : { agents };
}

export async function saveRelayAgent(input: {
  name: string;
  description: string;
  systemPrompt: string;
  scope: "user" | "project";
  cwd?: string;
  tools?: string[];
  model?: string | string[];
  thinkingLevel?: string;
  prewalk?: boolean | string;
  advisor?: boolean | string;
  blocking?: boolean;
}): Promise<{ name: string; filePath?: string }> {
  const name = input.name.trim();
  const description = input.description.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new RelaySessionError("invalid_name", "name must be kebab-case");
  }
  if (!description) throw new RelaySessionError("invalid_description", "description is required");
  const rest = {
    ...(input.tools !== undefined ? { tools: input.tools } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.thinkingLevel !== undefined ? { thinkingLevel: input.thinkingLevel } : {}),
    ...(input.prewalk !== undefined ? { prewalk: input.prewalk } : {}),
    ...(input.advisor !== undefined ? { advisor: input.advisor } : {}),
    ...(input.blocking !== undefined ? { blocking: input.blocking } : {}),
    ...(input.cwd?.trim() ? { cwd: input.cwd.trim() } : {}),
  };
  let filePath: string;
  try {
    filePath = await createAgent({
      scope: input.scope,
      name,
      description,
      systemPrompt: input.systemPrompt,
      ...rest,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already exists/i.test(message)) {
      try {
        filePath = await updateAgent({
          scope: input.scope,
          name,
          description,
          systemPrompt: input.systemPrompt,
          ...rest,
        });
      } catch (updateError) {
        throw new RelaySessionError("agent_save_failed", updateError instanceof Error ? updateError.message : String(updateError));
      }
    } else {
      throw new RelaySessionError("agent_save_failed", message);
    }
  }
  return { name, filePath };
}

export async function deleteRelayAgent(input: {
  name: string;
  scope: "user" | "project";
  cwd?: string;
}): Promise<{ name: string }> {
  try {
    await deleteAgent({
      name: input.name,
      scope: input.scope,
      ...(input.cwd?.trim() ? { cwd: input.cwd.trim() } : {}),
    });
  } catch (error) {
    throw new RelaySessionError("agent_delete_failed", error instanceof Error ? error.message : String(error));
  }
  return { name: input.name };
}

export async function getRelayAgent(input: {
  name: string;
  scope?: "user" | "project";
  cwd?: string;
}): Promise<Record<string, unknown>> {
  const name = input.name.trim();
  if (!name) throw new RelaySessionError("invalid_name", "name is required");
  const cwd = input.cwd?.trim() ? await assertAllowedCwd(input.cwd) : undefined;
  const discovered = await discoverAgents(cwd ?? process.cwd());
  const agent = discovered.agents.find(
    (entry) => entry.name === name && (!input.scope || entry.source === input.scope),
  );
  if (!agent) throw new RelaySessionError("agent_not_found", `Agent "${name}" was not found`);
  return {
    name: agent.name,
    description: agent.description,
    source: agent.source,
    ...(agent.filePath ? { filePath: agent.filePath } : {}),
    ...(agent.tools ? { tools: agent.tools } : {}),
    ...(agent.model !== undefined ? { model: agent.model } : {}),
    ...(agent.thinkingLevel !== undefined ? { thinkingLevel: agent.thinkingLevel } : {}),
    ...(agent.prewalk !== undefined ? { prewalk: agent.prewalk } : {}),
    ...(agent.advisor !== undefined ? { advisor: agent.advisor } : {}),
    ...(agent.blocking !== undefined ? { blocking: agent.blocking } : {}),
    systemPrompt: agent.systemPrompt,
    ...(agent.disabled ? { disabled: true } : {}),
    ...(agent.isShadowed ? { isShadowed: true } : {}),
    ...(agent.overrideModel !== undefined ? { overrideModel: agent.overrideModel } : {}),
    ...(agent.prewalkOverride !== undefined ? { prewalkOverride: agent.prewalkOverride } : {}),
    ...(agent.advisorOverride !== undefined ? { advisorOverride: agent.advisorOverride } : {}),
  };
}

export async function unpackRelayAgents(input: {
  scope: "user" | "project";
  cwd?: string;
  force?: boolean;
}): Promise<{ targetDir: string; count: number }> {
  const cwd = input.cwd?.trim() ? await assertAllowedCwd(input.cwd) : undefined;
  try {
    return await unpackBundledAgents({
      scope: input.scope,
      ...(cwd ? { cwd } : {}),
      ...(input.force !== undefined ? { force: input.force } : {}),
    });
  } catch (error) {
    throw new RelaySessionError("agent_unpack_failed", error instanceof Error ? error.message : String(error));
  }
}

export async function getRelaySkillDetail(rawCwd: string, rawFilePath: string): Promise<Record<string, unknown>> {
  const cwd = await assertAllowedCwd(rawCwd);
  const filePath = rawFilePath.trim();
  if (basename(filePath) !== "SKILL.md") {
    throw new RelaySessionError("not_a_skill_file", "not a SKILL.md file");
  }
  const loaded = await loadSkillsWithInstallInfo(cwd);
  const skill = loaded.skills.find((entry) => entry.filePath === filePath);
  if (!skill) throw new RelaySessionError("skill_not_found", "skill was not found");
  const allowedRoots = new Set(await getAllowedFileRoots());
  for (const dir of getSkillScanRootDirs(cwd)) allowedRoots.add(dir);
  const resolved = realpathSync(skill.filePath);
  if (!isExistingFilePathAllowed(resolved, allowedRoots)) {
    throw new RelaySessionError("access_denied", "Path is outside allowed workspaces");
  }
  const content = readFileSync(resolved, "utf8");
  const { frontmatter, body } = parseSkillFrontmatter(content);
  const preview = body.slice(0, 8000);
  return {
    name: skill.name,
    description: skill.description,
    filePath: resolved,
    disableModelInvocation: readDisableModelInvocation(frontmatter),
    ...(skill.sourceInfo.scope ? { scope: skill.sourceInfo.scope } : {}),
    ...(skill.sourceInfo.source ? { source: skill.sourceInfo.source } : {}),
    ...(skill.install ? { install: skill.install } : {}),
    frontmatter,
    contentPreview: preview,
    contentTruncated: body.length > preview.length,
  };
}

export async function getRelayMcp(rawCwd: string, rawName: string): Promise<Record<string, unknown>> {
  const cwd = await assertAllowedCwd(rawCwd);
  const name = rawName.trim();
  if (!name) throw new RelaySessionError("invalid_name", "name is required");
  let file: RelayMcpConfigFile;
  try {
    file = readMcpConfig(cwd);
  } catch (error) {
    throw new RelaySessionError("mcp_read_failed", error instanceof Error ? error.message : String(error));
  }
  const stored = file.config.mcpServers?.[name];
  if (!stored) throw new RelaySessionError("mcp_not_found", `MCP server "${name}" was not found`);
  return {
    name,
    source: "Project level" as const,
    config: redactMcpServer(stored),
    envConfigured: stored.env !== undefined,
    headersConfigured: stored.headers !== undefined,
    path: file.path,
  };
}

export async function validateRelayMcp(rawName: string, value: unknown): Promise<{ ok: true }> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RelaySessionError("invalid_mcp", "server must be an object");
  }
  const server: McpServer = { ...value };
  if (server.env === null) server.env = {};
  if (server.headers === null) server.headers = {};
  try {
    validateMcpServer(rawName, server);
  } catch (error) {
    throw new RelaySessionError("invalid_mcp", error instanceof Error ? error.message : String(error));
  }
  return { ok: true as const };
}

export async function checkRelaySkillUpdates(input: {
  cwd: string;
  package?: string;
  scope?: "global" | "project";
}): Promise<{ updates: SkillUpdateResult[] }> {
  const cwd = await assertAllowedCwd(input.cwd);
  const { skills } = await loadSkillsWithInstallInfo(cwd);
  const installs = skills
    .map((skill) => skill.install)
    .filter((install): install is NonNullable<typeof install> => Boolean(install))
    .filter((install) => !input.package || (install.package === input.package && install.scope === input.scope));
  if (input.package && installs.length === 0) {
    throw new RelaySessionError("skill_not_installed", "Installed skill not found");
  }
  const updates = await checkSkillUpdates(installs, {
    githubToken: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
  });
  return { updates };
}

export async function updateRelaySkill(input: {
  cwd: string;
  package: string;
  scope: "global" | "project";
}): Promise<Record<string, unknown>> {
  const cwd = await assertAllowedCwd(input.cwd);
  const { skills } = await loadSkillsWithInstallInfo(cwd);
  const skill = skills.find((item) => item.install?.package === input.package && item.install.scope === input.scope);
  if (!skill?.install) throw new RelaySessionError("skill_not_installed", "Installed skill not found");
  if (!skill.install.canCheckForUpdates) {
    throw new RelaySessionError("skill_update_unsupported", "This skill cannot be updated automatically");
  }
  try {
    const { stdout, stderr } = await runNpx(buildSkillUpdateArgs(skill.install), {
      timeout: 60_000,
      cwd: input.scope === "project" ? cwd : undefined,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    const refreshed = await loadSkillsWithInstallInfo(cwd);
    const updated = refreshed.skills.find(
      (item) => item.install?.package === input.package && item.install.scope === input.scope,
    );
    return { success: true as const, output: `${stdout}${stderr}`.slice(-500), ...(updated ? { skill: updated } : {}) };
  } catch (error) {
    const stdout = typeof error === "object" && error !== null && "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
    const stderr = typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
    const output = `${stdout}${stderr}`.trim() || (error instanceof Error ? error.message : String(error));
    throw new RelaySessionError("skill_update_failed", output.slice(-500));
  }
}

export async function listRelayAuthProviders(): Promise<{ providers: RelayAuthProvider[] }> {
  try {
    const response = await runUtilityCommand<{ providers?: unknown }>({ type: "get_login_providers" }, 30_000);
    const providers: RelayAuthProvider[] = [];
    if (Array.isArray(response.providers)) {
      for (const value of response.providers) {
        const provider: unknown = value;
        if (typeof provider !== "object" || provider === null || Array.isArray(provider)) continue;
        if (!("id" in provider) || typeof provider.id !== "string" ||
            !("name" in provider) || typeof provider.name !== "string" ||
            !("authenticated" in provider) || typeof provider.authenticated !== "boolean" ||
            ("available" in provider && provider.available === false)) continue;
        providers.push({ id: provider.id, name: provider.name, loggedIn: provider.authenticated });
      }
    }
    return { providers };
  } catch (error) {
    throw new RelaySessionError("auth_failed", error instanceof Error ? error.message : String(error));
  }
}
