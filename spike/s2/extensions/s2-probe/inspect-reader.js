// Test-only reader for spike S2: reaches VSCodeVim's ModeHandlerMap through the closure scope of
// the module export getAndUpdateModeHandler, with the in-process V8 inspector. It reads
// require.cache and object fields only; it calls no VSCodeVim function. It is the instrument that
// measures VSCodeVim's real state for the fixture deviations; it is not candidate (a).
const inspector = require("node:inspector");

function vimModulePath() {
  return Object.keys(require.cache).find((k) =>
    /vscodevim\.vim-[^/\\]+[/\\]out[/\\]extension\.js$/.test(k),
  );
}

function describeVimModule() {
  const path = vimModulePath();
  if (!path) return { loaded: false };
  const mod = require.cache[path];
  return {
    loaded: true,
    file: path.replace(/^.*[/\\](vscodevim\.vim-[^/\\]+)/, "$1"),
    exports: Object.keys(mod.exports).map((k) => [k, typeof mod.exports[k]]),
    children: mod.children.length,
  };
}

let session;
const post = (method, params) =>
  new Promise((resolve, reject) =>
    session.post(method, params, (err, res) =>
      err ? reject(err) : resolve(res),
    ),
  );

let cached;
async function modeHandlerMap() {
  if (cached) return cached;
  const path = vimModulePath();
  if (!path) throw new Error("VSCodeVim module not in require.cache");
  const fn = require.cache[path].exports.getAndUpdateModeHandler;
  session = new inspector.Session();
  session.connect();
  const slot = `__s2_${process.pid}_${Date.now()}`;
  globalThis[slot] = fn;
  try {
    const { result } = await post("Runtime.evaluate", {
      expression: `globalThis[${JSON.stringify(slot)}]`,
    });
    const fnProps = await post("Runtime.getProperties", {
      objectId: result.objectId,
      ownProperties: true,
    });
    const scopes = (fnProps.internalProperties ?? []).find(
      (p) => p.name === "[[Scopes]]",
    );
    if (!scopes) throw new Error("no [[Scopes]] on getAndUpdateModeHandler");
    const scopeList = await post("Runtime.getProperties", {
      objectId: scopes.value.objectId,
      ownProperties: true,
    });
    for (const scope of scopeList.result) {
      if (!scope.value?.objectId) continue;
      const vars = await post("Runtime.getProperties", {
        objectId: scope.value.objectId,
        ownProperties: true,
      });
      for (const v of vars.result) {
        if (v.value?.type !== "object" || !v.value.objectId) continue;
        const props = await post("Runtime.getProperties", {
          objectId: v.value.objectId,
          ownProperties: true,
        });
        const mhm = props.result.find(
          (p) => p.name === "ModeHandlerMap" && p.value?.objectId,
        );
        if (!mhm) continue;
        await post("Runtime.callFunctionOn", {
          objectId: mhm.value.objectId,
          functionDeclaration: `function () { globalThis[${JSON.stringify(slot)}] = this; }`,
        });
        cached = globalThis[slot];
        return cached;
      }
    }
    throw new Error(
      "ModeHandlerMap not found in the closure of getAndUpdateModeHandler",
    );
  } finally {
    delete globalThis[slot];
    session.disconnect();
  }
}

/** The values of the closure variables of a function (not its global scope), through the inspector. */
async function closureValues(fn) {
  session = new inspector.Session();
  session.connect();
  const slot = `__s2_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const values = [];
  try {
    globalThis[slot] = fn;
    const { result } = await post("Runtime.evaluate", {
      expression: `globalThis[${JSON.stringify(slot)}]`,
    });
    const fnProps = await post("Runtime.getProperties", {
      objectId: result.objectId,
      ownProperties: true,
    });
    const scopes = (fnProps.internalProperties ?? []).find(
      (p) => p.name === "[[Scopes]]",
    );
    if (!scopes) return values;
    const scopeList = await post("Runtime.getProperties", {
      objectId: scopes.value.objectId,
      ownProperties: true,
    });
    for (const scope of scopeList.result) {
      if (
        !scope.value?.objectId ||
        /Global/.test(scope.value.description ?? "")
      )
        continue;
      const vars = await post("Runtime.getProperties", {
        objectId: scope.value.objectId,
        ownProperties: true,
      });
      for (const v of vars.result) {
        if (!v.value) continue;
        if (!v.value.objectId) {
          values.push({ name: v.name, value: v.value.value });
          continue;
        }
        await post("Runtime.callFunctionOn", {
          objectId: v.value.objectId,
          functionDeclaration: `function () { globalThis[${JSON.stringify(slot)}] = this; }`,
        });
        values.push({ name: v.name, value: globalThis[slot] });
      }
    }
    return values;
  } finally {
    delete globalThis[slot];
    session.disconnect();
  }
}

let cachedActionMap;
/**
 * VSCodeVim's action table (Map<Mode, action class[]>) from the closure of getRelevantAction, which
 * is reached from the closure of ModeHandler.prototype.handleKeyAsAnAction. Test-only.
 */
async function actionMap(modeHandler) {
  if (cachedActionMap) return cachedActionMap;
  const proto = Object.getPrototypeOf(modeHandler);
  const isActionMap = (v) =>
    v instanceof Map &&
    v.size > 3 &&
    [...v.values()].every(
      (a) => Array.isArray(a) && a.every((c) => typeof c === "function"),
    );
  for (const name of Object.getOwnPropertyNames(proto)) {
    const fn = Object.getOwnPropertyDescriptor(proto, name).value;
    if (typeof fn !== "function") continue;
    for (const { value } of await closureValues(fn)) {
      if (isActionMap(value)) return (cachedActionMap = value);
      if (
        value &&
        typeof value === "object" &&
        typeof value.getRelevantAction === "function"
      ) {
        for (const inner of await closureValues(value.getRelevantAction)) {
          if (isActionMap(inner.value)) return (cachedActionMap = inner.value);
        }
      }
    }
  }
  throw new Error("action table not found");
}

module.exports = { describeVimModule, modeHandlerMap, actionMap };
