export type DaemonAction = "install" | "uninstall" | "enable" | "disable" | "start" | "stop" | "restart";

export type DaemonStatus = {
  supported: boolean;
  installed: boolean;
  running: boolean;
  autoStart: boolean;
  label: string;
  pid: number | null;
  logPath: string | null;
  error?: string;
  accepted?: boolean;
  cliAvailable?: boolean;
};

export function parseDaemonStatus(value: unknown): DaemonStatus {
  if (typeof value !== "object" || value === null ||
    !("supported" in value) || typeof value.supported !== "boolean" ||
    !("installed" in value) || typeof value.installed !== "boolean" ||
    !("running" in value) || typeof value.running !== "boolean" ||
    !("autoStart" in value) || typeof value.autoStart !== "boolean" ||
    !("label" in value) || typeof value.label !== "string" ||
    !("pid" in value) || (value.pid !== null && (typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid <= 0)) ||
    !("logPath" in value) || (value.logPath !== null && typeof value.logPath !== "string")) {
    throw new Error("Invalid daemon status response");
  }
  return {
    supported: value.supported, installed: value.installed, running: value.running,
    autoStart: value.autoStart, label: value.label, pid: value.pid, logPath: value.logPath,
    ...("error" in value && typeof value.error === "string" ? { error: value.error } : {}),
    ...("accepted" in value && value.accepted === true ? { accepted: true } : {}),
    ...("cliAvailable" in value && typeof value.cliAvailable === "boolean" ? { cliAvailable: value.cliAvailable } : {}),
  };
}
