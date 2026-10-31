// Test-only extension for the headless GNOME Shell harness. It reads what the top bar would show, selects an input
// source when the harness asks (as a user would from the top bar), and saves screenshots of the virtual monitor.
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Shell from "gi://Shell";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as Keyboard from "resource:///org/gnome/shell/ui/status/keyboard.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import { ModeTrace } from "./mode-trace.js";

const IFACE = `<node><interface name="org.vimcompanion.S1Harness">
  <method name="State"><arg type="s" direction="out" name="json"/></method>
  <method name="BeginModeTrace"/>
  <method name="EndModeTrace"/>
  <method name="HideOverview"/>
  <method name="FocusPid"><arg type="u" direction="in" name="pid"/><arg type="b" direction="out" name="found"/></method>
  <method name="SelectSource"><arg type="s" direction="in" name="id"/><arg type="b" direction="out" name="found"/></method>
  <method name="Screenshot"><arg type="s" direction="in" name="path"/></method>
</interface></node>`;

function findInputMode(props) {
  if (!props) return null;
  for (let i = 0; ; i++) {
    const p = props.get(i);
    if (!p) return null;
    if (p.get_key() === "InputMode") {
      const symbol = p.get_symbol ? p.get_symbol() : null;
      return {
        symbol: symbol ? symbol.get_text() : null,
        label: p.get_label() ? p.get_label().get_text() : null,
        state: p.get_state(),
      };
    }
    const sub = findInputMode(p.get_sub_props());
    if (sub) return sub;
  }
}

export default class S1HarnessExtension extends Extension {
  enable() {
    this._sources = Keyboard.getInputSourceManager();
    this._modeTrace = new ModeTrace(
      () => this._inputState(),
      () => GLib.get_monotonic_time() / 1000,
    );
    // GNOME Shell emits this after registering/updating current IBus properties.
    this._modeSignal = this._sources.connect("current-source-changed", () =>
      this._modeTrace.capture(),
    );
    this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
    this._dbus.export(Gio.DBus.session, "/org/vimcompanion/S1Harness");
    this._startupId = Main.layoutManager.connect("startup-complete", () =>
      Main.overview.hide(),
    );
    if (!Main.layoutManager._startingUp) Main.overview.hide();
  }

  disable() {
    if (this._modeSignal) this._sources.disconnect(this._modeSignal);
    this._modeSignal = 0;
    this._modeTrace = null;
    this._sources = null;
    this._dbus?.unexport();
    this._dbus = null;
    if (this._startupId) Main.layoutManager.disconnect(this._startupId);
    this._startupId = 0;
  }

  _inputState() {
    const src = this._sources.currentSource;
    const win = global.display.focus_window;
    return {
      source: src ? `${src.type}:${src.id}` : null,
      inputMode: src ? findInputMode(src.properties) : null,
      focusPid: win ? win.get_pid() : null,
      focusClientType: win ? win.get_client_type() : null,
    };
  }

  BeginModeTrace() {
    this._modeTrace.begin();
  }

  EndModeTrace() {
    this._modeTrace.end();
  }

  State() {
    const win = global.display.focus_window;
    return JSON.stringify({
      ...this._inputState(),
      modeTrace: this._modeTrace.snapshot(),
      overview: Main.overview.visible,
      focusWindow: win ? win.get_title() : null,
      focusWmClass: win ? win.get_wm_class() : null,
      focusSequence: win ? win.get_stable_sequence() : null,
      windows: global.get_window_actors().map((actor) => ({
        pid: actor.meta_window.get_pid(),
        title: actor.meta_window.get_title(),
        clientType: actor.meta_window.get_client_type(),
        wmClass: actor.meta_window.get_wm_class(),
      })),
    });
  }

  HideOverview() {
    Main.overview.hide();
  }

  FocusPid(pid) {
    Main.overview.hide();
    const window = global
      .get_window_actors()
      .map((actor) => actor.meta_window)
      .find((window) => window.get_pid() === pid);
    if (!window) return false;
    Main.activateWindow(window, global.get_current_time());
    return true;
  }

  SelectSource(id) {
    const ism = Keyboard.getInputSourceManager();
    for (const src of Object.values(ism.inputSources)) {
      if (`${src.type}:${src.id}` === id) {
        src.activate(false);
        return true;
      }
    }
    return false;
  }

  Screenshot(path) {
    const file = Gio.File.new_for_path(path);
    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    new Shell.Screenshot()
      .screenshot(false, stream)
      .finally(() => stream.close(null));
  }
}
