#!/bin/bash
# How stable are the VSCodeVim internals that the inspector adapter (candidate (a), option 2) reads?
# Usage: spike/s2/engine-history/run.sh <empty work dir> <output dir>
# Clones VSCodeVim's public history, fingerprints the adapter's dependency surface at every release
# tag since 2020 and on the default branch, then checks the published packages of 1.22.2, 1.25.2
# and 1.26.0 to 1.32.4 for the names the adapter reads. Executes nothing from the clone or packages.
set -euo pipefail
work=$(cd "$1" && pwd); out=$(mkdir -p "$2" && cd "$2" && pwd); here=$(cd "$(dirname "$0")" && pwd)
git clone --quiet --no-checkout https://github.com/VSCodeVim/Vim.git "$work/vim"
cd "$work/vim"
git for-each-ref --sort=creatordate --format='%(creatordate:short) %(refname:short)' refs/tags \
  | grep -E ' v?1\.[0-9]+\.[0-9]+$' > "$out/tags.txt"
git log -1 --format='%H %ci' origin/HEAD > "$out/default-branch.txt"
mkdir -p "$out/fingerprints"; : > "$out/changes.txt"; prev=; pf=
for r in $(awk '$1>="2020-01-01"{print $2}' "$out/tags.txt") origin/HEAD; do
  cur="$out/fingerprints/$(echo "$r" | tr / _).txt"; "$here/fingerprint.sh" "$r" > "$cur"
  if [ -n "$pf" ]; then
    d=$(diff "$pf" "$cur" | grep '^>' | sed 's/^> //' | cut -d: -f1 | tr '\n' ' ' || true)
    [ -n "$d" ] && echo "$prev -> $r: $d" >> "$out/changes.txt"
  fi
  prev=$r; pf=$cur
done
mkdir -p "$work/vsix"
for t in v1.22.2 v1.25.2 $(awk '$1>="2023-09-09"{print $2}' "$out/tags.txt"); do
  gh release download "$t" --repo VSCodeVim/Vim --pattern "vim-${t#v}.vsix" --dir "$work/vsix"
done
python3 -I "$here/bundle_check.py" "$work/vsix" > "$out/bundle-check.txt"
