import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { SubagentHub, buildSubagentHubTree } = await jiti.import("./SubagentHub.tsx");
const { SUBAGENT_STALE_AFTER_MS } = await jiti.import("../lib/subagent-hub-state.ts");
const { translate } = await jiti.import("../lib/i18n/index.tsx");

const noop = () => {};

function renderHub(props) {
  return renderToStaticMarkup(React.createElement(SubagentHub, props));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const mixedRoster = [
  { id: "running", agent: "scout", status: "started", index: 0, task: "Inspect the tree", lastUpdate: Date.now() },
  { id: "done", agent: "worker", status: "completed", index: 1, task: "Write the patch" },
  { id: "failed", agent: "reviewer", status: "failed", index: 2, task: "Check the tests" },
  { id: "aborted", agent: "helper", status: "aborted", index: 3, task: "Wait for input" },
  { id: "lost", agent: "watchdog", status: "lost", index: 4, task: "Connection lost" },
];

/**
 * Server markup intentionally omits event handlers. Resolve this component
 * tree with a tiny hook dispatcher only for the click-contract assertion;
 * all markup assertions use the same React server-rendering harness as the
 * neighboring component tests.
 */
function withResolvedHooks(locale, callback) {
  const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previousDispatcher = internals.H;
  internals.H = {
    useState(initial) {
      const value = typeof initial === "function" ? initial() : initial;
      return [value, noop];
    },
    useMemo(factory) {
      return factory();
    },
    useCallback(callbackValue) {
      return callbackValue;
    },
    useEffect() {},
    useSyncExternalStore() {
      return locale;
    },
  };
  try {
    return callback();
  } finally {
    internals.H = previousDispatcher;
  }
}

function withInteractiveHooks(locale, callback) {
  const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previousDispatcher = internals.H;
  const stateSlots = [];
  let stateCursor = 0;
  internals.H = {
    useState(initial) {
      const slot = stateCursor++;
      if (!(slot in stateSlots)) stateSlots[slot] = typeof initial === "function" ? initial() : initial;
      return [stateSlots[slot], (next) => {
        stateSlots[slot] = typeof next === "function" ? next(stateSlots[slot]) : next;
      }];
    },
    useMemo(factory) {
      return factory();
    },
    useCallback(callbackValue) {
      return callbackValue;
    },
    useEffect() {},
    useSyncExternalStore() {
      return locale;
    },
  };
  try {
    return callback((element) => {
      stateCursor = 0;
      return resolveElementTree(element);
    });
  } finally {
    internals.H = previousDispatcher;
  }
}

function resolveElementTree(node) {
  if (Array.isArray(node)) return node.flatMap(resolveElementTree);
  if (!React.isValidElement(node)) return node;

  const { type, props } = node;
  if (type === React.Fragment) return resolveElementTree(props.children);
  if (typeof type === "function") return resolveElementTree(type(props));
  if (props.children === undefined) return node;

  return React.cloneElement(node, { children: resolveElementTree(props.children) });
}

function findHostElements(node, predicate, found = []) {
  if (Array.isArray(node)) {
    for (const child of node) findHostElements(child, predicate, found);
    return found;
  }
  if (!React.isValidElement(node)) return found;

  if (predicate(node.type, node.props)) found.push(node);
  if (node.props.children !== undefined) findHostElements(node.props.children, predicate, found);
  return found;
}

function textContent(node) {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!React.isValidElement(node)) return "";
  return textContent(node.props.children);
}

test("empty roster renders the expanded hub empty state", () => {
  const html = renderHub({
    subagents: [],
    onSelectSubagent: noop,
    defaultExpanded: true,
  });

  assert.match(html, /aria-label="Subagents"/);
  assert.match(
    html,
    new RegExp(escapeRegExp(translate("chatWindow.subagentHub.empty", undefined, "en"))),
  );
  assert.match(html, /aria-label="0 running · 0 total"/);
});

