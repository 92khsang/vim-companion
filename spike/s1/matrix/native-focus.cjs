const { execFileSync } = require("node:child_process");
const samples = [];
let last;
let previousPoll;
const observe = () => {
  const requestedAt = performance.now();
  try {
    const id = execFileSync("xdotool", ["getwindowfocus"], {
      encoding: "utf8",
      timeout: 1000,
    }).trim();
    const observedAt = performance.now();
    if (id !== last) {
      last = id;
      let name;
      let properties;
      try {
        name = execFileSync("xdotool", ["getwindowname", id], {
          encoding: "utf8",
          timeout: 1000,
        }).trim();
      } catch {}
      try {
        properties = execFileSync(
          "xprop",
          ["-id", id, "WM_TRANSIENT_FOR", "WM_CLASS", "_NET_WM_PID"],
          { encoding: "utf8", timeout: 1000 },
        );
      } catch {}
      samples.push({
        requestedAt,
        observedAt,
        id,
        name,
        properties,
        previousPoll,
      });
    }
    previousPoll = { requestedAt, observedAt, id };
  } catch (error) {
    samples.push({ requestedAt, error: String(error) });
  }
};
observe();
const timer = setInterval(observe, 25);
process.send({
  ready: true,
  timeOrigin: performance.timeOrigin,
  pid: process.pid,
});
process.on("message", (message) => {
  if (message?.clockRequest) {
    process.send({
      clockResponse: message.clockRequest,
      time: performance.now(),
      timeOrigin: performance.timeOrigin,
    });
    return;
  }
  if (message === "stop") {
    clearInterval(timer);
    observe();
    process.send(
      { samples, lastPoll: previousPoll, timeOrigin: performance.timeOrigin },
      () => process.exit(0),
    );
  }
});
process.on("disconnect", () => process.exit(0));
