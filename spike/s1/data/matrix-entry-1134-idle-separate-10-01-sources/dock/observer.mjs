import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// Read-only DOM sampling triggers a screenshot of the actual X11 framebuffer.
// It neither requests a Chromium frame nor activates an editor or DevTools UI.
const inspect = () => {
  const dock = document.querySelector('[id="workbench.parts.auxiliarybar"]');
  const visible = (node) =>
    Boolean(
      node &&
      node.getBoundingClientRect().width > 0 &&
      node.getBoundingClientRect().height > 0 &&
      node.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
    );
  const rect = dock?.getBoundingClientRect();
  return {
    visible: visible(dock),
    title: dock?.textContent ?? null,
    rect: rect
      ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      : null,
    documentFocused: document.hasFocus(),
    activeElement: document.activeElement
      ? {
          tag: document.activeElement.tagName,
          className: String(document.activeElement.className),
        }
      : null,
    viewport: {
      width: innerWidth,
      height: innerHeight,
      scale: devicePixelRatio,
    },
  };
};

export async function connectDockObserver({
  port,
  directory,
  environment,
  until,
}) {
  const endpoint = "http://127.0.0.1:" + port;
  const get = async (path) => {
    const response = await fetch(endpoint + path, {
      signal: AbortSignal.timeout(1000),
    });
    assert.ok(response.ok);
    return response.json();
  };
  const target = await until(async () => {
    try {
      const targets = (await get("/json/list")).filter(
        (entry) => entry.type === "page" && entry.url.includes("workbench"),
      );
      assert.equal(targets.length, 1);
      return targets[0];
    } catch {
      return false;
    }
  }, "one workbench debugging target was not found");
  const version = await get("/json/version");
  const protocol = await get("/json/protocol");
  const runtime = protocol.domains.find((entry) => entry.domain === "Runtime");
  assert.ok(runtime?.commands.some((command) => command.name === "evaluate"));
  const metadata = {
    browser: version.Browser,
    protocolVersion: version["Protocol-Version"],
    protocolSha256: createHash("sha256")
      .update(JSON.stringify(protocol))
      .digest("hex"),
    screenshot: "ImageMagick import of X11 root framebuffer",
    imageMagick: execFileSync("import", ["-version"], {
      encoding: "utf8",
    }).split("\n")[0],
    samplingIntervalMs: 25,
    textRecognition: execFileSync("tesseract", ["--version"], {
      encoding: "utf8",
    }).split("\n")[0],
    rendererTracing: false,
    runnerTimeOrigin: performance.timeOrigin,
    imageReview: "pending",
  };
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("CDP connect timeout")),
        2000,
      );
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          reject(new Error("CDP connect failed"));
        },
        { once: true },
      );
    });
  } catch (error) {
    socket.close();
    throw error;
  }
  let sequence = 0;
  const pending = new Map();
  let connectionError;
  const failPending = (message) => {
    connectionError = new Error(message);
    for (const handler of pending.values()) {
      clearTimeout(handler.timeout);
      handler.reject(connectionError);
    }
    pending.clear();
  };
  socket.addEventListener("close", () =>
    failPending("renderer observation connection closed"),
  );
  socket.addEventListener("error", () =>
    failPending("renderer observation connection failed"),
  );
  socket.addEventListener("message", (event) => {
    const value = JSON.parse(event.data);
    const handler = pending.get(value.id);
    if (!handler) return;
    pending.delete(value.id);
    clearTimeout(handler.timeout);
    if (value.error) handler.reject(new Error(JSON.stringify(value.error)));
    else handler.resolve(value.result);
  });
  function evaluate(timeoutMs) {
    if (connectionError) return Promise.reject(connectionError);
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error("renderer observation timeout"));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timeout });
      socket.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: {
            expression: "(" + inspect.toString() + ")()",
            returnByValue: true,
            timeout: timeoutMs,
          },
        }),
      );
    });
  }

  return {
    metadata,
    async observe(
      record,
      expected,
      label,
      start = performance.now(),
      expectedText = [],
      forbiddenText = [],
    ) {
      record.expectedVisible = expected;
      record.expectedText = expectedText;
      record.forbiddenText = forbiddenText;
      record.started = start;
      record.budgetMs = 1000;
      record.samples = [];
      record.captures = [];
      const deadline = start + record.budgetMs;
      while (performance.now() < deadline) {
        const sample = { started: performance.now() };
        record.samples.push(sample);
        const value = await evaluate(
          Math.max(1, Math.floor(deadline - sample.started)),
        );
        sample.finished = performance.now();
        assert.ok(
          !value.exceptionDetails,
          JSON.stringify(value.exceptionDetails),
        );
        sample.dom = value.result.value;

        if (sample.dom.visible === expected) {
          const file = join(
            directory,
            label +
              "-" +
              String(record.captures.length + 1).padStart(2, "0") +
              ".png",
          );
          assert.ok(!existsSync(file), "screenshot evidence already exists");
          const capture = {
            started: performance.now(),
            file: basename(directory) + "/" + basename(file),
          };
          record.captures.push(capture);
          const remaining = Math.floor(deadline - capture.started);
          assert.ok(
            remaining > 0,
            "visual observation budget expired before capture",
          );
          execFileSync("import", ["-silent", "-window", "root", file], {
            env: environment,
            timeout: remaining,
            stdio: ["ignore", "ignore", "pipe"],
          });
          capture.finished = performance.now();
          capture.sha256 = createHash("sha256")
            .update(readFileSync(file))
            .digest("hex");
          if (expectedText.length) {
            capture.recognitionStarted = performance.now();
            const budget = Math.floor(deadline - capture.recognitionStarted);
            assert.ok(budget > 0, "image text observation budget expired");
            capture.text = execFileSync(
              "tesseract",
              [file, "stdout", "--psm", "11"],
              {
                encoding: "utf8",
                timeout: budget,
                stdio: ["ignore", "pipe", "pipe"],
              },
            );
            capture.recognitionFinished = performance.now();
            const normalized = capture.text.replace(/\s+/g, " ").toLowerCase();
            capture.contentMatched =
              expectedText.every((value) =>
                normalized.includes(value.toLowerCase()),
              ) &&
              forbiddenText.every(
                (value) => !normalized.includes(value.toLowerCase()),
              );
            if (!capture.contentMatched) continue;
          }
          record.capture = capture;
          assert.ok(
            record.capture.finished <= deadline,
            "screenshot exceeded observation budget",
          );
          record.completed = performance.now();
          assert.ok(
            record.completed <= deadline,
            "image content check exceeded observation budget",
          );
          return;
        }
        await sleep(Math.min(25, Math.max(0, deadline - performance.now())));
      }
      throw new Error("rendered item observation timed out");
    },
    close() {
      for (const handler of pending.values()) {
        clearTimeout(handler.timeout);
        handler.reject(new Error("observer closed"));
      }
      pending.clear();
      socket.close();
    },
  };
}
