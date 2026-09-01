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
const { LoginForm } = await jiti.import("./LoginForm.tsx");

test("LoginForm renders welcome title, password field, and submit button", () => {
  const html = renderToStaticMarkup(React.createElement(LoginForm));

  assert.match(html, /Welcome back/);
  assert.match(html, /Enter the password for this ompgui workspace\./);
  assert.match(html, /<label[^>]*>Password/);
  assert.match(html, /<input[^>]*id="web-password"/);
  assert.match(html, /<input[^>]*type="password"/);
  assert.match(html, /autoComplete="current-password"/i);
  assert.match(html, /<button[^>]*type="submit"[^>]*>Unlock workspace<\/button>/);
});

test("LoginForm submit button has primary styling with accent-strong background", () => {
  const html = renderToStaticMarkup(React.createElement(LoginForm));

  assert.match(html, /background:var\(--accent-strong\)/);
  assert.match(html, /color:var\(--on-accent\)/);
});

test("LoginForm passes password errors into SecretInput", async () => {
  const source = await readFile(new URL("./LoginForm.tsx", import.meta.url), "utf8");
  assert.match(source, /error=\{error\}/);
});
