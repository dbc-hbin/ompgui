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
const { translate } = await jiti.import("../lib/i18n/index.tsx");

const noop = () => {};

function renderHub(props) {
  return renderToStaticMarkup(React.createElement(SubagentHub, props));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const mixedRoster = [
  { id: "running", agent: "scout", status: "started", index: 0, task: "Inspect the tree" },
  { id: "done", agent: "worker", status: "completed", index: 1, task: "Write the patch" },
  { id: "failed", agent: "reviewer", status: "failed", index: 2, task: "Check the tests" },
  { id: "aborted", agent: "helper", status: "aborted", index: 3, task: "Wait for input" },
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
    (expandedHtml.match(/<svg[^>]*width="12"[^>]*height="12"/g) ?? []).length >= 3,
    "terminal rows should render status icons",
  );
});

test("hierarchy builder is deterministic and preserves parent ordering", () => {
  const roster = [
    { id: "root", agent: "scout", status: "started", index: 0, task: "Inspect" },
    { id: "unknown-child", agent: "worker", status: "completed", index: 1, parentToolCallId: "parent-call", task: "Write" },
    { id: "nested", agent: "helper", status: "started", index: 2, parentToolCallId: "root", task: "Check" },
    { id: "root-2", agent: "reviewer", status: "failed", index: 3, task: "Review" },
    { id: "unknown-child-2", agent: "helper", status: "aborted", index: 4, parentToolCallId: "parent-call", task: "Report" },
  ];

  const first = buildSubagentHubTree(roster);
  const second = buildSubagentHubTree(roster);
  assert.deepEqual(second, first);
  assert.deepEqual(
    first.filter((item) => item.kind === "row").map((item) => item.subagent.id),
    ["root", "nested", "root-2", "unknown-child", "unknown-child-2"],
  );
  assert.equal(first.filter((item) => item.kind === "row").length, roster.length);
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
