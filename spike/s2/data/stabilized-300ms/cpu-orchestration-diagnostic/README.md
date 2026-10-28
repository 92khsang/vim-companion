# Excluded orchestration diagnostic

This first CPU restart is excluded from formal row evidence. The outer queue was launched with `taskset -c 0-7`, so its Node driver and Xvfb inherited that affinity while the isolated VS Code processes used the configured cores 16-23. The original queue had no outer affinity override.

The attempt was stopped before a ten-minute window completed. The CPU driver received SIGTERM and ran its existing sandbox/Xvfb cleanup handler. There are zero window records and no CPU JSONL to preserve. `process-affinity.json`, the batch `command.txt`, queue log/status and the empty summary preserve the available evidence. The succeeding formal restart uses a new data root, the original invocation without taskset, and all required samples; this diagnostic is never added to them.
