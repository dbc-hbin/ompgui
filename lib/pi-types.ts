// Local mirrors of the omp shapes used by omp-web. omp's SDK packages are
// Bun-only, so these types are hand-maintained against
// oh-my-pi/packages/coding-agent/src/modes/rpc/rpc-types.ts (protocol v1).

export interface ContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

export interface ModelLike {
  id: string;
  provider: string;
}

/** Subset of omp's Model (pi-ai) that the web UI reads; extra fields pass through. */
export interface OmpModel {
  id: string;
  provider: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  input?: string[];
  thinking?: {
    mode?: string;
    efforts?: string[];
    requiresEffort?: boolean;
    defaultLevel?: string;
  };
  [key: string]: unknown;
}

export interface TodoItem {
  id?: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "blocked" | "abandoned";
  blocker?: string;
}

export interface TodoPhase {
  id?: string;
  name: string;
  tasks: TodoItem[];
}

/** Mirror of omp's RpcSessionState (the raw `get_state` payload). */
export interface RpcSessionState {
  model?: OmpModel;
  thinkingLevel: string | undefined;
  isStreaming: boolean;
  isCompacting: boolean;
  steeringMode: "all" | "one-at-a-time";
  followUpMode: "all" | "one-at-a-time";
  interruptMode: "immediate" | "wait";
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
  autoCompactionEnabled: boolean;
  autoRetryEnabled?: boolean;
  messageCount: number;
  queuedMessageCount: number;
  todoPhases: TodoPhase[];
  systemPrompt?: string[];
  contextUsage?: { tokens: number; contextWindow: number; percent: number };
  fastMode?: boolean;
  fastModeEnabled?: boolean;
  fastModeActive?: boolean;
}

/**
 * The state shape omp-web's own API returns to the browser
 * (AgentSessionWrapper adapts RpcSessionState and adds process-side flags).
 */
export interface WebSessionState {
  sessionId: string;
  sessionFile: string;
  sessionName?: string;
  isStreaming: boolean;
  isPromptRunning: boolean;
  isBashRunning: boolean;
  isCompacting: boolean;
  autoCompactionEnabled: boolean;
  interruptMode: "immediate" | "wait";
  steeringMode: "all" | "one-at-a-time";
  followUpMode: "all" | "one-at-a-time";
  model?: ModelLike & { name?: string; reasoning?: boolean; thinking?: { efforts?: string[] } };
  messageCount: number;
  queuedMessageCount: number;
  contextUsage: ContextUsage | null;
  systemPrompt: string;
  thinkingLevel: string;
  fastModeEnabled: boolean;
  fastModeActive?: boolean;
  autoRetryEnabled?: boolean;
  todoPhases: TodoPhase[];
  extensionStatuses: Array<{ key: string; text: string }>;
  extensionWidgets: Array<{ key: string; lines: string[]; placement: "aboveEditor" | "belowEditor" }>;
}

export type AvailableSlashCommandSource =
  | "builtin"
  | "skill"
  | "extension"
  | "custom"
  | "mcp_prompt"
  | "file";

/** Mirror of omp's RpcAvailableSlashCommand (`get_available_commands`). */
export interface RpcAvailableSlashCommand {
  name: string;
  aliases?: string[];
  description?: string;
  input?: { hint?: string };
  subcommands?: Array<{ name: string; description?: string; usage?: string }>;
  source: AvailableSlashCommandSource;
}

/** Mirror of omp's BashResult (`bash` command response). */
export interface BashResultInfo {
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  timedOut?: boolean;
  truncated: boolean;
  totalLines?: number;
  totalBytes?: number;
  outputLines?: number;
  outputBytes?: number;
  artifactId?: string;
  workingDir?: string;
}

export interface SessionStatsInfo {
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    reasoning?: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  premiumRequests?: number;
  cost: number;
  contextUsage?: ContextUsage;
}

/**
 * omp's RPC host-tool bridge: omp-web registers host tools (set_host_tools)
 * that the agent can call; the server emits host_tool_call frames the UI
 * executes, and the UI answers with host_tool_result. Mirrors
 * oh-my-pi modes/rpc/rpc-types.ts.
 */
export interface HostToolDefinition {
  name: string;
  label?: string;
  description: string;
  parameters: Record<string, unknown>;
  hidden?: boolean;
  loadMode?: "always" | "discoverable" | "explicit";
}

/**
 * omp's RPC host-URI bridge: the host registers URL schemes
 * (set_host_uri_schemes) that the agent's read/write tools resolve through
 * the UI; the server emits host_uri_request frames the UI satisfies with
 * host_uri_result. Mirrors oh-my-pi modes/rpc/rpc-types.ts.
 */
export interface HostUriSchemeDefinition {
  scheme: string;
  description?: string;
  writable?: boolean;
  immutable?: boolean;
}
