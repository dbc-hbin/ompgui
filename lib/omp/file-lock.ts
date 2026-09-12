import { existsSync, lstatSync, realpathSync } from "node:fs";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import koffi from "koffi";
import xxhash from "xxhash-wasm";

const DEFAULT_ATTEMPTS = 50;
const DEFAULT_RETRY_DELAY_MS = 100;
const HIGH_SEED = BigInt("0x4f4d502d4c4f434b");
const LOW_SEED = BigInt("0x50492d46494c454c");

interface NativeLock {
  release(): void;
}

interface LockOptions {
  attempts: number;
  retryDelayMs: number;
  sleep(ms: number): Promise<void>;
}

type TryAcquire = () => NativeLock | null;

const hashApi = xxhash();

async function memoryLockName(lockPath: string): Promise<string> {
  const { h64 } = await hashApi;
  const high = h64(lockPath, HIGH_SEED).toString(16).padStart(16, "0");
  const low = h64(lockPath, LOW_SEED).toString(16).padStart(16, "0");
  return `omp-file-lock-${high}${low}`;
}

function nativeError(operation: string, code: number): Error {
  return new Error(`${operation} failed with native error ${code}`);
}

function loadLinuxLibc() {
  const namesByArch: Record<string, readonly string[]> = {
    arm: [
      "/lib/arm-linux-gnueabihf/libc.so.6",
      "/usr/lib/arm-linux-gnueabihf/libc.so.6",
      "/lib/libc.musl-armhf.so.1",
    ],
    arm64: [
      "/lib/aarch64-linux-gnu/libc.so.6",
      "/usr/lib/aarch64-linux-gnu/libc.so.6",
      "/lib64/libc.so.6",
      "/lib/libc.musl-aarch64.so.1",
    ],
    ia32: [
      "/lib/i386-linux-gnu/libc.so.6",
      "/usr/lib/i386-linux-gnu/libc.so.6",
      "/lib32/libc.so.6",
      "/lib/libc.musl-i386.so.1",
    ],
    loong64: [
      "/lib/loongarch64-linux-gnu/libc.so.6",
      "/usr/lib/loongarch64-linux-gnu/libc.so.6",
      "/lib64/libc.so.6",
      "/lib/libc.musl-loongarch64.so.1",
    ],
    riscv64: [
      "/lib/riscv64-linux-gnu/libc.so.6",
      "/usr/lib/riscv64-linux-gnu/libc.so.6",
      "/lib64/libc.so.6",
      "/lib/libc.musl-riscv64.so.1",
    ],
    x64: [
      "/lib/x86_64-linux-gnu/libc.so.6",
      "/usr/lib/x86_64-linux-gnu/libc.so.6",
      "/lib64/libc.so.6",
      "/lib/libc.musl-x86_64.so.1",
    ],
  };
  const libcPath = [
    ...(namesByArch[process.arch] ?? []),
    "/lib/libc.so.6",
    "/usr/lib/libc.so.6",
  ].find(existsSync);
  if (!libcPath) {
    throw new Error(`Native OMP file locks do not support Linux ${process.arch} without a trusted libc path`);
  }
  return koffi.load(libcPath);
}

async function prepareLinuxLock(lockPath: string): Promise<TryAcquire> {
  const libc = loadLinuxLibc();
  const socket = libc.func("int socket(int domain, int type, int protocol)") as (
    domain: number,
    type: number,
    protocol: number,
  ) => number;
  const bind = libc.func("int bind(int socket, const void *address, uint32_t address_len)") as (
    socket: number,
    address: Buffer,
    addressLength: number,
  ) => number;
  const close = libc.func("int close(int fd)") as (fd: number) => number;
  const name = await memoryLockName(lockPath);
  const nameBytes = Buffer.from(name, "utf8");
  const address = Buffer.alloc(3 + nameBytes.length);
  address.writeUInt16LE(1, 0);
  nameBytes.copy(address, 3);

  return () => {
    const fd = socket(1, 2 | 0x8_0000, 0);
    if (fd < 0) throw nativeError("socket", koffi.errno());

    if (bind(fd, address, address.length) === 0) {
      return {
        release() {
          if (close(fd) !== 0) throw nativeError("close", koffi.errno());
        },
      };
    }

    const bindError = koffi.errno();
    if (close(fd) !== 0) throw nativeError("close", koffi.errno());
    if (bindError === koffi.os.errno.EADDRINUSE) return null;
    throw nativeError("bind", bindError);
  };
}

