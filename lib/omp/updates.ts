import { runOmpCli } from "./omp-cli";

export interface OmpUpdateStatus {
  currentVersion: string | null;
  availableVersion: string | null;
  updateAvailable: boolean;
  updateCommand: string;
}

function runOmpUpdate(args: string[]): Promise<string> {
  return runOmpCli(["update", ...args], { timeout: 300_000, maxBuffer: 1024 * 1024 }).then(
    ({ stdout, stderr }) => `${stdout}\n${stderr}`.trim(),
  );
}

export function parseOmpUpdateStatus(output: string): OmpUpdateStatus {
  const currentVersion = output.match(/^Current version:\s*(\S+)/mi)?.[1] ?? null;
  const availableVersion = output.match(/^New version available:\s*(\S+)/mi)?.[1] ?? null;
  return {
    currentVersion,
    availableVersion,
    updateAvailable: availableVersion !== null,
    updateCommand: "omp update",
  };
}

export async function checkOmpUpdate(): Promise<OmpUpdateStatus> {
  return parseOmpUpdateStatus(await runOmpUpdate(["--check"]));
}