test("mixed-status rows expose status badges and stay collapsed by default", () => {
  const collapsedHtml = renderHub({
    subagents: mixedRoster,
    onSelectSubagent: noop,
  });

  assert.match(collapsedHtml, /aria-expanded="false"/);
  for (const subagent of mixedRoster) {
    assert.doesNotMatch(collapsedHtml, new RegExp(escapeRegExp(subagent.task)));
  }

  const expandedHtml = renderHub({
    subagents: mixedRoster,
    onSelectSubagent: noop,
    defaultExpanded: true,
  });

  assert.match(expandedHtml, /aria-expanded="true"/);
  for (const subagent of mixedRoster) {
    assert.match(expandedHtml, new RegExp(escapeRegExp(subagent.agent)));
    assert.match(expandedHtml, new RegExp(escapeRegExp(subagent.task)));
    assert.match(
      expandedHtml,
      new RegExp(escapeRegExp(translate(`chatWindow.subagentState.${subagent.status}`, undefined, "en"))),
    );
  }

  // The live row has its pulsing status dot; terminal rows use the 12px
  // lucide status icons rather than a generic activity marker.
  assert.match(expandedHtml, /class="live-status-dot live-pulse/);
  assert.ok(
    (expandedHtml.match(/<svg[^>]*width="12"[^>]*height="12"/g) ?? []).length >= 4,
    "terminal rows should render status icons",
  );
});

test("SubagentStatusIcon renders distinct status icons and distinguishes lost from aborted", async () => {
  const { SubagentStatusIcon } = await jiti.import("./SubagentStatusIcon.tsx");
  const completedHtml = renderToStaticMarkup(React.createElement(SubagentStatusIcon, { status: "completed" }));
  const failedHtml = renderToStaticMarkup(React.createElement(SubagentStatusIcon, { status: "failed" }));
  const abortedHtml = renderToStaticMarkup(React.createElement(SubagentStatusIcon, { status: "aborted" }));
  const lostHtml = renderToStaticMarkup(React.createElement(SubagentStatusIcon, { status: "lost" }));
  const liveStartedHtml = renderToStaticMarkup(React.createElement(SubagentStatusIcon, { status: "started", live: true }));
  const historyStartedHtml = renderToStaticMarkup(React.createElement(SubagentStatusIcon, { status: "started", live: false }));

  assert.match(completedHtml, /lucide-check-circle-2|<svg/);
  assert.match(failedHtml, /lucide-circle-alert|<svg/);
  assert.match(abortedHtml, /lucide-ban|<svg/);
  assert.match(lostHtml, /lucide-radio-off|<svg/);
  assert.match(liveStartedHtml, /live-status-dot live-pulse/);
  assert.match(historyStartedHtml, /lucide-circle|<svg/);

  // Lost icon is structurally distinct from aborted icon
  assert.notEqual(lostHtml, abortedHtml);
  assert.notEqual(lostHtml, failedHtml);
});

test("hierarchy builder stacks active agents first and newest agents first", () => {
  const now = 100_000;
  const roster = [
    { id: "root", agent: "scout", status: "started", index: 0, task: "Inspect", lastUpdate: now },
    { id: "unknown-child", agent: "worker", status: "completed", index: 1, parentToolCallId: "parent-call", task: "Write" },
    { id: "nested", agent: "helper", status: "started", index: 2, parentToolCallId: "root", task: "Check", lastUpdate: now },
    { id: "root-2", agent: "reviewer", status: "failed", index: 3, task: "Review" },
    { id: "unknown-child-2", agent: "helper", status: "aborted", index: 4, parentToolCallId: "parent-call", task: "Report" },
    { id: "root-3", agent: "writer", status: "started", index: 5, task: "Implement", lastUpdate: now },
  ];

  const first = buildSubagentHubTree(roster, now);
  const second = buildSubagentHubTree(roster, now);
  assert.deepEqual(second, first);
  assert.deepEqual(
    first.filter((item) => item.kind === "row").map((item) => item.subagent.id),
    ["root-3", "root", "nested", "unknown-child-2", "unknown-child", "root-2"],
  );
  assert.equal(first.filter((item) => item.kind === "row").length, roster.length);
});

test("hierarchy builder lifts active orphan groups above completed history roots", () => {
  const now = 100_000;
  const roster = [
    { id: "history-root", agent: "archived", status: "completed", source: "history", index: 0, task: "Old work" },
    { id: "history-root-2", agent: "archived-2", status: "failed", source: "history", index: 1, task: "Older failure" },
    { id: "live-orphan", agent: "scout", status: "started", index: 2, parentToolCallId: "tool-call-1", task: "Live nested task", lastUpdate: now },
    { id: "live-orphan-2", agent: "worker", status: "started", index: 3, parentToolCallId: "tool-call-1", task: "Sibling live task", lastUpdate: now },
    { id: "done-orphan", agent: "helper", status: "completed", index: 4, parentToolCallId: "tool-call-2", task: "Finished nested" },
  ];

  const tree = buildSubagentHubTree(roster, now);
  assert.deepEqual(
    tree.filter((item) => item.kind === "row").map((item) => item.subagent.id),
    ["live-orphan-2", "live-orphan", "done-orphan", "history-root-2", "history-root"],
  );
});

test("hierarchy builder floats completed roots that still have live nested children", () => {
  const now = 100_000;
  const roster = [
    { id: "old-root", agent: "archived", status: "completed", source: "history", index: 0, task: "History root" },
    { id: "parent", agent: "coordinator", status: "completed", index: 1, task: "Parent settled" },
    { id: "child", agent: "worker", status: "started", index: 2, parentToolCallId: "parent", task: "Detached child still running", lastUpdate: now },
  ];

  const tree = buildSubagentHubTree(roster, now);
  assert.deepEqual(
    tree.filter((item) => item.kind === "row").map((item) => item.subagent.id),
    ["parent", "child", "old-root"],
  );
});

test("hierarchy builder propagates active state through orphan descendants", () => {
  const now = 100_000;
  const roster = [
    { id: "history-root", agent: "archived", status: "completed", source: "history", index: 8, task: "Recent history" },
    { id: "orphan-parent", agent: "coordinator", status: "completed", index: 1, parentToolCallId: "missing-call", task: "Parent settled" },
    { id: "live-child", agent: "worker", status: "started", index: 9, parentToolCallId: "orphan-parent", task: "Still running", lastUpdate: now },
  ];

  const tree = buildSubagentHubTree(roster, now);
  assert.deepEqual(
    tree.filter((item) => item.kind === "row").map((item) => item.subagent.id),
    ["orphan-parent", "live-child", "history-root"],
  );
});

test("hierarchy builder does not prioritize stale started orphan groups", () => {
  const now = 100_000;
  const roster = [
    { id: "completed-root", agent: "reviewer", status: "completed", index: 3, task: "Recent result" },
    {
      id: "stale-orphan",
      agent: "worker",
      status: "started",
      index: 2,
      parentToolCallId: "missing-call",
      task: "No longer updating",
      lastUpdate: now - SUBAGENT_STALE_AFTER_MS - 1,
    },
  ];

  const tree = buildSubagentHubTree(roster, now);
  assert.deepEqual(
    tree.filter((item) => item.kind === "row").map((item) => item.subagent.id),
    ["completed-root", "stale-orphan"],
  );
  const firstGroup = tree.find((item) => item.kind === "group");
  assert.equal(firstGroup?.group, "roots");
});

test("hierarchy builder sorts active root blocks by their newest active descendant", () => {
  const now = 100_000;
  const roster = [
    { id: "older-parent", agent: "coordinator", status: "completed", index: 1, task: "Parent settled" },
    { id: "newer-root", agent: "reviewer", status: "started", index: 5, task: "Review", lastUpdate: now },
    { id: "newest-child", agent: "worker", status: "started", index: 10, parentToolCallId: "older-parent", task: "Implement", lastUpdate: now },
  ];

  const tree = buildSubagentHubTree(roster, now);
  assert.deepEqual(
    tree.filter((item) => item.kind === "row").map((item) => item.subagent.id),
    ["older-parent", "newest-child", "newer-root"],
  );
});

test("row selection callback fires with the clicked subagent", () => {
  const target = {
    id: "worker-2",
    agent: "worker",
    status: "completed",
    index: 1,
    task: "Write the patch",
  };
  const selected = [];
  const tree = withResolvedHooks("en", () => resolveElementTree(React.createElement(SubagentHub, {
    subagents: [
      { id: "scout-1", agent: "scout", status: "started", index: 0, task: "Inspect the tree" },
      target,
    ],
    onSelectSubagent: (subagent) => selected.push(subagent),
    defaultExpanded: true,
  })));

  const rows = findHostElements(
    tree,
    (type, props) => type === "button" && props["aria-label"]?.startsWith("worker ·"),
  );
  assert.equal(rows.length, 1);
  assert.equal(typeof rows[0].props.onClick, "function");

  rows[0].props.onClick();
  assert.equal(selected.length, 1);
  assert.equal(selected[0], target);
});

test("Korean hub copy resolves through the component i18n hook", () => {
  const tree = withResolvedHooks("ko", () => resolveElementTree(React.createElement(SubagentHub, {
    subagents: [],
    onSelectSubagent: noop,
    defaultExpanded: true,
  })));
  const text = textContent(tree);

  assert.match(
    text,
    new RegExp(escapeRegExp(translate("chatWindow.subagentsPanel", undefined, "ko"))),
  );
  assert.match(
    text,
    new RegExp(escapeRegExp(translate("chatWindow.subagentHub.empty", undefined, "ko"))),
  );
  assert.doesNotMatch(text, /chatWindow\./);
});

test("filter pills switch the visible rows and expose per-filter counts", () => {
  const filterRoster = [
    ...mixedRoster,
    { id: "history-started", agent: "archived", status: "started", source: "history", index: 4, task: "Archived running" },
  ];
  const element = React.createElement(SubagentHub, {
    subagents: filterRoster,
    onSelectSubagent: noop,
    defaultExpanded: true,
  });

  withInteractiveHooks("en", (rerender) => {
    const initialTree = rerender(element);
    const initialText = textContent(initialTree);
    assert.match(initialText, /Inspect the tree/);
    assert.match(initialText, /Write the patch/);

    const activePills = findHostElements(
      initialTree,
      (type, props) => type === "button" && props["data-subagent-filter"] === "active",
    );
    assert.equal(activePills.length, 1);
    assert.match(textContent(activePills[0]), /Active1/);
    activePills[0].props.onClick();

    const filteredTree = rerender(element);
    const filteredText = textContent(filteredTree);
    assert.match(filteredText, /Inspect the tree/);
    assert.doesNotMatch(filteredText, /Write the patch/);
    assert.doesNotMatch(filteredText, /Check the tests/);
    assert.doesNotMatch(filteredText, /Archived running/);
    const selectedPills = findHostElements(
      filteredTree,
      (type, props) => type === "button" && props["data-subagent-filter"] === "active" && props["aria-pressed"] === true,
    );
    assert.equal(selectedPills.length, 1);
  });
});

test("freshness badges distinguish live, stale updates, and history rows", () => {
  const now = Date.now();
  const staleLastUpdate = now - SUBAGENT_STALE_AFTER_MS * 4;
  const roster = [
    { id: "live", agent: "scout", status: "started", index: 0, task: "Live task", lastUpdate: now },
    { id: "stale", agent: "worker", status: "started", index: 1, task: "Stale task", lastUpdate: staleLastUpdate },
    { id: "history", agent: "reviewer", status: "completed", source: "history", index: 2, task: "History task" },
    { id: "history-started", agent: "archived", status: "started", source: "history", index: 3, task: "Archived running" },
  ];
  const html = renderHub({
    subagents: roster,
    onSelectSubagent: noop,
    defaultExpanded: true,
    now,
  });

  assert.match(html, /data-subagent-freshness="live"/);
  assert.match(html, /data-subagent-freshness="stale"/);
  assert.match(html, /data-subagent-freshness="history"/);
  assert.match(html, /60s ago/);

  const tree = withResolvedHooks("en", () => resolveElementTree(React.createElement(SubagentHub, {
    subagents: roster,
    onSelectSubagent: noop,
    defaultExpanded: true,
    now,
  })));
  const historyStartedRows = findHostElements(
    tree,
    (type, props) => type === "button" && props["aria-label"]?.startsWith("archived ·"),
  );
  assert.equal(historyStartedRows.length, 1);
  assert.doesNotMatch(
    textContent(historyStartedRows[0]),
    new RegExp(escapeRegExp(translate("chatWindow.subagentState.started", undefined, "en"))),
  );
  assert.equal(
    textContent(historyStartedRows[0]).split(translate("chatWindow.subagentHub.fresh.history", undefined, "en")).length - 1,
    1,
  );
});

test("expanded hub includes the observation-only capability notice", () => {
  const html = renderHub({
    subagents: [],
    onSelectSubagent: noop,
    defaultExpanded: true,
  });

  assert.match(html, /data-subagent-observe-only/);
  assert.match(
    html,
    new RegExp(escapeRegExp(translate("chatWindow.subagentHub.observeOnly", undefined, "en"))),
  );
  assert.match(
    html,
    new RegExp(escapeRegExp(translate("chatWindow.subagentHub.observeOnlyHint", undefined, "en"))),
  );
});

test("expanded and collapsed hub counts exclude stale and lost rows from running count and active filter", () => {
  const now = 1_700_000_000_000;
  const staleTime = now - SUBAGENT_STALE_AFTER_MS * 3;
  const testRoster = [
    { id: "active-live", agent: "scout", status: "started", index: 0, task: "Live active task", lastUpdate: now },
    { id: "active-stale", agent: "worker", status: "started", index: 1, task: "Stale task", lastUpdate: staleTime },
    { id: "lost-agent", agent: "guard", status: "lost", index: 2, task: "Lost task", lastUpdate: now },
    { id: "failed-agent", agent: "reviewer", status: "failed", index: 3, task: "Failed task", lastUpdate: now },
    { id: "aborted-agent", agent: "helper", status: "aborted", index: 4, task: "Aborted task", lastUpdate: now },
    { id: "done-agent", agent: "writer", status: "completed", index: 5, task: "Done task", lastUpdate: now },
  ];

  // 1. Collapsed state: summary should strictly show 1 running (only the fresh live row, not stale or lost)
  const collapsedHtml = renderHub({
    subagents: testRoster,
    onSelectSubagent: noop,
    defaultExpanded: false,
    now,
  });
  assert.match(collapsedHtml, /aria-label="1 running · 6 total"/);
  assert.match(collapsedHtml, /<span>1<\/span>\s*<span[^>]*>\/<\/span>\s*<span>6<\/span>/);

  // 2. Expanded state: summary and filter pill counts
  const expandedHtml = renderHub({
    subagents: testRoster,
    onSelectSubagent: noop,
    defaultExpanded: true,
    now,
  });
  assert.match(expandedHtml, /aria-label="1 running · 6 total"/);

  // 3. Interactive filtering: active, failed (includes failed, aborted, lost), completed
  const element = React.createElement(SubagentHub, {
    subagents: testRoster,
    onSelectSubagent: noop,
    defaultExpanded: true,
    now,
  });

  withInteractiveHooks("en", (rerender) => {
    const initialTree = rerender(element);

    // Check filter counts on pills
    const allPill = findHostElements(initialTree, (t, p) => t === "button" && p["data-subagent-filter"] === "all");
    const activePill = findHostElements(initialTree, (t, p) => t === "button" && p["data-subagent-filter"] === "active");
    const completedPill = findHostElements(initialTree, (t, p) => t === "button" && p["data-subagent-filter"] === "completed");
    const failedPill = findHostElements(initialTree, (t, p) => t === "button" && p["data-subagent-filter"] === "failed");

    assert.equal(allPill.length, 1);
    assert.equal(activePill.length, 1);
    assert.equal(completedPill.length, 1);
    assert.equal(failedPill.length, 1);

    assert.match(textContent(allPill[0]), /All6/);
    assert.match(textContent(activePill[0]), /Active1/);
    assert.match(textContent(completedPill[0]), /Completed1/);
    assert.match(textContent(failedPill[0]), /Failed3/);

    // Click Active filter -> only the fresh live started row is visible
    activePill[0].props.onClick();
    const activeTree = rerender(element);
    const activeText = textContent(activeTree);
    assert.match(activeText, /Live active task/);
    assert.doesNotMatch(activeText, /Stale task/);
    assert.doesNotMatch(activeText, /Lost task/);
    assert.doesNotMatch(activeText, /Failed task/);
    assert.doesNotMatch(activeText, /Aborted task/);
    assert.doesNotMatch(activeText, /Done task/);

    // Click Failed filter -> failed, aborted, AND lost rows are visible
    failedPill[0].props.onClick();
    const failedTree = rerender(element);
    const failedText = textContent(failedTree);
    assert.match(failedText, /Lost task/);
    assert.match(failedText, /Failed task/);
    assert.match(failedText, /Aborted task/);
    assert.doesNotMatch(failedText, /Live active task/);
    assert.doesNotMatch(failedText, /Stale task/);
    assert.doesNotMatch(failedText, /Done task/);
  });
});

test("Korean hub copy translates lost status to 연결 끊김", () => {
  const now = Date.now();
  const lostRoster = [
    { id: "lost-1", agent: "scout", status: "lost", index: 0, task: "Network disconnected", lastUpdate: now },
  ];
  const tree = withResolvedHooks("ko", () => resolveElementTree(React.createElement(SubagentHub, {
    subagents: lostRoster,
    onSelectSubagent: noop,
    defaultExpanded: true,
    now,
  })));
  const text = textContent(tree);

  assert.match(
    text,
    new RegExp(escapeRegExp(translate("chatWindow.subagentState.lost", undefined, "ko"))),
  );
  assert.match(text, /연결 끊김/);

  const row = findHostElements(
    tree,
    (type, props) => type === "button" && props["aria-label"]?.includes("연결 끊김"),
  );
  assert.equal(row.length, 1);
});

test("mobile contract: semantic classes and data attributes are present for mobile omissions", () => {
  const now = 1_700_000_000_000;
  const richRoster = [
    {
      id: "parent-agent",
      agent: "planner",
      status: "started",
      index: 0,
      task: "Coordinate multi-file refactor",
      detached: true,
      lastUpdate: now,
      progress: {
        currentTool: "read",
        lastIntent: "Inspecting codebase",
        tokens: 12500,
        cost: 0.045,
        resolvedModel: "claude-3-7-sonnet-20250219",
        durationMs: 15400,
        nestedAgents: [{ id: "child-1" }],
      },
    },
    {
      id: "child-1",
      parentToolCallId: "parent-agent",
      agent: "worker",
      status: "completed",
      index: 1,
      task: "Implement mobile CSS overrides",
      lastUpdate: now,
      progress: {
        tokens: 3200,
        cost: 0.012,
        resolvedModel: "claude-3-7-sonnet-20250219",
      },
    },
  ];

  const events = {
    "parent-agent": [
      { id: "e1", label: "Reading components/SubagentHub.tsx" },
      { id: "e2", label: "Editing app/globals.css" },
    ],
  };

  const html = renderHub({
    subagents: richRoster,
    subagentEvents: events,
    onSelectSubagent: noop,
    defaultExpanded: true,
    now,
  });

  // 1. Root and content containers have responsive semantic classes
  assert.match(html, /class="[^"]*subagent-hub-root[^"]*"/);
  assert.match(html, /class="[^"]*subagent-hub-header-trigger[^"]*"/);
  assert.match(html, /class="[^"]*subagent-hub-content[^"]*"/);

  // 2. Filters have both data attribute and semantic class for mobile hiding
  assert.match(html, /data-subagent-filter-row/);
  assert.match(html, /class="[^"]*subagent-hub-filters[^"]*"/);

  // 3. Hierarchy group headers have data attribute and class for mobile hiding
  assert.match(html, /data-subagent-group-label/);
  assert.match(html, /class="[^"]*subagent-hub-group-label[^"]*"/);

  // 4. Nested row wrap has depth data attribute and class for mobile indent flattening
  assert.match(html, /data-subagent-row-wrap/);
  assert.match(html, /data-subagent-depth="1"/);
  assert.match(html, /class="[^"]*subagent-hub-nested[^"]*"/);

  // 5. Freshness badges have data attribute and class for mobile hiding
  assert.match(html, /data-subagent-freshness="live"/);
  assert.match(html, /class="[^"]*subagent-hub-freshness[^"]*"/);

  // 6. Detached marker has data attribute and class for mobile hiding
  assert.match(html, /data-subagent-detached/);
  assert.match(html, /class="[^"]*subagent-hub-detached[^"]*"/);

  // 7. ActivityLine telemetry has data attribute and class for mobile hiding
  assert.match(html, /data-subagent-activity-line/);
  assert.match(html, /class="[^"]*subagent-hub-activity-line[^"]*"/);

  // 8. ActivityPreview has data attribute and class for mobile hiding
  assert.match(html, /data-subagent-activity-preview/);
  assert.match(html, /class="[^"]*subagent-hub-activity-preview[^"]*"/);

  // 9. Observation notice has data attribute and class for mobile hiding
  assert.match(html, /data-subagent-observe-only/);
  assert.match(html, /class="[^"]*subagent-hub-observe-only[^"]*"/);

  // 10. Minimal selectable row container and components are properly classed
  assert.match(html, /class="[^"]*subagent-hub-row[^"]*"/);
  assert.match(html, /class="[^"]*subagent-hub-row-main[^"]*"/);
  assert.match(html, /class="[^"]*subagent-hub-row-agent[^"]*"/);
  assert.match(html, /class="[^"]*subagent-hub-row-task[^"]*"/);
  assert.match(html, /class="[^"]*subagent-hub-row-state[^"]*"/);
});

test("mobile contract: globals.css defines media queries hiding omitted elements at mobile breakpoint <=640px", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const cssPath = path.resolve(process.cwd(), "app/globals.css");
  const css = await fs.readFile(cssPath, "utf-8");

  // Check the @media (max-width: 640px) block for subagent hub
  assert.match(css, /@media\s*\(max-width:\s*640px\)/);
  assert.match(css, /\.subagent-hub-filters/);
  assert.match(css, /\[data-subagent-filter-row\]/);
  assert.match(css, /\.subagent-hub-group-label/);
  assert.match(css, /\[data-subagent-group-label\]/);
  assert.match(css, /\.subagent-hub-freshness/);
  assert.match(css, /\[data-subagent-freshness\]/);
  assert.match(css, /\.subagent-hub-activity-line/);
  assert.match(css, /\[data-subagent-activity-line\]/);
  assert.match(css, /\.subagent-hub-activity-preview/);
  assert.match(css, /\[data-subagent-activity-preview\]/);
  assert.match(css, /\.subagent-hub-detached/);
  assert.match(css, /\[data-subagent-detached\]/);
  assert.match(css, /\.subagent-hub-observe-only/);
  assert.match(css, /\[data-subagent-observe-only\]/);
  assert.match(css, /\.subagent-hub-nested/);
});

