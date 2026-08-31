import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { BuiltInToolsConfig } = await jiti.import("./BuiltInToolsConfig.tsx");

test("BuiltInToolsConfig renders exactly six approved cards", () => {
  const html = renderToStaticMarkup(
    React.createElement(BuiltInToolsConfig, {
      settings: {},
      onPatch: () => {},
    }),
  );

  const cardMatches = html.match(/data-tool-card="([^"]+)"/g) ?? [];
  assert.equal(cardMatches.length, 6, "Must render exactly 6 tool cards");

  const expectedCards = ["browser", "computer", "web_search", "github", "security", "checkpoint"];
  for (const card of expectedCards) {
    assert.match(html, new RegExp(`data-tool-card="${card}"`), `Missing card: ${card}`);
  }
});

test("BuiltInToolsConfig renders parent-level Global · New sessions scope note", () => {
  const html = renderToStaticMarkup(
    React.createElement(BuiltInToolsConfig, {
      settings: null,
      onPatch: () => {},
    }),
  );

  assert.match(html, /Global · New sessions/);
});

test("BuiltInToolsConfig reflects default OMP values when settings are omitted", () => {
  const html = renderToStaticMarkup(
    React.createElement(BuiltInToolsConfig, {
      settings: {},
      onPatch: () => {},
    }),
  );

  // Browser defaults: enabled=true
  assert.match(html, /data-tool-card="browser"[\s\S]*?role="switch"[\s\S]*?aria-checked="true"/);

  // Computer defaults: enabled=false
  assert.match(html, /data-tool-card="computer"[\s\S]*?role="switch"[\s\S]*?aria-checked="false"/);

  // Web Search defaults: enabled=true
  assert.match(html, /data-tool-card="web_search"[\s\S]*?role="switch"[\s\S]*?aria-checked="true"/);

  // GitHub defaults: enabled=false
  assert.match(html, /data-tool-card="github"[\s\S]*?role="switch"[\s\S]*?aria-checked="false"/);

  // Security Scan defaults: enabled=false
  assert.match(html, /data-tool-card="security"[\s\S]*?role="switch"[\s\S]*?aria-checked="false"/);

  // Checkpoint defaults: enabled=false
  assert.match(html, /data-tool-card="checkpoint"[\s\S]*?role="switch"[\s\S]*?aria-checked="false"/);
});

test("BuiltInToolsConfig exposes expand controls only for Browser and Computer", () => {
  const html = renderToStaticMarkup(
    React.createElement(BuiltInToolsConfig, {
      settings: {},
      onPatch: () => {},
    }),
  );

  // aria-expanded should only appear on Browser and Computer detail toggles
  const expandedButtons = html.match(/aria-expanded="[^"]*"/g) ?? [];
  assert.equal(expandedButtons.length, 2, "Only Browser and Computer should have collapsible detail toggles");

  assert.match(html, /aria-label="Expand browser settings"/);
  assert.match(html, /aria-label="Expand computer settings"/);
});

test("BuiltInToolsConfig renders accessible switches with 44px touch targets", () => {
  const html = renderToStaticMarkup(
    React.createElement(BuiltInToolsConfig, {
      settings: {
        browser: { enabled: true, relay: false, headless: true },
        computer: { enabled: true, display: "primary" },
      },
      onPatch: () => {},
    }),
  );

  // All switch buttons should have role="switch" and 44px touch target styling
  const switches = html.match(/role="switch"/g) ?? [];
  assert.ok(switches.length >= 6, "At least 6 switches must be rendered");
  assert.match(html, /min-width:var\(--control-touch,\s*44px\)/);
  assert.match(html, /min-height:var\(--control-touch,\s*44px\)/);
});
