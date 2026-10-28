# Analysis of the completed S3 Hangul reruns

Measured: the 16 jobs in `scripts/queue-xvfb-rerun.txt` finished at 2026-10-28 02:21:57 UTC. The four Xvfb
input-method jobs used the frame-refocus harness fix from `9d1aa73`; the other 12 jobs measured real IBus with
`keep-english-in-normal` on at fast timing. No IDE was started to produce this analysis. The hosts, observer and
probe are unchanged from the main rerun; the harness fixes do not change those plugin classes.

Measured: all 35,200 trial records and 79,200 steps in those 16 runs passed the validity scan: 0 steps without
focus, 0 undelivered steps, 0 trials without a shown host, 0 error records and 0 failed delivery checks. All 48
case/host groups contained every required trial index exactly once, every file had one run-start and one run-end,
and there were 0 malformed JSON lines. The plugin-on runs supplied 32,000 trials in 32 groups; every group had a
plugin-off reference, and all trials passed `hangul_check.py`. Reference final states and engine-switch counts
agreed in 100% of the 3,200 reference trials.

## Measurements

| Measurement                                            | Conditions and count                                                                                                                         | Result                                                                                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Xvfb input-method rows                                 | Both hosts, IdeaVim 2.47.3 and 2.48.0-eap.2, six sequences, 1000 trials per sequence/host/version; 200 reference trials per sequence/version | 0 failures in 24,000 plugin-on trials                                                                                               |
| Xvfb `SPC g` timing                                    | Both hosts and versions, 1000 trials per host/version                                                                                        | 4000 of 4000 committed jamos reached IdeaVim while `SPC` was pending; the host hid on `typed:ㅎ` in every trial                     |
| Real-IBus fast timing with `keep-english-in-normal` on | Both hosts, XToolkit and WLToolkit, both versions, `SPC g`, 1000 trials per condition; 200 reference trials per toolkit/version              | 0 failures in 8000 plugin-on trials; the jamo reached IdeaVim while `SPC` was pending and the host hid on `typed:ㅎ` in every trial |
| Keep-English preflight                                 | Eight plugin-on and four plugin-off real-IBus jobs, five tries per job                                                                       | 60 of 60 tries passed the strict check: a non-Hangul engine after `Esc` and a logged switch after `Esc`                             |

The six default sequences are `SPC g`, `SPC SPC`, `SPC /`, `SPC Shift+Space`, `SPC Esc` and `SPC Ctrl+[`. Fast
timing measures `SPC g` only. The default runs measure focus, input state and final editor state for all six
sequences; the fast runs exercise the requirement to hide on the committed jamo while the leader is pending.
The Xvfb variant posts input-method events and does not measure a real IBus engine switch.

Measured: combined with `analysis-2026-10-27`, the real-IBus matrix is:

| Host      | Version      | Toolkit                | Keep-English off, six default sequences                  | Keep-English on, six default sequences                                                        | Fast `SPC g`, off and on             |
| --------- | ------------ | ---------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------ |
| `layer`   | 2.47.3       | XToolkit and WLToolkit | 1000 per sequence/toolkit, 0 failures                    | 1000 per sequence/toolkit, 0 failures                                                         | 1000 per setting/toolkit, 0 failures |
| `layer`   | 2.48.0-eap.2 | XToolkit and WLToolkit | 1000 per sequence/toolkit, 0 failures                    | 1000 per sequence/toolkit, 0 failures                                                         | 1000 per setting/toolkit, 0 failures |
| `balloon` | 2.47.3       | XToolkit and WLToolkit | 1000 per sequence/toolkit, 0 failures                    | 1000 per sequence/toolkit, 0 failures                                                         | 1000 per setting/toolkit, 0 failures |
| `balloon` | 2.48.0-eap.2 | WLToolkit              | One `SPC SPC` trial failed; the other 5999 trials passed | 1000 per sequence, 0 failures                                                                 | 1000 per setting, 0 failures         |
| `balloon` | 2.48.0-eap.2 | XToolkit               | 1000 per sequence, 0 failures                            | Incomplete after two harness crashes: 679 to 681 records per sequence across the two attempts | 1000 per setting, 0 failures         |

