// UI state never participates in input routing or waits for a renderer.
exports.createDockModel = () => {
  let sequence = 0;
  let state = { revision: 0, session: null, phase: "idle", prefix: [] };
  let disposed = false;
  let delivery = null;
  let instance = null;
  let applied = null;
  const events = [];
  const copy = () => ({ ...state, prefix: [...state.prefix] });
  const record = (type, details = {}) =>
    events.push({ t: performance.now(), type, ...details });
  function send() {
    if (!delivery || disposed) return;
    const target = instance;
    const snapshot = copy();
    record("posted", { instance: target, state: snapshot });
    try {
      Promise.resolve(
        delivery({ type: "s1-state", instance: target, state: snapshot }),
      )
        .then((posted) =>
          record("post-result", {
            instance: target,
            revision: snapshot.revision,
            posted,
          }),
        )
        .catch((error) =>
          record("post-error", { instance: target, error: String(error) }),
        );
    } catch (error) {
      record("post-error", { instance: target, error: String(error) });
    }
  }
  function change(next, reason) {
    state = { ...next, revision: state.revision + 1 };
    record("state", { reason, state: copy() });
    send();
  }
  return {
    begin() {
      if (disposed) return null;
      const session = ++sequence;
      change({ session, phase: "pending", prefix: [] }, "start");
      return session;
    },
    prefix(prefix) {
      if (disposed || state.session === null) return;
      change({ ...state, prefix: [...prefix] }, "prefix");
    },
    acknowledge(token) {
      const accepted = !disposed && token !== null && token === state.session;
      record("acknowledged", { session: token, accepted });
      if (accepted) change({ ...state, phase: "active" }, "context-on");
    },
    reject(token, error) {
      record("context-error", { session: token, error: String(error) });
      if (!disposed && token !== null && token === state.session)
        change({ session: null, phase: "idle", prefix: [] }, "context-error");
    },
    end(reason) {
      if (!disposed)
        change({ session: null, phase: "idle", prefix: [] }, reason);
    },
    attach(id, post) {
      if (disposed) return;
      instance = id;
      delivery = post;
      applied = null;
      send();
    },
    detach(id) {
      if (id !== instance) return;
      delivery = null;
      instance = null;
      applied = null;
    },
    receive(message) {
      if (
        disposed ||
        message.instance !== instance ||
        message.type !== "s1-applied" ||
        message.revision !== state.revision
      )
        return false;
      applied = { ...message };
      record("applied", { message: applied });
      return true;
    },
    snapshot: () => ({
      state: copy(),
      instance,
      applied,
      disposed,
      events: events.map((event) => structuredClone(event)),
    }),
    clearEvents() {
      events.length = 0;
    },
    dispose() {
      if (disposed) return;
      change({ session: null, phase: "idle", prefix: [] }, "dispose");
      disposed = true;
      delivery = null;
      instance = null;
      applied = null;
    },
  };
};
