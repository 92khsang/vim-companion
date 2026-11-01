import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { recordOwned } from "./lifecycle.mjs";

export function cleanPrivateWayland(root) {
  let output,
    exitCode = 0,
    signal;
  try {
    output = execFileSync(
      "/usr/bin/python3",
      [
        "-I",
        fileURLToPath(new URL("../wayland/cleanup.py", import.meta.url)),
        root,
      ],
      { encoding: "utf8", timeout: 15000, maxBuffer: 1048576 },
    );
  } catch (error) {
    output = error.stdout?.toString();
    exitCode = error.status ?? null;
    signal = error.signal;
  }
  try {
    return { ...JSON.parse(output), exitCode, signal };
  } catch {
    return {
      remaining: [{ unknown: true }],
      errors: ["private cleanup helper did not return valid JSON"],
      exitCode,
      signal,
    };
  }
}

export async function startWayland({ root, processes, result, until, check }) {
  const source = fileURLToPath(new URL("../wayland", import.meta.url));
  const privateRoot = join(root, "gnome"),
    script = join(source, "gnome-harness.sh");
  mkdirSync(privateRoot, { mode: 0o700 });
  cpSync(join(source, "settings.ini"), join(privateRoot, "settings.ini"));
  writeFileSync(
    process.env.S1_PROCESS_LEDGER + ".wayland.json",
    JSON.stringify({ writerPid: process.pid, root: privateRoot }),
    { mode: 0o600 },
  );
  const shell = (args) =>
    execFileSync("bash", [script, ...args], {
      encoding: "utf8",
      timeout: 40000,
      maxBuffer: 1048576,
    });
  result.nativeSession = {
    start: shell(["start", privateRoot]),
    root: privateRoot,
  };
  result.nativeSession.packages = execFileSync(
    "dpkg-query",
    [
      "-W",
      "-f",
      "${Package}\t${Version}\n",
      "gnome-shell",
      "libmutter-18-0",
      "ibus",
      "ibus-hangul",
      "libhangul1",
      "python3-gi",
    ],
    { encoding: "utf8" },
  );
  for (const [name, version] of [
    ["gnome-shell", "50.1"],
    ["libmutter-18-0", "50.1"],
    ["ibus", "1.5.34"],
    ["ibus-hangul", "1.5.5"],
    ["libhangul1", "0.2.0"],
  ])
    assert.ok(
      result.nativeSession.packages
        .split("\n")
        .some((line) => line.startsWith(name + "\t" + version)),
      "unexpected native package version: " + name,
    );
  const environment = Object.fromEntries(
    shell(["env", privateRoot])
      .trim()
      .split("\n")
      .map((line) => {
        const separator = line.indexOf("=");
        assert.ok(separator > 0);
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
  assert.equal(environment.XDG_RUNTIME_DIR, join(privateRoot, "run"));
  assert.equal(
    environment.DBUS_SESSION_BUS_ADDRESS,
    "unix:path=" + join(privateRoot, "run/bus"),
  );
  const dbus = (method, ...args) =>
    execFileSync(
      "gdbus",
      [
        "call",
        "--session",
        "--dest",
        "org.gnome.Shell",
        "--object-path",
        "/org/vimcompanion/S1Harness",
        "--method",
        "org.vimcompanion.S1Harness." + method,
        ...args.map(String),
      ],
      { env: environment, encoding: "utf8", timeout: 5000 },
    );
  const state = () => JSON.parse(shell(["state", privateRoot]));
  await until(
    () => {
      check();
      try {
        return state();
      } catch {
        return false;
      }
    },
    "private shell probe did not start",
    30000,
  );
  dbus("HideOverview");
  dbus("SelectSource", "ibus:hangul");
  const socket = join(root, "native-input.sock");
  const python = join(source, "inject.py");
  const injector = spawn("/usr/bin/python3", ["-I", python, "serve", socket], {
    env: environment,
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  processes.push(injector);
  recordOwned(process.env.S1_PROCESS_LEDGER, processes);
  let startupError;
  injector.on("error", (error) => {
    startupError = error;
  });
  const request = (message) => {
    const requestedAt = performance.now();
    const answer = JSON.parse(
      execFileSync("/usr/bin/python3", ["-I", python, "client", socket], {
        input: JSON.stringify(message),
        encoding: "utf8",
        timeout: 180000,
        maxBuffer: 16 * 1048576,
      }),
    );
    if (answer.error) throw new Error(answer.error);
    return {
      ...answer.result,
      transport: {
        requestedAt,
        receivedAt: performance.now(),
        timeOrigin: performance.timeOrigin,
      },
    };
  };
  result.nativeSession.injector = await until(() => {
    check();
    if (startupError) throw startupError;
    try {
      return request({ method: "hello" });
    } catch {
      return false;
    }
  }, "persistent Wayland injector did not start");
  result.nativeSession.warmup = request({
    method: "keys",
    keys: ["Shift_L"],
    delayMs: 10,
  });
  result.nativeSession.batches = [];
  return {
    environment,
    state,
    dbus,
    beginModeTrace() {
      dbus("BeginModeTrace");
    },
    endModeTrace() {
      dbus("EndModeTrace");
      return state().modeTrace;
    },
    inject(keys, delayMs) {
      check();
      const batch = request({ method: "keys", keys, delayMs });
      const index = result.nativeSession.batches.length;
      result.nativeSession.batches.push(batch);
      return { index, events: batch.events.length };
    },
    async focus(pid) {
      dbus("FocusPid", pid);
      return until(() => {
        const value = state();
        return (
          value.focusPid === pid &&
          value.focusClientType === 0 &&
          !value.overview &&
          value
        );
      }, "IDE did not receive native Wayland focus");
    },
    stop: () => cleanPrivateWayland(privateRoot),
  };
}
