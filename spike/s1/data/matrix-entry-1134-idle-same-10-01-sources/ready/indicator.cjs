exports.createReadyIndicator = (vscode) => {
  const item = vscode.window.createStatusBarItem(
    "s1-ready",
    vscode.StatusBarAlignment.Left,
    100,
  );
  item.name = "S1 leader readiness";
  item.text = "Leader ready";
  let sequence = 0;
  let session = null;
  let requested = false;
  let disposed = false;
  const events = [];
  const record = (type, extra = {}) =>
    events.push({ t: performance.now(), type, ...extra });

  function hide(reason) {
    const previous = session;
    session = null;
    requested = false;
    item.hide();
    record("hide-requested", { session: previous, reason });
  }

  return {
    begin() {
      if (disposed) return null;
      session = ++sequence;
      record("session-start", { session });
      return session;
    },
    acknowledge(token) {
      const accepted = !disposed && token !== null && token === session;
      record("context-acknowledged", { session: token, accepted });
      if (!accepted) return;
      item.show();
      requested = true;
      // This is a host request, not evidence of a rendered frame.
      record("ready-requested", { session: token });
    },
    reject(token, error) {
      record("context-error", { session: token, error: String(error) });
      if (!disposed && token !== null && token === session)
        hide("context-error");
    },
    end(reason) {
      if (!disposed) hide(reason);
    },
    dispose() {
      if (disposed) return;
      hide("dispose");
      disposed = true;
      item.dispose();
    },
    snapshot: () => ({
      session,
      requested,
      disposed,
      events: events.map((event) => ({ ...event })),
    }),
    clearEvents() {
      events.length = 0;
    },
  };
};
