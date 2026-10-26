#!/usr/bin/env bash
# Spike S5 script (spike/s5/scripts/mac-awake.sh at commit 8fc284d, unchanged). Keeps the Mac from idle sleep while the spike works on it, without changing its settings:
# a `caffeinate -i -t <seconds>` power assertion that ends on its own. The display can still sleep
# and the screen still locks as the user set it.
#   MAC_HOST=<host> mac-awake.sh start <seconds>   prints the caffeinate PID
#   MAC_HOST=<host> mac-awake.sh stop <pid>
set -euo pipefail
: "${MAC_HOST:?}"
case $1 in
  start) ssh -o BatchMode=yes "$MAC_HOST" "/usr/bin/nohup /usr/bin/caffeinate -i -t $2 > /dev/null 2>&1 < /dev/null & echo \$!" ;;
  stop) ssh -o BatchMode=yes "$MAC_HOST" "/bin/kill $2" ;;
esac
