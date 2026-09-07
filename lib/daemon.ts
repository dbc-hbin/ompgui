import { execFile } from "node:child_process";
import { access, readFile, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, dirname, join, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { parseDaemonStatus, type DaemonAction, type DaemonStatus } from "./daemon-types";

const execFileAsync = promisify(execFile);

async function resolveInstalledCli(): Promise<string | null> {
  const candidates = [
    ...(process.env.OMPGUI_PACKAGE_DIR ? [join(process.env.OMPGUI_PACKAGE_DIR, "bin/ompgui.js")] : []),
    ...(process.env.PATH ?? "").split(delimiter).filter(isAbsolute).map((directory) => join(directory, "ompgui")),
    "/opt/homebrew/bin/ompgui", "/usr/local/bin/ompgui",
  ];
  for (const candidate of new Set(candidates)) {
    try {
      const cli = await realpath(candidate);
      const root = dirname(dirname(cli));
      // Only a published, built package is eligible. Never install a development checkout.
      if (!root.includes(`${delimiter === ";" ? "\\" : "/"}node_modules/ompgui`)) continue;
      const pkg: unknown = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
      if (typeof pkg !== "object" || pkg === null || !("name" in pkg) || pkg.name !== "ompgui") continue;
      await access(join(root, ".next/BUILD_ID"), constants.R_OK);
      await access(join(root, "bin/ompgui-service.js"), constants.R_OK);
      let directory = root;
      let checkout = false;
      while (true) {
        try { await access(join(directory, ".git")); checkout = true; break; } catch {}
        const parent = dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
      if (!checkout) return cli;
    } catch {}
  }
  return null;
}

export async function daemonCommand(action: DaemonAction | "status"): Promise<DaemonStatus> {
  const empty: DaemonStatus = { supported: process.platform === "darwin", installed: false, running: false, autoStart: false, label: "com.hanbinnoh.ompgui", pid: null, logPath: null, cliAvailable: false };
  if (!empty.supported) return empty;
  const cli = await resolveInstalledCli();
  if (!cli) return { ...empty, error: "Install or update the published CLI: npm install -g ompgui@latest" };
  const args = [cli, "service", action, "--json"];
  if (action === "stop" || action === "restart" || action === "uninstall") args.push("--defer");
  try {
    const { stdout } = await execFileAsync(process.execPath, args, { timeout: 15_000, maxBuffer: 64 * 1024, windowsHide: true });
    return { ...parseDaemonStatus(JSON.parse(stdout)), cliAvailable: true };
  } catch (error) {
    if (typeof error === "object" && error !== null && "stdout" in error && typeof error.stdout === "string" && error.stdout.trim()) {
      return { ...parseDaemonStatus(JSON.parse(error.stdout)), cliAvailable: true };
    }
    throw new Error("Unable to communicate with the installed ompgui service CLI");
  }
}
