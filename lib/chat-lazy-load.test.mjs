import test from "node:test";
import assert from "node:assert/strict";

async function loadSubject() {
  return import("./chat-lazy-load.ts");
}

test("clamps a window to total and the render cap", async () => {
  const { clampRenderWindow, MAX_RENDERED_MESSAGES } = await loadSubject();
  assert.deepEqual(clampRenderWindow(20, { startIndex: -10, endIndex: 500 }), {
    startIndex: 0,
    endIndex: 20,
    hasMoreAbove: false,
    hasMoreBelow: false,
  });
  assert.deepEqual(clampRenderWindow(500, { startIndex: 0, endIndex: 200 }), {
    startIndex: 0,
    endIndex: MAX_RENDERED_MESSAGES,
    hasMoreAbove: false,
    hasMoreBelow: true,
  });
  assert.equal(clampRenderWindow(0, { startIndex: 3, endIndex: 9 }).endIndex, 0);
});

test("initial window shows a tail page with more above and none below", async () => {
  const { initialRenderWindow } = await loadSubject();
  assert.deepEqual(initialRenderWindow(200, 50), {
    startIndex: 150,
    endIndex: 200,
    hasMoreAbove: true,
    hasMoreBelow: false,
  });
  assert.deepEqual(initialRenderWindow(30, 50), {
    startIndex: 0,
    endIndex: 30,
    hasMoreAbove: false,
    hasMoreBelow: false,
  });
  assert.deepEqual(initialRenderWindow(0, 50), {
    startIndex: 0,
    endIndex: 0,
    hasMoreAbove: false,
    hasMoreBelow: false,
  });
});

test("loading older prepends above and trims the far bottom at the cap", async () => {
  const { initialRenderWindow, shiftRenderWindowUp, MAX_RENDERED_MESSAGES } = await loadSubject();
  let window = initialRenderWindow(200, 50);
  window = shiftRenderWindowUp(200, window);
  assert.deepEqual(window, {
    startIndex: 100,
    endIndex: 200,
    hasMoreAbove: true,
    hasMoreBelow: false,
  });
  window = shiftRenderWindowUp(200, window);
  assert.deepEqual(window, {
    startIndex: 50,
    endIndex: 200,
    hasMoreAbove: true,
    hasMoreBelow: false,
  });
  window = shiftRenderWindowUp(200, window);
  assert.equal(window.endIndex - window.startIndex, MAX_RENDERED_MESSAGES);
  assert.deepEqual(window, {
    startIndex: 0,
    endIndex: 150,
    hasMoreAbove: false,
    hasMoreBelow: true,
  });
});

test("scrolling toward later groups restores below and trims the far top", async () => {
  const { shiftRenderWindowDown, MAX_RENDERED_MESSAGES } = await loadSubject();
  const window = shiftRenderWindowDown(200, { startIndex: 0, endIndex: 150 });
  assert.equal(window.endIndex - window.startIndex, MAX_RENDERED_MESSAGES);
  assert.deepEqual(window, {
    startIndex: 50,
    endIndex: 200,
    hasMoreAbove: true,
    hasMoreBelow: false,
  });
});

test("pinning to the end keeps a bounded tail as the total grows", async () => {
  const { reconcileRenderWindow, initialRenderWindow } = await loadSubject();
  const pinned = reconcileRenderWindow(80, initialRenderWindow(30), { pinToEnd: true });
  assert.deepEqual(pinned, {
    startIndex: 30,
    endIndex: 80,
    hasMoreAbove: true,
    hasMoreBelow: false,
  });
  const reading = reconcileRenderWindow(400, { startIndex: 10, endIndex: 160 }, { pinToEnd: false });
  assert.deepEqual(reading, {
    startIndex: 10,
    endIndex: 160,
    hasMoreAbove: true,
    hasMoreBelow: true,
  });
});

test("mixed shifts never mount more than the render cap", async () => {
  const {
    initialRenderWindow,
    shiftRenderWindowUp,
    shiftRenderWindowDown,
    MAX_RENDERED_MESSAGES,
  } = await loadSubject();
  const total = 1000;
  let window = initialRenderWindow(total);
  let operations = 0;
  while (window.hasMoreAbove) {
    window = shiftRenderWindowUp(total, window);
    operations += 1;
    assert.ok(window.endIndex - window.startIndex <= MAX_RENDERED_MESSAGES);
  }
  assert.equal(window.startIndex, 0);
  assert.equal(window.hasMoreBelow, true);
  while (window.hasMoreBelow) {
    window = shiftRenderWindowDown(total, window);
    operations += 1;
    assert.ok(window.endIndex - window.startIndex <= MAX_RENDERED_MESSAGES);
  }
  assert.ok(operations > 2);
  assert.equal(window.endIndex - window.startIndex, MAX_RENDERED_MESSAGES);
  assert.equal(window.endIndex, total);
  assert.equal(window.hasMoreAbove, true);
});

