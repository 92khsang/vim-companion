---
name: spike
description: Run a time-boxed spike that answers one technical question with experiments against real IDEs and engines, and report a verdict table. Use when a decision depends on unverified engine, IDE or OS behaviour (for example the Phase 2 spikes S1-S6 and the U1 UI mock-up).
---

# Spike

A spike answers one question that blocks a decision. Its code is throwaway: it is exempt from
test-first development and is never merged. The result lives in the description of the spike's
draft PR and, later, in the engine contract tests built from it.

## Before you start

1. Write down the question, the pass criteria, the timebox and the default that applies if the
   timebox runs out. For a planned spike, copy them from the plan or the issue that requests it;
   do not loosen a criterion.
2. Record the environment you will measure: OS and display server, IDE and engine versions, and
   any coexisting plugins.
3. Create a branch `spike/<id>-<slug>` from `main` and open a draft PR for it. Never mark the PR
   ready for review. The branch never merges, so the two-day branch limit in AGENTS.md does not
   apply; the timebox does.
4. Experiment in sandboxes: a VS Code `--user-data-dir` and `--extensions-dir` under a temporary
   directory, or the IntelliJ sandbox from `runIde`. Back up the user's real IDE profiles,
   `~/.ideavimrc` or desktop settings before you edit them.

## While you experiment

- Prove the harness first. Before measuring anything, show that injected keys actually reach the
  target window (for example with a probe command that records what it received). On Linux, run
  the IDE as an X11 app under Xvfb with `WAYLAND_DISPLAY` unset, send keys with `xdotool` (XTEST)
  and set focus explicitly with `xdotool windowfocus --sync`. Check native Wayland by hand.
- Count, do not sample by eye. When the criterion is "no leaks", run at least 1000 trials per
  condition: zero failures in 1000 trials puts the 95% upper bound near 0.3% (rule of three).
- Keep raw data and the exact commands that produced it. A result nobody can rerun is not a
  result.
- Stop at the timebox. If the criteria are not met by then, the planned default applies.

## Finish

1. Write the result into the draft PR description: the question, the environment, a verdict table
   (criterion, threshold, measured, pass or fail), the decision, and the default taken if a
   criterion failed. Report the same table to the user.
2. List every engine or IDE behaviour the decision relies on. Each one becomes an engine contract
   test, written test-first when the real code is built, and runs in the weekly canary.
3. After the user has seen the verdict, close the draft PR without merging and delete the spike
   branch.
