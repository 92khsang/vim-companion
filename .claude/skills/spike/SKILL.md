---
name: spike
description: Run a time-boxed spike that answers one technical question with experiments against real IDEs and engines, and record it in GitHub issues from fixed templates. Use when a decision depends on unverified engine, IDE or OS behaviour (for example the Phase 2 spikes S1-S6 and the U1 UI mock-up), and whenever you write to an issue labelled spike, including the user's approval of a mock-up.
---

# Spike

A spike answers one question that blocks a decision. Its code is throwaway: it is exempt from
test-first development and is never merged. Its record is a GitHub issue labelled `spike`. The
issue opens with the question and the criteria, its comments record findings that change the plan,
and it closes with the verdict. The engine contract tests built later carry the verdict into the
code.

Every issue body and comment starts from a template in [templates/](templates/). Copy the template
to a file outside the repository, such as one from `mktemp`, and replace every `{{…}}` placeholder.
Before you post it, run `grep -n '{{' <file>`; it must print nothing.

## Before you start

1. A phase that runs more than one spike has one tracking issue. Open it before the first spike
   issue.
   - Look for it first:
     `gh issue list --label spike --state all --search 'in:title "Spikes: Phase <n>"'`.
   - Otherwise create it from [templates/tracking.md](templates/tracking.md) with
     `gh issue create --label spike --title "Spikes: Phase <n>" --body-file <file>`.
2. Open the spike issue from [templates/issue.md](templates/issue.md) with
   `gh issue create --label spike --title "Spike <id>: <question>" --body-file <file>`, and add its
   row to the tracking issue.
   - For a planned spike, translate the question, pass criteria, timebox and default from the plan
     into English. Keep every number and condition. Do not loosen a criterion.
3. Create a branch `spike/<id>-<slug>` from `main`. Spike branches are the exception to the
   `<type>/<slug>` rule and the two-day limit in AGENTS.md; the timebox applies instead.
   - Commit messages use a Conventional Commits type and an allowed scope, such as
     `test(vscode): add the S1 key probe`.
   - Push the first commit, then open a draft PR with
     `gh pr create --draft --title "chore(<scope>): spike <id> <slug>" --body "Refs #<issue>"`.
   - Never mark the PR ready for review, and never force-push the branch.
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
- Post a comment from [templates/note.md](templates/note.md) when a finding changes the plan of the
  spike: a broken harness, a criterion that cannot be measured as written, or a new question. Post
  no other progress comments.
- A criterion that cannot be measured as written is not a mistake to fix. Ask the user, and change
  it only after they agree.
- Stop on the end date in the issue. If a criterion has no result by then, the planned default
  applies.

## Finish

1. If a criterion is the user's approval, as in U1, record the approval first. Add it under User
   approvals in the tracking issue, in the form that the template shows. Without a tracking issue,
   post the same line as a comment on the spike issue.
2. Post the verdict from [templates/verdict.md](templates/verdict.md) with
   `gh issue comment <number> --body-file <file>`, and report the same table to the user. The
   verdict is one of three words:
   - `pass`: every criterion passed.
   - `fail`: at least one criterion failed.
   - `default`: the timebox ended before every criterion had a result, and none failed.
3. The verdict lists every engine or IDE behaviour that the decision relies on. Each one becomes an
   engine contract test: it is written test-first when the real code is built, and it runs in the
   weekly canary.
4. In the tracking issue, set the spike's Verdict to the same word and its Decision to one sentence.
5. Wait for the user's reply to the verdict. If they disagree, post their objection as a note and
   keep the issue open.
6. Otherwise, close the issue with `gh issue close <number> --reason completed`, whatever the
   verdict. Close the draft PR and delete its branch with `gh pr close <pr> --delete-branch`. GitHub
   keeps the commits of a closed PR, so permalinks to them keep working; links by branch name stop
   working.
7. Close the tracking issue as completed when every row has a verdict and every approval that the
   phase needs is recorded.
8. If the plan makes a spike deliver a file that stays, such as a skill, put that file in its own
   `<type>/<slug>` branch and pull request under the normal rules. The spike branch still never
   merges.

## Writing rules

These rules apply to everything a spike publishes: issue bodies, comments, the draft PR, commit
messages and every file on the spike branch. The repository is public.

- Write in English, in plain sentences.
- Start each finding with how you know it. A finding is a sentence about how an engine, an IDE or an
  OS behaves.
  - `Measured:` in the past tense, with the command and the environment.
  - `Documented:` in the present tense, with a link to the source.
  - `Inferred:` in the present tense, with what it rests on.
- Give every measured value its unit, the trial count and the conditions, such as "0 leaks in 1000
  trials at 30 ms injected delay, idle extension host". Never write "works", "fast" or "stable"
  without one.
- In the verdict, list under Unverified each condition that the question covers but you did not
  test, such as native Wayland or macOS, and say why.
- Put every key, key sequence, command, path and setting in backticks, such as `f<Space>` or
  `SPC w <Esc>`. GitHub drops angle-bracket text outside code.
- Link an outside source by URL. Link a file in this repository by permalink, a URL with the full
  commit SHA (press `y` on a GitHub file page), never by branch name.
- Do not paste logs longer than 20 lines. Commit them to the spike branch and link them.
- One question per issue. A planned spike stays one issue, even when its criteria cover several
  checks.
- If a spike finds a new question, post a note and open a new spike issue titled
  `Spike: <question>`, with a branch `spike/<issue number>-<slug>`, and add it to the tracking
  issue. Start it only after the user agrees to its timebox.
- Do not change a spike issue's body after you open it, except to fix a mistake. Then post a note
  that says what changed and why.
- Edit the tracking issue's table and approvals in place. Read its body just before you edit it,
  and change only your own row or line.
- Leave out personal data: user names, host names, IP addresses, tokens, and screenshots that show
  anything other than the IDE under test.
  - Write the home directory as `~` in prose and as `$HOME` in commands. Write a remote host as a
    variable, such as `$MAC_HOST`.
  - Do not cite private notes or a personal config. State the fact itself.
- Before every push, run `git log -p main..HEAD | grep -nF -e "$HOME" -e "$USER" -e "$(hostname)"`.
  It must print nothing.
