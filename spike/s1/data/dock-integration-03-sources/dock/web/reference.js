/* Reference content from the approved U1 gallery; no live Vim observer. */
const S1_REFERENCE = [
  {
    id: "movement",
    title: "Movement",
    note: "Move in Normal mode. No Space prefix.",
    rows: [
      ["w / b", "Next / previous word"],
      ["0 / $", "Start / end of line"],
      ["f{char}", "Find a character on this line"],
      ["%", "Jump to the matching bracket"],
    ],
  },
  {
    id: "editing",
    title: "Editing",
    note: "Combine an operator with a motion.",
    rows: [
      ["d{motion}", "Delete a range"],
      ["c{motion}", "Change a range"],
      ["y{motion}", "Yank a range"],
      ["p", "Put after the cursor"],
    ],
  },
  {
    id: "objects",
    title: "Text objects",
    note: "Use after an operator or in Visual mode.",
    rows: [
      ["iw", "Inner word"],
      ["aw", "A word with whitespace"],
      ['i" / a"', "Inside / including quotes"],
      ["i( / a(", "Inside / including parentheses"],
    ],
  },
  {
    id: "counts",
    title: "Counts / registers",
    note: "Keep the destination and count explicit.",
    rows: [
      ["3w", "Move forward three words"],
      ["d2w", "Delete over two word motions"],
      ['"ayiw', "Yank an inner word into a"],
      ['"ap', "Put from register a"],
    ],
  },
  {
    id: "repeat",
    title: "Repeat / macros",
    note: "Macro playback has reference help only.",
    rows: [
      [".", "Repeat the last change"],
      ["qa", "Start recording into register a"],
      ["q", "Stop recording a macro"],
      ["@a", "Play the macro in register a"],
    ],
  },
];
