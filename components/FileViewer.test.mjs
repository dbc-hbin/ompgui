import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { PlainFileSource, splitPlainFileLines } = await jiti.import("./FileViewer.tsx");

function lineNumbers(html) {
  return [...html.matchAll(/data-line-number="(\d+)"/g)].map((match) => Number(match[1]));
}

test("plain text keeps line-addressable source controls", () => {
  const code = "alpha\nbeta\n";
  const html = renderToStaticMarkup(React.createElement(PlainFileSource, {
    content: code,
    wrapLines: false,
  }));

  assert.doesNotMatch(html, /react-syntax-highlighter/);
  assert.deepEqual(lineNumbers(html), [1, 2, 3]);
  assert.match(html, /class="file-source-line"/);
  assert.match(html, /class="file-source-line-content"/);
  assert.match(html, /class="linenumber"/);
  assert.match(html, />alpha</);
  assert.match(html, />beta</);
});

test("plaintext wrap mode still exposes selectable line content", () => {
  const html = renderToStaticMarkup(React.createElement(PlainFileSource, {
    content: "one line",
    wrapLines: true,
  }));
  assert.match(html, /data-line-number="1"/);
  assert.match(html, /file-source-line-content/);
  assert.match(html, /white-space:pre-wrap/);
});

test("empty plain-text lines keep height without inserting copy text", () => {
  const content = "alpha\n\nbeta";
  assert.deepEqual(splitPlainFileLines(content), ["alpha", "", "beta"]);
  const html = renderToStaticMarkup(React.createElement(PlainFileSource, {
    content,
    wrapLines: false,
  }));
  assert.equal(html.includes("\u00a0"), false);
  assert.doesNotMatch(html, /&nbsp;/);
  assert.match(html, /min-height:1.6em/);
  assert.deepEqual(lineNumbers(html), [1, 2, 3]);
});

test("plain fallback is memoized so selection-only updates skip line rebuild", () => {
  assert.equal(PlainFileSource.$$typeof, Symbol.for("react.memo"));
  const content = "alpha\n\nbeta";
  assert.deepEqual(splitPlainFileLines(content), splitPlainFileLines(content));
  assert.equal(splitPlainFileLines(content).length, 3);
});
