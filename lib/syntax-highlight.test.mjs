import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});

const {
  LONG_CODE_BLOCK_LINE_LIMIT,
  countCodeLines,
  ensureLanguageRegistered,
  isLanguageRegistered,
  isPlainTextLanguage,
  shouldHighlightLanguage,
  shouldShowCodeLineNumbers,
} = await jiti.import("./syntax-highlight.ts");
const { SyntaxHighlightedCode } = await jiti.import("../components/SyntaxHighlightedCode.tsx");

const source = await readFile(new URL("./syntax-highlight.ts", import.meta.url), "utf8");

function lineNumberNodeCount(html) {
  return html.match(/linenumber/g)?.length ?? 0;
}

test("eager grammar imports stay static for Turbopack compatibility", () => {
  const executable = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(executable, /import typescript from "react-syntax-highlighter\/dist\/esm\/languages\/prism\/typescript"/);
  assert.doesNotMatch(executable, /\(\)\s*=>\s*import\(/);
});

test("plain text labels are not treated as syntax grammars", () => {
  assert.equal(isPlainTextLanguage("text"), true);
  assert.equal(isPlainTextLanguage("plaintext"), true);
  assert.equal(isPlainTextLanguage("PlainText"), true);
  assert.equal(isLanguageRegistered("text"), false);
  assert.equal(isLanguageRegistered("plaintext"), false);
  assert.equal(shouldHighlightLanguage("text"), false);
  assert.equal(shouldHighlightLanguage("plaintext"), false);
  assert.equal(shouldHighlightLanguage("ts"), true);
});

test("supported languages and aliases are registered; unknown languages are not", () => {
  assert.equal(isLanguageRegistered("ts"), true);
  assert.equal(isLanguageRegistered("TypeScript"), true);
  assert.equal(isLanguageRegistered("python"), true);
  assert.equal(isLanguageRegistered("py"), true);
  assert.equal(isLanguageRegistered("not-a-real-lang"), false);
  assert.equal(isLanguageRegistered(""), false);
  assert.equal(ensureLanguageRegistered("ts"), null);
});

test("line numbers are omitted for coarse pointers or long fences", () => {
  assert.equal(shouldShowCodeLineNumbers({ isCoarsePointer: false, lineCount: 3 }), true);
  assert.equal(shouldShowCodeLineNumbers({ isCoarsePointer: true, lineCount: 3 }), false);
  assert.equal(shouldShowCodeLineNumbers({
    isCoarsePointer: false,
    lineCount: LONG_CODE_BLOCK_LINE_LIMIT,
  }), true);
  assert.equal(shouldShowCodeLineNumbers({
    isCoarsePointer: false,
    lineCount: LONG_CODE_BLOCK_LINE_LIMIT + 1,
  }), false);
  assert.equal(shouldShowCodeLineNumbers({
    isCoarsePointer: true,
    lineCount: LONG_CODE_BLOCK_LINE_LIMIT + 20,
  }), false);
});

test("desktop short supported fences highlight with one line-number node per line", () => {
  const code = "const value = 1;\nexport const two = 2;";
  const html = renderToStaticMarkup(React.createElement(SyntaxHighlightedCode, {
    code,
    lang: "ts",
  }));

  assert.match(html, /const/);
  assert.match(html, /value/);
  assert.match(html, /token/);
  assert.equal(lineNumberNodeCount(html), countCodeLines(code));
});

test("long fences keep highlighted content without line-number nodes", () => {
  const last = LONG_CODE_BLOCK_LINE_LIMIT;
  const code = Array.from({ length: last + 1 }, (_, i) => `const n${i} = ${i};`).join("\n");
  const html = renderToStaticMarkup(React.createElement(SyntaxHighlightedCode, {
    code,
    lang: "ts",
  }));

  assert.match(html, /n0/);
  assert.match(html, new RegExp(`n${last}`));
  assert.match(html, /token/);
  assert.equal(lineNumberNodeCount(html), 0);
});

test("unknown languages degrade to plain content without line-number nodes", () => {
  const code = "print('hello')\nprint('world')";
  const html = renderToStaticMarkup(React.createElement(SyntaxHighlightedCode, {
    code,
    lang: "not-a-real-lang",
  }));

  assert.match(html, /print/);
  assert.match(html, /hello/);
  assert.match(html, /world/);
  assert.doesNotMatch(html, /linenumber/);
  assert.doesNotMatch(html, /react-syntax-highlighter/);
});
