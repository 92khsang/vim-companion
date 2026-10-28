// Capture the real VS Code window under Xvfb, with only synthetic sample files.
import { spawn, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
  openSync,
  rmSync,
  existsSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";

if (!process.env.DISPLAY) throw new Error("Run this capture with xvfb-run");
const root = fileURLToPath(new URL("../../", import.meta.url));
const gallery = join(root, "spikes/u1/gallery");
const work = mkdtempSync(join(tmpdir(), "u1-context-"));
const control = join(work, "control");
for (const dir of ["user/User", "extensions", "project", "control"])
  mkdirSync(join(work, dir), { recursive: true });
for (const file of ["Order.java", "OrderService.java"])
  cpSync(join(root, "spikes/u1/sample", file), join(work, "project", file));
writeFileSync(
  join(work, "user/User/settings.json"),
  JSON.stringify({
    "workbench.colorTheme": "Dark 2026",
    "workbench.startupEditor": "none",
    "workbench.secondarySideBar.defaultVisibility": "visible",
    "window.restoreWindows": "none",
    "window.title": "Vim Keys · U1 layout review",
    "security.workspace.trust.enabled": false,
    "telemetry.telemetryLevel": "off",
    "update.mode": "none",
    "extensions.autoUpdate": false,
    "editor.minimap.enabled": false,
    "editor.fontSize": 14,
    "editor.renderLineHighlight": "all",
    "breadcrumbs.enabled": false,
  }),
);
const env = { ...process.env, U1_CONTEXT_DIR: control };
delete env.WAYLAND_DISPLAY;
delete env.U1_CAPTURE_DIR;
const app = spawn(
  "/usr/share/code/code",
  [
    "--no-sandbox",
    "--disable-gpu",
    "--skip-welcome",
    "--skip-release-notes",
    "--new-window",
    "--ozone-platform=x11",
    "--force-device-scale-factor=1",
    "--user-data-dir",
    join(work, "user"),
    "--extensions-dir",
    join(work, "extensions"),
    `--extensionDevelopmentPath=${join(root, "spikes/u1/vscode")}`,
    join(work, "project"),
  ],
  { env, stdio: ["ignore", openSync(join(work, "code.log"), "w"), "ignore"] },
);
const xdo = (...args) =>
  execFileSync("xdotool", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
try {
  let window;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      window = xdo("search", "--onlyvisible", "--class", "Code").split("\n")[0];
      if (window) break;
    } catch {}
    await delay(250);
  }
  assert.ok(window, "VS Code window did not appear");
  const captures = [];
  const cases = [
    { id: "single", width: 1440, height: 1000, state: "prefix", split: false },
    { id: "split", width: 1440, height: 1000, state: "badges", split: true },
    {
      id: "small-split",
      width: 1100,
      height: 800,
      state: "badges",
      split: true,
    },
    {
      id: "small-hidden",
      width: 1100,
      height: 800,
      state: "prefix",
      split: true,
      hidden: true,
    },
  ];
  for (const item of cases) {
    xdo("windowmove", window, "0", "0");
    xdo(
      "windowsize",
      "--sync",
      window,
      String(item.width),
      String(item.height),
    );
    writeFileSync(join(control, "request.next"), JSON.stringify(item));
    renameSync(join(control, "request.next"), join(control, "request.json"));
    let ready;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (existsSync(join(control, "error.txt")))
        throw new Error(readFileSync(join(control, "error.txt"), "utf8"));
      try {
        const candidate = JSON.parse(
          readFileSync(join(control, "ready.json"), "utf8"),
        );
        if (candidate.id === item.id && candidate.state === item.state) {
          ready = candidate;
          break;
        }
      } catch {}
      await delay(100);
    }
    assert.ok(ready, `No rendered state: ${item.id}`);
    assert.equal(ready.editorGroups.length, item.split ? 2 : 1);
    assert.equal(ready.viewVisible, !item.hidden);
    await delay(350);
    const geometry = Object.fromEntries(
      xdo("getwindowgeometry", "--shell", window)
        .split("\n")
        .map((line) => line.split("=")),
    );
    const file = `vscode-context-${item.id}.png`;
    execFileSync("import", ["-window", window, join(gallery, file)], {
      stdio: "ignore",
    });
    captures.push({
      file,
      width: Number(geometry.WIDTH),
      height: Number(geometry.HEIGHT),
      ...ready,
    });
  }
  writeFileSync(
    join(gallery, "vscode-context.json"),
    JSON.stringify(
      {
        theme: "Dark 2026",
        captureMethod: "X11 capture of the sandbox VS Code window",
        captures,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Captured four VS Code layouts, including an update while the view is hidden.",
  );
} finally {
  app.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => {
      if (app.exitCode !== null) resolve();
      else app.once("exit", resolve);
    }),
    delay(5000).then(() => app.kill("SIGKILL")),
  ]);
  rmSync(work, { recursive: true, force: true });
}
