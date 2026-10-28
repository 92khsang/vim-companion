const sameKeys = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const LINE_UNDO_PREFIXES = [
  [],
  ["2"],
  ["3"],
  ["3", "0"],
  ['"', "a"],
  ['"', "a", "3"],
  ['"', "+"],
  ['"', "_"],
];

/** Standalone U reads line history; gUU is a different operator. */
export function needsLineUndoPreparation(card, row) {
  if (row.key !== "U" || row.sample !== undefined) return false;
  // The no-pending fixture reaches Normal by cancelling d, rather than by no keys.
  if (card.id === "normal []" && sameKeys(card.keys, ["d", "<Esc>"]))
    return true;
  return LINE_UNDO_PREFIXES.some(
    (prefix) =>
      card.id === `normal ${JSON.stringify(prefix)}` &&
      sameKeys(card.keys, prefix),
  );
}

/** These uncounted half-page rows have no setup that sets runtime scroll. */
export function needsScrollPreparation(card, row) {
  if (
    !["<C-d>", "<C-u>"].includes(row.key) ||
    row.sample !== undefined ||
    !sameKeys(row.setup, ["z", "b"])
  )
    return false;
  if (card.id === "visual-block []" && sameKeys(card.keys, ["<C-v>"]))
    return true;
  return ["+", "_"].some((register) => {
    const prefix = ['"', register];
    return (
      card.id === `normal ${JSON.stringify(prefix)}` &&
      sameKeys(card.keys, prefix)
    );
  });
}
