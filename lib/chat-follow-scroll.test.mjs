import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applyFollowScroll,
  createFollowScrollToken,
  decideFollowScroll,
  followTodoSignature,
  nextFollowScrollTop,
} from "./chat-follow-scroll.ts";

function container(scrollTop, scrollHeight, clientHeight) {
  return { scrollTop, scrollHeight, clientHeight };
}

function endSpy() {
  const calls = [];
  return {
    calls,
    scrollIntoView(options) {
      calls.push(options);
    },
  };
}

test("stream frame at the bottom assigns scrollTop once and never uses scrollIntoView", () => {
  const box = container(100, 500, 400);
  box.scrollHeight = 560;
  const decision = decideFollowScroll({
    following: true,
    intent: "follow-stream",
    scrollTop: box.scrollTop,
    nextScrollTop: nextFollowScrollTop(box),
    reducedMotion: false,
  });
  const end = endSpy();
  const result = applyFollowScroll({ container: box, end, decision });

  assert.equal(decision.mode, "assign");
  assert.equal(result.method, "scrollTop");
  assert.equal(result.wrote, true);
  assert.equal(box.scrollTop, 160);
  assert.equal(end.calls.length, 0);

  const unchanged = decideFollowScroll({
    following: true,
    intent: "follow-stream",
    scrollTop: box.scrollTop,
    nextScrollTop: nextFollowScrollTop(box),
    reducedMotion: false,
  });
  const second = applyFollowScroll({ container: box, end, decision: unchanged });
  assert.equal(unchanged.mode, "skip");
  assert.equal(second.wrote, false);
  assert.equal(second.method, "none");
  assert.equal(end.calls.length, 0);
});

test("manual scroll-up is not followed", () => {
  const box = container(20, 500, 400);
  const decision = decideFollowScroll({
    following: false,
    intent: "follow-stream",
    scrollTop: box.scrollTop,
    nextScrollTop: nextFollowScrollTop(box),
    reducedMotion: false,
  });
  const end = endSpy();
  const result = applyFollowScroll({ container: box, end, decision });
  assert.equal(decision.mode, "skip");
  assert.equal(result.wrote, false);
  assert.equal(box.scrollTop, 20);
  assert.equal(end.calls.length, 0);
});

test("idle follow uses scrollIntoView unless reduced motion", () => {
  const box = container(0, 500, 400);
  const end = endSpy();
  const smooth = decideFollowScroll({
    following: true,
    intent: "follow-idle",
    scrollTop: 0,
    nextScrollTop: 100,
    reducedMotion: false,
  });
  assert.equal(applyFollowScroll({ container: box, end, decision: smooth }).method, "scrollIntoView");
  assert.equal(end.calls.length, 1);
  assert.equal(end.calls[0].behavior, "smooth");

  const reduced = decideFollowScroll({
    following: true,
    intent: "follow-idle",
    scrollTop: 0,
    nextScrollTop: 100,
    reducedMotion: true,
  });
  assert.equal(reduced.mode, "assign");
});

test("stream follow is one scrollTop write and zero scrollIntoView operations", () => {
  const box = container(80, 480, 400);
  const end = endSpy();
  let writes = 0;
  let intoView = 0;
  const run = (height) => {
    box.scrollHeight = height;
    const decision = decideFollowScroll({
      following: true,
      intent: "follow-stream",
      scrollTop: box.scrollTop,
      nextScrollTop: nextFollowScrollTop(box),
      reducedMotion: false,
    });
    const result = applyFollowScroll({ container: box, end, decision });
    if (result.method === "scrollTop") writes += 1;
    if (result.method === "scrollIntoView") intoView += 1;
  };
  run(480);
  run(520);
  run(520);
  run(520);
  assert.equal(writes, 1);
  assert.equal(intoView, 0);
  assert.equal(end.calls.length, 0);
});

test("follow token ignores object identity and tracks stream revision", () => {
  const base = {
    loading: false,
    messageCount: 3,
    lastEntryId: "e3",
    streaming: true,
    streamRevision: 40,
    agentRunning: true,
    agentPhase: "responding",
    widgetSignature: "",
    isCompacting: false,
    retrySignature: "",
    activeSubagentCount: 0,
    todoSignature: "",
  };
  assert.equal(createFollowScrollToken(base), createFollowScrollToken({ ...base }));
  assert.notEqual(createFollowScrollToken(base), createFollowScrollToken({ ...base, streamRevision: 41 }));
  assert.notEqual(
    createFollowScrollToken(base),
    createFollowScrollToken({ ...base, widgetSignature: "status:one long line" }),
  );
  const sameCountUpdate = createFollowScrollToken({ ...base, streamRevision: 42 });
  const sameCountGrownTool = createFollowScrollToken({ ...base, streamRevision: 43 });
  assert.notEqual(sameCountUpdate, createFollowScrollToken(base));
  assert.notEqual(sameCountUpdate, sameCountGrownTool);
  assert.equal(followTodoSignature([{ name: "A", tasks: [{ status: "pending" }, { status: "completed" }] }]), "A:pendingcompleted:2");
});

test("follow payload extent is not recomputed from streamed tool payloads", async () => {
  const source = await readFile(new URL("./chat-follow-scroll.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /followStreamExtent/);
  assert.doesNotMatch(source, /followUnknownExtent/);
  assert.doesNotMatch(source, /JSON\.stringify/);
  assert.match(source, /streamRevision/);
});
