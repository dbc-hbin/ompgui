export interface SkillSearchResult {
  package: string;
  installs: string;
  url: string;
}

export type SkillInstallScope = "global" | "project";

export interface SkillInstallInfo {
  package: string;
  scope: SkillInstallScope;
  source: string;
  sourceType?: string;
  skillsShUrl?: string;
  skillPath?: string;
  ref?: string;
  versionHash?: string;
  canCheckForUpdates: boolean;
}

export type SkillUpdateState =
  | "up-to-date"
  | "update-available"
  | "unsupported"
  | "error";

export interface SkillUpdateResult {
  package: string;
  scope: SkillInstallScope;
  state: SkillUpdateState;
  currentVersion?: string;
  latestVersion?: string;
  message?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  sourceInfo: {
    source?: string;
    scope?: string;
  };
  install?: SkillInstallInfo;
}

export type PluginScope = "global" | "project";
export type PluginResourceKind = "extension" | "skill" | "prompt" | "theme";

export interface PluginResourceCounts {
  extensions: number;
  skills: number;
  prompts: number;
  themes: number;
}

export interface PluginDiagnostic {
  type: "warning" | "error";
  message: string;
  source?: string;
  path?: string;
}

export interface PluginResourceInfo {
  kind: PluginResourceKind;
  name: string;
  path: string;
  relativePath: string;
}

export interface PluginPackageInfo {
  source: string;
  scope: PluginScope;
  filtered: boolean;
  disabled: boolean;
  installedPath?: string;
  packageName?: string;
  version?: string;
  configuredVersion?: string;
  counts: PluginResourceCounts;
  resources: PluginResourceInfo[];
  status: "loaded" | "installed" | "missing" | "disabled";
}

export interface PluginsResponse {
  packages: PluginPackageInfo[];
  totals: PluginResourceCounts;
  diagnostics: PluginDiagnostic[];
}

// mirrored from oh-my-pi packages/ai/src/usage.ts + coding-agent usage-cli

export type UsageUnit =
  | "percent"
  | "tokens"
  | "requests"
  | "usd"
  | "minutes"
  | "bytes"
  | "unknown";

export type UsageStatus = "ok" | "warning" | "exhausted" | "unknown";

export interface UsageWindow {
  id: string;
  label: string;
  durationMs?: number;
  resetsAt?: number;
  resetLabel?: string;
}

export interface UsageAmount {
  used?: number;
  limit?: number;
  remaining?: number;
  usedFraction?: number;
  remainingFraction?: number;
  unit: UsageUnit;
}

export interface UsageScope {
  provider: string;
  accountId?: string;
  projectId?: string;
  orgId?: string;
  modelId?: string;
  tier?: string;
  windowId?: string;
  shared?: boolean;
}

export interface UsageLimit {
  id: string;
  label: string;
  scope: UsageScope;
  window?: UsageWindow;
  amount: UsageAmount;
  status?: UsageStatus;
  notes?: string[];
}

export interface UsageResetCreditDetail {
  grantedAt?: string;
  expiresAt?: string;
  status?: string;
}

export interface UsageResetCredits {
  availableCount: number;
  credits?: UsageResetCreditDetail[];
}

export interface UsageReport {
  provider: string;
  fetchedAt: number;
  limits: UsageLimit[];
  resetCredits?: UsageResetCredits;
  notes?: string[];
  metadata?: Record<string, unknown>;
}

export interface UsageAccountIdentity {
  provider: string;
  type: "api_key" | "oauth";
  email?: string;
  accountId?: string;
  projectId?: string;
  enterpriseUrl?: string;
  orgId?: string;
  orgName?: string;
  authorizedAt?: number;
}

export interface DisabledCredentialSummary {
  id: number;
  provider: string;
  type: "api_key" | "oauth" | string;
  email?: string;
  accountId?: string;
  orgId?: string;
  orgName?: string;
  cause: string;
  disabledAtMs?: number;
}

export interface ProviderWindowStat {
  window: string;
  durationMs?: number;
  accounts: number;
  usedAccounts: number;
  remainingAccounts: number;
}

export interface UsageResponse {
  generatedAt: number;
  reports: UsageReport[];
  accountsWithoutUsage: UsageAccountIdentity[];
  disabledCredentials: DisabledCredentialSummary[];
  capacity: Record<string, ProviderWindowStat[]>;
  cached: boolean;
  emptyReason?: "no-credentials" | "no-usage-endpoint";
}
