import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-utils";
import { FilePreviewError, previewDocxFile } from "@/lib/file-preview";
import fs from "fs";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { isPathWithinRoots } from "@/lib/path-security";
import path from "path";
import {
  getAllowedFileRoots,
  isExistingFilePathAllowed,
  isWindowsAbsolutePath,
  normalizeSlashes,
} from "@/lib/file-access";
import {
  DOCX_PREVIEW_MAX_BYTES,
  IMAGE_PREVIEW_MAX_BYTES,
  TEXT_PREVIEW_MAX_BYTES,
  documentPreviewKind,
  getAudioMime,
  getDocumentMime,
  getFileExt,
  getImageMime,
} from "@/lib/file-types";
import { resolveDirentIsDirectory } from "@/lib/file-dirent";
import { isFilePathReferencedBySession } from "@/lib/session-file-references";
import {
  inspectUploadTargets,
  parseUploadConflictStrategy,
  validateUploadFileNames,
} from "@/lib/file-upload";
import { parseFormDataWithinLimit, parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";

const IGNORED_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
  "target", "vendor", ".DS_Store", ".git",
]);

const IGNORED_SUFFIXES = [".pyc"];

const FILE_REQUEST_TYPES = ["list", "read", "download", "meta", "preview", "watch"] as const;
type FileRequestType = typeof FILE_REQUEST_TYPES[number];
const FILE_REQUEST_TYPE_SET = new Set<string>(FILE_REQUEST_TYPES);
const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_TOTAL_BYTES = 100 * 1024 * 1024;
// Multipart boundaries and headers are not file bytes, but must be bounded too.
const MAX_UPLOAD_REQUEST_BYTES = MAX_UPLOAD_TOTAL_BYTES + 1024 * 1024;
const MAX_UPLOAD_CHECK_REQUEST_BYTES = 1024 * 1024;

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  mjs: "javascript", cjs: "javascript", py: "python", rb: "ruby",
  go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift",
  c: "c", cpp: "cpp", h: "c", hpp: "cpp", cs: "csharp",
  html: "html", htm: "html", css: "css", scss: "css", less: "css",
  json: "json", jsonl: "json", yaml: "yaml", yml: "yaml",
  toml: "toml", xml: "xml", md: "markdown", mdx: "markdown",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  sql: "sql", graphql: "graphql", gql: "graphql",
  dockerfile: "dockerfile", tf: "hcl", hcl: "hcl",
  env: "bash", gitignore: "bash", txt: "text",
  pdf: "pdf", docx: "word",
};

function getLanguage(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  // Special full-name matches
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "dockerfile";
  if (base === ".env" || base.startsWith(".env.")) return "bash";
  if (base === "makefile" || base === "gnumakefile") return "makefile";
  const ext = base.split(".").pop() ?? "";
  return EXT_TO_LANGUAGE[ext] ?? "text";
}

function filePathFromSegments(segments: string[]): string {
  const joined = segments.join("/");
  const slashJoined = normalizeSlashes(joined);
  if (isWindowsAbsolutePath(slashJoined)) return slashJoined;
  return "/" + joined.replace(/^\/+/, "");
}

function parseFileRequestType(value: string): FileRequestType | null {
  return FILE_REQUEST_TYPE_SET.has(value) ? (value as FileRequestType) : null;
}

async function getUploadDirectory(segments: string[]): Promise<
  { directory: string } | { response: NextResponse }
> {
  const directory = filePathFromSegments(segments);
  const allowedRoots = await getAllowedFileRoots();
  if (!isPathWithinRoots(directory, allowedRoots)) {
    return { response: NextResponse.json({ error: "Access denied", code: "access_denied" }, { status: 403 }) };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(directory);
  } catch {
    return { response: NextResponse.json({ error: "Upload directory not found", code: "upload_directory_not_found" }, { status: 404 }) };
  }
  if (!stat.isDirectory()) {
    return { response: NextResponse.json({ error: "Upload target is not a directory", code: "upload_target_not_directory" }, { status: 400 }) };
  }

  // A browsable directory can be a symlink. Resolve both sides before writes
  // so a symlink inside an allowed root cannot redirect uploads outside it.
  const realDirectory = fs.realpathSync(directory);
  const realRoots = new Set<string>();
  for (const root of allowedRoots) {
    try {
      realRoots.add(fs.realpathSync(root));
    } catch {
      // Ignore stale session roots that no longer exist.
    }
  }
  if (!isPathWithinRoots(realDirectory, realRoots)) {
    return { response: NextResponse.json({ error: "Access denied", code: "access_denied" }, { status: 403 }) };
  }

  return { directory: realDirectory };
}

