// Measures the editor geometry of the check (1) harness: how many lines and columns each of the two
// editor groups shows, read over CDP from the rendered editors (height of the scrollable area over
// the line height; content width over the width of one character of the fixture's first line).
// The Vim oracle's window (vim-check/expect.mjs, S2_VIM_SIZE) is set from this, so that keys that
// depend on the window (H, M, L, CTRL-D, CTRL-F, gm, ...) see the window VSCodeVim sees. This reads
// the harness, not VSCodeVim's behaviour.
// Usage: node spike/s2/check1/geometry.mjs <version> <display> <cdpPort> <out.json>
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  START,
  cdpEvaluate,
  focusWindow,
  openSession,
  startXvfb,
  stopCode,
} from "../harness/lib.mjs";

const [version, display, cdpPort, outFile] = process.argv.slice(2);
const GEOMETRY_JS = `[...document.querySelectorAll('.editor-group-container .monaco-editor')].map((ed) => {
  const scroll = ed.querySelector('.monaco-scrollable-element.editor-scrollable');
  const line = ed.querySelector('.view-line');
  const lines = [...ed.querySelectorAll('.view-line')].map((l) => l.textContent);
  const first = [...ed.querySelectorAll('.view-line')].find((l) => l.textContent.startsWith('alpha'));
  const span = first?.querySelector('span span') ?? first?.querySelector('span');
  const lineHeight = line ? line.getBoundingClientRect().height : null;
  const height = scroll ? scroll.getBoundingClientRect().height : null;
  const width = scroll ? scroll.getBoundingClientRect().width : null;
  const charWidth = span && span.textContent.length ? span.getBoundingClientRect().width / span.textContent.length : null;
  const vertical = ed.querySelector('.scrollbar.vertical');
  const vbar = vertical ? vertical.getBoundingClientRect().width : 0;
  return { lineHeight, height, width, charWidth, vbar, renderedLines: lines.length,
           rows: lineHeight ? Math.floor(height / lineHeight) : null,
           cols: charWidth ? Math.floor((width - vbar) / charWidth) : null };
})`;
let xvfb, code;
try {
  xvfb = await startXvfb(display);
  code = await openSession({
    version,
    display,
    name: `${process.env.S2_NAME_PREFIX ?? ""}geometry-${version}-${display.slice(1)}`,
    cdpPort: Number(cdpPort),
    settings: {},
  });
  await code.probe.call("open", {
    files: [
      { path: join(code.inst, "ws/a.txt"), viewColumn: 1 },
      { path: join(code.inst, "ws/b.txt"), viewColumn: 2 },
    ],
  });
  focusWindow(code);
  await code.probe.call("exec", {
    command: "workbench.action.focusFirstEditorGroup",
  });
  await code.probe.call("reset", START);
  await sleep(1000);
  const editors = await cdpEvaluate(Number(cdpPort), GEOMETRY_JS);
  const out = {
    version,
    measured: new Date().toISOString(),
    editors,
    hello: code.hello,
  };
  writeFileSync(outFile, JSON.stringify(out, null, 1) + "\n");
  console.log(JSON.stringify(editors));
} finally {
  if (code) await stopCode(code);
  if (xvfb)
    try {
      process.kill(xvfb, "SIGTERM");
    } catch {}
}
