import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  Button,
  PrimaryButton,
  ConfirmDialog,
  Field,
  SecretInput,
  Select,
  Switch,
  TextInput,
} = await jiti.import("./field.tsx");

test("Select renders string options and preserves value selection", () => {
  const html = renderToStaticMarkup(
    React.createElement(Select, {
      value: "medium",
      onChange: () => {},
      options: ["low", "medium", "high"],
      required: true,
      id: "test-verbosity",
    }),
  );

  assert.match(html, /<select[^>]*id="test-verbosity"/);
  assert.match(html, /<option value="low"[^>]*>low<\/option>/);
  assert.match(html, /<option value="medium"[^>]*>medium<\/option>/);
  assert.match(html, /<option value="high"[^>]*>high<\/option>/);
  // required select does not prepend an empty option when not requested
  assert.doesNotMatch(html, /<option value=""/);
});

test("Select renders labeled { value, label } options and round-trips values", () => {
  const options = [
    { value: "steer", label: "Steer current execution" },
    { value: "queue", label: "Queue follow-up turn" },
  ];
  const html = renderToStaticMarkup(
    React.createElement(Select, {
      value: "steer",
      onChange: () => {},
      options,
      required: true,
      "aria-label": "Submit behavior",
    }),
  );

  assert.match(html, /aria-label="Submit behavior"/);
  assert.match(html, /<option value="steer"[^>]*>Steer current execution<\/option>/);
  assert.match(html, /<option value="queue"[^>]*>Queue follow-up turn<\/option>/);
});

test("Select renders placeholder when optional or explicitly provided", () => {
  const html = renderToStaticMarkup(
    React.createElement(Select, {
      value: "",
      onChange: () => {},
      options: ["gpt-4o", "claude-3-5-sonnet"],
      placeholder: "Choose a model",
      id: "model-select",
    }),
  );

  assert.match(html, /<option value=""[^>]*>Choose a model<\/option>/);
  assert.match(html, /<option value="gpt-4o"/);
});

test("Button renders primary variant with semantic styling and supports busy state", () => {
  const normalHtml = renderToStaticMarkup(
    React.createElement(Button, { type: "submit" }, "Save changes"),
  );
  assert.match(normalHtml, /type="submit"/);
  assert.match(normalHtml, /Save changes/);
  assert.match(normalHtml, /background:var\(--accent-strong\)/);
  assert.doesNotMatch(normalHtml, /disabled/);

  const busyHtml = renderToStaticMarkup(
    React.createElement(Button, { busy: true }, "Saving…"),
  );
  assert.match(busyHtml, /aria-busy="true"/);
  assert.match(busyHtml, /disabled/);
  assert.match(busyHtml, /cursor:wait/);
});

test("Button renders secondary variant with border and transparent background", () => {
  const html = renderToStaticMarkup(
    React.createElement(Button, { variant: "secondary" }, "Cancel"),
  );
  assert.match(html, /background:transparent/);
  assert.match(html, /border:1px solid var\(--border\)/);
  assert.match(html, /Cancel/);
});

test("Button alias PrimaryButton is available and functions identically", () => {
  assert.equal(PrimaryButton, Button);
});

test("Switch renders role=switch and maintains >=44px touch hit area", () => {
  const checkedHtml = renderToStaticMarkup(
    React.createElement(Switch, {
      checked: true,
      onChange: () => {},
      ariaLabel: "Enable Auto-Learn",
    }),
  );

  assert.match(checkedHtml, /role="switch"/);
  assert.match(checkedHtml, /aria-checked="true"/);
  assert.match(checkedHtml, /aria-label="Enable Auto-Learn"/);
  assert.match(checkedHtml, /min-width:var\(--control-touch,\s*44px\)/);
  assert.match(checkedHtml, /min-height:var\(--control-touch,\s*44px\)/);

  const uncheckedHtml = renderToStaticMarkup(
    React.createElement(Switch, {
      checked: false,
      onChange: () => {},
      "aria-label": "Review Subagents",
    }),
  );

  assert.match(uncheckedHtml, /role="switch"/);
  assert.match(uncheckedHtml, /aria-checked="false"/);
  assert.match(uncheckedHtml, /aria-label="Review Subagents"/);
});

test("SecretInput renders password field with password-manager and paste semantics", () => {
  const html = renderToStaticMarkup(
    React.createElement(SecretInput, {
      id: "web-password",
      name: "password",
      value: "topsecret",
      onChange: () => {},
      autoComplete: "current-password",
      autoFocus: true,
      required: true,
      placeholder: "••••••••",
    }),
  );

  assert.match(html, /<input[^>]*type="password"/);
  assert.match(html, /id="web-password"/);
  assert.match(html, /name="password"/);
  assert.match(html, /autoComplete="current-password"/i);
  assert.match(html, /placeholder="••••••••"/);
  assert.match(html, /required/);
  assert.doesNotMatch(html, /tabindex="-1"/);
  assert.match(html, /min-width:var\(--control-touch,\s*44px\)/);
  assert.match(html, /min-height:var\(--control-touch,\s*44px\)/);
});

test("SecretInput forwards invalid semantics and describedby to the native input", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      Field,
      { label: "Password", error: "Incorrect password" },
      React.createElement(SecretInput, {
        id: "web-password",
        value: "bad",
        onChange: () => {},
        error: "Incorrect password",
      }),
    ),
  );

  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /aria-describedby="web-password-error"/);
  assert.match(html, /Incorrect password/);
});

test("Field renders label, required asterisk, and error alert", () => {
  const validHtml = renderToStaticMarkup(
    React.createElement(
      Field,
      { label: "API Key", required: true },
      React.createElement(TextInput, { value: "sk-...", onChange: () => {} }),
    ),
  );
  assert.match(validHtml, /API Key/);
  assert.match(validHtml, /\*/);

  const errorHtml = renderToStaticMarkup(
    React.createElement(
      Field,
      { label: "API Key", error: "Key is required" },
      React.createElement(TextInput, { value: "", onChange: () => {} }),
    ),
  );
  assert.match(errorHtml, /role="alert"/);
  assert.match(errorHtml, /Key is required/);
});

test("ConfirmDialog renders without throwing", () => {
  const html = renderToStaticMarkup(
    React.createElement(ConfirmDialog, {
      open: true,
      onOpenChange: () => {},
      title: "Discard changes?",
      description: "You have unsaved changes that will be lost.",
      confirmLabel: "Discard",
      cancelLabel: "Keep editing",
      danger: true,
      onConfirm: () => {},
    }),
  );

  assert.equal(typeof html, "string");
});
