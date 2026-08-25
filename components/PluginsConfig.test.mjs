import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { PackageDetail } = await jiti.import("./PluginsConfig.tsx");

const samplePackage = {
  source: "@test/plugin",
  scope: "global",
  status: "loaded",
  disabled: false,
  filtered: false,
  installedPath: "/path/to/plugin",
  counts: { extensions: 1, skills: 0, prompts: 0, themes: 0 },
  resources: [],
  diagnostics: [],
};

test("disables session reload button when runtimeReady is false", () => {
  const html = renderToStaticMarkup(
    React.createElement(PackageDetail, {
      pkg: samplePackage,
      cwd: "/test",
      busyKey: null,
      actionError: null,
      actionMessage: null,
      sessionId: "session-123",
      onAction: () => {},
      onReloadSession: () => {},
      runtimeReady: false,
    }),
  );

  assert.match(html, /<button[^>]*disabled=""[^>]*title="Open a session to reload"[^>]*>Reload session<\/button>/);
});

test("enables session reload button when sessionId is present and runtimeReady is true", () => {
  const html = renderToStaticMarkup(
    React.createElement(PackageDetail, {
      pkg: samplePackage,
      cwd: "/test",
      busyKey: null,
      actionError: null,
      actionMessage: null,
      sessionId: "session-123",
      onAction: () => {},
      onReloadSession: () => {},
      runtimeReady: true,
    }),
  );

  assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*title="Reload current session"[^>]*>Reload session<\/button>/);
  assert.match(html, /title="Reload current session"/);
});

test("disables session reload button when sessionId is null even if runtimeReady is true", () => {
  const html = renderToStaticMarkup(
    React.createElement(PackageDetail, {
      pkg: samplePackage,
      cwd: "/test",
      busyKey: null,
      actionError: null,
      actionMessage: null,
      sessionId: null,
      onAction: () => {},
      onReloadSession: () => {},
      runtimeReady: true,
    }),
  );

  assert.match(html, /<button[^>]*disabled=""[^>]*title="Open a session to reload"[^>]*>Reload session<\/button>/);
});
