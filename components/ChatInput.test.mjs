import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ChatInput, ModelErrorBanner, filterModelOptions } = await jiti.import("./ChatInput.tsx");

const noop = () => {};

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

/** Resolve ChatInput's forwardRef render with a tiny stateful dispatcher so
 * the popup click contract can be exercised without a browser DOM. */
function withInteractiveHooks(callback) {
  const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previousDispatcher = internals.H;
  const stateSlots = [];
  const refSlots = [];
  let hookCursor = 0;
  const forwardRefType = ChatInput.type ?? ChatInput;
  const render = forwardRefType.render ?? forwardRefType.type?.render;
  assert.equal(typeof render, "function");

  internals.H = {
    useState(initial) {
      const slot = hookCursor++;
      if (!(slot in stateSlots)) stateSlots[slot] = typeof initial === "function" ? initial() : initial;
      return [stateSlots[slot], (next) => {
        stateSlots[slot] = typeof next === "function" ? next(stateSlots[slot]) : next;
      }];
    },
    useRef(initial) {
      const slot = hookCursor++;
      if (!(slot in refSlots)) refSlots[slot] = { current: initial };
      return refSlots[slot];
    },
    useMemo(factory) {
      hookCursor++;
      return factory();
    },
    useCallback(callbackValue) {
      hookCursor++;
      return callbackValue;
    },
    useEffect() {
      hookCursor++;
    },
    useImperativeHandle() {
      hookCursor++;
    },
    useSyncExternalStore(_subscribe, _getSnapshot, getServerSnapshot) {
      hookCursor++;
      return getServerSnapshot();
    },
  };

  try {
    return callback((props) => {
      hookCursor = 0;
      return resolveElementTree(render(props, null));
    });
  } finally {
    internals.H = previousDispatcher;
  }
}

test("renders the upstream model error", () => {
  const html = renderToStaticMarkup(
    React.createElement(ModelErrorBanner, {
      error: "Invalid models.json schema:\nproviders.custom.models.0.id must not be empty",
    }),
  );

  assert.match(html, /role="alert"/);
  // en.json is assembled from locale parts; before assembly the key renders as-is.
  assert.match(html, /(Model error|chatInput\.modelError)/);
  assert.match(html, /providers\.custom\.models\.0\.id must not be empty/);
});

test("does not render an empty model error", () => {
  assert.equal(renderToStaticMarkup(React.createElement(ModelErrorBanner, { error: null })), "");
});

test("keeps the model selector visible when a model error leaves no options", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      onModelChange() {},
      isStreaming: false,
      modelError: "Invalid models.json schema",
      modelList: [],
      modelNames: {},
    }),
  );

  assert.match(html, />(No models|chatInput\.noModels)</);
  assert.match(html, /title="(No available models|chatInput\.noAvailableModels)"/);
});


test("renders goal, planning, and advisor indicators at the composer", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      onModelChange() {},
      isStreaming: false,
      model: { provider: "test", modelId: "model" },
      modelList: [{ provider: "test", modelId: "model", id: "model", name: "Test model" }],
      modelNames: {},
      activeGoal: { objective: "Ship the active goal bar", startedAt: 0 },
      activePlan: { objective: "Plan the implementation" },
      advisorEnabled: true,
    }),
  );

  assert.match(html, /Ship the active goal bar/);
  assert.match(html, /(Planning in progress|chatInput\.planningInProgress)/);
  assert.match(html, /(Advisor enabled|chatInput\.advisorEnabled)/);
});

test("renders context ring button collapsed without its popup on the server", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend: noop,
      onAbort: noop,
      isStreaming: false,
      contextUsage: { percent: 34.2, contextWindow: 1_000_000, tokens: 342_000 },
    }),
  );

  assert.match(html, /<button[^>]*class="composer-context-ring"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.doesNotMatch(html, /composer-context-ring-popup/);
});

test("renders an empty disabled context ring before a session exists", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend: noop,
      isStreaming: false,
    }),
  );

  assert.match(html, /<button[^>]*class="composer-context-ring"[^>]*disabled/);
  assert.match(html, /aria-label="Context window usage unavailable"/);
  assert.match(html, />0%<\/span>/);
  assert.doesNotMatch(html, /composer-context-ring-popup/);
});

