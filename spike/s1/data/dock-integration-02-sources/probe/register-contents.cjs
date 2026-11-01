const REGISTER_MODES = { 0: "character", 1: "line", 2: "block" };

/**
 * Read register payloads without losing Ex commands. The colon register stores
 * its command in RecordedState.commandList; its actionsRunPressedKeys is empty.
 * Other recorded states retain their key representation. Numbered-register shifts
 * may store a numeric-keyed object instead of an array, so both shapes are read.
 */
function registerContents(name, contents) {
  const list = Array.isArray(contents)
    ? contents
    : contents &&
        typeof contents === "object" &&
        Object.keys(contents).every((k) => /^\d+$/.test(k))
      ? Object.keys(contents)
          .map(Number)
          .sort((a, b) => a - b)
          .map((i) => contents[i])
      : [contents];
  return list.map((c) => {
    let text = c?.text;
    if (typeof text !== "string") {
      if (name === ":") {
        if (
          !Array.isArray(text?.commandList) ||
          !text.commandList.every((part) => typeof part === "string")
        )
          throw new Error("the Ex register has no readable commandList");
        text = text.commandList.join("");
      } else {
        text = Array.isArray(text?.actionsRunPressedKeys)
          ? { keys: text.actionsRunPressedKeys.join("") }
          : `<unreadable ${typeof text}>`;
      }
    }
    return {
      text,
      mode: REGISTER_MODES[c?.registerMode] ?? `other-${c?.registerMode}`,
    };
  });
}

module.exports = { registerContents };
