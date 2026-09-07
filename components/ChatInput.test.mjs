import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ChatInput, ModelErrorBanner, filterModelOptions, resolveMobileRunSubmitMode } = await jiti.import("./ChatInput.tsx");
const { CHAT_COLUMN_MAX_WIDTH } = await jiti.import("../lib/chat-layout.ts");
const { getDraft, setDraft, clearDraft } = await jiti.import("../lib/draft-store.ts");

const noop = () => {};
if (typeof globalThis.requestAnimationFrame !== "function") {
  globalThis.requestAnimationFrame = () => 0;
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

  const restore = () => {
    internals.H = previousDispatcher;
  };
  try {
    const result = callback((props) => {
      hookCursor = 0;
      return resolveElementTree(render(props, null));
    });
    if (result && typeof result.then === "function") {
      return Promise.resolve(result).finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
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
      sessionCost: 12.33,
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
      sessionCost: 0,
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
    assert.equal(textContent(popup[0]), "Context window34.2% used342k / 1.0M tokensSession cost $0.00");

    openedButton.props.onClick();
    const closedTree = rerender(props);
    assert.equal(findRingButton(closedTree).props["aria-expanded"], false);
    assert.equal(findHostElements(closedTree, (type, popupProps) => (
      type === "div" && String(popupProps.className ?? "").includes("composer-context-ring-popup")
    )).length, 0);
  });
});

test("running image upload survives failed enqueue and clears only after accepted retry", async () => {
  const previousReader = globalThis.FileReader;
  const previousCreateUrl = URL.createObjectURL;
  const previousRevokeUrl = URL.revokeObjectURL;
  globalThis.FileReader = class {
    readAsDataURL() {
      this.result = "data:image/png;base64,aGVsbG8=";
      this.onload();
    }
  };
  URL.createObjectURL = () => "blob:queued-image";
  URL.revokeObjectURL = noop;
  try {
    await withInteractiveHooks(async (rerender) => {
      const queued = [];
      let accepted = false;
      const props = {
        onSend: noop,
        onAbort: noop,
        isStreaming: true,
        onPromptWithStreamingBehavior: async (message, behavior, images) => {
          queued.push({ message, behavior, images });
          return accepted;
        },
      };
      let tree = rerender(props);
      const picker = findHostElements(tree, (type, inputProps) => type === "input" && inputProps.type === "file")[0];
      assert.equal(picker.props.disabled, false);
      picker.props.onChange({ target: { files: [{ type: "image/png", size: 5 }], value: "image.png" } });
      await Promise.resolve();
      await Promise.resolve();
      tree = rerender(props);
      assert.equal(findHostElements(tree, (type) => type === "img")[0].props.src, "blob:queued-image");
      const queueButton = findHostElements(tree, (type, buttonProps) => type === "button"
        && String(buttonProps.className).includes("composer-queue-action-steer"))[0];
      assert.equal(queueButton.props.disabled, false);
      await queueButton.props.onClick();
      await Promise.resolve();
      tree = rerender(props);
      assert.equal(queued.length, 1);
      assert.equal(queued[0].message, "");
      assert.equal(queued[0].images[0].data, "aGVsbG8=");
      assert.equal(findHostElements(tree, (type) => type === "img")[0].props.src, "blob:queued-image");
      accepted = true;
      findHostElements(tree, (type, buttonProps) => type === "button"
        && String(buttonProps.className).includes("composer-queue-action-steer"))[0].props.onClick();
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(findHostElements(rerender(props), (type) => type === "img").length, 0);
      assert.equal(queued[1].images[0].data, "aGVsbG8=");
    });
  } finally {
    globalThis.FileReader = previousReader;
    URL.createObjectURL = previousCreateUrl;
    URL.revokeObjectURL = previousRevokeUrl;
  }
});

