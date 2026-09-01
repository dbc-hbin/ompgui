import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const code = await readFile(new URL("./useModalDialog.ts", import.meta.url), "utf8");

test("useModalDialog rebinds when the rendered panel identity changes", () => {
  assert.match(code, /identity\?: string \| number \| boolean/);
  assert.match(code, /\{ onClose, active = true, identity \}/);
  assert.match(code, /if \(!container \|\| !container\.isConnected\) return/);
  assert.match(code, /\}, \[active, identity\]\);/);
});
