import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ExtensionsTabs, SettingsTabs, SETTINGS_CATEGORIES, getNormalizedActive } = await jiti.import("./SettingsTabs.tsx");

test("horizontal settings tabs expose every category description", () => {
  const html = renderToStaticMarkup(React.createElement(SettingsTabs, {
    active: "general",
    onSelect: () => {},
    layout: "horizontal",
  }));

  for (const category of SETTINGS_CATEGORIES) {
    assert.ok(html.includes(`>${category.description}<`), `description is not visibly rendered for ${category.id}`);
  }
});

test("settings tabs remain enabled and expose one keyboard-focusable active tab", () => {
  const html = renderToStaticMarkup(React.createElement(SettingsTabs, {
    active: "providers",
    onSelect: () => {},
    layout: "horizontal",
  }));

  assert.equal((html.match(/role="tab"/g) ?? []).length, SETTINGS_CATEGORIES.length);
  assert.doesNotMatch(html, /\sdisabled(?:=|\s|>)/);
  assert.equal((html.match(/aria-selected="true"/g) ?? []).length, 1);
  assert.match(html, /id="settings-tab-providers"[^>]*aria-selected="true"[^>]*tabindex="0"/);
});

test("extension deep links select the single Extensions & Tools category", () => {
  assert.equal(getNormalizedActive("tools"), "extensions");
  assert.equal(getNormalizedActive("mcp"), "extensions");
  assert.equal(getNormalizedActive("skills"), "extensions");
  assert.equal(getNormalizedActive("plugins"), "extensions");
  assert.equal(getNormalizedActive("extensions"), "extensions");

  const html = renderToStaticMarkup(React.createElement(SettingsTabs, {
    active: "skills",
    onSelect: () => {},
    layout: "horizontal",
  }));
  assert.equal((html.match(/role="tab"/g) ?? []).length, SETTINGS_CATEGORIES.length);
  assert.match(html, /id="settings-tab-extensions"[^>]*aria-selected="true"/);
});

test("extension segmented tabs expose exactly one selected subpanel target", () => {
  const html = renderToStaticMarkup(React.createElement(ExtensionsTabs, {
    active: "plugins",
    onSelect: () => {},
  }));
  assert.equal((html.match(/role="tab"/g) ?? []).length, 4);
  for (const label of ["Optional Tools", "MCP Servers", "Skills", "Plugins"]) assert.ok(html.includes(label), `${label} segment is missing`);
  assert.match(html, /id="settings-extension-tab-plugins"[^>]*aria-selected="true"/);
  assert.match(html, /aria-controls="settings-extension-panel-tools"/);
  assert.match(html, /aria-controls="settings-extension-panel-mcp"/);
  assert.match(html, /aria-controls="settings-extension-panel-skills"/);
  assert.match(html, /aria-controls="settings-extension-panel-plugins"/);
});

test("extension segmented tabs place Optional Tools first in tab order", () => {
  const html = renderToStaticMarkup(React.createElement(ExtensionsTabs, {
    active: "tools",
    onSelect: () => {},
  }));
  assert.match(html, /id="settings-extension-tab-tools"[^>]*aria-selected="true"/);
  const toolsIndex = html.indexOf("settings-extension-tab-tools");
  const mcpIndex = html.indexOf("settings-extension-tab-mcp");
  const skillsIndex = html.indexOf("settings-extension-tab-skills");
  const pluginsIndex = html.indexOf("settings-extension-tab-plugins");
  assert.ok(toolsIndex < mcpIndex, "tools must come before mcp");
  assert.ok(mcpIndex < skillsIndex, "mcp must come before skills");
  assert.ok(skillsIndex < pluginsIndex, "skills must come before plugins");
});
