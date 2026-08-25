import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { BranchNavigator } = await jiti.import("./BranchNavigator.tsx");

const sampleTree = [
  {
    entry: { id: "root-1", type: "message", message: { role: "user", content: "Hello" } },
    children: [
      {
        entry: { id: "leaf-1", type: "message", message: { role: "assistant", content: "Branch 1" } },
        children: [],
      },
      {
        entry: { id: "leaf-2", type: "message", message: { role: "assistant", content: "Branch 2" } },
        children: [],
      },
    ],
  },
];

test("renders inline branch button disabled when runtimeReady is false", () => {
  const html = renderToStaticMarkup(
    React.createElement(BranchNavigator, {
      tree: sampleTree,
      activeLeafId: "leaf-1",
      onLeafChange: () => {},
      inline: true,
      runtimeReady: false,
    }),
  );

  assert.match(html, /<button[^>]*disabled=""/);
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /cursor:\s*not-allowed/);
});

test("renders inline branch button enabled when runtimeReady is true", () => {
  const html = renderToStaticMarkup(
    React.createElement(BranchNavigator, {
      tree: sampleTree,
      activeLeafId: "leaf-1",
      onLeafChange: () => {},
      inline: true,
      runtimeReady: true,
    }),
  );

  assert.doesNotMatch(html, /<button[^>]*disabled=""/);
  assert.doesNotMatch(html, /aria-disabled="true"/);
});

test("renders dropdown nodes with disabled attributes when disabled prop is true", () => {
  const html = renderToStaticMarkup(
    React.createElement(BranchNavigator, {
      tree: sampleTree,
      activeLeafId: "leaf-1",
      onLeafChange: () => {},
      open: true,
      disabled: true,
    }),
  );

  assert.match(html, /<button[^>]*disabled=""/);
  assert.match(html, /aria-disabled="true"/);
});
