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
const { Tooltip, Dialog, DialogTitle, Collapsible } = await jiti.import("./primitives.tsx");
const code = await readFile(new URL("./primitives.tsx", import.meta.url), "utf8");

test("Tooltip renders child trigger on SSR without crashing", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      Tooltip,
      { content: "Help text" },
      React.createElement("button", { type: "button" }, "Click me"),
    ),
  );

  assert.match(html, /Click me/);
  assert.match(html, /<button/);
});

test("Tooltip skips hover-only portals for coarse or hover-none pointers", () => {
  assert.match(code, /\(hover:\s*none\)/);
  assert.match(code, /\(pointer:\s*coarse\)/);
  assert.match(code, /BaseTooltip\.Trigger/);
  assert.match(code, /isCoarse \|\| !content \? null/);
  assert.match(code, /disabled=\{isCoarse \|\| !content\}/);
  assert.match(code, /"aria-label": content/);
});

test("Dialog and Collapsible render without throwing", () => {
  const dialogHtml = renderToStaticMarkup(
    React.createElement(
      Dialog,
      { open: false, onOpenChange: () => {} },
      React.createElement(DialogTitle, null, "Test Title"),
    ),
  );
  assert.equal(typeof dialogHtml, "string");

  const collHtml = renderToStaticMarkup(
    React.createElement(
      Collapsible,
      { open: true, onOpenChange: () => {} },
      React.createElement("div", null, "Panel"),
    ),
  );
  assert.match(collHtml, /Panel/);
});
