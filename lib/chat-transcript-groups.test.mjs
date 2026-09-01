import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { reconcileRenderWindow } = await jiti.import("./chat-lazy-load.ts");
const { buildTranscriptRenderPlan } = await jiti.import("./chat-transcript-groups.ts");

function user(text) {
  return { role: "user", content: text };
}

function assistant(text, toolName) {
  const content = [];
  if (toolName) {
    content.push({ type: "toolCall", toolName, toolCallId: `${toolName}-1`, arguments: {} });
  }
  if (text) content.push({ type: "text", text });
  return { role: "assistant", content };
}

function lastAnchorIdx(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return i;
  }
  return -1;
}

function planOnce(messages, options = {}) {
  return buildTranscriptRenderPlan(messages, {
    lastAnchorIdx: lastAnchorIdx(messages),
    isStreaming: false,
    sessionBusy: false,
    ...options,
  });
}

test("completed turns fold process into one render slot plus answer", () => {
  const messages = [
    user("one"),
    assistant("working", "bash"),
    assistant("done"),
    user("two"),
    assistant("ok"),
  ];
  const plan = planOnce(messages);
  assert.deepEqual(plan.map((item) => item.kind), [
    "message",
    "process-group",
    "answer",
    "message",
    "answer",
  ]);
});

test("appending at the followed tail uses one grouping pass and a derived pin", () => {
  const requested = { startIndex: 0, endIndex: 0 };
  let groupingPasses = 0;
  const group = (messages) => {
    groupingPasses += 1;
    return planOnce(messages);
  };

  const first = [];
  for (let i = 0; i < 40; i += 1) {
    first.push(user(`u${i}`), assistant(`a${i}`));
  }
  const firstPlan = group(first);
  const firstWindow = reconcileRenderWindow(firstPlan.length, requested, { pinToEnd: true });
  assert.equal(firstWindow.hasMoreBelow, false);
  assert.equal(firstWindow.endIndex, firstPlan.length);

  const next = [...first, user("tail"), assistant("reply")];
  const nextPlan = group(next);
  const nextWindow = reconcileRenderWindow(nextPlan.length, requested, { pinToEnd: true });

  assert.equal(groupingPasses, 2);
  assert.equal(nextPlan.length, firstPlan.length + 2);
  assert.equal(nextWindow.endIndex, nextPlan.length);
  assert.equal(nextWindow.endIndex - nextWindow.startIndex, firstWindow.endIndex - firstWindow.startIndex);
  assert.equal(nextWindow.startIndex, firstWindow.startIndex + 2);
  assert.deepEqual(requested, { startIndex: 0, endIndex: 0 });
});

test("equal-size page shifts keep the same window length", () => {
  const messages = [];
  for (let i = 0; i < 80; i += 1) {
    messages.push(user(`u${i}`), assistant(`a${i}`));
  }
  const plan = planOnce(messages);
  const tail = reconcileRenderWindow(plan.length, { startIndex: 0, endIndex: 0 }, { pinToEnd: true });
  const earlier = { startIndex: tail.startIndex - 50, endIndex: tail.endIndex - 50 };
  const shifted = reconcileRenderWindow(plan.length, earlier, { pinToEnd: false });
  assert.equal(shifted.endIndex - shifted.startIndex, tail.endIndex - tail.startIndex);
  assert.notEqual(shifted.startIndex, tail.startIndex);
  assert.equal(shifted.hasMoreBelow, true);
});
