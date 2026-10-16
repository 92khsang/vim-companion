#!/usr/bin/env bash
# Copies the spike's helpers to the Mac and builds the Swift tools there.
#   MAC_HOST=<host> MAC_SPIKE_DIR=<dir> mac-push.sh [artifacts dir]
# The artifacts (the stand-ins of checks 2 and 3, with SHA256SUMS) are copied with scp, as a CI
# build would be.
set -euo pipefail
: "${MAC_HOST:?}" "${MAC_SPIKE_DIR:?}"
s5=$(cd "$(dirname "$0")/.." && pwd)
md=$MAC_SPIKE_DIR
ssh -o BatchMode=yes "$MAC_HOST" "/bin/mkdir -p '$md/scripts' '$md/mac' '$md/keys' '$md/bin' '$md/artifacts'"
scp -q -o BatchMode=yes "$s5"/scripts/*.sh "$s5"/scripts/*.py "$MAC_HOST:$md/scripts/"
scp -q -o BatchMode=yes "$s5"/mac/*.swift "$MAC_HOST:$md/mac/"
scp -q -o BatchMode=yes "$s5"/keys/sequence.txt "$MAC_HOST:$md/keys/"
if [ $# -ge 1 ]; then
  scp -q -o BatchMode=yes "$1"/*.vsix "$1"/*.zip "$1"/SHA256SUMS "$MAC_HOST:$md/artifacts/"
fi
ssh -o BatchMode=yes "$MAC_HOST" "cd '$md' && /usr/bin/swiftc -O -o bin/s5win mac/s5win.swift && /usr/bin/swiftc -O -o bin/s5keys mac/s5keys.swift && /bin/chmod +x scripts/*.sh && echo pushed"