test("mobile minimal row contract: every subagent row maintains status icon, agent name, single-line task, and selection handler", () => {
  const selected = [];
  const testSubagents = [
    { id: "s1", agent: "scout", status: "started", index: 0, task: "Investigate mobile layout", lastUpdate: 0 },
    { id: "w1", agent: "worker", status: "completed", index: 1, task: "Apply compact styling" },
    { id: "r1", agent: "reviewer", status: "failed", index: 2, task: "Verify no regressions" },
  ];

  const tree = withResolvedHooks("en", () => resolveElementTree(React.createElement(SubagentHub, {
    subagents: testSubagents,
    onSelectSubagent: (subagent) => selected.push(subagent),
    defaultExpanded: true,
  })));

  const rows = findHostElements(
    tree,
    (type, props) => type === "button" && props.className?.includes("subagent-hub-row"),
  );
  assert.equal(rows.length, 3);

  const expectedOrder = [testSubagents[0], testSubagents[2], testSubagents[1]];
  for (let i = 0; i < expectedOrder.length; i++) {
    const sub = expectedOrder[i];
    const row = rows[i];

    // Main line contains agent name, task text, status
    const rowText = textContent(row);
    assert.match(rowText, new RegExp(escapeRegExp(sub.agent)));
    assert.match(rowText, new RegExp(escapeRegExp(sub.task)));

    // Interactive selection remains intact on every row
    assert.equal(typeof row.props.onClick, "function");
    row.props.onClick();
    assert.equal(selected[i], sub);
  }
});