function prepareDarwinLock(lockPath: string): TryAcquire {
  const libc = koffi.load("/usr/lib/libSystem.B.dylib");
  const open = libc.func("int open(const char *path, int flags, ...)") as (
    lockPath: string,
    flags: number,
    modeType: "uint",
    mode: number,
  ) => number;
  const flock = libc.func("int flock(int fd, int operation)") as (
    fd: number,
    operation: number,
  ) => number;
  const close = libc.func("int close(int fd)") as (fd: number) => number;

  return () => {
    const fd = open(lockPath, 2 | 0x200 | 0x100_0000, "uint", 0o600);
    if (fd < 0) throw nativeError("open", koffi.errno());

    if (flock(fd, 2 | 4) === 0) {
      return {
        release() {
          if (close(fd) !== 0) throw nativeError("close", koffi.errno());
        },
      };
    }

    const flockError = koffi.errno();
    if (close(fd) !== 0) throw nativeError("close", koffi.errno());
    if (flockError === koffi.os.errno.EWOULDBLOCK || flockError === koffi.os.errno.EAGAIN) return null;
    throw nativeError("flock", flockError);
  };
}

async function prepareWindowsLock(lockPath: string): Promise<TryAcquire> {
  const kernel32 = koffi.load("kernel32.dll");
  const setLastError = kernel32.func("void __stdcall SetLastError(uint32_t code)") as (
    code: number,
  ) => void;
  const createMutex = kernel32.func(
    "void * __stdcall CreateMutexW(void *attributes, int initial_owner, str16 name)",
  ) as (attributes: null, initialOwner: number, name: string) => unknown | null;
  const getLastError = kernel32.func("uint32_t __stdcall GetLastError(void)") as () => number;
  const closeHandle = kernel32.func("int __stdcall CloseHandle(void *handle)") as (
    handle: unknown,
  ) => number;
  const name = `Global\\${await memoryLockName(lockPath)}`;

  return () => {
    setLastError(0);
    const handle = createMutex(null, 0, name);
    const createError = getLastError();
    if (handle === null) throw nativeError("CreateMutexW", createError);

    if (createError === 183) {
      if (closeHandle(handle) === 0) throw nativeError("CloseHandle", getLastError());
      return null;
    }

    return {
      release() {
        if (closeHandle(handle) === 0) throw nativeError("CloseHandle", getLastError());
      },
    };
  };
}

async function prepareLock(lockPath: string): Promise<TryAcquire> {
  if (process.platform === "linux") return prepareLinuxLock(lockPath);
  if (process.platform === "darwin") return prepareDarwinLock(lockPath);
  if (process.platform === "win32") return prepareWindowsLock(lockPath);
  throw new Error(`Native OMP file locks do not support ${process.platform}`);
}

async function withLock<T>(
  filePath: string,
  fn: () => T | Promise<T>,
  options: LockOptions,
): Promise<T> {
  const lockPath = `${path.resolve(filePath)}.lock`;
  const tryAcquire = await prepareLock(lockPath);

  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    const lock = tryAcquire();
    if (lock) {
      try {
        return await fn();
      } finally {
        lock.release();
      }
    }
    if (attempt + 1 < options.attempts) await options.sleep(options.retryDelayMs);
  }

  throw new Error(`Failed to acquire lock for ${filePath} after ${options.attempts} attempts`);
}

/** Match OMP's write and lock identity: only a symlink at the config leaf is
 * resolved; an absent or regular leaf keeps its lexical absolute path. */
export function resolveNativeConfigWritePath(filePath: string): string {
  const lexicalPath = path.resolve(filePath);
  let isSymlink: boolean;
  try {
    isSymlink = lstatSync(lexicalPath).isSymbolicLink();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return lexicalPath;
    throw error;
  }
  return isSymlink ? realpathSync(lexicalPath) : lexicalPath;
}

/** Run `fn` while holding OMP's cross-process native lock for `filePath`. */
export function withNativeConfigLock<T>(
  filePath: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  return withLock(filePath, fn, {
    attempts: DEFAULT_ATTEMPTS,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
    sleep: delay,
  });
}

/** Narrow test hooks for protocol vectors and deterministic retry control. */
export const __fileLockInternals = {
  memoryLockName,
  withLock,
};