test("pending enqueue blocks duplicate queue and idle submissions until acknowledgement", async () => {
  await withInteractiveHooks(async (rerender) => {
    const acknowledgement = Promise.withResolvers();
    const queued = [];
    const sent = [];
    const props = {
      onSend: (message) => sent.push(message),
      onAbort: noop,
      isStreaming: true,
      onPromptWithStreamingBehavior: (message) => {
        queued.push(message);
        return acknowledgement.promise;
      },
    };
    let tree = rerender(props);
    findHostElements(tree, (type) => type === "textarea")[0].props.onChange({
      target: { value: "one delivery", selectionStart: 12 },
    });
    tree = rerender(props);
    const queueButton = findHostElements(tree, (type, buttonProps) => type === "button"
      && String(buttonProps.className).includes("composer-queue-action-steer"))[0];
    queueButton.props.onClick();
    queueButton.props.onClick();
    assert.deepEqual(queued, ["one delivery"]);

    const idleProps = { ...props, isStreaming: false };
    const idleTree = rerender(idleProps);
    const send = findHostElements(idleTree, (type, buttonProps) => type === "button"
      && buttonProps["data-state"] === "send")[0];
    assert.equal(send.props.disabled, true);
    await send.props.onClick();
    const textarea = findHostElements(idleTree, (type) => type === "textarea")[0];
    textarea.props.onKeyDown({ key: "Enter", shiftKey: false, nativeEvent: {}, preventDefault: noop });
    assert.deepEqual(sent, []);
    assert.equal(textarea.props.value, "one delivery");

    acknowledgement.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    const acknowledgedTree = rerender(idleProps);
    const emptyDraft = findHostElements(acknowledgedTree, (type) => type === "textarea")[0];
    assert.equal(emptyDraft.props.value, "");
    emptyDraft.props.onChange({ target: { value: "next delivery", selectionStart: 13 } });
    const readyTree = rerender(idleProps);
    const readySend = findHostElements(readyTree, (type, buttonProps) => type === "button"
      && buttonProps["data-state"] === "send")[0];
    assert.equal(readySend.props.disabled, false);
    await readySend.props.onClick();
    assert.deepEqual(sent, ["next delivery"]);
  });
});

test("native-only queued counts have no edit or delete controls", () => {
  withInteractiveHooks((rerender) => {
    const tree = rerender({
      onSend: noop,
      onAbort: noop,
      isStreaming: true,
      queuedMessages: { revision: 0, items: [], nativeQueuedCount: 3 },
    });
    const status = findHostElements(tree, (type, props) => type === "div" && props.role === "status"
      && /Queued on device|chatInput\.queuedNativeCount/.test(textContent(props.children)));
    assert.equal(status.length, 1);
    assert.match(textContent(status[0]), /3/);
    assert.deepEqual(findHostElements(status[0], (type) => type === "button"), []);
    assert.deepEqual(findHostElements(tree, (type, props) => type === "div" && props["data-queue-id"]), []);
  });
});

test("queued items expose per-id edit, delete, and follow-up steer", async () => {
  await withInteractiveHooks(async (rerender) => {
    const recalled = [];
    const deleted = [];
    const promoted = [];
    let recallResult = { text: "from-queue", images: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }] };
    const snapshot = {
      revision: 4,
      nativeQueuedCount: 2,
      items: [
        { id: "q1", text: "same", lane: "followUp", status: "queued" },
        { id: "q2", text: "same", lane: "followUp", status: "queued", attachments: [{ mimeType: "image/png", bytes: 5 }] },
        { id: "q-send", text: "in flight", lane: "steer", status: "sending" },
        { id: "q-fail", text: "broke", lane: "followUp", status: "failed", error: "timeout" },
      ],
    };
    const props = {
      onSend: noop,
      onAbort: noop,
      isStreaming: true,
      queuedMessages: snapshot,
      onRecallQueuedMessage: async (id) => {
        recalled.push(id);
        return recallResult;
      },
      onDeleteQueuedMessage: async (id) => {
        deleted.push(id);
        return true;
      },
      onPromoteQueuedToSteer: async (id) => {
        promoted.push(id);
        return true;
      },
    };

    const findRow = (tree, id) => findHostElements(
      tree,
      (type, rowProps) => type === "div" && rowProps["data-queue-id"] === id,
    )[0];
    const findButtons = (row) => findHostElements(row, (type) => type === "button");
    const buttonByTitle = (row, pattern) => findButtons(row).find((button) => (
      pattern.test(String(button.props.title ?? "")) || pattern.test(textContent(button))
    ));

    const tree = rerender(props);
    const follow = findRow(tree, "q1");
    const duplicate = findRow(tree, "q2");
    const sending = findRow(tree, "q-send");
    const failed = findRow(tree, "q-fail");
    assert.ok(follow && duplicate && sending && failed);
    const nativeStatus = findHostElements(tree, (type, props) => type === "div" && props.role === "status"
      && /Queued on device|chatInput\.queuedNativeCount/.test(textContent(props.children)))[0];
    assert.ok(nativeStatus);
    assert.deepEqual(findHostElements(nativeStatus, (type) => type === "button"), []);
    assert.equal(findButtons(follow).length, 3);
    assert.equal(findButtons(duplicate).length, 3);
    assert.equal(findButtons(sending).length, 2);
    assert.equal(findButtons(failed).length, 2);
    assert.ok(findButtons(sending).every((button) => button.props.disabled));
    assert.ok(findButtons(follow).every((button) => !button.props.disabled));
    assert.ok(findButtons(failed).every((button) => !button.props.disabled));
    assert.match(textContent(failed), /timeout/);
    assert.ok(findHostElements(failed, (type, alertProps) => type === "span" && alertProps.role === "alert")[0]);

    buttonByTitle(duplicate, /Edit this queued message|chatInput\.queuedEditTitle/)?.props.onClick();
    await Promise.resolve();
    await Promise.resolve();
    const afterEdit = rerender(props);
    const textarea = findHostElements(afterEdit, (type) => type === "textarea")[0];
    assert.deepEqual(recalled, ["q2"]);
    assert.equal(textarea.props.value, "from-queue");
    const restoredImage = findHostElements(afterEdit, (type) => type === "img")[0];
    assert.equal(restoredImage.props.src, "data:image/png;base64,aGVsbG8=");
    assert.equal(findHostElements(duplicate, (type) => type === "img").length, 0);
    assert.match(textContent(duplicate), /Images · 1|chatInput\.queuedImages/);

    recallResult = null;
    const previousWindow = globalThis.window;
    try {
      globalThis.window = { confirm: () => false };
      buttonByTitle(findRow(afterEdit, "q1"), /Edit this queued message|chatInput\.queuedEditTitle/)?.props.onClick();
      assert.deepEqual(recalled, ["q2"]);
      globalThis.window = { confirm: () => true };
      buttonByTitle(findRow(afterEdit, "q1"), /Edit this queued message|chatInput\.queuedEditTitle/)?.props.onClick();
    } finally {
      globalThis.window = previousWindow;
    }
    await Promise.resolve();
    await Promise.resolve();
    const afterFailedRecall = rerender(props);
    const textareaAfterMiss = findHostElements(afterFailedRecall, (type) => type === "textarea")[0];
    assert.deepEqual(recalled, ["q2", "q1"]);
    assert.equal(textareaAfterMiss.props.value, "from-queue");

    buttonByTitle(findRow(afterFailedRecall, "q1"), /Remove this queued message|chatInput\.queuedDeleteTitle/)?.props.onClick();
    buttonByTitle(findRow(afterFailedRecall, "q1"), /Deliver this message as a steer|chatInput\.queuedSteerTitle/)?.props.onClick();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(deleted, ["q1"]);
    assert.deepEqual(promoted, ["q1"]);

    const sendingEdit = buttonByTitle(findRow(afterFailedRecall, "q-send"), /Edit this queued message|chatInput\.queuedEditTitle/);
    sendingEdit?.props.onClick();
    await Promise.resolve();
    globalThis.window = previousWindow;
    assert.deepEqual(recalled, ["q2", "q1"]);
  });
});

