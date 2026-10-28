# Original 30 ms adapter rows

These are unchanged copies of the results produced by the frozen checkout
`cbf136fce986b5cf77749dfbe91e0f71e115fac6`. The original files remain in that checkout.
Every record uses build `1d862e513b00f4b5`. The exact commands are in each row's `command.txt`.

Measured: both VS Code versions passed the 100-run adapter-off precheck and matched all 1,800
grammar-fixture reads. The differential did not pass on either version: 1.141.0 completed
324 adapter-on and 325 adapter-off runs, with one adapter-on script error and two adapter-off
outcomes; 1.134.0 completed 874 adapter-on and 875 adapter-off runs, with one adapter-on script
error. Both errors left the which-key menu open after `3 SPC b n`. Neither version reached
1,000 completed runs per arm. No CPU row was produced by this checkout.

The failed original condition remains evidence. Results under an additional counted-leader
stabilization delay must be stored and judged separately.
