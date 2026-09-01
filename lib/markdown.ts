import { useEffect, useState } from "react";
import type { Options as ReactMarkdownOptions } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]],
  },
  strip: [...(defaultSchema.strip || []), "iframe", "object", "style", "form"],
};

// singleTilde:false requires ~~double~~ tildes for strikethrough. A single `~`
// is the standard CJK numeric-range separator (e.g. "5~7U", "100~200倍"), and
// GFM's default single-tilde strikethrough silently mangles such ranges (#385).
const remarkGfmOptions = { singleTilde: false } as const;

export interface MarkdownPlugins {
  remarkPlugins: NonNullable<ReactMarkdownOptions["remarkPlugins"]>;
  rehypePlugins: NonNullable<ReactMarkdownOptions["rehypePlugins"]>;
}

// Math-free pipeline used until math syntax is detected. The math pipeline is
// built from these same arrays, so the sanitize schema cannot drift between
// the two.
const baseMarkdownPlugins: MarkdownPlugins = {
  remarkPlugins: [[remarkGfm, remarkGfmOptions]],
  rehypePlugins: [rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]],
};

let mathMarkdownPlugins: MarkdownPlugins | null = null;
let mathMarkdownPluginsPromise: Promise<MarkdownPlugins> | null = null;

/**
 * Cheap gate deciding whether the KaTeX pipeline could matter for a document.
 * False positives (e.g. dollar amounts) only cost loading the math chunk;
 * remark-math then decides what is actually math.
 */
export function containsMathSyntax(markdown: string): boolean {
  return markdown.includes("$") || markdown.includes("\\(") || markdown.includes("\\[");
}

/** Loads remark-math + rehype-katex + the KaTeX CSS once, caching module-level. */
export function loadMathMarkdownPlugins(): Promise<MarkdownPlugins> {
  if (!mathMarkdownPluginsPromise) {
    mathMarkdownPluginsPromise = (async () => {
      const [remarkMath, rehypeKatex] = await Promise.all([
        import("remark-math").then((m) => m.default),
        import("rehype-katex").then((m) => m.default),
      ]);
      if (typeof window !== "undefined") {
        // KaTeX styles are only needed (and only loadable) in the browser.
        await import("katex/dist/katex.min.css");
      }
      mathMarkdownPlugins = {
        remarkPlugins: [...baseMarkdownPlugins.remarkPlugins, remarkMath],
        rehypePlugins: [
          ...baseMarkdownPlugins.rehypePlugins,
          [rehypeKatex, { throwOnError: false, strict: false }],
        ],
      };
      return mathMarkdownPlugins;
    })().catch((error) => {
      // Allow a later render to retry after e.g. a transient network failure.
      mathMarkdownPluginsPromise = null;
      throw error;
    });
  }
  return mathMarkdownPluginsPromise;
}

/**
 * Plugin arrays for ReactMarkdown. Documents without math syntax render with
 * the math-free pipeline and never fetch the KaTeX chunk; the first document
 * containing math triggers the lazy load and re-renders when it lands.
 */
