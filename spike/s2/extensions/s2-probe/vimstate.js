// Maps the fields of a VSCodeVim 1.32.4 ModeHandler to the grammar fixture state. It reads plain
// fields only: no getter and no method of VSCodeVim runs. Field names come from the VSCodeVim
// v1.32.4 sources (src/state/recordedState.ts, src/state/vimState.ts, src/mode/mode.ts).
const MODES = {
  0: "normal",
  1: "insert",
  2: "visual",
  3: "visual-block",
  4: "visual-line",
  7: "replace",
};

function fieldsOf(modeHandler) {
  const vs = modeHandler.vimState;
  const rs = vs.recordedState;
  return {
    mode: vs.modeData.mode,
    actionsRun: rs.actionsRun.map((a) => ({
      name: a.name,
      actionType: a.actionType,
      isCompleteAction: a.isCompleteAction,
      keysPressed: [...(a.keysPressed ?? [])],
    })),
    actionsRunPressedKeys: [...rs.actionsRunPressedKeys],
    actionKeys: [...rs.actionKeys],
    bufferedKeys: [...rs.bufferedKeys],
    count: rs.count,
    operatorCount: rs.operatorCount,
    registerName: rs.registerName,
    hasRunOperator: rs.hasRunOperator,
  };
}

function toState(f) {
  const mode = MODES[f.mode] ?? `other-${f.mode}`;
  const insertLike = mode === "insert" || mode === "replace";
  // Pending keys: the keys of the count, register and operator actions at the end of actionsRun
  // (the prefixes of the command being typed; not the v that entered Visual mode), then the keys
  // of the action being typed, then the keys buffered for a possible remap.
  const isPrefix = (a) =>
    a.actionType === "number" ||
    a.actionType === "operator" ||
    a.name === "cmd_register";
  let start = f.actionsRun.length;
  while (start > 0 && isPrefix(f.actionsRun[start - 1])) start -= 1;
  const prefixKeys = f.actionsRun.slice(start).flatMap((a) => a.keysPressed);
  const pending = insertLike
    ? [...f.actionKeys, ...f.bufferedKeys]
    : [...prefixKeys, ...f.actionKeys, ...f.bufferedKeys];
  const op = f.hasRunOperator
    ? undefined
    : f.actionsRun.filter((a) => a.actionType === "operator").at(-1);
  const reg = f.actionsRun.some((a) => a.name === "cmd_register");
  return {
    mode,
    pending: pending.filter((k) => k !== "<TimeoutFinished>"),
    operator: op ? op.keysPressed.join("") : null,
    count: f.count > 0 ? f.count : null,
    register: reg ? f.registerName : null,
  };
}

/** The ModeHandler of the document with this URI string, from a ModeHandlerMap object. */
function handlerFor(modeHandlerMap, uriString) {
  for (const [uri, handler] of modeHandlerMap.modeHandlerMap) {
    if (String(uri) === uriString) return handler;
  }
  return undefined;
}

module.exports = { fieldsOf, toState, handlerFor };
