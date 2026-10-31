import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Installed only in the isolated workbench. Listeners observe without cancelling
// events, changing focus, requesting frames, or invoking editor commands.
function install() {
  if (globalThis.__s1MatrixObservation)
    return globalThis.__s1MatrixObservation.read();
  let nextElementId = 0;
  const elementIds = new WeakMap();
  const elementId = (node) => {
    if (!elementIds.has(node)) elementIds.set(node, ++nextElementId);
    return elementIds.get(node);
  };
  const describe = (node) =>
    node && {
      elementId: elementId(node),
      tag: node.tagName,
      id: node.id,
      className: String(node.className),
      role: node.getAttribute?.("role"),
      label: node.getAttribute?.("aria-label"),
      editor: Boolean(node.closest?.(".monaco-editor")),
      quickInput: Boolean(node.closest?.(".quick-input-widget")),
      searchQuery: Boolean(node.closest?.(".search-widget .search-container")),
      dialog: Boolean(node.closest?.('[role="dialog"]')),
      rename: Boolean(node.closest?.(".rename-box")),
      scmInput: Boolean(node.closest?.(".scm-editor-container")),
      actionList: Boolean(node.closest?.(".action-widget")),
      explorer: Boolean(node.closest?.(".explorer-folders-view")),
      openEditors: Boolean(node.closest?.(".open-editors")),
      scm: Boolean(node.closest?.(".scm-view")),
      hover: Boolean(node.closest?.(".monaco-hover,.monaco-hover-content")),
    };
  const state = { events: [], overflow: 0 };
  const editContexts = new WeakSet();
  const observeEditContexts = () => {
    for (const node of document.querySelectorAll(".native-edit-context")) {
      const context = node.editContext;
      if (!context || editContexts.has(context)) continue;
      editContexts.add(context);
      for (const type of ["textupdate", "compositionstart", "compositionend"])
        context.addEventListener(type, (event) => {
          if (state.events.length >= 8192) {
            state.overflow++;
            return;
          }
          state.events.push({
            type,
            editContext: true,
            time: performance.now(),
            text: event.text,
            updateRangeStart: event.updateRangeStart,
            updateRangeEnd: event.updateRangeEnd,
            selectionStart: event.selectionStart,
            selectionEnd: event.selectionEnd,
            contextText: context.text,
            target: describe(node),
            active: describe(document.activeElement),
          });
        });
    }
  };
  const snapshot = () => ({
    time: performance.now(),
    timeOrigin: performance.timeOrigin,
    wallTime: Date.now(),
    documentFocused: document.hasFocus(),
    active: describe(document.activeElement),
    widgets: Object.fromEntries(
      Object.entries({
        quickInput: ".quick-input-widget",
        rename: ".rename-box",
        actionList: ".action-widget",
        hover: ".monaco-hover",
        dialog: '[role="dialog"]',
      }).map(([name, selector]) => [
        name,
        [...document.querySelectorAll(selector)].some((node) =>
          node.checkVisibility({
            visibilityProperty: true,
            opacityProperty: true,
          }),
        ),
      ]),
    ),
    editContexts: [...document.querySelectorAll(".native-edit-context")]
      .filter((node) => node.editContext)
      .map((node) => ({
        ...describe(node),
        focused: node === document.activeElement,
        text: node.editContext.text,
        selectionStart: node.editContext.selectionStart,
        selectionEnd: node.editContext.selectionEnd,
      })),
    inputs: [...document.querySelectorAll("input,textarea")]
      .filter((node) =>
        node.checkVisibility({
          visibilityProperty: true,
          opacityProperty: true,
        }),
      )
      .map((node) => ({
        ...describe(node),
        value: node.value,
        focused: node === document.activeElement,
      })),
  });
  for (const type of [
    "keydown",
    "keyup",
    "beforeinput",
    "input",
    "focusin",
    "focusout",
    "compositionstart",
    "compositionupdate",
    "compositionend",
    "pointerdown",
    "pointerup",
    "mousedown",
    "mouseup",
  ]) {
    document.addEventListener(
      type,
      (event) => {
        if (type === "focusin") observeEditContexts();
        if (state.events.length >= 8192) {
          state.overflow++;
          return;
        }
        state.events.push({
          type,
          time: performance.now(),
          key: event.key,
          code: event.code,
          keyCode: event.keyCode,
          ctrl: event.ctrlKey,
          alt: event.altKey,
          shift: event.shiftKey,
          meta: event.metaKey,
          composing: event.isComposing,
          inputType: event.inputType,
          data: event.data,
          button: event.button,
          clientX: event.clientX,
          clientY: event.clientY,
          target: describe(event.target),
          active: describe(document.activeElement),
        });
      },
      true,
    );
  }
  for (const type of ["blur", "focus"])
    window.addEventListener(type, () => {
      if (state.events.length >= 8192) {
        state.overflow++;
        return;
      }
      state.events.push({
        type: "window-" + type,
        time: performance.now(),
        documentFocused: document.hasFocus(),
      });
    });
  let focusTimer,
    focusSamples = [],
    lastFocus;
  const sampleFocus = () => {
    const value = snapshot();
    const signature = JSON.stringify([
      value.active,
      value.widgets,
      value.documentFocused,
      value.inputs,
      value.editContexts,
    ]);
    if (signature !== lastFocus) {
      lastFocus = signature;
      focusSamples.push(value);
    }
  };
  globalThis.__s1MatrixObservation = {
    begin() {
      observeEditContexts();
      state.events = [];
      state.overflow = 0;
      return snapshot();
    },
    read() {
      return { ...snapshot(), events: state.events, overflow: state.overflow };
    },
    beginFocus() {
      clearInterval(focusTimer);
      focusSamples = [];
      lastFocus = undefined;
      sampleFocus();
      focusTimer = setInterval(sampleFocus, 25);
      return snapshot();
    },
    finishFocus() {
      clearInterval(focusTimer);
      sampleFocus();
      return { ...this.read(), focusSamples };
    },
  };
  observeEditContexts();
  return snapshot();
}