test("recall preserves the outgoing draft during a key handoff before the draft-switch effect", async () => {
  const originKey = "test:recall-handoff:origin";
  const destinationKey = "test:recall-handoff:destination";
  const ack = Promise.withResolvers();
  const image = { type: "image", data: "AQID", mimeType: "image/png" };
  const newerDestination = {
    value: "Newer destination draft",
    images: [{ data: "BAUG", mimeType: "image/png" }],
    files: [{ name: "notes.txt", mimeType: "text/plain", content: "Keep these notes", size: 16 }],
  };
  clearDraft(originKey);
  clearDraft(destinationKey);
  try {
    await withInteractiveHooks(async (rerender) => {
      const recalledIds = [];
      const props = {
        draftKey: originKey,
        onSend: noop,
        onAbort: noop,
        isStreaming: true,
        queuedMessages: {
          revision: 7,
          items: [{
            id: "handoff-item", text: "Recovered queued text", lane: "followUp", status: "queued",
            attachments: [{ mimeType: "image/png", bytes: 3 }],
          }],
        },
        onRecallQueuedMessage: (id) => {
          recalledIds.push(id);
          return ack.promise;
        },
      };
      let tree = rerender(props);
      const textarea = findHostElements(tree, (type) => type === "textarea")[0];
      assert.equal(textarea.props.value, "");
      const row = findHostElements(tree, (type, rowProps) => (
        type === "div" && rowProps["data-queue-id"] === "handoff-item"
      ))[0];
      const edit = findHostElements(row, (type) => type === "button").find((button) => (
        /Edit this queued message|chatInput\.queuedEditTitle/.test(String(button.props.title ?? ""))
      ));
      assert.ok(edit);
      edit.props.onClick();
      assert.deepEqual(recalledIds, ["handoff-item"]);

      // The user continues the outgoing draft while recall is in flight.
      textarea.props.onChange({ target: { value: "Outgoing draft typed during recall", selectionStart: 34 } });
      rerender(props);
      setDraft(destinationKey, newerDestination);
      const destinationProps = { ...props, draftKey: destinationKey, queuedMessages: { revision: 0, items: [] } };
      tree = rerender(destinationProps);
      const beforeAckValue = findHostElements(tree, (type) => type === "textarea")[0].props.value;
      const beforeAckImages = findHostElements(tree, (type) => type === "img").map((node) => node.props.src);
      // Effects are disabled in this harness: the render has selected B,
      // while the composer refs still belong to A until its switch effect.
      ack.resolve({
        id: "handoff-item", text: "Recovered queued text", lane: "followUp", status: "queued", images: [image],
      });
      await ack.promise;
      await Promise.resolve();
      assert.deepEqual(getDraft(originKey), {
        value: "Recovered queued text\n\nOutgoing draft typed during recall",
        images: [{ data: "AQID", mimeType: "image/png" }], files: [],
      });
      assert.deepEqual(getDraft(destinationKey), newerDestination);
      tree = rerender(destinationProps);
      assert.equal(findHostElements(tree, (type) => type === "textarea")[0].props.value, beforeAckValue);
      assert.deepEqual(findHostElements(tree, (type) => type === "img").map((node) => node.props.src), beforeAckImages);
    });
  } finally {
    clearDraft(originKey);
    clearDraft(destinationKey);
  }
});

