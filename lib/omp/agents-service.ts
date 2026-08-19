import { promises as fs, existsSync } from "fs";
import path from "path";
import { parseDocument, stringify } from "yaml";
import { getAgentDir } from "./paths";
import { readNativeSettings } from "./settings-config";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "../file-access";
import { resolveOmpBin } from "./omp-cli";

export type AgentSource = "bundled" | "user" | "project" | "extension";

export interface AgentDefinition {
  name: string;
  description: string;
  tools?: string[];
  spawns?: string[];
  model?: string | string[];
  thinkingLevel?: string;
  blocking?: boolean;
  prewalk?: boolean | string;
  advisor?: boolean | string;
  autoloadSkills?: boolean;
  readSummarize?: boolean;
  systemPrompt: string;
  source: AgentSource;
  filePath?: string;
  isShadowed?: boolean;
  overrideModel?: string | string[];
  prewalkOverride?: boolean | string;
  advisorOverride?: boolean | string;
  disabled?: boolean;
}

export function validateAgentIdentifier(name: string): boolean {
  return typeof name === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

const BUNDLED_CATALOG: Record<string, Partial<AgentDefinition>> = {
  task: {
    description: "General-purpose implementation agent with full capabilities",
    tools: ["read", "write", "edit", "bash"],
    systemPrompt: "You are a general-purpose coding agent. Implement requested changes carefully and verify them before finishing.",
  },
  scout: {
    description: "Read-only codebase exploration and research agent",
    tools: ["read", "grep", "glob"],
    systemPrompt: "Explore the codebase and return concise, evidence-backed findings. Do not modify files.",
  },
  reviewer: {
    description: "Code review specialist for quality and security analysis",
    tools: ["read", "grep", "glob"],
    systemPrompt: "Review code for correctness, security, maintainability, and regressions with concrete findings.",
  },
  "security-reviewer": {
    description: "Security vulnerability discovery specialist",
    tools: ["read", "grep", "glob"],
    systemPrompt: "Discover potential security vulnerabilities and return concrete evidence and remediation guidance.",
  },
  librarian: {
    description: "External library and API research specialist",
    tools: ["read", "web_search", "web_extract"],
    systemPrompt: "Research library APIs and source documentation; provide definitive, source-verified answers.",
  },
  designer: {
    description: "UI and UX implementation specialist",
    tools: ["read", "write", "edit"],
    systemPrompt: "Design and implement polished, accessible user interfaces following project conventions.",
  },
  sonic: {
    description: "Fast low-reasoning agent for strictly mechanical updates",
    tools: ["read", "write", "edit"],
    systemPrompt: "Perform strictly mechanical updates and data collection accurately with minimal overhead.",
  },
};

function parseAgentFile(text: string, filePath: string, source: AgentSource): AgentDefinition {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const frontmatterText = match ? match[1] : "";
  const body = match ? text.slice(match[0].length) : text;

  const doc = parseDocument(frontmatterText);
  if (doc.errors.length > 0) {
    throw new Error(`YAML parse error in ${filePath}: ${doc.errors[0].message}`);
  }
  const raw = doc.toJS() as unknown;
  const frontmatter = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const name = String(frontmatter.name || path.basename(filePath, ".md"));

  if (!validateAgentIdentifier(name)) {
    throw new Error(`Invalid agent identifier "${name}" in ${filePath}`);
  }

  return {
    ...frontmatter,
    name,
    description: String(frontmatter.description || ""),
    tools: Array.isArray(frontmatter.tools) ? frontmatter.tools.map(String) : undefined,
    model: typeof frontmatter.model === "string" || Array.isArray(frontmatter.model) ? (frontmatter.model as string | string[]) : undefined,
    prewalk: typeof frontmatter.prewalk === "boolean" || typeof frontmatter.prewalk === "string" ? frontmatter.prewalk : undefined,
    advisor: typeof frontmatter.advisor === "boolean" || typeof frontmatter.advisor === "string" ? frontmatter.advisor : undefined,
    thinkingLevel: typeof frontmatter.thinkingLevel === "string" ? frontmatter.thinkingLevel : undefined,
    blocking: typeof frontmatter.blocking === "boolean" ? frontmatter.blocking : undefined,
    systemPrompt: String(frontmatter.systemPrompt ?? body.trim()),
    source,
    filePath,
    isShadowed: false,
  };
}

async function scanDirectory(
  dir: string,
  source: AgentSource,
  diagnostics: Array<{ path: string; error: string }>,
): Promise<AgentDefinition[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const agents: AgentDefinition[] = [];
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const fullPath = path.join(dir, entry.name);
        try {
          const content = await fs.readFile(fullPath, "utf8");
          agents.push(parseAgentFile(content, fullPath, source));
        } catch (err) {
          diagnostics.push({ path: fullPath, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    return agents;
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? (err as { code: string }).code : undefined;
    if (code !== "ENOENT") {
      diagnostics.push({ path: dir, error: err instanceof Error ? err.message : String(err) });
    }
    return [];
  }
}

export function findProjectAgentsDir(cwd: string): string | null {
  let current = path.resolve(cwd);
  while (true) {
    const agentsDir = path.join(current, ".omp", "agents");
    if (existsSync(agentsDir)) return agentsDir;

    const ompDir = path.join(current, ".omp");
    if (existsSync(ompDir)) return agentsDir; // If .omp exists, project agents go into .omp/agents

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function getUserAgentsDir(): string {
  return path.join(getAgentDir(), "agents");
}

export async function discoverAgents(cwd: string = process.cwd()): Promise<{
  agents: AgentDefinition[];
  projectRoot?: string;
  diagnostics?: Array<{ path: string; error: string }>;
}> {
  const diagnostics: Array<{ path: string; error: string }> = [];
  const projectAgentsDir = findProjectAgentsDir(cwd);
  const userAgentsDir = getUserAgentsDir();

  const sources: Array<{ dir: string; source: AgentSource }> = [];
  if (projectAgentsDir) {
    sources.push({ dir: projectAgentsDir, source: "project" });
  }
  sources.push({ dir: userAgentsDir, source: "user" });

  const extensionDirs = (process.env.OMP_EXTENSION_DIRS || "")
    .split(path.delimiter)
    .filter(Boolean);
  for (const extDir of extensionDirs) {
    sources.push({ dir: path.join(extDir, "agents"), source: "extension" });
  }

  const allFound: AgentDefinition[] = [];
  for (const { dir, source } of sources) {
    const found = await scanDirectory(dir, source, diagnostics);
    allFound.push(...found);
  }

  // Add bundled agents
  for (const [name, def] of Object.entries(BUNDLED_CATALOG)) {
    allFound.push({
      name,
      description: def.description || "",
      tools: def.tools,
      systemPrompt: def.systemPrompt || "",
      source: "bundled",
      isShadowed: false,
    });
  }

  // Deduplicate and mark shadowed agents based on precedence: project > user > extension > bundled
  const seen = new Set<string>();
  const effectiveAgents: AgentDefinition[] = [];

  // Read task overrides from config.yml
  let taskSettings: Record<string, unknown> = {};
  try {
    const native = readNativeSettings();
    taskSettings = (native.settings.task as Record<string, unknown>) || {};
  } catch {
    // ignore settings read failure in discovery
  }

  const agentModelOverrides = (taskSettings.agentModelOverrides as Record<string, string | string[]>) || {};
  const agentPrewalk = (taskSettings.agentPrewalk as Record<string, boolean | string>) || {};
  const agentAdvisor = (taskSettings.agentAdvisor as Record<string, boolean | string>) || {};
  const disabledAgents = new Set(Array.isArray(taskSettings.disabledAgents) ? taskSettings.disabledAgents : []);

  for (const agent of allFound) {
    const isFirst = !seen.has(agent.name);
    seen.add(agent.name);

    agent.isShadowed = !isFirst;
    if (isFirst) {
      if (agent.name in agentModelOverrides) {
        agent.overrideModel = agentModelOverrides[agent.name];
      }
      if (agent.name in agentPrewalk) {
        agent.prewalkOverride = agentPrewalk[agent.name];
      }
      if (agent.name in agentAdvisor) {
        agent.advisorOverride = agentAdvisor[agent.name];
      }
      if (disabledAgents.has(agent.name)) {
        agent.disabled = true;
      }
      effectiveAgents.push(agent);
    }
  }

  return {
    agents: effectiveAgents,
    projectRoot: projectAgentsDir ? path.dirname(path.dirname(projectAgentsDir)) : undefined,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

async function resolveTargetFilePath(params: {
  scope: "user" | "project";
  name: string;
  cwd?: string;
}): Promise<string> {
  if (!validateAgentIdentifier(params.name)) {
    throw new Error(`Invalid agent identifier: "${params.name}"`);
  }

  let dir: string;
  if (params.scope === "user") {
    dir = getUserAgentsDir();
  } else {
    const cwd = params.cwd || process.cwd();
    const roots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, roots)) {
      throw new Error(`Access denied to project path: ${cwd}`);
    }
    const projectAgents = findProjectAgentsDir(cwd);
    if (!projectAgents) {
      // Create .omp/agents in resolved cwd
      dir = path.join(path.resolve(cwd), ".omp", "agents");
    } else {
      dir = projectAgents;
    }
  }

  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, `${params.name}.md`);
}

function serializeAgentMarkdown(params: {
  name: string;
  description: string;
  tools?: string[];
  model?: string | string[];
  thinkingLevel?: string;
  prewalk?: boolean | string;
  advisor?: boolean | string;
  systemPrompt?: string;
  [key: string]: unknown;
}): string {
  const frontmatterObj: Record<string, unknown> = {
    name: params.name,
    description: params.description,
  };

  if (params.tools && params.tools.length > 0) frontmatterObj.tools = params.tools;
  if (params.model !== undefined) frontmatterObj.model = params.model;
  if (params.thinkingLevel !== undefined) frontmatterObj.thinkingLevel = params.thinkingLevel;
  if (params.prewalk !== undefined) frontmatterObj.prewalk = params.prewalk;
  if (params.advisor !== undefined) frontmatterObj.advisor = params.advisor;

  // Preserve any extra frontmatter keys
  for (const [k, v] of Object.entries(params)) {
    if (k !== "name" && k !== "description" && k !== "tools" && k !== "model" && k !== "thinkingLevel" && k !== "prewalk" && k !== "advisor" && k !== "systemPrompt" && v !== undefined) {
      frontmatterObj[k] = v;
    }
  }

  const yamlText = stringify(frontmatterObj).trim();

  const body = (params.systemPrompt || "").trim();
  return `---\n${yamlText}\n---\n\n${body}\n`;
}

export async function createAgent(params: {
  scope: "user" | "project";
  name: string;
  description: string;
  tools?: string[];
  model?: string | string[];
  thinkingLevel?: string;
  prewalk?: boolean | string;
  advisor?: boolean | string;
  systemPrompt: string;
  cwd?: string;
}): Promise<string> {
  const targetPath = await resolveTargetFilePath(params);
  if (existsSync(targetPath)) {
    throw new Error(`Agent "${params.name}" already exists in ${params.scope} scope`);
  }

  const content = serializeAgentMarkdown(params);
  const tempPath = `${targetPath}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content, { encoding: "utf8", mode: 0o600 });
  await fs.rename(tempPath, targetPath);
  return targetPath;
}

export async function updateAgent(params: {
  scope: "user" | "project";
  name: string;
  description?: string;
  tools?: string[];
  model?: string | string[];
  thinkingLevel?: string;
  prewalk?: boolean | string;
  advisor?: boolean | string;
  systemPrompt?: string;
  cwd?: string;
}): Promise<string> {
  const targetPath = await resolveTargetFilePath(params);
  if (!existsSync(targetPath)) {
    throw new Error(`Agent "${params.name}" not found in ${params.scope} scope`);
  }

  const existingContent = await fs.readFile(targetPath, "utf8");
  const parsed = parseAgentFile(existingContent, targetPath, params.scope);

  const updatedContent = serializeAgentMarkdown({
    ...parsed,
    name: params.name,
    description: params.description ?? parsed.description,
    tools: params.tools ?? parsed.tools,
    model: params.model ?? parsed.model,
    thinkingLevel: params.thinkingLevel ?? parsed.thinkingLevel,
    prewalk: params.prewalk ?? parsed.prewalk,
    advisor: params.advisor ?? parsed.advisor,
    systemPrompt: params.systemPrompt ?? parsed.systemPrompt,
  });

  const tempPath = `${targetPath}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, updatedContent, { encoding: "utf8", mode: 0o600 });
  await fs.rename(tempPath, targetPath);
  return targetPath;
}

export async function deleteAgent(params: {
  scope: "user" | "project";
  name: string;
  cwd?: string;
}): Promise<void> {
  const targetPath = await resolveTargetFilePath(params);
  if (!existsSync(targetPath)) {
    throw new Error(`Agent "${params.name}" not found in ${params.scope} scope`);
  }

  await fs.unlink(targetPath);
}

export async function unpackBundledAgents(params: {
  scope: "user" | "project";
  cwd?: string;
  force?: boolean;
}): Promise<{ targetDir: string; count: number }> {
  let targetDir: string;
  if (params.scope === "user") {
    targetDir = getUserAgentsDir();
  } else {
    const cwd = params.cwd || process.cwd();
    const roots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, roots)) {
      throw new Error(`Access denied to project path: ${cwd}`);
    }
    const projectAgents = findProjectAgentsDir(cwd);
    targetDir = projectAgents || path.join(path.resolve(cwd), ".omp", "agents");
  }

  await fs.mkdir(targetDir, { recursive: true });

  let count = 0;
  for (const [name, def] of Object.entries(BUNDLED_CATALOG)) {
    const targetFile = path.join(targetDir, `${name}.md`);
    if (!params.force && existsSync(targetFile)) {
      continue;
    }

    const content = serializeAgentMarkdown({
      name,
      description: def.description || "",
      tools: def.tools,
      systemPrompt: def.systemPrompt || "",
    });

    const tempFile = `${targetFile}.${Date.now()}.tmp`;
    await fs.writeFile(tempFile, content, { encoding: "utf8", mode: 0o600 });
    await fs.rename(tempFile, targetFile);
    count++;
  }

  return { targetDir, count };
}
