# S1: leader input routing

Throwaway experiment for [S1 #10](https://github.com/92khsang/vim-companion/issues/10).
Never merge this branch. The issue retains the complete acceptance criteria; this
first feasibility gate cannot produce an S1 pass or choose the product input path.

## First gate

One sandbox: VS Code 1.141.0, VSCodeVim 1.32.4, X11 under Xvfb, US layout,
10 ms requested inter-key delay, idle extension host, prototype and engine in the
same extension host. No user profile is changed. Only one IDE instance runs.

1. Prove delivery: at least 1000 injected keys must arrive in order at probe
   keybindings, followed by a fixed Vim insertion script with exact expected text.
2. Establish the engine's initial text, cursor, mode and registers. Observe them
   through a read-only test probe; do not change the engine's input path.
3. Try V-a entry/exit with `SPC w h j`, checking the executed leaf, final text,
   cursor, mode, registers and released leader context after every trial. Run
   1000 trials only if no discrepancy appears first.
4. Stop this gate at the first discrepancy or harness failure and retain the
   complete trial. Diagnose whether it belongs to the harness or prototype;
   reproduce a suspected product-path failure before recommending further work.
   Otherwise stop after the 1000-trial entry/exit batch and report this condition.

This is a staged investigation, not a reduction of the issue's criteria. A
failure-free first batch does not qualify cancellation, native Vim arguments,
counts, Visual modes, input-opening leaves, load/host separation, another IDE
version, Hangul, native Wayland or macOS. Those results remain required for a
final S1 verdict. S2 stays stopped and is not run by this harness.

## Next decision

Use the first gate's evidence to decide which unresolved S1 conditions to run
next. Do not start the full matrix automatically or adopt V-b solely because this
initial scope is bounded. The user must approve any change to final criteria.
