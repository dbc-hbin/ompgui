import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ExtensionDialog } = await jiti.import("./ExtensionDialog.tsx");

test("renders confirm dialog buttons disabled when runtimeReady is false", () => {
  const html = renderToStaticMarkup(
    React.createElement(ExtensionDialog, {
      request: { id: "req-1", method: "confirm", title: "Allow Tool", message: "Allow tool execution?" },
      onRespond: () => {},
      runtimeReady: false,
    }),
  );

  // Both cancel and confirm buttons should have disabled and aria-disabled="true"
  assert.match(html, /<button[^>]*disabled=""[^>]*aria-disabled="true"[^>]*>.*Cancel.*<\/button>/s);
  assert.match(html, /<button[^>]*disabled=""[^>]*aria-disabled="true"[^>]*>.*Confirm.*<\/button>/s);
});

test("renders select dialog options disabled when runtimeReady is false", () => {
  const html = renderToStaticMarkup(
    React.createElement(ExtensionDialog, {
      request: { id: "req-2", method: "select", title: "Select Option", options: ["Option A", "Option B"] },
      onRespond: () => {},
      runtimeReady: false,
    }),
  );

  assert.match(html, /<button[^>]*disabled=""[^>]*aria-disabled="true"[^>]*>Option A<\/button>/);
  assert.match(html, /<button[^>]*disabled=""[^>]*aria-disabled="true"[^>]*>Option B<\/button>/);
});

test("renders input and editor fields disabled and readOnly when runtimeReady is false", () => {
  const inputHtml = renderToStaticMarkup(
    React.createElement(ExtensionDialog, {
      request: { id: "req-3", method: "input", title: "Enter value", placeholder: "type here" },
      onRespond: () => {},
      runtimeReady: false,
    }),
  );
  assert.match(inputHtml, /<input[^>]*disabled=""[^>]*readOnly=""/);

  const editorHtml = renderToStaticMarkup(
    React.createElement(ExtensionDialog, {
      request: { id: "req-4", method: "editor", title: "Edit text", prefill: "sample" },
      onRespond: () => {},
      runtimeReady: false,
    }),
  );
  assert.match(editorHtml, /<textarea[^>]*disabled=""[^>]*readOnly=""/);
});

test("renders controls enabled when runtimeReady is true", () => {
  const html = renderToStaticMarkup(
    React.createElement(ExtensionDialog, {
      request: { id: "req-5", method: "confirm", title: "Allow Tool", message: "Allow tool execution?" },
      onRespond: () => {},
      runtimeReady: true,
    }),
  );

  assert.doesNotMatch(html, /<button[^>]*disabled=""/);
  assert.doesNotMatch(html, /aria-disabled="true"/);
});
