// How the harness produces each key token of a card row on Linux (check (1) of candidate (b)).
// Most tokens are one key (lib.mjs keysym). The rest are VSCodeVim 1.32.4 tokens that no single
// key names: each entry says how VSCodeVim receives the token on Linux, with the source, or why
// nothing on Linux produces it. `spike/s2/check1/keys-proof.mjs` shows the delivery in a sandbox.
import { keysym } from "./lib.mjs";

/**
 * keys: physical keys typed instead of the token; exec: a VS Code command run instead of a key,
 * with a teardown command run after the trial's reads; unreachable: nothing produces the token on
 * Linux, so the row cannot be typed. An unreachable token also carries `tries`, the raw xdotool
 * chords a Linux user would press for it, and `label`, the card's statement that it is not
 * available on Linux (check1/unsupported.mjs). Its check (1) row is a negative one: a trial sends
 * every chord and passes only when VSCodeVim never receives the token (cards-correctness.mjs).
 */
export const TOKENS = {
  // Surround's default mappings in normal mode, active while vim.surround is true:
  // pluginDefaultMappings.ts L14, L24, L29 (ys -> <plugys>, cs -> <plugcs>, ds -> <plugds>).
  "<plugys>": {
    keys: ["y", "s"],
    source: "src/actions/plugins/pluginDefaultMappings.ts L14",
  },
  "<plugcs>": {
    keys: ["c", "s"],
    source: "src/actions/plugins/pluginDefaultMappings.ts L24",
  },
  "<plugds>": {
    keys: ["d", "s"],
    source: "src/actions/plugins/pluginDefaultMappings.ts L29",
  },
  // With vim.overrideCopy (default true), the key <D-c> becomes <copy> in every mode
  // (modeHandler.ts L453-L458); <D-c> is bound as `cmd+c` (package.json L411, command
  // extension.vim_cmd+c), which VS Code reads as Super+C on Linux.
  "<copy>": {
    keys: ["<D-c>"],
    source: "src/mode/modeHandler.ts L453-L458; package.json L411",
  },
  // The command palette's "Vim: Toggle Vim Mode" (command `toggleVim`, extensionBase.ts L455-L458)
  // sends <ExtensionDisable> (toggleExtension, L519-L524); running it again sends
  // <ExtensionEnable>.
  "<ExtensionDisable>": {
    exec: "toggleVim",
    teardown: "toggleVim",
    source: "extensionBase.ts L455-L458, L519-L528; src/util/specialKeys.ts L3",
  },
  // InsertCursorBelow/Above (actions.ts L1122-L1153) listen for <D-alt+down>/<C-alt+down> (and up).
  // Their package.json bindings are ctrl+alt+down/up with mac cmd+alt+down/up and linux
  // shift+alt+down/up (package.json L427, L434), so on Linux VSCodeVim receives
  // <S-alt+down>/<S-alt+up>, which no action takes.
  "<C-alt+down>": {
    tries: [["ctrl+alt+Down"], ["shift+alt+Down"]],
    label:
      "Not available on Linux: VSCodeVim binds Ctrl+Alt+Down (add a cursor below) only on Windows",
    unreachable:
      "Linux binds shift+alt+down, which VSCodeVim receives as <S-alt+down> (package.json L427; configuration.ts L163-L167); no Linux key sends <C-alt+down>",
  },
  "<C-alt+up>": {
    tries: [["ctrl+alt+Up"], ["shift+alt+Up"]],
    label:
      "Not available on Linux: VSCodeVim binds Ctrl+Alt+Up (add a cursor above) only on Windows",
    unreachable:
      "Linux binds shift+alt+up, which VSCodeVim receives as <S-alt+up> (package.json L434; configuration.ts L163-L167); no Linux key sends <C-alt+up>",
  },
  "<D-alt+down>": {
    tries: [["super+alt+Down"]],
    label:
      "Not available on Linux: VSCodeVim binds Cmd+Alt+Down (add a cursor below) only on macOS",
    unreachable:
      "cmd+alt+down is the binding's mac field only; Linux binds shift+alt+down (<S-alt+down>)",
  },
  "<D-alt+up>": {
    tries: [["super+alt+Up"]],
    label:
      "Not available on Linux: VSCodeVim binds Cmd+Alt+Up (add a cursor above) only on macOS",
    unreachable:
      "cmd+alt+up is the binding's mac field only; Linux binds shift+alt+up (<S-alt+up>)",
  },
  // GoToAlternateFile takes <C-6> and <C-^> (file.ts L32); package.json binds ctrl+6 (L321) and
  // ctrl+^ (L326). Measured on 2026-10-27 in the harness (VS Code 1.134.0 and 1.141.0, XKB layout
  // us, check1/keys-proof.mjs): ctrl+6 reached the action; ctrl+asciicircum, ctrl+shift+6 and
  // ctrl+shift+asciicircum did not, so VS Code dispatches no key of the us layout to ctrl+^.
  "<C-^>": {
    tries: [["ctrl+asciicircum"], ["ctrl+shift+6"], ["ctrl+shift+asciicircum"]],
    label:
      "Not available on a US layout on Linux; use <C-6> (edit the alternate file)",
    unreachable:
      "VS Code dispatches no key of the us layout to the binding ctrl+^ (package.json L326): ctrl+asciicircum, ctrl+shift+6 and ctrl+shift+asciicircum did not reach it (measured 2026-10-27 on VS Code 1.134.0 and 1.141.0, spike/s2/data/check1/keys-proof); <C-6> (ctrl+6) reaches the same action",
  },
  // insert.ts L337 listens for <C-shift+2>, but its binding ctrl+shift+2 is normalized to <C-S-2>
  // (package.json L341; notation.ts L4 and L6: ctrl+ -> C-, then shift+ -> S-), so the action
  // never matches.
  "<C-shift+2>": {
    tries: [["ctrl+shift+2"], ["ctrl+at"]],
    label:
      "Not available on Linux: VSCodeVim's binding for Ctrl+@ (insert the last inserted text and leave Insert mode) never reaches its action",
    unreachable:
      "the binding ctrl+shift+2 is normalized to <C-S-2> (package.json L341; notation.ts L4, L6), which no action takes; insert.ts L337 expects <C-shift+2>",
  },
};

/**
 * The plan for a list of tokens: steps of { keys } (keysyms for typeKeys-style typing) and
 * { exec }, the teardown commands, and the reasons a token cannot be typed.
 */
export function planKeys(tokens) {
  const steps = [];
  const teardown = [];
  const unreachable = [];
  const untypeable = [];
  const pushKeys = (ks) => {
    const last = steps.at(-1);
    if (last?.keys) last.keys.push(...ks);
    else steps.push({ keys: [...ks] });
  };
  for (const t of tokens) {
    const special = TOKENS[t];
    if (special?.unreachable)
      unreachable.push({ token: t, reason: special.unreachable });
    else if (special?.exec) {
      steps.push({ exec: special.exec, token: t });
      if (special.teardown) teardown.push(special.teardown);
    } else {
      const ks = special?.keys ?? [t];
      const bad = ks.filter((k) => {
        try {
          keysym(k);
          return false;
        } catch {
          return true;
        }
      });
      if (bad.length) untypeable.push(t);
      else pushKeys(ks);
    }
  }
  return { steps, teardown, unreachable, untypeable };
}
