import mammoth from "mammoth";
import { closeSync, constants, fstatSync, openSync, readSync, statSync } from "node:fs";
import type { BigIntStats } from "node:fs";
import { basename } from "node:path";
import { unified } from "unified";
import type { Nodes } from "hast";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { DOCX_PREVIEW_MAX_BYTES, getFileExt } from "./file-types";

export class FilePreviewError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "FilePreviewError";
  }
}

const sanitizer = unified().use(rehypeRaw).use(rehypeSanitize, {
  ...defaultSchema,
  // Documents never fetch resources. Only embedded images and local anchors survive.
  protocols: { ...defaultSchema.protocols, src: ["data"], href: [] },
}).use(rehypeStringify);

function revisionOf(stat: BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

/** The caller must authorize the canonical path before invoking this reader. */
export async function previewDocxFile(filePath: string, expectedRevision?: string, maxOutputBytes?: number): Promise<{ revision: string; html: string }> {
  if (getFileExt(filePath) !== "docx") throw new FilePreviewError("preview_unavailable", "Preview not available for this file type", 400);
  const fd = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let buffer: Buffer;
  let revision: string;
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile()) throw new FilePreviewError("not_a_file", "Not a file", 400);
    revision = revisionOf(before);
    if (expectedRevision !== undefined && expectedRevision !== revision) throw new FilePreviewError("stale_revision", "File changed; reload before continuing", 409);
    if (before.size > BigInt(DOCX_PREVIEW_MAX_BYTES)) throw new FilePreviewError("docx_too_large", "DOCX too large for preview (>10MB)", 413);
    buffer = Buffer.allocUnsafe(Number(before.size));
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (!count) throw new FilePreviewError("stale_revision", "File changed during read", 409);
      offset += count;
    }
    if (revisionOf(fstatSync(fd, { bigint: true })) !== revision) throw new FilePreviewError("stale_revision", "File changed during read", 409);
  } finally { closeSync(fd); }
  const result = await mammoth.convertToHtml({ buffer }, {
    externalFileAccess: false,
    convertImage: mammoth.images.dataUri,
  });
  if (maxOutputBytes !== undefined && Buffer.byteLength(result.value, "utf8") > maxOutputBytes) throw new FilePreviewError("preview_too_large", "Rendered document is too large for preview", 413);
  const tree = sanitizer.runSync({ type: "root", children: [{ type: "raw", value: result.value }] });
  // A scheme allowlist alone permits relative URLs; strip all non-embedded image
  // sources and all non-fragment links, including protocol-relative destinations.
  const pending: Nodes[] = [tree];
  while (pending.length) {
    const node = pending.pop()!;
    if ("children" in node && Array.isArray(node.children)) pending.push(...node.children);
    if (node.type === "element") {
      const src = node.properties.src;
      if (typeof src === "string" && !/^data:image\/(?:png|jpeg|gif|webp|bmp|tiff);base64,[A-Za-z0-9+/]*={0,2}$/i.test(src)) delete node.properties.src;
      const href = node.properties.href;
      if (typeof href === "string" && !href.startsWith("#")) delete node.properties.href;
    }
  }
  const html = wrapDocxPreviewHtml(sanitizer.stringify(tree), basename(filePath));
  if (maxOutputBytes !== undefined && Buffer.byteLength(html, "utf8") > maxOutputBytes) throw new FilePreviewError("preview_too_large", "Rendered document is too large for preview", 413);
  try {
    if (revisionOf(statSync(filePath, { bigint: true })) !== revision) throw new FilePreviewError("stale_revision", "File changed during conversion", 409);
  } catch (error) {
    if (error instanceof FilePreviewError) throw error;
    throw new FilePreviewError("stale_revision", "File changed during conversion", 409);
  }
  return { revision, html };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrapDocxPreviewHtml(bodyHtml: string, fileName: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; min-height: 100%; background: #eef1f5; color: #171717; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 28px; }
  main {
    box-sizing: border-box;
    max-width: 840px;
    min-height: calc(100vh - 56px);
    margin: 0 auto;
    padding: 56px 64px;
    background: #fff;
    box-shadow: 0 8px 28px rgba(15, 23, 42, 0.14);
  }
  .file-title {
    margin: 0 0 28px;
    padding-bottom: 10px;
    border-bottom: 1px solid #e5e7eb;
    color: #6b7280;
    font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    word-break: break-word;
  }
  h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.1em 0 0.45em; color: #111827; }
  p { margin: 0.65em 0; line-height: 1.7; }
  table { border-collapse: collapse; max-width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #d1d5db; padding: 6px 9px; vertical-align: top; }
  img { max-width: 100%; height: auto; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; }
  a { color: #2563eb; }
  @media (max-width: 720px) {
    body { padding: 0; background: #fff; }
    main { min-height: 100vh; padding: 28px 22px; box-shadow: none; }
  }
</style>
</head>
<body>
<main>
<div class="file-title">${escapeHtml(fileName)}</div>
${bodyHtml}
</main>
</body>
</html>`;
}