export function useMarkdownPlugins(markdown: string): MarkdownPlugins {
  const hasMath = containsMathSyntax(markdown);
  const [, setLoadedVersion] = useState(0);

  useEffect(() => {
    if (!hasMath || mathMarkdownPlugins) return;
    let cancelled = false;
    loadMathMarkdownPlugins()
      .then(() => {
        if (!cancelled) setLoadedVersion((version) => version + 1);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hasMath]);

  return hasMath && mathMarkdownPlugins ? mathMarkdownPlugins : baseMarkdownPlugins;
}

export function normalizeDisplayMath(markdown: string): string {
  const lineBreak = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const normalized: string[] = [];
  let fence: { marker: string; size: number } | null = null;
  let inlineCodeMarkerSize = 0;
  let rawCodeTag: string | null = null;
  const unmatchedDisplayMathUntil = new Map<string, number>();

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    if (rawCodeTag) {
      normalized.push(line);
      if (new RegExp(`</${rawCodeTag}\\s*>`, "i").test(line)) rawCodeTag = null;
      continue;
    }

    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      const size = fenceMatch[1].length;
      if (!fence) fence = { marker, size };
      else if (marker === fence.marker && size >= fence.size) fence = null;
      inlineCodeMarkerSize = 0;
      normalized.push(line);
      continue;
    }

    if (fence) {
      normalized.push(line);
      continue;
    }

    const rawCodeOpen = line.match(/<(code|pre|script|style)\b/i);
    if (rawCodeOpen) {
      const tag = rawCodeOpen[1].toLowerCase();
      const remainder = line.slice((rawCodeOpen.index ?? 0) + rawCodeOpen[0].length);
      if (!new RegExp(`</${tag}\\s*>`, "i").test(remainder)) rawCodeTag = tag;
      inlineCodeMarkerSize = 0;
      normalized.push(line);
      continue;
    }

    if (/^(?: {4}|\t)/.test(line) || line.trim() === "") {
      inlineCodeMarkerSize = 0;
      normalized.push(line);
      continue;
    }

    if (inlineCodeMarkerSize || line.includes("`")) {
      inlineCodeMarkerSize = updateInlineCodeMarker(line, inlineCodeMarkerSize);
      normalized.push(line);
      continue;
    }

    const bracketDisplayOneLine = line.match(/^([ ]{0,3})\\\[[ \t]*(.+?)[ \t]*\\\][ \t]*$/);
    if (bracketDisplayOneLine) {
      const math = bracketDisplayOneLine[2].trim();
      if (math) {
        // Keep the content line indented together with the `$$` fence. When the
        // formula is nested inside a GFM list item (indented `$$`), a content line
        // at column 0 becomes a lazy continuation that can mis-parse the fence pair.
        normalized.push(
          `${bracketDisplayOneLine[1]}$$`,
          `${bracketDisplayOneLine[1]}${math}`,
          `${bracketDisplayOneLine[1]}$$`,
        );
        continue;
      }
    }

    const bracketDisplayStart = line.match(/^([ ]{0,3})\\\[[ \t]*$/);
    if (bracketDisplayStart) {
      const closingIndex = findBracketDisplayClose(lines, index + 1);
      if (closingIndex !== -1) {
        normalized.push(
          `${bracketDisplayStart[1]}$$`,
          ...lines.slice(index + 1, closingIndex).map((mathLine) =>
            indentDisplayMathContent(mathLine, bracketDisplayStart[1]),
          ),
          `${bracketDisplayStart[1]}$$`,
        );
        index = closingIndex;
        continue;
      }
    }

    const displayMathMatch = line.match(/^([ \t]{0,3})\$\$(.+)\$\$[ \t]*$/);
    if (displayMathMatch) {
      const math = displayMathMatch[2].trim();
      if (math) {
        normalized.push(
          `${displayMathMatch[1]}$$`,
          `${displayMathMatch[1]}${math}`,
          `${displayMathMatch[1]}$$`,
        );
        continue;
      }
    }

    // Models may glue display fences to the first or last formula line.
    const displayMathMultiLine = line.match(/^([ \t]{0,3})\$\$(.+)$/);
    if (displayMathMultiLine) {
      const indent = displayMathMultiLine[1];
      const firstLine = displayMathMultiLine[2].trimEnd();
      // Keep `$$x$$ and text` inline; it is not a display block opener.
      if (firstLine && !firstLine.includes("$$")) {
        const closing = findDisplayMathClose(lines, index + 1, indent, unmatchedDisplayMathUntil);
        if (closing) {
          normalized.push(`${indent}$$`, `${indent}${firstLine}`);
          for (let j = index + 1; j < closing.index; j++) {
            normalized.push(indentDisplayMathContent(lines[j], indent));
          }
          if (closing.content) normalized.push(`${indent}${closing.content}`);
          normalized.push(`${indent}$$`);
          index = closing.index;
          continue;
        }
      }
    }

    // Normalize bare openers nested in list items, and glued closing fences.
    const displayMathBareOpen = line.match(/^([ \t]{0,3})\$\$\s*$/);
    if (displayMathBareOpen) {
      const indent = displayMathBareOpen[1];
      const closing = findDisplayMathClose(lines, index + 1, indent, unmatchedDisplayMathUntil);
      if (closing && (closing.glued || indent !== "")) {
        normalized.push(`${indent}$$`);
        for (let j = index + 1; j < closing.index; j++) {
          normalized.push(indentDisplayMathContent(lines[j], indent));
        }
        if (closing.content) normalized.push(`${indent}${closing.content}`);
        normalized.push(`${indent}$$`);
        index = closing.index;
        continue;
      }
    }

    normalized.push(normalizeInlineLatexMath(line));
  }

  return normalized.join(lineBreak);
}

interface DisplayMathClose {
  index: number;
  content: string;
  glued: boolean;
}

function findDisplayMathClose(
  lines: string[],
  startIndex: number,
  indent: string,
  unmatchedUntil: Map<string, number>,
): DisplayMathClose | null {
  const knownUnmatchedUntil = unmatchedUntil.get(indent);
  if (knownUnmatchedUntil !== undefined && startIndex < knownUnmatchedUntil) return null;

  for (let index = startIndex; index < lines.length; index++) {
    const line = lines[index];
    if (isDisplayMathFence(line, indent)) return { index, content: "", glued: false };
    if (shouldAbortDisplayMath(line)) {
      unmatchedUntil.set(indent, index);
      return null;
    }
    const content = getDisplayMathGluedCloseContent(line, indent);
    if (content !== null) return { index, content, glued: true };
  }

  unmatchedUntil.set(indent, lines.length);
  return null;
}

function isDisplayMathFence(line: string, indent: string): boolean {
  if (indent === "") return /^ {0,3}\$\$\s*$/.test(line);
  return line.startsWith(indent) && /^\$\$\s*$/.test(line.slice(indent.length));
}

function getDisplayMathGluedCloseContent(line: string, indent: string): string | null {
  if (!line.startsWith(indent)) return null;
  const match = line.slice(indent.length).match(/^(.+?)\$\$\s*$/);
  if (!match) return null;
  const content = match[1].trimEnd();
  return content && !content.includes("$$") ? content : null;
}

function isDisplayMathOpeningLine(line: string): boolean {
  return /^ {0,3}\$\$(?:\S|[ \t]+\S)/.test(line);
}

function isDisplayMathBlockBoundary(line: string): boolean {
  return (
    /^ {0,3}(`{3,}|~{3,})/.test(line) ||
    /^[ \t]*(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$)/.test(line) ||
    /^ {0,3}#{1,6}(?:[ \t]+|$)/.test(line) ||
    /^ {0,3}>/.test(line) ||
    /<(code|pre|script|style)\b/i.test(line)
  );
}

function shouldAbortDisplayMath(line: string): boolean {
  return isDisplayMathBlockBoundary(line) || isDisplayMathOpeningLine(line);
}

function indentDisplayMathContent(line: string, indent: string): string {
  if (!indent || !line || line.startsWith("\t")) return line;
  const leadingSpaces = line.match(/^ */)?.[0].length ?? 0;
  if (leadingSpaces >= indent.length) return line;
  return `${indent.slice(leadingSpaces)}${line}`;
}

function isBracketDisplayBoundary(line: string): boolean {
  return (
      /^ {0,3}(`{3,}|~{3,})/.test(line) ||
      /^ {0,3}\\\[[ \t]*$/.test(line) ||
      /<(code|pre|script|style)\b/i.test(line)
  );
}

function findBracketDisplayClose(lines: string[], startIndex: number): number {
  for (let index = startIndex; index < lines.length; index++) {
    const line = lines[index];
    if (/^ {0,3}\\\][ \t]*$/.test(line)) return index;
    // Do not pair delimiters across another Markdown block boundary.
    if (isBracketDisplayBoundary(line)) return -1;
  }

  return -1;
}

function updateInlineCodeMarker(line: string, initialMarkerSize: number): number {
  let markerSize = initialMarkerSize;
  for (let cursor = 0; cursor < line.length;) {
    if (line[cursor] !== "`") {
      cursor++;
      continue;
    }

    let end = cursor + 1;
    while (line[end] === "`") end++;
    const runSize = end - cursor;
    if (markerSize === 0) markerSize = runSize;
    else if (runSize === markerSize) markerSize = 0;
    cursor = end;
  }
  return markerSize;
}

function normalizeInlineLatexMath(line: string): string {
  if (
    /^\s{0,3}\[[^\]]+\]:/.test(line) ||
    /]\s*\(/.test(line) ||
    /<(?:!--|\/?[A-Za-z][^>]*>)/.test(line) ||
    /\b(?:https?|file|mailto):/i.test(line) ||
    /\b[A-Za-z]:\\/.test(line)
  ) {
    return line;
  }

  return line.replace(
    /(?<!\\)\\\(([^`\r\n$]+?)(?<!\\)\\\)/g,
    (match, math: string) => (math.trim() ? `$${math}$` : match),
  );
}

export interface StableMarkdownParts {
  stable: string;
  tail: string;
}

/**
 * Conservatively split markdown into a completed prefix and a growing tail.
 * `stable + tail === markdown`. When a construct might still grow, `stable` is empty.
 */
export function splitStableMarkdownPrefix(markdown: string): StableMarkdownParts {
  const end = findStableMarkdownPrefixEnd(markdown);
  return { stable: markdown.slice(0, end), tail: markdown.slice(end) };
}

interface MarkdownLine {
  text: string;
  start: number;
  next: number;
  blank: boolean;
}

type FenceState = { marker: string; size: number };
type HtmlState =
  | { kind: "type1"; tag: string }
  | { kind: "untilBlank" }
  | { kind: "until"; close: string };
type MathState = { kind: "dollar"; indent: string } | { kind: "bracket" };
type TableState = { seenDelim: boolean };

const HTML_TYPE6_TAGS = new Set([
  "address",
  "article",
  "aside",
  "base",
  "basefont",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frame",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "iframe",
  "legend",
  "li",
  "link",
  "main",
  "menu",
  "menuitem",
  "nav",
  "noframes",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "search",
  "section",
  "source",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "ul",
]);

function splitMarkdownLines(markdown: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let index = 0;
  while (index < markdown.length) {
    let cursor = index;
    while (cursor < markdown.length && markdown[cursor] !== "\n" && markdown[cursor] !== "\r") {
      cursor++;
    }
    let next = cursor;
    if (markdown[cursor] === "\r" && markdown[cursor + 1] === "\n") next = cursor + 2;
    else if (cursor < markdown.length) next = cursor + 1;
    const text = markdown.slice(index, cursor);
    lines.push({ text, start: index, next, blank: text.trim() === "" });
    index = next;
  }
  return lines;
}

function isFenceOpenLine(line: string): FenceState | null {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!match) return null;
  const marker = match[1][0];
  const size = match[1].length;
  const rest = match[2];
  if (marker === "`" && rest.includes("`")) return null;
  return { marker, size };
}

function isFenceCloseLine(line: string, fence: FenceState): boolean {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
  if (!match) return false;
  return match[1][0] === fence.marker && match[1].length >= fence.size;
}

function isAtxHeading(line: string): boolean {
  return /^ {0,3}#{1,6}(?:[ \t]+|$|#[ \t]*$)/.test(line);
}

function isThematicBreak(line: string): boolean {
  return /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})[ \t]*$/.test(line);
}

function isSetextUnderline(line: string): boolean {
  return /^ {0,3}(?:=+|-+)[ \t]*$/.test(line);
}

function isListItem(line: string): boolean {
  return /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$)/.test(line);
}

/** CommonMark: lists interrupt paragraphs only when nonempty; ordered start must be 1. */
function canListInterruptParagraph(line: string): boolean {
  return (
    /^ {0,3}[-+*][ \t]+\S/.test(line) ||
    /^ {0,3}0*1[.)][ \t]+\S/.test(line)
  );
}

function isBlockquote(line: string): boolean {
  return /^ {0,3}>/.test(line);
}

function isIndentedCodeLine(line: string): boolean {
  return /^(?: {4}|\t)/.test(line);
}

function isIndentedContinuation(line: string): boolean {
  return /^[ \t]/.test(line) && line.trim() !== "";
}

function isTableDelimiter(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|") || !trimmed.includes("-")) return false;
  const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|");
  return cells.length >= 1 && cells.every((cell) => /^:?-+:?$/.test(cell.trim()));
}

function isTableRow(line: string): boolean {
  return line.includes("|");
}

function isHtmlType1Open(line: string): string | null {
  const match = line.match(/^ {0,3}<(pre|script|style|textarea)(?=[\s>]|$)/i);
  return match ? match[1].toLowerCase() : null;
}

function isHtmlType1Close(line: string, tag: string): boolean {
  return new RegExp(`</${tag}>`, "i").test(line);
}

function matchHtmlBlockStart(line: string, inParagraph: boolean): { state: HtmlState | null } | null {
  if (/^ {0,3}<!--/.test(line)) {
    return line.includes("-->") ? { state: null } : { state: { kind: "until", close: "-->" } };
  }
  if (/^ {0,3}<\?/.test(line)) {
    return line.includes("?>") ? { state: null } : { state: { kind: "until", close: "?>" } };
  }
  if (/^ {0,3}<!\[CDATA\[/.test(line)) {
    return line.includes("]]>") ? { state: null } : { state: { kind: "until", close: "]]>" } };
  }
  if (/^ {0,3}<![a-zA-Z]/.test(line)) {
    return line.includes(">") ? { state: null } : { state: { kind: "until", close: ">" } };
  }
  const type6 = line.match(/^ {0,3}<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:[ \t]|\/?>|$)/);
  if (type6 && HTML_TYPE6_TAGS.has(type6[1].toLowerCase())) {
    return { state: { kind: "untilBlank" } };
  }
  // Type 7 cannot interrupt a paragraph.
  if (inParagraph) return null;
  if (/^ {0,3}<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\s*\/?>[ \t]*$/.test(line)) {
    return { state: { kind: "untilBlank" } };
  }
  return null;
}

function isDisplayDollarOpen(line: string): { indent: string } | null {
  const bare = line.match(/^([ \t]{0,3})\$\$[ \t]*$/);
  if (bare) return { indent: bare[1] };
  if (/^[ \t]{0,3}\$\$(.+)\$\$[ \t]*$/.test(line)) return null;
  const glued = line.match(/^([ \t]{0,3})\$\$(.+)$/);
  if (!glued) return null;
  const firstLine = glued[2].trimEnd();
  return firstLine && !firstLine.includes("$$") ? { indent: glued[1] } : null;
}

function isDisplayDollarOneLine(line: string): boolean {
  return /^[ \t]{0,3}\$\$.+\$\$[ \t]*$/.test(line);
}

function isBracketMathOpen(line: string): boolean {
  return /^ {0,3}\\\[[ \t]*(.*)$/.test(line) && !/^ {0,3}\\\[[ \t]*.+[ \t]*\\\][ \t]*$/.test(line)
    || /^ {0,3}\\\[[ \t]*$/.test(line);
}

function isBracketMathOneLine(line: string): boolean {
  return /^ {0,3}\\\[[ \t]*.+[ \t]*\\\][ \t]*$/.test(line);
}

function isBracketMathClose(line: string): boolean {
  return /^ {0,3}\\\][ \t]*$/.test(line) || /\\\][ \t]*$/.test(line);
}

function stripMarkdownContainerPrefix(line: string): string {
  let rest = line;
  for (;;) {
    const quote = rest.match(/^ {0,3}>[ \t]?/);
    if (!quote) break;
    rest = rest.slice(quote[0].length);
  }
  const list = rest.match(/^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$)/);
  return list ? rest.slice(list[0].length) : rest;
}

function lineHasReferenceConstruct(line: string): boolean {
  const stripped = stripMarkdownContainerPrefix(line);
  const candidates = stripped === line ? [line] : [line, stripped];
  for (const text of candidates) {
    if (/^ {0,3}\[[^\]\n]{1,999}\]:/.test(text)) return true;
    if (/\[\^[^\]]+\]/.test(text)) return true;
    if (/\[[^\]]+\]\[[^\]]*\]/.test(text)) return true;
    if (/\[[^\]]+\](?![(\[])/.test(text)) return true;
  }
  return false;
}

function markdownHasReferenceConstructs(lines: MarkdownLine[]): boolean {
  let fence: FenceState | null = null;
  let htmlTag: string | null = null;
  for (const line of lines) {
    if (htmlTag) {
      if (isHtmlType1Close(line.text, htmlTag)) htmlTag = null;
      continue;
    }
    if (fence) {
      if (isFenceCloseLine(line.text, fence)) fence = null;
      continue;
    }
    const html1 = isHtmlType1Open(line.text);
    if (html1) {
      if (!isHtmlType1Close(line.text, html1)) htmlTag = html1;
      continue;
    }
    const opened = isFenceOpenLine(line.text);
    if (opened) {
      fence = opened;
      continue;
    }
    if (isIndentedCodeLine(line.text)) continue;
    if (lineHasReferenceConstruct(line.text)) return true;
  }
  return false;
}

function findStableMarkdownPrefixEnd(markdown: string): number {
  if (!markdown) return 0;
  const lines = splitMarkdownLines(markdown);
  if (lines.length === 0) return 0;
  if (markdownHasReferenceConstructs(lines)) return 0;

  let fence: FenceState | null = null;
  let html: HtmlState | null = null;
  let math: MathState | null = null;
  let table: TableState | null = null;
  let indented = false;
  let inList = false;
  let inQuote = false;
  let listPendingExit = false;
  let quotePendingExit = false;
  let inParagraph = false;
  let inlineTicks = 0;
  let lastCompleteEnd = 0;

  const inContainer = () => inList || inQuote;

  const closeParagraph = (endOffset: number) => {
    inParagraph = false;
    inlineTicks = 0;
    if (!inContainer() && !fence && !html && !math && !table && !indented) {
      lastCompleteEnd = endOffset;
    }
  };

  const markClosed = (endOffset: number) => {
    if (!inContainer()) lastCompleteEnd = endOffset;
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const isLast = index === lines.length - 1;
    const hasNewline = line.next !== line.start + line.text.length;

    if (fence) {
      if (isFenceCloseLine(line.text, fence)) {
        fence = null;
        if (hasNewline) markClosed(line.next);
      }
      continue;
    }

    if (html) {
      if (html.kind === "type1") {
        if (isHtmlType1Close(line.text, html.tag)) {
          html = null;
          if (hasNewline) markClosed(line.next);
        }
      } else if (html.kind === "until") {
        if (line.text.includes(html.close)) {
          html = null;
          if (hasNewline) markClosed(line.next);
        }
      } else if (line.blank) {
        html = null;
        markClosed(line.next);
      }
      continue;
    }

    if (math?.kind === "dollar") {
      if (
        isDisplayMathFence(line.text, math.indent) ||
        getDisplayMathGluedCloseContent(line.text, math.indent) !== null
      ) {
        math = null;
        if (hasNewline) markClosed(line.next);
        continue;
      }
      if (shouldAbortDisplayMath(line.text)) math = null;
      else continue;
    }

    if (math?.kind === "bracket") {
      if (isBracketMathClose(line.text)) {
        math = null;
        if (hasNewline) markClosed(line.next);
        continue;
      }
      if (isBracketDisplayBoundary(line.text)) math = null;
      else continue;
    }

    if (indented) {
      if (line.blank || isIndentedCodeLine(line.text)) continue;
      indented = false;
      markClosed(line.start);
    }

    if (table) {
      if (line.blank) {
        table = null;
        markClosed(line.next);
        continue;
      }
      if (!table.seenDelim) {
        if (isTableDelimiter(line.text)) {
          table.seenDelim = true;
          continue;
        }
        table = null;
        inParagraph = true;
        continue;
      }
      if (isTableRow(line.text)) continue;
      table = null;
      markClosed(line.start);
    }

    if (line.blank) {
      if (inList) listPendingExit = true;
      if (inQuote) quotePendingExit = true;
      if (inParagraph) closeParagraph(line.next);
      else inlineTicks = 0;
      continue;
    }

    if (inQuote && quotePendingExit) {
      if (isBlockquote(line.text) || isIndentedContinuation(line.text)) {
        quotePendingExit = false;
      } else {
        inQuote = false;
        quotePendingExit = false;
        markClosed(line.start);
      }
    }

    if (inList && listPendingExit) {
      if (isListItem(line.text) || isIndentedContinuation(line.text) || isBlockquote(line.text)) {
        listPendingExit = false;
      } else {
        inList = false;
        listPendingExit = false;
        markClosed(line.start);
      }
    }

    if (inContainer()) {
      if (isBlockquote(line.text)) inQuote = true;
      if (isListItem(line.text)) inList = true;
      continue;
    }

    const openedFence = isFenceOpenLine(line.text);
    if (openedFence) {
      if (inParagraph) closeParagraph(line.start);
      fence = openedFence;
      inParagraph = false;
      inlineTicks = 0;
      continue;
    }

    const html1 = isHtmlType1Open(line.text);
    if (html1) {
      if (inParagraph) closeParagraph(line.start);
      inParagraph = false;
      inlineTicks = 0;
      if (isHtmlType1Close(line.text, html1)) {
        if (hasNewline) markClosed(line.next);
      } else {
        html = { kind: "type1", tag: html1 };
      }
      continue;
    }

    const htmlBlock = matchHtmlBlockStart(line.text, inParagraph);
    if (htmlBlock) {
      if (inParagraph) closeParagraph(line.start);
      inParagraph = false;
      inlineTicks = 0;
      if (htmlBlock.state) {
        html = htmlBlock.state;
      } else if (hasNewline) {
        markClosed(line.next);
      }
      continue;
    }

    if (isBracketMathOneLine(line.text) || isDisplayDollarOneLine(line.text)) {
      if (inParagraph) closeParagraph(line.start);
      inParagraph = false;
      inlineTicks = 0;
      if (hasNewline) markClosed(line.next);
      continue;
    }

    if (isBracketMathOpen(line.text)) {
      if (inParagraph) closeParagraph(line.start);
      inParagraph = false;
      inlineTicks = 0;
      math = { kind: "bracket" };
      continue;
    }

    const dollarOpen = isDisplayDollarOpen(line.text);
    if (dollarOpen) {
      if (inParagraph) closeParagraph(line.start);
      inParagraph = false;
      inlineTicks = 0;
      math = { kind: "dollar", indent: dollarOpen.indent };
      continue;
    }

    if (isAtxHeading(line.text)) {
      if (inParagraph) closeParagraph(line.start);
      inParagraph = false;
      inlineTicks = 0;
      if (hasNewline) markClosed(line.next);
      continue;
    }

    if (inParagraph && isSetextUnderline(line.text)) {
      inParagraph = false;
      inlineTicks = 0;
      if (hasNewline) markClosed(line.next);
      continue;
    }

    if (!inParagraph && isThematicBreak(line.text)) {
      inlineTicks = 0;
      if (hasNewline) markClosed(line.next);
      continue;
    }

    if (isBlockquote(line.text)) {
      if (inParagraph) closeParagraph(line.start);
      inQuote = true;
      quotePendingExit = false;
      inParagraph = false;
      inlineTicks = 0;
      continue;
    }

    if (isListItem(line.text) && (!inParagraph || canListInterruptParagraph(line.text))) {
      if (inParagraph) closeParagraph(line.start);
      inList = true;
      listPendingExit = false;
      inParagraph = false;
      inlineTicks = 0;
      continue;
    }

    if (!inParagraph && isIndentedCodeLine(line.text)) {
      indented = true;
      continue;
    }

    if (
      !inParagraph
      && isTableRow(line.text)
      && (isLast || isTableDelimiter(lines[index + 1]?.text ?? ""))
    ) {
      if (isLast && !isTableDelimiter(line.text)) continue;
      table = { seenDelim: false };
      continue;
    }

    inParagraph = true;
    inlineTicks = updateInlineCodeMarker(line.text, inlineTicks);
  }

  return lastCompleteEnd;
}
