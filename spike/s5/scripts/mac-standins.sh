#!/usr/bin/env bash
# Stand-ins for checks 2, 3 and 4 in the sandbox VS Code, over ssh with absolute paths.
#   MAC_HOST=<host> MAC_SPIKE_DIR=<dir> mac-standins.sh vscode <out dir>
#   MAC_HOST=<host> MAC_SPIKE_DIR=<dir> mac-standins.sh vim <out dir>
# vscode: `shasum -a 256 -c` on the copied artifacts, then install 0.0.1, upgrade to 0.0.2 and roll
#         back to 0.0.1 with `code --install-extension <vsix> --force`; after each step the sandbox's
#         `--list-extensions --show-versions` must show the expected version.
# vim:    VSCodeVim 1.32.4 in a separate sandbox VS Code whose settings turn automatic updates off.
set -euo pipefail
: "${MAC_HOST:?}" "${MAC_SPIKE_DIR:?}"
what=$1 out=$2
md=$MAC_SPIKE_DIR
code_cli="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
mkdir -p "$out"
r() { ssh -o BatchMode=yes "$MAC_HOST" "$1"; }
case $what in
  vscode)
    r "cd '$md/artifacts' && /usr/bin/shasum -a 256 -c SHA256SUMS" > "$out/shasum-check.txt" 2>&1
    sb=$(r "/usr/bin/mktemp -d -t s5vsc-standin")
    echo "$sb" > "$out/sandbox.txt"
    : > "$out/steps.tsv"
    for step in install:0.0.1 upgrade:0.0.2 rollback:0.0.1; do
      name=${step%%:*} v=${step#*:}
      r "'$md/scripts/vscode-sandbox.sh' install '$code_cli' '$sb' '$md/artifacts/s5-target-c-$v.vsix'" > "$out/$name.log" 2>&1
      r "'$md/scripts/vscode-sandbox.sh' list '$code_cli' '$sb'" > "$out/$name-list.txt" 2>&1
      got=$(grep -o 'vim-companion-spike.s5-target-c@[0-9.]*' "$out/$name-list.txt" | sed 's/.*@//')
      result=fail
      [ "$got" = "$v" ] && result=pass
      printf '%s\t%s\t%s\t%s\n' "$name" "$v" "$got" "$result" >> "$out/steps.tsv"
    done
    cat "$out/steps.tsv"
    ;;
  vim)
    sb=$(r "/usr/bin/mktemp -d -t s5vim-standin")
    echo "$sb" > "$out/sandbox.txt"
    r "'$md/scripts/vscode-sandbox.sh' install '$code_cli' '$sb' vscodevim.vim@1.32.4" > "$out/install.log" 2>&1
    r "'$md/scripts/vscode-sandbox.sh' list '$code_cli' '$sb'" > "$out/list.txt" 2>&1
    r "/bin/cat '$sb/user-data/User/settings.json'" > "$out/settings.json"
    cat "$out/list.txt"
    ;;
esac
