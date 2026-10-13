---
name: spike
description: Run a time-boxed spike that answers one technical question with experiments against real IDEs and engines, and record it in a GitHub issue built from fixed templates. Use when a decision depends on unverified engine, IDE or OS behaviour (for example the Phase 2 spikes S1-S6 and the U1 UI mock-up).
---

# Spike

A spike answers one question that blocks a decision. Its code is throwaway: it is exempt from
test-first development and is never merged. Its record is a GitHub issue labelled `spike`.
The issue opens with the question and the criteria. Its comments collect the evidence, and it
closes with the verdict. The engine contract tests built later carry the verdict into the code.

## Before you start

1. Open the spike issue.
   - Copy [templates/issue.md](templates/issue.md) and fill in every section.
   - Create the issue with `gh issue create --label spike --title "Spike <id>: <question>" --body-file <file>`.
   - For a planned spike, copy the question, pass criteria, timebox and default from the plan or
     from the issue that requests it. Do not loosen a criterion.
2. When a phase runs more than one spike, keep a single tracking issue for them.
   - Create it from [templates/tracking.md](templates/tracking.md), titled `Spikes: <phase>`.
   - Add a row for each spike issue as you open it.
3. Create a branch `spike/<id>-<slug>` from `main`.
   - Open a draft PR for it with `Refs #<issue>` in its description, and never mark it ready for
     review.
   - The branch never merges, so the two-day branch limit in AGENTS.md does not apply; the timebox
     does.
4. Experiment in sandboxes: a VS Code `--user-data-dir` and `--extensions-dir` under a temporary
   directory, or the IntelliJ sandbox from `runIde`.
5. Back up the user's real IDE profiles, `~/.ideavimrc` or desktop settings before you edit them.

## While you experiment

- Prove the harness first. Before you measure anything, show that injected keys actually reach the
  target window, for example with a probe command that records what it received.
  - On Linux, run the IDE as an X11 app under Xvfb with `WAYLAND_DISPLAY` unset.
  - Send keys with `xdotool` (XTEST), and set focus explicitly with `xdotool windowfocus --sync`.
  - Check native Wayland by hand.
- Count; do not sample by eye. When the criterion is "no leaks", run at least 1000 trials per
  condition. Zero failures in 1000 trials puts the 95% upper bound near 0.3% (rule of three).
- Commit the scripts and raw data to the spike branch, with the exact commands that produced them.
  A result that nobody can rerun is not a result.
- Post a comment on the issue when a finding changes the plan of the spike, such as a broken
  harness, a criterion that cannot be measured as written, or a new question.
- Stop at the timebox. If the criteria are not met by then, the planned default applies.

## Finish

1. Post the verdict on the spike issue as a comment, from
   [templates/verdict.md](templates/verdict.md). Report the same table to the user.
2. In that comment, list every engine or IDE behaviour that the decision relies on. Each one
   becomes an engine contract test: it is written test-first when the real code is built, and it
   runs in the weekly canary.
3. Update the spike's row in the tracking issue.
4. Once the user has seen the verdict, close the issue as completed, close the draft PR without
   merging, and delete the spike branch. GitHub keeps the commits of a closed PR, so links to them
   keep working.
5. Record the user's approval of a mock-up or a decision, with the date. It goes in the tracking
   issue, or in the spike issue when there is no tracking issue. Write it in English, not as a
   quote.

## Writing rules

These rules apply to every issue body and comment that a spike writes.

- Write in English, in plain sentences. State facts in the present tense and measurements in the
  past tense.
- Mark how you know each statement:
  - "measured", with the command and the environment;
  - "documented", with a link to the source;
  - "inferred", with what it rests on.
- Put everything you did not check under Unverified.
- Give every number its unit, trial count and conditions, such as "0 of 1000 leaks at 30 ms
  injected delay, idle host". Never write "works", "fast" or "stable" without a number.
- Link a source by URL, or by `path:line` at a commit SHA. Do not paste logs longer than 20 lines;
  commit them to the spike branch and link them.
- One question per issue. If a spike finds a second question, open a new spike issue and link it.
- Fix a mistake in the issue body only by editing it and saying so in a comment. Record progress
  and results as comments.
- Leave out personal data: home directory paths (write `~`), user names, tokens, and screenshots
  that show anything other than the IDE under test. Do not cite private notes or a personal
  config; state the fact itself.
