import { randomUUID } from "node:crypto";
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readSync, realpathSync, renameSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "../file-access";
import { inspectUploadTargets, parseUploadConflictStrategy, validateUploadFileNames } from "../file-upload";
import type { UploadConflictStrategy } from "../file-upload";
import type { RelayRequestHandler } from "./request-types";
import { RelaySessionError } from "./session-runtime";
import { assertAllowedPath, gitRelayDiff, gitRelayStatus, listRelayFiles, readRelayFile, readRelayFileChunk, relayContentHash, relayFileMeta, relayFileRevision, searchRelayFileIndex, writeRelayFile } from "./workspace";

export const FILES_REQUEST_ACTIONS = ["list", "search", "meta", "read", "readChunk", "write", "gitStatus", "gitDiff", "uploadBegin", "uploadChunk", "uploadComplete", "uploadAbort", "downloadBegin", "downloadChunk", "downloadClose"] as const;
const CHUNK_BYTES = 128 * 1024;
const TTL_MS = 5 * 60 * 1000;
interface TransferBase {
  deviceId: string;
  expiresAt: number;
  timer: NodeJS.Timeout;
  path: string;
  size: number;
}
interface Upload extends TransferBase {
  kind: "upload";
  directory: string;
  name: string;
  temp: string;
  fd: number;
  received: number;
  conflict: UploadConflictStrategy;
}
interface Download extends TransferBase {
  kind: "download";
  revision: string;
}
const transfers = new Map<string, Upload | Download>();

function disposeTransfer(id: string): void {
  const transfer = transfers.get(id);
  if (!transfer) return;
  transfers.delete(id);
  clearTimeout(transfer.timer);
  if (transfer.kind === "upload") {
    try {
      if (transfer.fd >= 0) closeSync(transfer.fd);
    } finally {
      transfer.fd = -1;
      try { unlinkSync(transfer.temp); } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
    }
  }
}

export function cleanupRelayFileTransfers(deviceId?: string): void {
  for (const [id, transfer] of transfers) {
    if (deviceId === undefined || transfer.deviceId === deviceId) disposeTransfer(id);
  }
}

function stringArg(args: Record<string, unknown>, key: string): string;
function stringArg(args: Record<string, unknown>, key: string, optional: true): string | undefined;
function stringArg(args: Record<string, unknown>, key: string, optional = false): string | undefined {
  const value = args[key];
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || (key !== "text" && key !== "query" && key !== "data" && value.length === 0) || value.includes("\0")) {
    throw new RelaySessionError("invalid_args", `Invalid ${key}`);
  }
  return value;
}

function integerArg(args: Record<string, unknown>, key: string, optional = false, max = Number.MAX_SAFE_INTEGER): number | undefined {
  const value = args[key];
  if (value === undefined && optional) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) throw new RelaySessionError("invalid_args", `Invalid ${key}`);
  return value;
}

function ownedTransfer(id: string, deviceId: string, kind: "upload" | "download"): Upload | Download {
  const transfer = transfers.get(id);
  if (!transfer || transfer.deviceId !== deviceId || transfer.kind !== kind) throw new RelaySessionError("transfer_not_found", "File transfer not found");
  if (Date.now() >= transfer.expiresAt) {
    disposeTransfer(id);
    throw new RelaySessionError("transfer_expired", "File transfer expired");
  }
  return transfer;
}

async function uploadTarget(directory: string, name: string): Promise<string> {
  const roots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(directory, roots)) throw new RelaySessionError("path_not_allowed", "Upload directory is not allowed");
  const resolved = realpathSync(directory);
  if (resolved !== directory || !lstatSync(resolved).isDirectory()) throw new RelaySessionError("path_not_allowed", "Upload directory changed");
  const destination = path.join(resolved, name);
  // A validated basename beneath an authorized real parent is authorized even
  // when the configured root itself is a symlink to that parent.
  const inspection = inspectUploadTargets(resolved, [name]);
  if (inspection.nonReplaceable.length) throw new RelaySessionError("invalid_target", "Upload destination must be a regular file, not a directory or symlink");
  if (inspection.conflicts.length && !isExistingFilePathAllowed(destination, roots)) throw new RelaySessionError("path_not_allowed", "Upload destination is not allowed");
  return destination;
}