test("opens the context popup with the resolved percent and window summary", () => {
  withInteractiveHooks((rerender) => {
    const props = {
      onSend: noop,
      onAbort: noop,
      isStreaming: false,
      contextUsage: { percent: 34.2, contextWindow: 1_000_000, tokens: 342_000 },
    };
    const initialTree = rerender(props);
    const findRingButton = (tree) => findHostElements(
      tree,
      (type, buttonProps) => type === "button" && buttonProps.className === "composer-context-ring",
    )[0];
    const initialButton = findRingButton(initialTree);

    assert.ok(initialButton);
    assert.equal(initialButton.props["aria-expanded"], false);
    assert.equal(findHostElements(initialTree, (type, popupProps) => (
      type === "div" && String(popupProps.className ?? "").includes("composer-context-ring-popup")
    )).length, 0);

    initialButton.props.onClick();
    const openedTree = rerender(props);
    const openedButton = findRingButton(openedTree);
    const popup = findHostElements(openedTree, (type, popupProps) => (
      type === "div" && String(popupProps.className ?? "").includes("composer-context-ring-popup")
    ));

    assert.equal(openedButton.props["aria-expanded"], true);
    assert.equal(popup.length, 1);
    assert.equal(textContent(popup[0]), "34.2% / 1M");

    openedButton.props.onClick();
    const closedTree = rerender(props);
    assert.equal(findRingButton(closedTree).props["aria-expanded"], false);
    assert.equal(findHostElements(closedTree, (type, popupProps) => (
      type === "div" && String(popupProps.className ?? "").includes("composer-context-ring-popup")
    )).length, 0);
  });
});

test("compacts the medium thinking trigger without changing accessible copy", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      onThinkingLevelChange() {},
      isStreaming: false,
      thinkingLevel: "medium",
      thinkingLevelMap: { medium: "medium" },
      availableThinkingLevels: ["medium", "xhigh"],
    }),
  );

  assert.match(html, />med</);
  assert.match(html, /aria-label="[^"]*medium"/);
  assert.doesNotMatch(html, />medium</);
});

test("filters model options by display name, identifier, and provider", () => {
  const options = [
    { provider: "OpenAI", modelId: "gpt-5.2", name: "GPT-5.2" },
    { provider: "Anthropic", modelId: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
  ];

  assert.deepEqual(filterModelOptions(options, "sonnet", "en"), [options[1]]);
  assert.deepEqual(filterModelOptions(options, "5.2", "en"), [options[0]]);
  assert.deepEqual(filterModelOptions(options, "OPENAI", "en"), [options[0]]);
  assert.equal(filterModelOptions(options, "   ", "en"), options);
});

test("renders idle send button with disabled state and accessible label", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend: noop,
      onAbort: noop,
      isStreaming: false,
    }),
  );

  assert.match(html, /<button[^>]*class="[^"]*composer-primary-action[^"]*"/);
  assert.match(html, /data-state="send"/);
  assert.match(html, /<button[^>]*class="[^"]*composer-primary-action[^"]*"[^>]*disabled/);
  assert.match(html, /aria-label="(Send|chatInput\.send)"/);
  assert.match(html, /title="(Send|chatInput\.send)"/);
  assert.match(html, /<span class="composer-primary-label">(Send|chatInput\.send)<\/span>/);
});

test("keeps an existing session composer read-only until runtime state is ready", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend: noop,
      onAbort: noop,
      onModelChange: noop,
      runtimeReady: false,
      isStreaming: false,
      model: { provider: "test", modelId: "model" },
      modelList: [{ provider: "test", modelId: "model", id: "model", name: "Test model" }],
    }),
  );

  assert.match(html, /<textarea[^>]*readOnly/);
  assert.match(html, /<input[^>]*type="file"[^>]*disabled/);
  assert.match(html, /<button[^>]*class="[^"]*composer-model-button[^"]*"[^>]*disabled/);
  assert.match(html, /<button[^>]*class="[^"]*composer-primary-action[^"]*"[^>]*disabled/);
});

test("renders active stop button when agent is streaming", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend: noop,
      onAbort: noop,
      isStreaming: true,
    }),
  );

  assert.match(html, /<button[^>]*class="[^"]*composer-primary-action[^"]*"[^>]*data-state="stop"/);
  assert.doesNotMatch(html, /<button[^>]*class="[^"]*composer-primary-action[^"]*"[^>]*disabled/);
  assert.match(html, /aria-label="(Stop agent|chatInput\.stopAgent)"/);
  assert.match(html, /title="(Stop agent|chatInput\.stopAgent)"/);
  assert.match(html, /<span class="composer-primary-label">(Stop|chatInput\.stop)<\/span>/);
});

test("renders shared horizontal padding and column width at composer root", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend: noop,
      onAbort: noop,
      isStreaming: false,
    }),
  );

  assert.match(html, /padding-left:\s*16px/);
  assert.match(html, /padding-right:\s*16px/);
  assert.match(html, /max-width:\s*960px/);
});

test("disables attachment controls and model selection when runtimeReady is false", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend: noop,
      onAbort: noop,
      onModelChange: noop,
      isStreaming: false,
      runtimeReady: false,
      model: { provider: "test", modelId: "model" },
      modelList: [{ provider: "test", modelId: "model", id: "model", name: "Test model" }],
    }),
  );

  assert.match(html, /<input[^>]*type="file"[^>]*disabled/);
  assert.match(html, /<button[^>]*class="[^"]*composer-model-button[^"]*"[^>]*disabled/);
});