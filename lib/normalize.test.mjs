import test from "node:test";
import assert from "node:assert/strict";

const { normalizeToolCalls } = await import("./normalize.ts");

test("normalizeToolCalls preserves opaque tool-call metadata", () => {
  const message = {
    role: "assistant",
    content: [{
      type: "toolCall",
      id: "legacy-id",
      name: "read",
      arguments: { path: "src/index.ts" },
      providerMetadata: { traceId: "trace-1" },
      unknownField: { keep: true },
    }],
  };

  const normalized = normalizeToolCalls(message);
  assert.deepEqual(normalized.content[0], {
    type: "toolCall",
    id: "legacy-id",
    name: "read",
    arguments: { path: "src/index.ts" },
    providerMetadata: { traceId: "trace-1" },
    unknownField: { keep: true },
    toolCallId: "legacy-id",
    toolName: "read",
    input: { path: "src/index.ts" },
  });
});
