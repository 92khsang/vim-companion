#!/bin/sh
# Run from the spike checkout with Node 24 and the pinned Vim available.
# The optional argument selects a new output directory; profiles and source inputs are untouched.
set -eu

data=spike/s2/data/check1/resume-2026-10-28/bracket-oracle
output=${1:-$(mktemp -d)}
mkdir -p "$output"
for settings in defaults extensions; do
  S2_VIM_CPUS=0-7 S2_VIM_DOC=document S2_VIM_LAYOUT=single \
    S2_VIM_SIZE=43x42 S2_VIMRC=expect-sw2.vimrc \
    taskset -c 0-7 node spike/s2/vim-check/expect.mjs \
      "$output/$settings" "$settings" "$data/cards.json" \
      "$output/$settings.jsonl" > "$output/$settings.log" 2>&1
done