Measured: the earlier failing balloon trial changed the IBus/Hangul state relative to its reference. Its cause
remains unverified. The new fast run cannot replace the incomplete default run's other five sequences, and the
failed and incomplete measurements remain in the record.

## Decision and limits

Use the `JLayeredPane.POPUP_LAYER` host. Its Hangul measurements are complete, and the existing Linux focus and
`Esc` measurements plus the clean macOS runs satisfy the host-selection criteria. Balloon remains rejected by
its measured Hangul failure; its incomplete condition is disclosed rather than treated as a pass.

Keep the whole S3 verdict `fail`. Measured: `dot.jsonl` preserves the EAP result after `]d`: 19 of 20 trials
repeated `x`, while one replayed an earlier IDE action. The observer saw all 80 dot replays across the two mappings
and versions and showed 0 hints during them. Selecting a host does not change that criterion or its failure.
Do not promise consistent `.` repetition for action mappings. The fallback in issue #12 defers T1 when a
criterion cannot be measured and the user agrees, or when neither host passes; it also omits the overlay when
no host passes. Neither trigger applies here: the dot criterion was measured and layer passed the host rows.
The host choice alone does not establish that the full T1 implementation is ready.

Measured: `mac-clean.jsonl` contains 4000 focus trials (two sequences, two hosts, 1000 each) and the clean Esc
rerun (1000 trials per host), all with 0 failures. `mac-earlier-esc.jsonl` separately preserves the preceding Esc
attempt: layer 1000 of 1000 passed; balloon 999 of 1000 passed the analyzer. The other balloon trial received a
`<Left>` that the injector log did not send. Its source is unverified. The clean rerun supplies the required count
without silently discarding the earlier record. Layer's result does not depend on classifying that record.

Measured: the earlier EAP/WLToolkit/plugin-off Keep-English preflight passed 4 of 5 tries under the strict switch
check and 5 of 5 by the engine after `Esc`; that distinction remains in `analysis-2026-10-27/keep-english.jsonl`.
All plugin-on preflights and all 12 new preflights passed 5 of 5 under the strict check. Native desktop crashes,
the source of the anomalous macOS key, macOS beyond the focus/Esc rows and Windows remain unverified.

## Reproduction and preserved inputs

From the repository root, run `bash spikes/s3/data/analysis-2026-10-28/commands.sh`, or give the script an absolute
output directory to compare a separate reproduction. It reads the committed
raw records and writes analysis only; it never starts an IDE. Run commands are preserved in each `command.txt`
and in `scripts/queue-xvfb-rerun.txt` and its log. `runs.txt` fixes the 16-run input set; `inputs.sha256` verifies
the exact input bytes, including the earlier Mac and dot records used here.

| Output                                                  | Contents                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `checksums.txt`, `summarize.jsonl`, `validity.jsonl`    | Input hashes, completion/preflight checks and invalid-measurement counters     |
| `record-coverage.jsonl`                                 | Trial-index completeness and Xvfb pending-jamo timing, from `check_records.py` |
| `hangul-check.jsonl`, `hangul-check-warnings.txt`       | Conditions (1)-(3) against plugin-off references; the warnings file is empty   |
| `hangul-timing-fast.jsonl`, `keep-english.jsonl`        | Real-IBus pending-jamo timing and strict/lenient preflight counts              |
| `mac-clean.jsonl`, `mac-earlier-esc.jsonl`, `dot.jsonl` | Separate clean and anomalous Mac evidence, and the unchanged dot failure       |

The new raw JSONL files, commands, harness start records and harness settings are preserved byte for byte.
Unpublished Gradle logs contain local paths; they are left untouched and are not inputs to these measurements.
The state snapshots and Xvfb logs also remain local. Trial records contain the input-state observations used by
the checks. Prior evidence, including the four invalid Xvfb runs, is unchanged.
