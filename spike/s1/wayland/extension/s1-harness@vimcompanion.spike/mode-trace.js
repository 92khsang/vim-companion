export const modeTraceMethod = "gnome-input-mode-events-v1";

export class ModeTrace {
  constructor(readState, clock, limit = 256) {
    this.readState = readState;
    this.clock = clock;
    this.limit = limit;
    this.active = false;
    this.trace = null;
  }

  begin() {
    this.trace = {
      method: modeTraceMethod,
      clock:
        "GLib monotonic milliseconds; signal receipt, not key processing time",
      events: [],
      overflow: 0,
      startedMs: this.clock(),
    };
    this.active = true;
    this.capture("begin");
  }

  capture(event = "current-source-changed") {
    if (!this.active) return;
    if (this.trace.events.length >= this.limit) {
      this.trace.overflow++;
      return;
    }
    const state = this.readState();
    this.trace.events.push({
      sequence: this.trace.events.length,
      event,
      timeMs: this.clock(),
      source: state.source,
      inputMode: state.inputMode ? { ...state.inputMode } : null,
      focusPid: state.focusPid,
      focusClientType: state.focusClientType,
    });
  }

  end() {
    if (!this.active) throw new Error("mode trace is not active");
    this.capture("end");
    this.trace.finishedMs = this.clock();
    this.active = false;
  }

  snapshot() {
    return this.trace;
  }
}
