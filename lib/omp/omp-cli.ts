import { execFile } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { delimiter, join } from "path";

/**
 * Locating and probing the user's installed `omp` CLI. ompgui never embeds
 * the (Bun-only) @oh-my-pi SDK — every live-agent capability goes through the
 * omp binary, so its absence is a first-class, user-visible state.
 */

let cachedBin: string | null = null;
let binMissAt = 0;
let cachedVersion: string | null = null;
let versionMissAt = 0;

const BIN_NAME = process.platform === "win32" ? "omp.exe" : "omp";
const ANSI_RE = /\x1B\[[0-9;]*m/g;
// Only successes are cached for the process lifetime. omp may be installed (or
// PATH repaired) while the server runs; a permanently cached "not found" would
// keep the UI reporting a missing binary until restart.
const MISS_TTL_MS = 30_000;

function probeOmpBin(): string | null {
  const override = process.env.OMPGUI_OMP_BIN ?? process.env.OMP_WEB_OMP_BIN;
  if (override) return existsSync(override) ? override : null;
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, BIN_NAME);
    if (existsSync(candidate)) return candidate;
  }
  // GUI-launched processes often miss homebrew/bun dirs in PATH; probe the
  // usual install locations before giving up.
  const fallbackDirs = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(homedir(), ".bun", "bin"),
    join(homedir(), ".local", "bin"),
  ];
  for (const dir of fallbackDirs) {
    const candidate = join(dir, BIN_NAME);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Resolve the omp binary: OMP_WEB_OMP_BIN override, then PATH lookup. Returns
 * null when omp is not installed. A hit is cached until explicitly
 * invalidated; a miss is re-probed after MISS_TTL_MS. */
export function resolveOmpBin(): string | null {
  if (cachedBin) return cachedBin;
  if (Date.now() - binMissAt < MISS_TTL_MS) return null;
  const found = probeOmpBin();
  if (found) {
    cachedBin = found;
    binMissAt = 0;
    return found;
  }
  binMissAt = Date.now();
  return null;
}

/** Clear successful and failed probes before restarting OMP child processes
 * after an update. The next caller re-resolves the executable and version. */
export function invalidateOmpCliCache(): void {
  cachedBin = null;
  binMissAt = 0;
  cachedVersion = null;
  versionMissAt = 0;
}

/** `omp --version` output (e.g. "omp/17.1.3"), or null when unavailable.
 * Successes are reused until OMP sessions are explicitly restarted; failures
 * are retried after MISS_TTL_MS. */
export async function getOmpVersion(): Promise<string | null> {
  if (cachedVersion) return cachedVersion;
  if (Date.now() - versionMissAt < MISS_TTL_MS) return null;
  const bin = resolveOmpBin();
  if (!bin) {
    versionMissAt = Date.now();
    return null;
  }
  try {
    const output = await new Promise<string>((resolve, reject) => {
      execFile(bin, ["--version"], { timeout: 10_000, windowsHide: true }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
    const version = output.trim();
    if (version) {
      cachedVersion = version;
      versionMissAt = 0;
      return version;
    }
  } catch {
    // Fall through to the miss path: retry after the TTL.
  }
  versionMissAt = Date.now();
  return null;
}

/** Run `omp <args>` and return stdout+stderr with colors disabled. Shared by
 * plugins, updates, and usage so the exec surface (timeout, maxBuffer, env)
 * stays identical. Rejects with a trimmed ANSI-free detail on failure. */
export function runOmpCli(
  args: string[],
  opts: { cwd?: string; timeout?: number; maxBuffer?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  const bin = resolveOmpBin();
  if (!bin) {
    return Promise.reject(new Error("omp binary not found. Install oh-my-pi or set OMP_WEB_OMP_BIN."));
  }
  const { promise, resolve, reject } = Promise.withResolvers<{
    stdout: string;
    stderr: string;
  }>();
  execFile(
    bin,
    args,
    {
      cwd: opts.cwd,
      timeout: opts.timeout ?? 60_000,
      maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      windowsHide: true,
    },
    (error, stdout, stderr) => {
      if (error) {
        const detail = (stderr || stdout || error.message).replace(ANSI_RE, "").trim();
        reject(new Error(detail.slice(-600) || `omp ${args.join(" ")} failed`));
      } else {
        resolve({ stdout, stderr });
      }
    },
  );
  return promise;
}

/** Parse `--json` stdout, tolerating stray non-JSON lines before the payload. */
export function parseOmpJsonStdout<T>(stdout: string): T | null {
  const cleaned = stdout.replace(ANSI_RE, "");
  const start = cleaned.search(/[{[]/);
  if (start < 0) return null;
  try {
    return JSON.parse(cleaned.slice(start)) as T;
  } catch {
    return null;
  }
}