test("desktop retention: full hub retains metrics, previews, freshness, hierarchy, and capability notice in rendered markup", () => {
  const now = 1_700_000_000_000;
  const richRoster = [
    {
      id: "root-1",
      agent: "architect",
      status: "started",
      index: 0,
      task: "Deconstruct responsive layout",
      lastUpdate: now,
      progress: {
        tokens: 45000,
        cost: 0.15,
        resolvedModel: "claude-3-7-sonnet-20250219",
        durationMs: 32000,
      },
    },
    {
      id: "nested-1",
      parentToolCallId: "root-1",
      agent: "coder",
      status: "completed",
      index: 1,
      task: "Refactor compact classes",
      lastUpdate: now,
      progress: {
        tokens: 8200,
        cost: 0.028,
        resolvedModel: "gpt-4o",
      },
    },
  ];

  const events = {
    "root-1": [
      { id: "e1", label: "Evaluating CSS tokens" },
      { id: "e2", label: "Generating test cases" },
    ],
  };

  const html = renderHub({
    subagents: richRoster,
    subagentEvents: events,
    onSelectSubagent: noop,
    defaultExpanded: true,
    now,
  });

  // Telemetry metrics rendered
  assert.match(html, /45k/);
  assert.match(html, /\$0\.15/);
  assert.match(html, /32s/);
  assert.match(html, /sonnet/i);

  // Activity preview rendered
  assert.match(html, /Evaluating CSS tokens/);
  assert.match(html, /Generating test cases/);

  // Freshness badges rendered
  assert.match(html, /data-subagent-freshness="live"/);

  // Hierarchy rendered
  assert.match(
    html,
    new RegExp(escapeRegExp(translate("chatWindow.subagentHub.group.roots", undefined, "en"))),
  );
  assert.match(
    html,
    new RegExp(escapeRegExp(translate("chatWindow.subagentHub.group.nested", { agent: "architect" }, "en"))),
  );
  assert.match(html, /architect/);

  // Observation-only notice rendered
  assert.match(html, /data-subagent-observe-only/);
});