export async function connectMatrixObserver({ port, until }) {
  const get = async (path) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      signal: AbortSignal.timeout(2000),
    });
    assert.ok(response.ok);
    return response.json();
  };
  const target = await until(async () => {
    try {
      const targets = (await get("/json/list")).filter(
        (item) => item.type === "page" && item.url.includes("workbench"),
      );
      return targets.length === 1 && targets[0];
    } catch {
      return false;
    }
  }, "one matrix workbench target was not found");
  const protocol = await get("/json/protocol");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("matrix CDP connection timeout")),
      5000,
    );
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timeout);
        reject(new Error("matrix CDP connection failed"));
      },
      { once: true },
    );
  });
  let sequence = 0;
  const pending = new Map();
  const worldName = "s1-matrix-passive-observer";
  let observerContext;
  const fail = () => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error("matrix CDP closed"));
    }
    pending.clear();
  };
  socket.addEventListener("close", fail);
  socket.addEventListener("error", fail);
  socket.addEventListener("message", (event) => {
    const response = JSON.parse(event.data);
    if (
      response.method === "Runtime.executionContextCreated" &&
      response.params.context.name === worldName
    )
      observerContext = response.params.context.id;
    if (
      response.method === "Runtime.executionContextsCleared" ||
      (response.method === "Runtime.executionContextDestroyed" &&
        response.params.executionContextId === observerContext)
    )
      observerContext = undefined;
    const item = pending.get(response.id);
    if (!item) return;
    pending.delete(response.id);
    clearTimeout(item.timer);
    if (response.error) item.reject(new Error(JSON.stringify(response.error)));
    else item.resolve(response.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("matrix CDP timeout: " + method));
      }, 5000);
      pending.set(id, { timer, resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const contextId = await until(
      () => observerContext,
      "passive observer world is missing",
    );
    const response = await send("Runtime.evaluate", {
      expression,
      contextId,
      returnByValue: true,
      timeout: 4000,
    });
    assert.ok(
      !response.exceptionDetails,
      JSON.stringify(response.exceptionDetails),
    );
    return response.result.value;
  };
  // Electron creates its workbench worlds during startup. Keep passive state
  // in a named world, recreated on navigation; never gate first input on it.
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(${install.toString()})()`,
    worldName,
  });
  const frame = await send("Page.getFrameTree");
  const world = await send("Page.createIsolatedWorld", {
    frameId: frame.frameTree.frame.id,
    worldName,
  });
  observerContext = world.executionContextId;
  await evaluate(`(${install.toString()})()`);
  return {
    metadata: {
      browser: await send("Browser.getVersion"),
      crossOriginIsolated: await evaluate("globalThis.crossOriginIsolated"),
      protocolSha256: createHash("sha256")
        .update(JSON.stringify(protocol))
        .digest("hex"),
      passiveEventListeners: true,
      runnerTimeOrigin: performance.timeOrigin,
    },
    send,
    evaluate,
    begin: () => evaluate("__s1MatrixObservation.begin()"),
    read: () => evaluate("__s1MatrixObservation.read()"),
    beginFocus: () => evaluate("__s1MatrixObservation.beginFocus()"),
    finishFocus: () => evaluate("__s1MatrixObservation.finishFocus()"),
    clock: () =>
      evaluate(
        "({time: performance.now(), timeOrigin: performance.timeOrigin, wallTime: Date.now()})",
      ),
    close: () => socket.close(),
  };
}

export async function clockSamples(remote, count = 7) {
  const samples = [];
  for (let i = 0; i < count; i++) {
    const sent = performance.now();
    const value = await remote();
    const received = performance.now();
    samples.push({ sent, received, remote: value });
  }
  return samples;
}
