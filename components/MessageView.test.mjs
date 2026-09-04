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
const { MessageView, SafeMarkdownBody, TaskResultPanel, loadToolResultImages } = await jiti.import("./MessageView.tsx");
const { CodeBlock } = await jiti.import("./MermaidBlock.tsx");
const { CHAT_COLUMN_MAX_WIDTH } = await jiti.import("../lib/chat-layout.ts");
const { collectToolResultImages } = await jiti.import("../lib/image-attachments.ts");
const messageViewSource = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");

test("large message content avoids the markdown pipeline until requested", () => {
  const largeMessage = "x".repeat(100_001);
  const html = renderToStaticMarkup(React.createElement(SafeMarkdownBody, null, largeMessage));

  assert.match(html, /Large message \(100 KB\)/);
  assert.doesNotMatch(html, /markdown-body/);
});

test("streaming code blocks avoid syntax-highlighter line markup", () => {
  const html = renderToStaticMarkup(React.createElement(CodeBlock, {
    code: "const value = 1;",
    lang: "ts",
    isStreaming: true,
  }));

  assert.match(html, /const value = 1;/);
  assert.doesNotMatch(html, /linenumber/);
  assert.doesNotMatch(html, /react-syntax-highlighter/);
});

test("MCP mount notices stay out of the transcript", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    message: {
      role: "custom",
      customType: "xdev-mount-notice",
      content: "The xd:// device inventory changed.",
      display: false,
    },
  }));

  assert.equal(html, "");
});

test("streaming tool calls start collapsed when the interface preference is enabled", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    isStreaming: true,
    toolCallsDefaultCollapsed: true,
    message: {
      role: "assistant",
      content: [{ type: "toolCall", toolCallId: "call-1", toolName: "read", input: { path: "foo.ts" } }],
    },
  }));

  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /<pre/);
});

test("streaming tool calls can still start expanded when the preference is disabled", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    isStreaming: true,
    toolCallsDefaultCollapsed: false,
    message: {
      role: "assistant",
      content: [{ type: "toolCall", toolCallId: "call-1", toolName: "read", input: { path: "foo.ts" } }],
    },
  }));

  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /<pre/);
});


test("task tool results render a per-subagent summary panel", () => {
  const html = renderToStaticMarkup(React.createElement(TaskResultPanel, {
    details: {
      totalDurationMs: 360000,
      async: { state: "completed", jobId: "Scout", type: "task" },
      results: [
        { id: "Scout", agent: "scout", task: "Map the surface", exitCode: 0, tokens: 999000, cost: 1.25, durationMs: 360000, resolvedModel: "provider/gpt-5.6:medium" },
        { id: "Worker", agent: "worker", task: "Write the code", exitCode: 1, error: "Test failed", tokens: 500 },
      ],
    },
  }));

  assert.match(html, /Subagents/);
  assert.match(html, /Map the surface/);
  assert.match(html, /Write the code/);
  assert.match(html, /2 subagents/);
  assert.match(html, /999k tok/);
  assert.match(html, /gpt-5.6/);
  assert.match(html, /\u23a4|⤴/);
});

test("task panel renders nothing without task details", () => {
  assert.equal(renderToStaticMarkup(React.createElement(TaskResultPanel, { details: undefined })), "");
  assert.equal(renderToStaticMarkup(React.createElement(TaskResultPanel, { details: { patch: "p" } })), "");
});

test("async-only task details render the job as one started row", () => {
  const html = renderToStaticMarkup(React.createElement(TaskResultPanel, {
    details: { async: { state: "running", jobId: "AsyncAudit", type: "task" } },
  }));
  assert.match(html, /1 subagent/);
  assert.match(html, /AsyncAudit/);
  assert.doesNotMatch(html, /0 subagents/);
});

test("irc:incoming custom messages title with the sender name", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    message: {
      role: "custom",
      customType: "irc:incoming",
      content: "<irc>\nIncoming IRC message from agent `AuditUiComponents`:\n\nPlease review the current tree.\nThanks.",
      display: true,
    },
  }));
  assert.match(html, /AuditUiComponents/);
  assert.doesNotMatch(html, /irc:incoming/);
  assert.match(html, /Please review the current tree/);
  assert.doesNotMatch(html, /Incoming IRC message from agent/);
});

test("advisor custom messages use the localized advisor label", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    message: { role: "custom", customType: "advisor", content: "Consider handling the edge case.", display: true },
  }));
  assert.match(html, /Advisor/);
  assert.match(html, /Consider handling the edge case/);
  assert.doesNotMatch(html, /customType/);
});

test("CHAT_COLUMN_MAX_WIDTH is 744", () => {
  assert.equal(CHAT_COLUMN_MAX_WIDTH, 744);
});

