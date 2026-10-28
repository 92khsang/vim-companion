#!/bin/bash
# Regenerates analysis from preserved raw records; never starts an IDE.
# An optional output directory keeps a verification run separate from committed results.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."
source_dir=data/analysis-2026-10-28
output_dir=${1:-$source_dir}
mkdir -p -- "$output_dir"
all=()
on=()
off=()
while IFS= read -r run; do
  all+=("data/$run")
  if [[ $run == *plugin-off* ]]; then
    off+=("data/$run")
  else
    on+=("data/$run")
  fi
done < "$source_dir/runs.txt"

sha256sum --check "$source_dir/inputs.sha256" > "$output_dir/checksums.txt"
python3 -I -B scripts/summarize.py "${all[@]}" > "$output_dir/summarize.jsonl"
python3 -I -B scripts/validity_scan.py "${all[@]}" > "$output_dir/validity.jsonl"
python3 -I -B scripts/hangul_check.py --on "${on[@]}" --off "${off[@]}" \
  > "$output_dir/hangul-check.jsonl" 2> "$output_dir/hangul-check-warnings.txt"
python3 -I -B scripts/hangul_timing.py "${on[@]}" > "$output_dir/hangul-timing-fast.jsonl"
python3 -I -B scripts/keep_english_readings.py "$output_dir/summarize.jsonl" > "$output_dir/keep-english.jsonl"
python3 -I -B "$source_dir/check_records.py" "${all[@]}" > "$output_dir/record-coverage.jsonl"

python3 -I -B scripts/analyze.py \
  data/20261026T221241Z-mac-focus-2.47.3-LWCToolkit \
  data/20261026T225035Z-mac-esc-2.47.3-LWCToolkit > "$output_dir/mac-clean.jsonl"
python3 -I -B scripts/analyze.py \
  data/20261026T223620Z-mac-esc-2.47.3-LWCToolkit > "$output_dir/mac-earlier-esc.jsonl"
python3 -I -B scripts/analyze.py \
  data/20261026T091810Z-xvfb-2.47.3-dot \
  data/20261026T093825Z-xvfb-2.48.0-eap.2-dot > "$output_dir/dot.jsonl"
