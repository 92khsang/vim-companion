// Capture only the four U1 direction pages, using the same assets as the webview.
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  openSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const gallery = fileURLToPath(
  new URL("../../spikes/u1/gallery/", import.meta.url),
);
const theme = JSON.parse(
  readFileSync(join(gallery, "vscode-theme.json"), "utf8"),
);
const work = mkdtempSync(join(tmpdir(), "u1-chromium-"));
const chromePath = process.env.U1_CHROME ?? "/usr/bin/google-chrome";
const server = createServer((req, res) => {
  const path = basename(new URL(req.url, "http://localhost").pathname);
  try {
    const type = path.endsWith(".css")
      ? "text/css"
      : path.endsWith(".js")
        ? "text/javascript"
        : "text/html";
    const body = readFileSync(join(gallery, path));
    res.writeHead(200, { "Content-Type": type });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--no-first-run",
    "--disable-background-networking",
    "--remote-debugging-port=0",
    `--user-data-dir=${work}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", openSync(join(work, "chrome.log"), "w")] },
);
let socket;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try {
      port = readFileSync(join(work, "DevToolsActivePort"), "utf8").split(
        "\n",
      )[0];
      break;
    } catch {
      await delay(100);
    }
  }
  if (!port) throw new Error("Chromium did not start");
  const target = await (
    await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
      method: "PUT",
    })
  ).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const reply = JSON.parse(data);
    const request = pending.get(reply.id);
    if (request) {
      pending.delete(reply.id);
      clearTimeout(request.timer);
      reply.error
        ? request.reject(new Error(JSON.stringify(reply.error)))
        : request.resolve(reply.result);
    }
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Timed out: ${method}`));
      }, 10000);
      pending.set(requestId, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Page.addScriptToEvaluateOnNewDocument", {
    source:
      "window.captureViolations=[]; document.addEventListener('securitypolicyviolation', e => captureViolations.push({directive:e.violatedDirective,blocked:e.blockedURI}));",
  });
  const captures = [];
  const width = theme.viewport.width;
  for (const state of ["idle", "prefix", "badges", "grammar"]) {
    const height = state === "badges" ? 820 : 580;
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await call("Page.navigate", {
      url: `http://127.0.0.1:${server.address().port}/vscode-${state}.html`,
    });
    let ready = false;
    for (let i = 0; i < 60; i++) {
      const result = await call("Runtime.evaluate", {
        expression: `window.u1Ready === true && location.pathname === '/vscode-${state}.html'`,
        returnByValue: true,
      });
      if (result.result.value) {
        ready = true;
        break;
      }
      await delay(50);
    }
    if (!ready) throw new Error(`Renderer not ready: ${state}`);
    await call("Runtime.evaluate", {
      expression:
        "document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))",
      awaitPromise: true,
    });
    const result = await call("Runtime.evaluate", {
      expression:
        "({violations:window.captureViolations, scrollWidth:document.documentElement.scrollWidth, scrollHeight:document.documentElement.scrollHeight, rowCount:document.querySelectorAll('.row').length})",
      returnByValue: true,
    });
    const checks = result.result.value;
    if (
      checks.violations.length ||
      checks.scrollWidth > width ||
      checks.scrollHeight > height
    )
      throw new Error(`${state}: ${JSON.stringify(checks)}`);
    const png = await call("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    const file = `vscode-${state}.png`;
    writeFileSync(join(gallery, file), Buffer.from(png.data, "base64"));
    captures.push({ file, width, height, deviceScaleFactor: 1, ...checks });
  }
  writeFileSync(
    join(gallery, "vscode-capture.json"),
    JSON.stringify(
      {
        chromium: execFileSync(chromePath, ["--version"], {
          encoding: "utf8",
        }).trim(),
        theme: theme.theme,
        vscode: theme.vscode,
        xvfbScreen: { width: 1440, height: 1000 },
        captures,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Captured ${captures.length} VS Code cells; zero CSP violations and no viewport overflow.`,
  );
} finally {
  socket?.close();
  chrome.kill("SIGTERM");
  server.close();
  await new Promise((resolve) => {
    if (chrome.exitCode !== null) resolve();
    else chrome.once("exit", resolve);
  });
  rmSync(work, { recursive: true, force: true });
}
