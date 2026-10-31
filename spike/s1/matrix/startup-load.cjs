const { readFileSync } = require("node:fs");

exports.activate = (context) => {
  const phase = JSON.parse(readFileSync(process.env.S1_STARTUP_PHASE_FILE));
  const windows = [];
  let timer;
  const block = () => {
    const epoch = Date.now(),
      start = performance.now();
    while (performance.now() - start < 50) {}
    windows.push({ start, end: performance.now(), epoch });
  };
  const initial = setTimeout(() => {
    timer = setInterval(block, 100);
    block();
  }, phase.delayMs);
  context.subscriptions.push({
    dispose() {
      clearTimeout(initial);
      clearInterval(timer);
    },
  });
  return {
    pid: process.pid,
    phaseDelayMs: phase.delayMs,
    windows: () => [...windows],
  };
};
