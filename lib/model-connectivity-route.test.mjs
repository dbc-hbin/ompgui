import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const connectivity = await jiti.import("./omp/model-connectivity.ts");
const { POST } = await jiti.import("../app/api/models-config/connectivity/route.ts");

function request(body, headers = {}) {
  return new NextRequest("http://localhost/api/models-config/connectivity", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost", ...headers },
    body: JSON.stringify(body),
  });
}

test("REST security guards reject before connectivity dispatch", async (t) => {
  const saved = { OMPGUI_PASSWORD: process.env.OMPGUI_PASSWORD, OMP_WEB_PASSWORD: process.env.OMP_WEB_PASSWORD };
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  delete process.env.OMPGUI_PASSWORD;
  delete process.env.OMP_WEB_PASSWORD;
  const dispatch = t.mock.method(connectivity, "verifyModelConnectivity", async () => {
    throw new Error("unexpected provider dispatch");
  });
  const unconfirmed = await POST(request({ confirm: false }));
  assert.equal(unconfirmed.status, 400);
  assert.equal((await unconfirmed.json()).code, "connectivity_confirmation_required");
  const crossOrigin = await POST(request({ confirm: true }, { origin: "https://untrusted.example" }));
  assert.equal(crossOrigin.status, 403);
  const oversized = await POST(request({ confirm: true, padding: "x".repeat(512 * 1024) }));
  assert.equal(oversized.status, 413);
  process.env.OMPGUI_PASSWORD = "test-only-password";
  const unauthenticated = await POST(request({ confirm: true }));
  assert.equal(unauthenticated.status, 401);
  assert.equal((await unauthenticated.json()).code, "password_required");
  assert.equal(dispatch.mock.callCount(), 0);
});
