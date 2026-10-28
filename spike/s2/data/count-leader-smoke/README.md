# Counted-leader stabilization smoke runs

These runs exercise the opt-in 300 ms condition on each VS Code version with the adapter on and
off. They used an uncommitted harness while it was being implemented, and have too few runs for
any row. Their recorded build is intentionally not eligible for the formal precheck or
differential. Keep them separate from the frozen row results. Exact commands are in `command.txt`.

Measured: all four runs observed the root ready, kept both menu keys inside quick input, recorded
no later root redraw and passed the adapter presence/poll check. Callback times were 300.3-300.4 ms
after Space; actual Space-to-`b` gaps were 304.6-305.5 ms. The final outcomes agreed between the
two arms within each VS Code version. The row comparator correctly rejects these runs because
their builds were uncommitted and changed during implementation.
