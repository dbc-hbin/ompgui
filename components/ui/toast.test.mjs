import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const root = new URL("../../", import.meta.url);
const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ClampedDescription, clampDescriptionStyle, ToastProvider } = await jiti.import("./toast.tsx");

const TOOL_LIST = "xd://: mounted mcp__ida_reverse_engineering_ida_address_context, mcp__ida_decompile";

test("ToastProvider renders without throwing and mounts container", () => {
  const html = renderToStaticMarkup(React.createElement(ToastProvider, null, React.createElement("div", null, "App Content")));
  assert.match(html, /App Content/);
});

test("Toaster positions mobile viewport at bottom with safe-area and provides 44px close target", async () => {
  const code = await readFile(new URL("components/ui/toast.tsx", root), "utf8");

  // Mobile viewport at bottom with safe-area inset
  assert.match(code, /bottom:\s*"max\(var\(--space-4\),\s*env\(safe-area-inset-bottom,\s*0px\)\)"/);
  // Desktop viewport top-right preserved
  assert.match(code, /top:\s*80/);
  assert.match(code, /right:\s*"var\(--space-6\)"/);

  assert.match(code, /width:\s*isMobile\s*\?\s*44/);
  assert.match(code, /height:\s*isMobile\s*\?\s*44/);
  assert.match(code, /minWidth:\s*isMobile\s*\?\s*44/);
  assert.match(code, /minHeight:\s*isMobile\s*\?\s*44/);
  assert.match(code, /touchAction:\s*"manipulation"/);
});

test("clamped description renders collapsed to 2 lines with an expand affordance", () => {
  const html = renderToStaticMarkup(React.createElement(ClampedDescription, null, TOOL_LIST));

  assert.match(html, new RegExp(TOOL_LIST.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /-webkit-line-clamp:2/);
  assert.match(html, /-webkit-box/);
  assert.match(html, /overflow:hidden/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /cursor:pointer/);
  assert.match(html, /Click to expand/);
});

test("add forwards timeout from timeout or duration options", async () => {
  const code = await readFile(new URL("components/ui/toast.tsx", root), "utf8");
  assert.match(code, /interface ToastOptions \{[\s\S]*timeout\?: number;[\s\S]*duration\?: number;/);
  assert.match(code, /const timeout = options\?\.timeout \?\? options\?\.duration;/);
  assert.match(code, /\.\.\.\(timeout !== undefined \? \{ timeout \} : \{\}\)/);
});

test("clamp style helper drops the clamp when expanded", () => {
  const collapsed = clampDescriptionStyle(false);
  const expanded = clampDescriptionStyle(true);

  assert.equal(collapsed.display, "-webkit-box");
  assert.equal(collapsed.WebkitLineClamp, 2);
  assert.equal(collapsed.overflow, "hidden");
  assert.equal(collapsed.cursor, "pointer");

  assert.equal(expanded.display, undefined);
  assert.equal(expanded.WebkitLineClamp, undefined);
  assert.equal(expanded.overflow, undefined);
  assert.equal(expanded.cursor, "default");
});