function parseUploadFileNames(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return null;
  return value;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: segments } = await params;
    const uploadDirectory = await getUploadDirectory(segments);
    if ("response" in uploadDirectory) return uploadDirectory.response;
    const { directory } = uploadDirectory;
    const type = request.nextUrl.searchParams.get("type") ?? "upload";

    if (type === "upload-check") {
      let body: { fileNames?: unknown } | null;
      try {
        body = await parseJsonWithinLimit<{ fileNames?: unknown }>(request, MAX_UPLOAD_CHECK_REQUEST_BYTES);
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "Upload check request is too large", code: "upload_check_too_large" }, { status: 413 });
        body = null;
      }
      const fileNames = parseUploadFileNames(body?.fileNames);
      if (!fileNames) {
        return NextResponse.json({ error: "fileNames must be an array of strings", code: "invalid_file_names" }, { status: 400 });
      }
      const validationError = validateUploadFileNames(fileNames);
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 });
      }
      return NextResponse.json(inspectUploadTargets(directory, fileNames));
    }

    if (type !== "upload") {
      return NextResponse.json({ error: "Invalid upload request type", code: "invalid_upload_type" }, { status: 400 });
    }

    const strategy = parseUploadConflictStrategy(request.nextUrl.searchParams.get("conflict"));
    if (!strategy) {
      return NextResponse.json({ error: "Invalid conflict strategy", code: "invalid_conflict_strategy" }, { status: 400 });
    }

    let formData: FormData;
    try {
      formData = await parseFormDataWithinLimit(request, MAX_UPLOAD_REQUEST_BYTES);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return NextResponse.json({ error: "Uploads must total 100MB or less", code: "upload_total_too_large" }, { status: 413 });
      }
      throw error;
    }
    const files = formData.getAll("files").filter((entry): entry is File => typeof entry !== "string");
    if (files.some((file) => file.size > MAX_UPLOAD_FILE_BYTES)) {
      return NextResponse.json({ error: "Each upload must be 25MB or smaller", code: "upload_file_too_large" }, { status: 413 });
    }
    if (files.reduce((total, file) => total + file.size, 0) > MAX_UPLOAD_TOTAL_BYTES) {
      return NextResponse.json({ error: "Uploads must total 100MB or less", code: "upload_total_too_large" }, { status: 413 });
    }
    const fileNames = files.map((file) => file.name);
    const validationError = validateUploadFileNames(fileNames);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const inspection = inspectUploadTargets(directory, fileNames);
    if (strategy === "error" && inspection.conflicts.length > 0) {
      return NextResponse.json({
        error: "One or more files already exist",
        code: "upload_conflict",
        conflicts: inspection.conflicts,
        nonReplaceable: inspection.nonReplaceable,
      }, { status: 409 });
    }

    const conflictSet = new Set(inspection.conflicts);
    const nonReplaceableSet = new Set(inspection.nonReplaceable);
    const uploaded: string[] = [];
    const skipped: string[] = [];
    const errors: Array<{ name: string; error: string }> = [];
    const recordError = (file: File, error: unknown) => {
      errors.push({ name: file.name, error: error instanceof Error ? error.message : String(error) });
    };

    for (const file of files) {
      const destination = path.join(directory, file.name);
      if (conflictSet.has(file.name) && strategy === "skip") {
        skipped.push(file.name);
        continue;
      }
      if (conflictSet.has(file.name) && nonReplaceableSet.has(file.name)) {
        errors.push({ name: file.name, error: "Cannot replace a directory or symbolic link" });
        continue;
      }

      let bytes: Buffer;
      try {
        bytes = Buffer.from(await file.arrayBuffer());
      } catch (error) {
        recordError(file, error);
        continue;
      }

      let temporary: string | undefined;
      try {
        if (strategy === "overwrite" && conflictSet.has(file.name)) {
          const candidate = path.join(directory, `.omp-upload-${randomUUID()}`);
          const descriptor = fs.openSync(candidate, "wx", 0o600);
          temporary = candidate;
          try {
            fs.writeFileSync(descriptor, bytes);
          } finally {
            fs.closeSync(descriptor);
          }
          // Never follow a destination symlink or replace a non-file that
          // appeared since inspection. Rename commits only complete bytes.
          const current = fs.lstatSync(destination, { throwIfNoEntry: false });
          if (current && (!current.isFile() || current.isSymbolicLink())) {
            throw new Error("Cannot replace a directory or symbolic link");
          }
          if (current) fs.chmodSync(temporary, current.mode & 0o777);
          fs.renameSync(temporary, destination);
          temporary = undefined;
        } else {
          fs.writeFileSync(destination, bytes, { flag: "wx" });
        }
        uploaded.push(file.name);
      } catch (error) {
        recordError(file, error);
      } finally {
        if (temporary) fs.rmSync(temporary, { force: true });
      }
    }

    return NextResponse.json(
      { uploaded, skipped, errors },
      { status: errors.length > 0 ? 207 : 200 },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

function createFileBodyStream(filePath: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  const fileStream = fs.createReadStream(filePath, range);
  return Readable.toWeb(fileStream, {
    strategy: {
      highWaterMark: fileStream.readableHighWaterMark,
      size: (chunk: Uint8Array) => chunk.byteLength,
    },
  }) as ReadableStream<Uint8Array>;
}

function encodeHeaderValue(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) =>
    `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function getContentDisposition(filePath: string, asDownload = false): string {
  const disposition = asDownload ? "attachment" : "inline";
  const fileName = path.basename(filePath);
  const fallback = fileName.replace(/[^\x20-\x7E]|["\\;\r\n]/g, "_") || "download";
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeHeaderValue(fileName)}`;
}

