(() => {
  "use strict";

  const app = document.getElementById("app");
  const bridge = window.OmpguiRemoteReplica || {};
  const query = new URLSearchParams(window.location.search);
  const offline = query.get("offline") === "1";

  function syncViewportHeight() {
    const root = document.documentElement;
    const visual = window.visualViewport;
    const height = visual ? visual.height + visual.offsetTop : window.innerHeight;
    root.style.setProperty("--app-viewport-height", `${height}px`);
  }
  syncViewportHeight();
  if (window.visualViewport) {
    visualViewport.addEventListener("resize", syncViewportHeight);
    visualViewport.addEventListener("scroll", syncViewportHeight);
  }
  window.addEventListener("resize", syncViewportHeight);

  function getOrigin() {
    try {
      const value = typeof bridge.getOrigin === "function" ? bridge.getOrigin() : null;
      return typeof value === "string" ? value : "";
    } catch {
      return "";
    }
  }

  function getSnapshot() {
    try {
      const raw = typeof bridge.getSnapshot === "function" ? bridge.getSnapshot() : null;
      if (typeof raw !== "string" || raw.length === 0) return null;
      const value = JSON.parse(raw);
      if (!value || value.version !== 1 || !value.session || typeof value.session !== "object") return null;
      if (!Array.isArray(value.session.messages)) return null;
      return value;
    } catch {
      return null;
    }
  }

  function make(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function setStatus(element, text, error) {
    element.textContent = text;
    element.classList.toggle("error", Boolean(error));
  }

  function remoteUrl(origin) {
    try {
      const url = new URL(origin);
      url.searchParams.set("ompguiRemote", "1");
      return url.toString();
    } catch {
      return null;
    }
  }

  function goToRemote(origin) {
    const target = remoteUrl(origin || getOrigin());
    if (!target) return false;
    window.location.replace(target);
    return true;
  }

  function renderSetup(options = {}) {
    app.replaceChildren();
    const card = make("section", "card");
    card.append(
      make("div", "eyebrow", "ompgui Remote"),
      make("h1", "", options.change ? "Change server" : "Connect to ompgui"),
      make("p", "description", "Enter the origin of the ompgui server. Remote HTTPS origins are required; HTTP is accepted only for loopback development.")
    );

    const form = make("form");
    const label = make("label", "", "ompgui origin");
    label.htmlFor = "origin";
    const input = document.createElement("input");
    input.id = "origin";
    input.name = "origin";
    input.type = "url";
    input.inputMode = "url";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = "https://server.example";
    input.value = getOrigin();
    const actions = make("div", "actions");
    const submit = make("button", "", "Connect");
    submit.type = "submit";
    actions.append(submit);
    const status = make("p", "status");
    status.setAttribute("role", "status");
    form.append(label, input, actions, status);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) {
        setStatus(status, "Enter an origin to continue.", true);
        input.focus();
        return;
      }
      if (typeof bridge.setOrigin !== "function" || !bridge.setOrigin(value)) {
        setStatus(status, "That origin is not allowed. Use HTTPS, or HTTP on localhost/127.0.0.1.", true);
        input.focus();
        return;
      }
      submit.disabled = true;
      setStatus(status, "Connecting…", false);
      if (!goToRemote(getOrigin())) {
        submit.disabled = false;
        setStatus(status, "The origin could not be normalized.", true);
      }
    });
    card.append(form);
    app.append(card);
    input.focus();
  }

  function renderMessageList(messages) {
    const list = make("div", "messages");
    const safeMessages = Array.isArray(messages) ? messages.slice(-50) : [];
    if (safeMessages.length === 0) {
      list.append(make("div", "empty", "No cached display messages are available."));
      return list;
    }
    for (const message of safeMessages) {
      if (!message || typeof message !== "object") continue;
      const role = typeof message.role === "string" ? message.role : "message";
      const text = typeof message.text === "string" ? message.text : "";
      const block = make("article", "message");
      block.append(make("div", "message-role", role), make("div", "message-text", text));
      list.append(block);
    }
    if (!list.firstChild) list.append(make("div", "empty", "No cached display messages are available."));
    return list;
  }

  function renderOffline(snapshot) {
    app.replaceChildren();
    const card = make("section", "card");
    card.append(make("div", "eyebrow", "ompgui Remote"), make("h1", "", "Read-only cached view"));
    card.append(make("div", "cache-banner", "Cached/offline data. Sending and all other mutations are disabled until the live server reconnects."));

    if (snapshot && snapshot.session) {
      const session = snapshot.session;
      const title = typeof session.title === "string" && session.title ? session.title : "Cached session";
      card.append(make("h2", "", title));
      if (typeof session.cwd === "string" && session.cwd) card.append(make("div", "session-meta", session.cwd));
      card.append(renderMessageList(session.messages));
    } else {
      card.append(make("p", "description", "There is no cached session yet. Reconnect when the server is reachable, or choose another server."));
    }

    const actions = make("div", "actions");
    const reconnect = make("button", "", "Reconnect");
    const change = make("button", "secondary", "Change server");
    reconnect.type = "button";
    change.type = "button";
    reconnect.addEventListener("click", () => {
      if (!goToRemote(getOrigin())) renderSetup({ change: true });
    });
    change.addEventListener("click", () => renderSetup({ change: true }));
    actions.append(reconnect, change);
    card.append(actions);
    app.append(card);
  }

  if (offline) {
    renderOffline(getSnapshot());
  } else {
    renderSetup();
  }
})();