test("overlapping anchor survives trim in both directions", async () => {
  const { overlappingAnchorIndex } = await loadSubject();
  assert.equal(
    overlappingAnchorIndex({ startIndex: 150, endIndex: 200 }, { startIndex: 100, endIndex: 200 }),
    150,
  );
  assert.equal(
    overlappingAnchorIndex({ startIndex: 0, endIndex: 150 }, { startIndex: 50, endIndex: 200 }),
    50,
  );
});

test("anchor math restores viewport after prepend and after trimming above", async () => {
  const { restoreScrollTopFromRectDelta, restoreScrollTopAfterAboveShift } = await loadSubject();
  assert.equal(restoreScrollTopFromRectDelta(500, 100, 400), 800);
  assert.equal(restoreScrollTopFromRectDelta(500, 100, 40), 440);
  assert.equal(restoreScrollTopAfterAboveShift(500, 300), 800);
  assert.equal(restoreScrollTopAfterAboveShift(500, -60), 440);
  assert.equal(restoreScrollTopAfterAboveShift(10, -40), 0);
});

test("scroll observers keep committed indices until layout commit", async () => {
  const { commitResolvedRenderWindow, reconcileRenderWindow } = await loadSubject();
  const committed = reconcileRenderWindow(100, { startIndex: 10, endIndex: 60 });
  const observerRef = { current: committed };
  const next = reconcileRenderWindow(130, committed, { pinToEnd: true });
  assert.notEqual(next.startIndex, committed.startIndex);
  assert.equal(observerRef.current.startIndex, committed.startIndex);
  assert.equal(observerRef.current.endIndex, committed.endIndex);
  commitResolvedRenderWindow(observerRef, next);
  assert.deepEqual(observerRef.current, next);
});

test("top sentinel ignores mount-at-zero but loads after the viewport has left the top", async () => {
  const { historyLoadModeFromSentinel, shouldLoadOlderAtExactTop } = await loadSubject();
  assert.equal(historyLoadModeFromSentinel({ intersecting: false, scrollTop: 80, hasLeftTop: true }), null);
  assert.equal(historyLoadModeFromSentinel({ intersecting: true, scrollTop: 0, hasLeftTop: false }), null);
  assert.equal(historyLoadModeFromSentinel({ intersecting: true, scrollTop: 12, hasLeftTop: false }), "auto");
  assert.equal(historyLoadModeFromSentinel({ intersecting: true, scrollTop: 0, hasLeftTop: true }), "click-above");
  assert.equal(historyLoadModeFromSentinel({ intersecting: true, scrollTop: -8, hasLeftTop: true }), "click-above");
  assert.equal(shouldLoadOlderAtExactTop({ scrollTop: 0, hasLeftTop: false, hasMoreAbove: true }), false);
  assert.equal(shouldLoadOlderAtExactTop({ scrollTop: 0, hasLeftTop: true, hasMoreAbove: false }), false);
  assert.equal(shouldLoadOlderAtExactTop({ scrollTop: 24, hasLeftTop: true, hasMoreAbove: true }), false);
  assert.equal(shouldLoadOlderAtExactTop({ scrollTop: 0, hasLeftTop: true, hasMoreAbove: true }), true);
  assert.equal(shouldLoadOlderAtExactTop({ scrollTop: -4, hasLeftTop: true, hasMoreAbove: true }), true);
});

test("distance restore still maps prepend-only height growth", async () => {
  const { captureScrollDistance, restoreScrollTop } = await loadSubject();
  const savedDistance = captureScrollDistance(2000, 500);
  assert.equal(savedDistance, 1500);
  assert.equal(restoreScrollTop(2500, savedDistance), 1000);
  assert.equal(restoreScrollTop(3000, captureScrollDistance(2000, 0)), 1000);
  assert.equal(restoreScrollTop(3000, captureScrollDistance(2000, 2000)), 3000);
});
