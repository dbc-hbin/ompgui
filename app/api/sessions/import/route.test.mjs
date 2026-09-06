import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "") } });
const { POST } = await jiti.import("./route.ts");

test("rejects non-object or malformed JSONL records before persisting an import", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "ompgui-import-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    for (const invalid of ["null", "[]", '"text"', "42", "true", '{"torn":']) {
      const content = [
        JSON.stringify({ type: "session", version: 3, id: "source", cwd: agentDir }),
        invalid,
        JSON.stringify({ type: "message", id: "user", parentId: null, message: { role: "user", content: "valid surrounding record" } }),
      ].join("\n");
      const response = await POST(new Request("http://localhost/api/sessions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: "import.jsonl", content }),
      }));
      assert.equal(response.status, 400, invalid);
      assert.equal((await response.json()).code, "invalid_session_file", invalid);
      assert.equal(existsSync(join(agentDir, "sessions")), false);
    }
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(agentDir, { recursive: true, force: true });
  }
});
