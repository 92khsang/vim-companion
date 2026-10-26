Spike S5: rerun of the local skill `mac-remote-verify` by a new agent session (2026-10-26 16:04-16:39 +0900).

The session read only the skill and had `MAC_HOST` as its only input. From its own clone (`refs/pull/18/head`
= 64825c1077229f40a23ff9e44e007a0328bf5406), its own artifacts (SHA256SUMS, COMMIT) and its own spike directory
on the Mac, it ran: 1 row 1 run per target with fresh caches, 1 capture per IDE, 1 run of the 1000-key sequence
per IDE, then the cleanup. Layout: `out/` holds every command's output in order (00 preconditions, 01 helpers,
02 row 1, 04 row 2, 05 row 3, 08 cleanup); `row1/` the first row 1 attempt (a-1 passed; b-1 was cut by a network
outage of the Mac from about 16:18 to 16:23, no sleep or reboot; c-1 skipped as "unreachable"); `row1-retry/`
the b-1 and c-1 runs after the Mac answered again; `state/` the sandboxes' reports, captures and key runs.

Measured: a-1 169 of 169 tests, b-1 1 of 1 on IU-262.10968.63, c-1 1 passing, every step exit 0; captures
2880 by 1800 px (VS Code) and 2800 by 2000 px (IntelliJ), tesseract 1 each; keys 1000 of 1000 in order, none
extra, per IDE. The first row 1 attempt (`out/02-row1-all.attempt1-failed.log`) ran nothing because `row1-all.sh`
did not create its output directory; fixed in the same commit as this data.