function streamFile(filePath: string, stat: fs.Stats, contentType: string, rangeHeader: string | null, asDownload = false): Response {
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
    "Accept-Ranges": "bytes",
    "Content-Disposition": getContentDisposition(filePath, asDownload),
    // SVG is an active document when opened directly, not just an image.
    // Keep PDF out of sandbox so native browser PDF viewers still work.
    "Content-Security-Policy": "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; media-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'" + (contentType === "image/svg+xml" ? "; sandbox" : ""),
    "X-Content-Type-Options": "nosniff",
  };

  if (!rangeHeader) {
    return new Response(createFileBodyStream(filePath), {
      headers: {
        ...headers,
        "Content-Length": String(stat.size),
      },
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) {
    return new Response(null, {
      status: 416,
      headers: {
        ...headers,
        "Content-Range": `bytes */${stat.size}`,
      },
    });
  }

  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : stat.size - 1;
  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2]);
    start = Math.max(stat.size - suffixLength, 0);
    end = stat.size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= stat.size) {
    return new Response(null, {
      status: 416,
      headers: {
        ...headers,
        "Content-Range": `bytes */${stat.size}`,
      },
    });
  }

  end = Math.min(end, stat.size - 1);
  const chunkSize = end - start + 1;
  return new Response(createFileBodyStream(filePath, { start, end }), {
    status: 206,
    headers: {
      ...headers,
      "Content-Length": String(chunkSize),
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: segments } = await params;
    const filePath = filePathFromSegments(segments);
    const rawType = request.nextUrl.searchParams.get("type") ?? "list";
    const type = parseFileRequestType(rawType);
    if (!type) {
      return NextResponse.json({ error: "Invalid file request type", code: "invalid_request_type" }, { status: 400 });
    }
    const sessionId = request.nextUrl.searchParams.get("sessionId");

    const allowedRoots = await getAllowedFileRoots();
    const allowedByRoot = isPathWithinRoots(filePath, allowedRoots);
    const allowedBySessionReference =
      !allowedByRoot &&
      type !== "list" &&
      await isFilePathReferencedBySession(filePath, sessionId);
    if (!allowedByRoot && !allowedBySessionReference) {
      return NextResponse.json({ error: "Access denied", code: "access_denied" }, { status: 403 });
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return NextResponse.json({ error: "Not found", code: "file_not_found" }, { status: 404 });
    }

    if (!allowedBySessionReference && !isExistingFilePathAllowed(filePath, allowedRoots)) {
      return NextResponse.json({ error: "Access denied", code: "access_denied" }, { status: 403 });
    }

    if (type === "read") {
      if (!stat.isFile()) {
        return NextResponse.json({ error: "Not a file", code: "not_a_file" }, { status: 400 });
      }
      const imageMime = getImageMime(filePath);
      if (imageMime) {
        if (stat.size > IMAGE_PREVIEW_MAX_BYTES) {
          return NextResponse.json({ error: "Image too large (>10MB)", code: "image_too_large" }, { status: 413 });
        }
        return streamFile(filePath, stat, imageMime, request.headers.get("range"));
      }
      const audioMime = getAudioMime(filePath);
      if (audioMime) {
        return streamFile(filePath, stat, audioMime, request.headers.get("range"));
      }
      const documentMime = getDocumentMime(filePath);
      if (documentMime) {
        return streamFile(filePath, stat, documentMime, request.headers.get("range"));
      }
      if (stat.size > TEXT_PREVIEW_MAX_BYTES) {
        return NextResponse.json({ error: "File too large for preview (>256KB)", code: "file_too_large_preview" }, { status: 413 });
      }
      const content = fs.readFileSync(filePath, "utf-8");
      const language = getLanguage(filePath);
      return NextResponse.json({ content, language, size: stat.size });
    }

    if (type === "download") {
      if (!stat.isFile()) {
        return NextResponse.json({ error: "Not a file", code: "not_a_file" }, { status: 400 });
      }
      const mime = getImageMime(filePath) || getAudioMime(filePath) || getDocumentMime(filePath) || "application/octet-stream";
      return streamFile(filePath, stat, mime, request.headers.get("range"), true);
    }

    if (type === "meta") {
      if (!stat.isFile()) {
        return NextResponse.json({ error: "Not a file", code: "not_a_file" }, { status: 400 });
      }
      const imageMime = getImageMime(filePath);
      const audioMime = getAudioMime(filePath);
      const documentMime = getDocumentMime(filePath);
      return NextResponse.json({
        size: stat.size,
        language: getLanguage(filePath),
        mime: imageMime || audioMime || documentMime || "text/plain",
        previewKind: documentPreviewKind(filePath),
      });
    }

    if (type === "preview") {
      if (!stat.isFile()) {
        return NextResponse.json({ error: "Not a file", code: "not_a_file" }, { status: 400 });
      }
      if (getFileExt(filePath) !== "docx") {
        return NextResponse.json({ error: "Preview not available for this file type", code: "preview_unavailable" }, { status: 400 });
      }
      if (stat.size > DOCX_PREVIEW_MAX_BYTES) {
        return NextResponse.json({ error: "DOCX too large for preview (>10MB)", code: "docx_too_large" }, { status: 413 });
      }

      const canonicalPath = fs.realpathSync(filePath);
      if (!allowedBySessionReference && !isExistingFilePathAllowed(canonicalPath, allowedRoots)) {
        return NextResponse.json({ error: "Access denied", code: "access_denied" }, { status: 403 });
      }
      const { html } = await previewDocxFile(canonicalPath);
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
          "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    if (type === "watch") {
      if (!stat.isFile()) {
        return NextResponse.json({ error: "Not a file", code: "not_a_file" }, { status: 400 });
      }
      let watcher: fs.FSWatcher | null = null;
      let lastMtimeMs = stat.mtimeMs;
      let lastSize = stat.size;
      const stream = new ReadableStream({
        start(controller) {
          const send = (eventName: string, data: Record<string, unknown>) => {
            const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
            try {
              controller.enqueue(new TextEncoder().encode(payload));
            } catch {
              // client disconnected
            }
          };
          // Send initial ping so client knows connection is live
          send("connected", { filePath });
          try {
            watcher = fs.watch(filePath, () => {
              try {
                const s = fs.statSync(filePath);
                // Some platforms emit watch events for file reads/attribute
                // access. Ignore those or the client's refresh read loops.
                if (s.mtimeMs === lastMtimeMs && s.size === lastSize) return;
                lastMtimeMs = s.mtimeMs;
                lastSize = s.size;
                send("change", { mtime: s.mtime.toISOString(), size: s.size });
              } catch {
                send("change", { mtime: new Date().toISOString(), size: 0 });
              }
            });
            watcher.on("error", () => {
              try { controller.close(); } catch { /* ignore */ }
            });
          } catch {
            send("error", { message: "Failed to watch file" });
            controller.close();
          }
        },
        cancel() {
          try { watcher?.close(); } catch { /* ignore */ }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // type === "list"
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Not a directory", code: "not_a_directory" }, { status: 400 });
    }

    // Avoid per-entry stat calls for normal files and directories. Symlinks and
    // filesystems without directory type information use the stat fallback.
    const readDirectorySync = Reflect.get(fs, "readdirSync") as typeof fs.readdirSync;
    const dirents = readDirectorySync(filePath, { withFileTypes: true });
    const entries = dirents
      .filter((d) => !IGNORED_NAMES.has(d.name) && !IGNORED_SUFFIXES.some((s) => d.name.endsWith(s)))
      .flatMap((d) => {
        const isDir = resolveDirentIsDirectory(d, path.join(filePath, d.name));
        return isDir === null
          ? []
          : [{ name: d.name, isDir, size: 0, modified: "" }];
      })
      .sort((a, b) => {
        // Dirs first, then files, both alphabetically
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    return NextResponse.json({ entries, path: filePath });
  } catch (error) {
    if (error instanceof FilePreviewError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return apiErrorResponse(error);
  }
}
