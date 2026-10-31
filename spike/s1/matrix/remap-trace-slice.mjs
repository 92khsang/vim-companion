// Compare original log prefixes before path redaction. A single measured key
// batch can cross the logger's rotation boundary; include both pieces then.
export function traceSlice(before, after) {
  const active = before.find((item) => /\/Vim\.log$/.test(item.file));
  const current = after.find((item) => /\/Vim\.log$/.test(item.file));
  if (!active || !current)
    return [{ complete: false, reason: "active Vim log missing", text: null }];
  if (current.text.startsWith(active.text))
    return [
      {
        file: current.file,
        complete: true,
        text: current.text.slice(active.text.length),
      },
    ];
  const rotated = after.find(
    (item) => item.file === active.file.replace(/Vim\.log$/, "Vim.1.log"),
  );
  if (rotated?.text.startsWith(active.text))
    return [
      {
        file: current.file,
        rotatedFrom: rotated.file,
        complete: true,
        text: rotated.text.slice(active.text.length) + current.text,
      },
    ];
  return [
    {
      file: current.file,
      complete: false,
      reason: "Vim log prefix not found after rotation",
      text: null,
    },
  ];
}