test("user message container uses quiet neutral border without accent mix or shadow", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    message: {
      role: "user",
      content: "Hello from user",
    },
  }));

  assert.match(html, /border:1px solid var\(--border\)/);
  assert.match(html, /box-shadow:none/);
  assert.doesNotMatch(html, /color-mix\(in srgb, var\(--accent\)/);
  assert.doesNotMatch(html, /var\(--shadow-card\)/);
});

test("user message actions render with touch-ready action button classes and labels", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    message: {
      role: "user",
      content: "Copyable text",
    },
    entryId: "entry-1",
    onFork: () => {},
    prevAssistantEntryId: "prev-1",
    onNavigate: () => {},
    onEditContent: () => {},
  }));

  assert.match(html, /class="[^"]*chat-action-row[^"]*"/);
  assert.match(html, /class="[^"]*chat-action-group[^"]*"/);
  assert.match(html, /class="[^"]*chat-action-btn[^"]*"/);
  assert.match(html, /aria-label="Copy message"/);
  assert.match(html, /aria-label="Jump back here and edit this message"/);
  assert.match(html, /aria-label="Fork a new session from this point"/);
  // Verify Lucide inline icon size 14 with strokeWidth 1.75
  assert.match(html, /width="14" height="14"[^>]*stroke-width="1.75"/);
});

test("normal tool call renders with neutral border and text without status-success tint", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    toolCallsDefaultCollapsed: false,
    message: {
      role: "assistant",
      content: [
        { type: "toolCall", toolCallId: "call-1", toolName: "read", input: { path: "foo.ts" } },
      ],
    },
    toolResults: new Map([
      ["call-1", { role: "toolResult", toolCallId: "call-1", toolName: "read", content: "file contents", isError: false }],
    ]),
  }));

  assert.match(html, /border:1px solid var\(--border\)/);
  assert.match(html, /color:var\(--text\)/);
  assert.doesNotMatch(html, /var\(--status-success\)/);
  // Chip chevron uses size 12 and strokeWidth 2
  assert.match(html, /width="12" height="12"[^>]*stroke-width="2"/);
});

test("error tool call renders with semantic error border and text", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    toolCallsDefaultCollapsed: false,
    message: {
      role: "assistant",
      content: [
        { type: "toolCall", toolCallId: "call-err", toolName: "bash", input: { command: "exit 1" } },
      ],
    },
    toolResults: new Map([
      ["call-err", { role: "toolResult", toolCallId: "call-err", toolName: "bash", content: "command failed", isError: true }],
    ]),
  }));

  assert.match(html, /border:1px solid var\(--status-error\)/);
  assert.match(html, /color:var\(--status-error\)/);
});

test("thinking block renders with normalized Lucide icons and neutral border", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Pondering the solution..." },
      ],
    },
  }));

  assert.match(html, /border:1px solid var\(--border\)/);
  // Brain icon: inline 14/1.75
  assert.match(html, /width="14" height="14"[^>]*stroke-width="1.75"/);
  // Chevron: chip 12/2
  assert.match(html, /width="12" height="12"[^>]*stroke-width="2"/);
});

const TEST_IMAGE_DATA = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function expandedToolCallHtml({ result, toolName = "read", sessionId } = {}) {
  return renderToStaticMarkup(React.createElement(MessageView, {
    // Streaming + expanded preference starts the tool call expanded, since
    // collapsed tool calls unmount their paired result.
    isStreaming: true,
    toolCallsDefaultCollapsed: false,
    sessionId,
    message: {
      role: "assistant",
      content: [{ type: "toolCall", toolCallId: "call-1", toolName, input: { path: "foo.ts" } }],
    },
    toolResults: new Map([["call-1", result]]),
  }));
}

test("assistant image blocks render inline through the clickable thumbnail", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Here is the screenshot:" },
        { type: "image", data: TEST_IMAGE_DATA, mimeType: "image/png" },
      ],
    },
  }));

  assert.match(html, /Here is the screenshot/);
  assert.match(html, new RegExp(`data:image/png;base64,${TEST_IMAGE_DATA}`));
  assert.match(html, /class="image-clickable"/);
});

test("assistant image blocks support the nested source shape", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    message: {
      role: "assistant",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: TEST_IMAGE_DATA } },
      ],
    },
  }));

  assert.match(html, new RegExp(`data:image/jpeg;base64,${TEST_IMAGE_DATA}`));
});

test("tool content images render inside the expanded paired tool call", () => {
  const html = expandedToolCallHtml({
    result: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "read",
      content: [
        { type: "text", text: "Screenshot captured" },
        { type: "image", data: TEST_IMAGE_DATA, mimeType: "image/png" },
      ],
    },
  });

  assert.match(html, /Screenshot captured/);
  assert.match(html, new RegExp(`data:image/png;base64,${TEST_IMAGE_DATA}`));
  assert.match(html, /class="image-clickable"/);
});

test("tool results with images only skip the no-output placeholder", () => {
  const html = expandedToolCallHtml({
    result: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "read",
      content: [{ type: "image", data: TEST_IMAGE_DATA, mimeType: "image/png" }],
    },
  });

  assert.match(html, new RegExp(`data:image/png;base64,${TEST_IMAGE_DATA}`));
  assert.doesNotMatch(html, /\(no output\)/);
});

