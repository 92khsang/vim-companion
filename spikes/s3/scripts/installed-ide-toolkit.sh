#!/usr/bin/env bash
# Records, read-only, which AWT toolkit the installed IntelliJ IDEA 2026.2 of this machine's own desktop session ran
# on (issue #12, WLToolkit row: "also record the installed IDE's toolkit in the native session"). The IDE's own log
# holds, for every start, the `toolkit:` line (the toolkit class AWT chose) and the JVM options, which carry the
# `awt.toolkit.name` option. Only these lines are copied: the IDE, OS, JRE, desktop and toolkit lines of each start,
# and the awt.toolkit.name token of its JVM options line (the rest of that line holds paths and a Toolbox token).
# The home directory is written as $HOME; the user and host names are replaced if they occur.
# Usage: installed-ide-toolkit.sh [log-dir] [out-dir]
#   log-dir defaults to $HOME/.cache/JetBrains/IntelliJIdea2026.2/log, out-dir to spikes/s3/data/installed-ide-toolkit
set -euo pipefail
log_dir="${1:-$HOME/.cache/JetBrains/IntelliJIdea2026.2/log}"
here="$(cd "$(dirname "$0")" && pwd)"
out="${2:-$here/../data/installed-ide-toolkit}"
mkdir -p "$out"
printf 'spikes/s3/scripts/installed-ide-toolkit.sh %s\n' "$*" >"$out/command.txt"
host="$(hostname)"
scrub() {
  sed -e "s#$HOME#\$HOME#g" -e "s#$host#[host]#g" -e "s#\\b$USER\\b#[user]#g"
}
{
  echo "# Lines copied from idea.log* of the installed IDE (log directory $log_dir), read $(date -u +%FT%TZ)."
  echo "# Rotated logs (idea.log.N) come first, oldest first; each start's lines are in the log's order."
  # idea.log.N (N highest = oldest) before idea.log.
  for f in $(ls "$log_dir"/idea.log* | sort -V -r); do
    echo "## $(basename "$f")"
    grep -E -e ' IDE STARTED ' \
      -e 'AppStarter - (IDE|OS|JRE|desktop|toolkit): ' \
      -e 'AppStarter - JVM options: ' "$f" |
      sed -E 's/^(.*AppStarter - )JVM options: .*(-Dawt\.toolkit\.name=[^],]*).*$/\1JVM options: ... \2 .../' |
      sed -E 's/^(.*AppStarter - )JVM options: \[.*$/\1JVM options: (no awt.toolkit.name option)/'
  done
} | scrub >"$out/toolkit-lines.txt"
{
  echo "# One line per GUI start: timestamp, toolkit class, awt.toolkit.name option."
  awk '
    /AppStarter - toolkit: / { ts = $1 " " $2; tk = $NF }
    /AppStarter - JVM options: / { opt = "(none)"; if (match($0, /-Dawt\.toolkit\.name=[^] ,.]*/)) opt = substr($0, RSTART, RLENGTH); print ts, tk, opt }
  ' "$out/toolkit-lines.txt"
} >"$out/starts.txt"
cat "$out/starts.txt"