export const handleFilesRequest: RelayRequestHandler = async (action, args, context) => {
  switch (action) {
    case "list": return { ...await listRelayFiles(stringArg(args, "path", true), integerArg(args, "offset", true), integerArg(args, "limit", true)) };
    case "search": return { ...await searchRelayFileIndex(stringArg(args, "cwd"), stringArg(args, "query"), integerArg(args, "offset", true), integerArg(args, "limit", true)) };
    case "meta": return { ...await relayFileMeta(stringArg(args, "path")) };
    case "read": return { ...await readRelayFile(stringArg(args, "path")) };
    case "readChunk": return { ...await readRelayFileChunk(stringArg(args, "path"), stringArg(args, "revision"), integerArg(args, "offset")!, integerArg(args, "length", true, CHUNK_BYTES)) };
    case "write": {
      if (args.createIfMissing !== undefined && typeof args.createIfMissing !== "boolean") throw new RelaySessionError("invalid_args", "Invalid createIfMissing");
      return { ...await writeRelayFile(stringArg(args, "path"), stringArg(args, "text"), stringArg(args, "revision", true), stringArg(args, "baseContentHash", true), args.createIfMissing) };
    }
    case "gitStatus": return { ...await gitRelayStatus(stringArg(args, "cwd"), integerArg(args, "offset", true), integerArg(args, "limit", true)) };
    case "gitDiff": return { ...await gitRelayDiff(stringArg(args, "cwd"), stringArg(args, "path")) };
    case "uploadBegin": {
      const name = stringArg(args, "file");
      if (validateUploadFileNames([name])) throw new RelaySessionError("invalid_args", "Invalid upload file name");
      const size = integerArg(args, "size", false, 25 * 1024 * 1024)!;
      const conflict = parseUploadConflictStrategy(stringArg(args, "conflict", true) ?? null);
      if (!conflict) throw new RelaySessionError("invalid_args", "Invalid conflict strategy");
      const directory = realpathSync(await assertAllowedPath(stringArg(args, "dir")));
      const destination = await uploadTarget(directory, name);
      const inspection = inspectUploadTargets(directory, [name]);
      if (inspection.conflicts.length && conflict !== "overwrite") {
        if (conflict === "skip") return { skipped: true, path: destination, name, bytes: size };
        throw Object.assign(new RelaySessionError("upload_conflict", "Upload destination already exists"), { details: { conflicts: [name] } });
      }
      const id = randomUUID();
      const temp = path.join(directory, `.relay-upload-${randomUUID()}.tmp`);
      const fd = openSync(temp, "wx", 0o600);
      const expiresAt = Date.now() + TTL_MS;
      const timer = setTimeout(() => { disposeTransfer(id); }, TTL_MS);
      timer.unref();
      transfers.set(id, { kind: "upload", deviceId: context.deviceId, expiresAt, timer, path: destination, directory, name, temp, fd, size, received: 0, conflict });
      return { transferId: id, path: destination, name, bytes: size, size, chunkSize: CHUNK_BYTES, expiresAt };
    }
    case "uploadChunk":
    case "uploadComplete":
    case "uploadAbort": {
      const id = stringArg(args, "transferId");
      const transfer = ownedTransfer(id, context.deviceId, "upload");
      if (transfer.kind !== "upload") throw new RelaySessionError("transfer_not_found", "Upload not found");
      try {
        if (action === "uploadAbort") { disposeTransfer(id); return { aborted: true }; }
        if (action === "uploadChunk") {
          const offset = integerArg(args, "offset")!;
          const data = stringArg(args, "data");
          if (offset !== transfer.received) throw new RelaySessionError("invalid_offset", "Upload chunks must be sequential");
          if (data.length > 4 * Math.ceil(CHUNK_BYTES / 3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new RelaySessionError("invalid_chunk", "Invalid base64 upload chunk");
          const bytes = Buffer.from(data, "base64");
          if (bytes.toString("base64") !== data || bytes.length === 0 || bytes.length > CHUNK_BYTES || transfer.received + bytes.length > transfer.size) throw new RelaySessionError("invalid_chunk", "Invalid upload chunk size or encoding");
          let written = 0;
          while (written < bytes.length) {
            const count = writeSync(transfer.fd, bytes, written, bytes.length - written, transfer.received + written);
            if (count === 0) throw new RelaySessionError("upload_failed", "Upload write made no progress");
            written += count;
          }
          transfer.received += written;
          return { transferId: id, received: transfer.received, nextOffset: transfer.received, complete: transfer.received === transfer.size };
        }
        if (transfer.received !== transfer.size) throw new RelaySessionError("size_mismatch", "Upload is incomplete");
        const hash = stringArg(args, "sha256", true);
        if (hash !== undefined && (!/^[a-fA-F0-9]{64}$/.test(hash) || relayContentHash(transfer.temp).toLowerCase() !== hash.toLowerCase())) throw new RelaySessionError("hash_mismatch", "Upload checksum mismatch");
        await uploadTarget(transfer.directory, transfer.name);
        ownedTransfer(id, context.deviceId, "upload");
        const inspection = inspectUploadTargets(transfer.directory, [transfer.name]);
        if (inspection.conflicts.length && transfer.conflict !== "overwrite") {
          if (transfer.conflict === "skip") { disposeTransfer(id); return { skipped: true, path: transfer.path, name: transfer.name, bytes: transfer.size }; }
          throw Object.assign(new RelaySessionError("upload_conflict", "Upload destination already exists"), { details: { conflicts: [transfer.name] } });
        }
        if (inspection.conflicts.length) fchmodSync(transfer.fd, lstatSync(transfer.path).mode & 0o7777);
        fsyncSync(transfer.fd);
        closeSync(transfer.fd);
        transfer.fd = -1;
        if (inspection.conflicts.length && transfer.conflict === "overwrite") {
          renameSync(transfer.temp, transfer.path);
        } else {
          try {
            linkSync(transfer.temp, transfer.path);
          } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "EEXIST") {
              const lateInspection = inspectUploadTargets(transfer.directory, [transfer.name]);
              if (lateInspection.nonReplaceable.length) throw new RelaySessionError("invalid_target", "Upload destination must be a regular file, not a directory or symlink");
              if (transfer.conflict === "skip") {
                disposeTransfer(id);
                return { skipped: true, path: transfer.path, name: transfer.name, bytes: transfer.size };
              }
              throw Object.assign(new RelaySessionError("upload_conflict", "Upload destination already exists"), { details: { conflicts: [transfer.name] } });
            }
            throw error;
          }
          unlinkSync(transfer.temp);
        }
        const directoryFd = openSync(transfer.directory, constants.O_RDONLY);
        try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
        disposeTransfer(id);
        return { path: transfer.path, name: transfer.name, bytes: transfer.size, revision: relayFileRevision(transfer.path), contentHash: relayContentHash(transfer.path) };
      } catch (error) {
        disposeTransfer(id);
        if (error instanceof RelaySessionError) throw error;
        throw new RelaySessionError("upload_failed", "File upload failed");
      }
    }
    case "downloadBegin": {
      const target = await assertAllowedPath(stringArg(args, "path"));
      const meta = await relayFileMeta(target);
      if (meta.kind !== "file") throw new RelaySessionError("invalid_target", "Download target must be a file");
      if (meta.size > 100 * 1024 * 1024) throw new RelaySessionError("file_too_large", "Download exceeds 100 MiB");
      const id = randomUUID();
      const expiresAt = Date.now() + TTL_MS;
      const timer = setTimeout(() => { disposeTransfer(id); }, TTL_MS);
      timer.unref();
      transfers.set(id, { kind: "download", deviceId: context.deviceId, expiresAt, timer, path: target, size: meta.size, revision: meta.revision });
      return { ...meta, transferId: id, bytes: meta.size, chunkSize: CHUNK_BYTES, expiresAt };
    }
    case "downloadChunk":
    case "downloadClose": {
      const id = stringArg(args, "transferId");
      const transfer = ownedTransfer(id, context.deviceId, "download");
      if (transfer.kind !== "download") throw new RelaySessionError("transfer_not_found", "Download not found");
      try {
        if (action === "downloadClose") { disposeTransfer(id); return { closed: true }; }
        const offset = integerArg(args, "offset")!;
        const length = integerArg(args, "length", true, CHUNK_BYTES) ?? CHUNK_BYTES;
        if (length === 0 || offset > transfer.size) throw new RelaySessionError("invalid_offset", "Invalid download range");
        await assertAllowedPath(transfer.path);
        ownedTransfer(id, context.deviceId, "download");
        if (relayFileRevision(transfer.path) !== transfer.revision) throw new RelaySessionError("stale_revision", "Download file changed");
        const fd = openSync(transfer.path, constants.O_RDONLY | constants.O_NOFOLLOW);
        let bytes: Buffer;
        try {
          if (!fstatSync(fd).isFile()) throw new RelaySessionError("invalid_target", "Download target must be a file");
          bytes = Buffer.alloc(Math.min(length, transfer.size - offset));
          let received = 0;
          while (received < bytes.length) {
            const count = readSync(fd, bytes, received, bytes.length - received, offset + received);
            if (!count) throw new RelaySessionError("stale_revision", "Download file changed");
            received += count;
          }
          const current = fstatSync(fd);
          const target = lstatSync(transfer.path);
          if (current.dev !== target.dev || current.ino !== target.ino || current.size !== transfer.size || relayFileRevision(transfer.path) !== transfer.revision) throw new RelaySessionError("stale_revision", "Download file changed");
        } finally { closeSync(fd); }
        const nextOffset = offset + bytes.length;
        return { transferId: id, path: transfer.path, revision: transfer.revision, offset, data: bytes.toString("base64"), nextOffset, complete: nextOffset === transfer.size };
      } catch (error) {
        disposeTransfer(id);
        if (error instanceof RelaySessionError) throw error;
        throw new RelaySessionError("download_failed", "File download failed");
      }
    }
    default: throw new RelaySessionError("unknown_action", "Unknown files action");
  }
};
