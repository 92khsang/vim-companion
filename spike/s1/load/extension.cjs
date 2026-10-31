exports.activate = (context) => {
  const windows = [];
  const timer = setInterval(() => {
    const epoch = Date.now();
    const start = performance.now();
    while (performance.now() - start < 50) {
      // Required blocking-host condition: occupy this extension host for 50 ms.
    }
    windows.push({ start, end: performance.now(), epoch });
  }, 100);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  return { pid: process.pid, windows: () => [...windows] };
};
