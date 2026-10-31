// Test-only read access adapted from the S2 inspector instrument. No engine method is invoked.
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
  const slot = `__s1_${process.pid}_${Date.now()}`;
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
  const slot = `__s1_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

let cachedRegister;
/** VSCodeVim's Register class, from the closure of the module export deactivate. Test-only. */
async function registerClass() {
  if (cachedRegister) return cachedRegister;
  const path = vimModulePath();
  if (!path) throw new Error("VSCodeVim module not in require.cache");
  for (const { value } of await closureValues(
    require.cache[path].exports.deactivate,
  )) {
    if (
      value &&
      typeof value === "object" &&
      typeof value.Register === "function"
    ) {
      return (cachedRegister = value.Register);
    }
  }
  throw new Error("Register not found in the closure of deactivate");
}

let cachedQueue;
async function keyQueue() {
  if (cachedQueue) return cachedQueue;
  const path = vimModulePath();
  for (const { value } of await closureValues(
    require.cache[path].exports.getAndUpdateModeHandler,
  )) {
    const candidate = value?.taskQueue?.taskQueue;
    if (
      candidate &&
      Array.isArray(candidate.jobs) &&
      typeof candidate.pending === "number" &&
      typeof candidate.running === "boolean"
    ) {
      return (cachedQueue = candidate);
    }
  }
  throw new Error("key queue not found; refuse to infer engine completion");
}
module.exports = { modeHandlerMap, registerClass, keyQueue };