test("uses the configured behavior for mobile submissions during a run", () => {
  assert.equal(resolveMobileRunSubmitMode(true, true, true, "steer", true, true), "steer");
  assert.equal(resolveMobileRunSubmitMode(true, true, true, "queue", true, true), "followup");
  assert.equal(resolveMobileRunSubmitMode(true, true, true, "queue", true, false), "steer");
  assert.equal(resolveMobileRunSubmitMode(false, true, true, "steer", true, true), null);
  assert.equal(resolveMobileRunSubmitMode(true, true, false, "steer", true, true), null);
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

test("disables the model selector while the agent is streaming", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend: noop,
      onAbort: noop,
      onModelChange: noop,
      runtimeReady: true,
      isStreaming: true,
      model: { provider: "test", modelId: "model" },
      modelList: [{ provider: "test", modelId: "model", id: "model", name: "Test model" }],
    }),
  );

  const modelButton = html.match(/<button[^>]*class="[^"]*composer-model-button[^"]*"[^>]*>/);
  assert.ok(modelButton, "expected a model selector button");
  assert.match(modelButton[0], /\sdisabled(?:[=/\s>]|$)/);
});

test("blocks model selection from a stale open menu once a run starts", () => {
  const priorWindow = globalThis.window;
  globalThis.window = { visualViewport: { height: 800 }, innerHeight: 800 };
  try {
    withInteractiveHooks((rerender) => {
      const calls = [];
      const baseProps = {
        onSend: noop,
        onAbort: noop,
        onModelChange: (provider, modelId) => { calls.push([provider, modelId]); },
        runtimeReady: true,
        isStreaming: false,
        model: { provider: "test", modelId: "model" },
        modelList: [
          { provider: "test", modelId: "model", id: "model", name: "Test model" },
          { provider: "test", modelId: "other", id: "other", name: "Other model" },
        ],
      };
      const openEvent = () => ({ currentTarget: { getBoundingClientRect: () => ({ top: 600, left: 8, width: 160 }) } });
      const findModelButton = (tree) => findHostElements(
        tree,
        (type, buttonProps) => type === "button" && String(buttonProps.className ?? "").includes("composer-model-button"),
      )[0];
      const findModelOptions = (tree) => findHostElements(
        tree,
        (type, buttonProps) => type === "button" && buttonProps.className === "dropdown-item",
      );

      // Idle: the menu opens and selection dispatches as before.
      let tree = rerender(baseProps);
      findModelButton(tree).props.onClick(openEvent());
      tree = rerender(baseProps);
      assert.equal(findModelOptions(tree).length, 2);
      findModelOptions(tree).find((option) => textContent(option).includes("Other model")).props.onClick();
      assert.deepEqual(calls, [["test", "other"]]);

      // A run starts with the menu open (stale): options lock and clicks are dropped.
      tree = rerender(baseProps);
      findModelButton(tree).props.onClick(openEvent());
      tree = rerender({ ...baseProps, isStreaming: true });
      assert.equal(findModelButton(tree).props.disabled, true);
      const staleOptions = findModelOptions(tree);
      assert.equal(staleOptions.length, 2);
      for (const option of staleOptions) assert.equal(option.props.disabled, true);
      staleOptions.find((option) => textContent(option).includes("Other model")).props.onClick();
      assert.deepEqual(calls, [["test", "other"]]);
    });
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
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

  assert.equal(CHAT_COLUMN_MAX_WIDTH, 744);
  assert.match(html, /padding-left:max\(16px, env\(safe-area-inset-left, 0px\)\)/);
  assert.match(html, /padding-right:max\(16px, env\(safe-area-inset-right, 0px\)\)/);
  assert.match(html, new RegExp(`max-width:\\s*${CHAT_COLUMN_MAX_WIDTH}px`));
});
