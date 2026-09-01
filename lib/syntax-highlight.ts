// Shared PrismLight setup: registers a curated grammar set instead of the full
// Prism build, which bundles all ~600 refractor grammars plus the entire CJS
// theme barrel. The fence/file languages that dominate real sessions are
// registered here; unknown fence languages fall back to plain text without
// console noise (the highlighter catches the unknown-language error itself).
//
// IMPORTANT: every grammar is registered EAGERLY via static imports. The old
// design lazy-loaded rarer grammars with `() => import(...)`; Turbopack split
// those ESM-only refractor chains into async chunks and intermittently failed
// with:
//
//   Module .../languages/prism/c.js [app-client] (ecmascript) was instantiated
//   because it was required from module .../lib/syntax-highlight.ts <locals>,
//   but the module factory is not available.
//
// The async grammar chunk either raced with HMR or referenced a module factory
// in a chunk that was never evaluated, taking down the whole page. Next 16's
// `next dev` still uses Turbopack, so demand-loading is not a testable-safe
// cut. Static imports keep every grammar in the main client chunk. Grammars
// are small regex-based objects; render-work savings come from omitting
// line-number DOM on coarse pointers and long fences, not from dropping
// registrations.
import type { CSSProperties } from "react";
import createSyntaxElement from "react-syntax-highlighter/dist/esm/create-element";
import PrismLight from "react-syntax-highlighter/dist/esm/prism-light";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import c from "react-syntax-highlighter/dist/esm/languages/prism/c";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";
import csharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import docker from "react-syntax-highlighter/dist/esm/languages/prism/docker";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import graphql from "react-syntax-highlighter/dist/esm/languages/prism/graphql";
import hcl from "react-syntax-highlighter/dist/esm/languages/prism/hcl";
import ini from "react-syntax-highlighter/dist/esm/languages/prism/ini";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import kotlin from "react-syntax-highlighter/dist/esm/languages/prism/kotlin";
import makefile from "react-syntax-highlighter/dist/esm/languages/prism/makefile";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import protobuf from "react-syntax-highlighter/dist/esm/languages/prism/protobuf";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import ruby from "react-syntax-highlighter/dist/esm/languages/prism/ruby";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import scss from "react-syntax-highlighter/dist/esm/languages/prism/scss";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import swift from "react-syntax-highlighter/dist/esm/languages/prism/swift";
import toml from "react-syntax-highlighter/dist/esm/languages/prism/toml";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import vsTheme from "react-syntax-highlighter/dist/esm/styles/prism/vs";
import vscDarkPlusTheme from "react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus";

// Every grammar we render. Grammar modules carry their own aliases (ts, py,
// sh, html, yml, dockerfile, ...) and register their own dependencies, so
// registering under the canonical name is enough.
const GRAMMARS: Record<string, unknown> = {
  bash, c, cpp, csharp, css, diff, docker, go, graphql, hcl, ini, java,
  javascript, json, jsx, kotlin, makefile, markdown, markup, protobuf,
  python, ruby, rust, scss, sql, swift, toml, tsx, typescript, yaml,
};

type PrismGrammar = {
  aliases?: string[];
};

const registeredLanguages = new Set<string>();

for (const [name, grammar] of Object.entries(GRAMMARS)) {
  PrismLight.registerLanguage(name, grammar);
  registeredLanguages.add(name);
  for (const alias of (grammar as PrismGrammar).aliases ?? []) {
    registeredLanguages.add(alias.toLowerCase());
  }
}

/** Desktop omits per-line number nodes above this fence length. */
export const LONG_CODE_BLOCK_LINE_LIMIT = 200;

export const COARSE_POINTER_MEDIA_QUERY = "(hover: none), (pointer: coarse)";

export function normalizeFenceLanguage(language: string): string {
  return language.trim().toLowerCase();
}

export function countCodeLines(code: string): number {
  if (!code) return 0;
  let lines = 1;
  for (let i = 0; i < code.length; i++) {
    if (code.charCodeAt(i) === 10) lines += 1;
  }
  return lines;
}

/**
 * Line numbers double highlighter DOM. Skip them on coarse/mobile pointers
 * and on sufficiently long fences; copy/content stay on the same code string.
 */
export function shouldShowCodeLineNumbers(input: {
  isCoarsePointer: boolean;
  lineCount: number;
}): boolean {
  if (input.isCoarsePointer) return false;
  if (input.lineCount > LONG_CODE_BLOCK_LINE_LIMIT) return false;
  return input.lineCount > 0;
}

/**
 * True when a fence language has an eager Prism grammar (canonical name or
 * alias). Unknown languages are not registered and should render as plain text.
 */
export function isLanguageRegistered(language: string): boolean {
  const key = normalizeFenceLanguage(language);
  return key.length > 0 && registeredLanguages.has(key);
}

const PLAIN_TEXT_LANGUAGES = new Set(["text", "plaintext", "plain", "txt"]);

/** True for labels that mean "plain text", not a Prism grammar. */
export function isPlainTextLanguage(language: string): boolean {
  return PLAIN_TEXT_LANGUAGES.has(normalizeFenceLanguage(language));
}

/**
 * File/fence highlighting requires a real registered grammar. `text` and
 * `plaintext` stay line-addressable without registering a dummy language.
 */
export function shouldHighlightLanguage(language: string): boolean {
  return isLanguageRegistered(language) && !isPlainTextLanguage(language);
}

/**
 * Kept for API compatibility with callers that awaited a grammar load before
 * rendering (SyntaxHighlightedCode, FileViewer). Every grammar is already
 * registered, so there is never anything to wait for.
 */
export function ensureLanguageRegistered(language: string): Promise<void> | null {
  void language;
  return null;
}

const PRE_STYLE = 'pre[class*="language-"]';

function withoutPreBackground(theme: Record<string, CSSProperties>) {
  const preStyle = { ...theme[PRE_STYLE] };
  delete preStyle.background;
  delete preStyle.backgroundColor;
  return { ...theme, [PRE_STYLE]: preStyle };
}

const vs = withoutPreBackground(vsTheme);
const vscDarkPlus = withoutPreBackground(vscDarkPlusTheme);

export { createSyntaxElement, vs, vscDarkPlus };
export { PrismLight as SyntaxHighlighter };
