import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");
const {
  normalizeDisplayMath,
  loadMathMarkdownPlugins,
  splitStableMarkdownPrefix,
} = await jiti.import("../lib/markdown.ts");

function renderMarkdown(markdown, props = {}) {
  return renderToStaticMarkup(
    React.createElement(MarkdownBody, {
      cwd: "/home/me/project",
      onOpenFile() {},
      ...props,
    }, markdown),
  );
}

test("opens non-file markdown links in a safe new tab", () => {
  const html = renderMarkdown("[docs](https://example.com/docs)");

  assert.match(
    html,
    /<a (?=[^>]*href="https:\/\/example\.com\/docs")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>docs<\/a>/,
  );
  assert.doesNotMatch(html, /\snode=/);
});

test("keeps local file markdown links in the app", () => {
  const html = renderMarkdown("[file](components/MarkdownBody.tsx)");

  assert.match(html, /<a href="components\/MarkdownBody\.tsx">file<\/a>/);
  assert.doesNotMatch(html, /target=|rel=|\snode=/);
});

test("renders math as plain text until the lazy KaTeX pipeline loads", () => {
  const html = renderMarkdown(String.raw`射线为 \(r_c = K^{-1}p\)。`);

  assert.doesNotMatch(html, /class="katex"/);
  assert.match(html, /r_c/);
});

test("renders LaTeX parenthesis delimiters as inline math", async () => {
  await loadMathMarkdownPlugins();
  const html = renderMarkdown(String.raw`射线为 \(r_c = K^{-1}p\)。`);

  assert.match(html, /class="katex"/);
  assert.match(html, /r_c/);
});

test("renders paired LaTeX bracket delimiters as display math", async () => {
  await loadMathMarkdownPlugins();
  const html = renderMarkdown(String.raw`\[
P(\lambda)=o_b+\lambda r_b
\]`);
  const oneLineHtml = renderMarkdown(String.raw`\[P(\lambda)=o_b+\lambda r_b\]`);

  assert.match(html, /class="katex-display"/);
  assert.match(html, /lambda/);
  assert.match(oneLineHtml, /class="katex-display"/);
});

test("leaves an unmatched LaTeX bracket delimiter unchanged", () => {
  const markdown = String.raw`before
\[
x + y
after`;

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize LaTeX delimiters inside Markdown code", () => {
  const markdown = "    \\(indented\\)\n\n`code\n\\(inline\\)`\n\n```text\n\\[\nfenced\n\\]\n```";

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize LaTeX delimiters inside raw HTML code", () => {
  const markdown = "<code>\\(inline\\)</code>\n\n<pre>\n\\(block\\)\n</pre>";

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize escaped delimiters or link destinations", () => {
  const escaped = String.raw`Literal: \\(x+y\\).`;
  const link = String.raw`[docs](https://example.com/\(manual\))`;

  assert.equal(normalizeDisplayMath(escaped), escaped);
  assert.equal(normalizeDisplayMath(link), link);
});

const STREAM_FIXTURES = {
  fences: "Intro.\n\n```js\nconst n = 1;\n```\n\nOutro.",
  tables: "Before.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter.",
  math: "Before.\n\n$$\nx + y\n$$\n\nAfter.",
  html: "Before.\n\n<div>\nhello\n</div>\n\nAfter.",
  lists: "Before.\n\n- one\n- two\n\nAfter.",
  blockquotes: "Before.\n\n> quoted\n> still\n\nAfter.",
  cjk: "5~7U는 약 100~200倍입니다。\n\n다음 문단입니다.",
};

test("completed streaming output matches the full markdown pipeline", async () => {
  await loadMathMarkdownPlugins();
  for (const [name, markdown] of Object.entries(STREAM_FIXTURES)) {
    const full = renderMarkdown(markdown);
    const streaming = renderMarkdown(markdown, { isStreaming: true });
    const completed = renderMarkdown(markdown, { isStreaming: false });
    assert.equal(completed, full, name);
    assert.equal(streaming, full, `${name} streaming`);
  }

  const referenced = "See [docs][ref].\n\n[ref]: https://example.com/docs\n\nDone.";
  assert.equal(
    renderMarkdown(referenced, { isStreaming: true }),
    renderMarkdown(referenced),
  );
});

test("does not reparse a long stable prefix on tail-only streaming updates", () => {
  const prefix = "Stable paragraph about rendering cost.\n\n".repeat(80);
  let stableParses = 0;
  let lastStable = null;
  for (const tail of ["tai", "tail", "tail grows"]) {
    const { stable } = splitStableMarkdownPrefix(`${prefix}${tail}`);
    assert.equal(stable, prefix);
    if (stable !== lastStable) {
      lastStable = stable;
      stableParses++;
      normalizeDisplayMath(stable);
    }
  }
  assert.ok(prefix.length > 1000);
  assert.equal(stableParses, 1);
});
