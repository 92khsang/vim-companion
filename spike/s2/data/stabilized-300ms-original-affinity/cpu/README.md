# CPU evidence progress

The complete VS Code 1.141.0 record contains 12 valid ten-minute windows: three off and three on for each of idle and typing. Its version-specific ROW passes. The added CPU share is 0.188–0.208% of one core for idle and 0.156–0.185% for typing, below the unchanged 1% limit. No window was excluded or retried. All records use frozen build `dfd686159cc2459f`.

`summary-1.141-only.txt` intentionally summarizes only this completed version and therefore reports the overall two-version row as not pass while 1.134.0 is pending. The final batch summary is not present yet. The 1.134.0 run began after the last 1.141.0 window; it is not included in this snapshot. The excluded orchestration diagnostic is preserved separately under `../stabilized-300ms/cpu-orchestration-diagnostic/` relative to the data root. CPU typing keeps the original 30 ms input without either wait rule.
