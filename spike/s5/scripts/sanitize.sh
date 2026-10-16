#!/usr/bin/env bash
# Rewrites personal data in copied text results before they are committed: home directories
# become ~, and user names, host names and private IP addresses become placeholders.
# Extra literal strings to scrub (such as the Mac's host names) come from S5_SCRUB, separated by
# colons, so they are never written into the repository. Binary files are left alone.
#   S5_SCRUB=<name>:<name> sanitize.sh <dir>
set -euo pipefail
dir=$1
words=("$USER" "$(hostname)")
IFS=: read -r -a extra <<< "${S5_SCRUB:-}"
words+=("${extra[@]}")
grep -rlI -E -e "/Users/|/home/|192\.168\.|10\.[0-9]+\.[0-9]+\.[0-9]+" "$dir" 2>/dev/null | while read -r f; do
  sed -i -E -e 's#/Users/[^/ "]+#~#g' -e "s#/home/[^/ \"]+#~#g" -e 's#192\.168\.[0-9]+\.[0-9]+#<private-ip>#g' "$f"
done || true
for w in "${words[@]}"; do
  [ -n "$w" ] || continue
  grep -rlI -F -e "$w" "$dir" 2>/dev/null | while read -r f; do
    sed -i -e "s#$w#<redacted>#g" "$f"
  done || true
done || true