test("non-image no-output results keep the localized empty-state styling", () => {
  const html = expandedToolCallHtml({
    result: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "read",
      content: "(no output)",
    },
  });

  assert.match(html, /\(no output\)/);
  assert.match(html, /font-style:italic/);
  assert.match(html, /opacity:0\.6/);
});

test("tool details.images render alongside text through the shared helper", () => {
  const image = { type: "image", data: TEST_IMAGE_DATA, mimeType: "image/png" };
  const result = {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "generate_image",
    content: [{ type: "text", text: "Generated" }],
    details: { images: [{ data: TEST_IMAGE_DATA, mimeType: "image/png" }] },
  };
  // Exact deduplication through the shared helper: the same payload in
  // content and details.images collapses to one image.
  assert.deepEqual(
    collectToolResultImages({ content: [...result.content, image], details: result.details }),
    [image],
  );
  const html = expandedToolCallHtml({ result, toolName: "generate_image" });
  assert.match(html, /Generated/);
  assert.match(html, new RegExp(`data:image/png;base64,${TEST_IMAGE_DATA}`));
});

test("shared helper deduplicates exact copies and tolerates malformed input", () => {
  const flat = { type: "image", data: TEST_IMAGE_DATA, mimeType: "image/png" };
  const nested = { type: "image", source: { type: "base64", media_type: "image/png", data: TEST_IMAGE_DATA } };
  assert.deepEqual(
    collectToolResultImages({ content: [flat, nested], details: { images: [{ data: TEST_IMAGE_DATA, mimeType: "image/png" }] } }),
    [{ type: "image", data: TEST_IMAGE_DATA, mimeType: "image/png" }],
  );
  assert.deepEqual(collectToolResultImages({ content: "oops", details: null }), []);
  assert.deepEqual(collectToolResultImages({}), []);
});

test("collapsed deferred results render no image and fetch no media", () => {
  const fetches = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    fetches.push([url, init]);
    throw new Error("must not fetch while collapsed");
  };
  try {
    const html = renderToStaticMarkup(React.createElement(MessageView, {
      sessionId: "session-1",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", toolCallId: "call-1", toolName: "read", input: { path: "foo.ts" } }],
      },
      toolResults: new Map([["call-1", {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "read",
        content: [{ type: "text", text: "[2 tool result images omitted from initial history payload: image/png, ~10 bytes]" }],
        deferredImages: { entryId: "entry-9", count: 2 },
      }]]),
    }));
    assert.equal(fetches.length, 0);
    // Collapsed tool calls unmount their paired result entirely.
    assert.doesNotMatch(html, /omitted from initial history payload/);
    assert.doesNotMatch(html, /<img/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("expanded deferred results hide the omission line and show the loading state", () => {
  const html = expandedToolCallHtml({
    sessionId: "session-1",
    result: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "read",
      content: [{ type: "text", text: "[2 tool result images omitted from initial history payload: image/png, ~10 bytes]" }],
      deferredImages: { entryId: "entry-9", count: 2 },
    },
  });

  // Effects never run under server rendering, so the first expanded frame is
  // the loading state — never the stale omission claim or a no-output line.
  assert.doesNotMatch(html, /omitted from initial history payload/);
  assert.doesNotMatch(html, /\(no output\)/);
  assert.match(html, /Loading…/);
  assert.doesNotMatch(html, /<img/);
});

test("loadToolResultImages fetches the per-entry media route", async () => {
  const seen = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push([url, init]);
    return {
      ok: true,
      json: async () => ({
        images: [{ type: "image", data: TEST_IMAGE_DATA, mimeType: "image/png" }],
        missingCount: 1,
      }),
    };
  };
  try {
    const result = await loadToolResultImages("session 1", "entry/9");
    assert.deepEqual(result, {
      images: [{ type: "image", data: TEST_IMAGE_DATA, mimeType: "image/png" }],
      missingCount: 1,
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0][0], "/api/sessions/session%201/entries/entry%2F9/media");
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  try {
    await assert.rejects(() => loadToolResultImages("session-1", "missing"));
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = async () => ({ ok: true, json: async () => ({ images: [] }) });
  try {
    await assert.rejects(
      () => loadToolResultImages("session-1", "invalid"),
      /Invalid media response/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deferred image state is released on collapse and partial loads stay visibly failed", () => {
  assert.match(
    messageViewSource,
    /if \(!expanded\) \{\s*setDeferredImages\(null\);\s*setDeferredLoadedKey\(null\);\s*setDeferredMissingCount\(0\)/,
  );
  assert.match(
    messageViewSource,
    /deferredLoaded && deferredMissingCount > 0/,
  );
  assert.doesNotMatch(
    messageViewSource,
    /\{failed && images\.length === 0 && \(/,
  );
});

