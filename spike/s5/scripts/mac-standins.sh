#!/usr/bin/env bash
# Stand-ins for checks 2, 3 and 4 in the sandbox VS Code, over ssh with absolute paths.
#   MAC_HOST=<host> MAC_SPIKE_DIR=<dir> mac-standins.sh vscode <out dir>
#   MAC_HOST=<host> MAC_SPIKE_DIR=<dir> mac-standins.sh vim <out dir>
# vscode: `shasum -a 256 -c` on the copied artifacts, then install 0.0.1, upgrade to 0.0.2 and roll
#         back to 0.0.1 with `code --install-extension <vsix> --force`; after each step the sandbox's
#         `--list-extensions --show-versions` must show the expected version.
# vim:    VSCodeVim 1.32.4 in a separate sandbox VS Code whose settings turn automatic updates off.
#   MAC_HOST=<host> MAC_SPIKE_DIR=<dir> mac-standins.sh vim-report <out dir>
#         starts that sandbox once with the target (c) probe, which reports the settings and extension
#         versions that VS Code applied, then stops it and removes the probe again.
#   MAC_HOST=<host> MAC_SPIKE_DIR=<dir> mac-standins.sh intellij <out dir> <commit> <gradle user home>
#         install 0.0.1, upgrade to 0.0.2 and roll back to 0.0.1 in the IntelliJ sandbox of the run task
#         runIde2026_2_3: each step extracts the copied plugin zip into the sandbox's plugins directory,
#         as Install Plugin from Disk does, then starts the sandbox IDE, whose plugin manager reports
#         the loaded version, and lets it exit.
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
  intellij)
    commit=$3 gh=$4
    w=$(r "/usr/bin/mktemp -d /tmp/s5ijsi.XXXXXX")
    echo "$w" > "$out/workdir.txt"
    r "'$md/scripts/intellij-sandbox.sh' setup '$w' $commit" > "$out/setup.log" 2>&1
    r "'$md/scripts/intellij-sandbox.sh' task '$w' '$gh' prepareSandbox_runIde2026_2_3" > "$out/prepare.log" 2>&1
    plugins=$(r "'$md/scripts/intellij-sandbox.sh' plugins-dir '$w'")
    : > "$out/steps.tsv"
    for step in install:0.0.1 upgrade:0.0.2 rollback:0.0.1; do
      name=${step%%:*} v=${step#*:}
      r "/bin/rm -rf '$plugins/s5-target-b' && /usr/bin/unzip -q -o '$md/artifacts/s5-target-b-$v.zip' -d '$plugins' && /bin/ls '$plugins/s5-target-b/lib'" > "$out/$name-files.txt" 2>&1
      r "'$md/scripts/intellij-sandbox.sh' task '$w' '$gh' runIde2026_2_3 -Ps5.keepSandboxPlugins=true -Ps5.report='$w/report-$name.log' -Ps5.exitAfterReport=true" > "$out/$name-gradle.log" 2>&1 || true
      r "/bin/cat '$w/report-$name.log'" > "$out/$name-report.log" 2>&1 || true
      got=$(sed -n 's/.*pluginVersion=\([0-9.]*\).*/\1/p' "$out/$name-report.log" | head -1)
      result=fail
      [ "$got" = "$v" ] && result=pass
      printf '%s\t%s\t%s\t%s\n' "$name" "$v" "$got" "$result" >> "$out/steps.tsv"
    done
    cat "$out/steps.tsv"
    ;;
  vim-report)
    sb=$(cat "$out/sandbox.txt")
    r "'$md/scripts/vscode-sandbox.sh' install '$code_cli' '$sb' '$md/artifacts/s5-target-c-0.0.1.vsix'" > "$out/probe-install.log" 2>&1
    pid=$(r "S5_KEEP_UPDATE_SETTING=1 '$md/scripts/vscode-sandbox.sh' start '/Applications/Visual Studio Code.app/Contents/MacOS/Code' '$sb' - - '$sb/report.log'")
    for _ in $(seq 1 60); do
      r "/bin/cat '$sb/report.log' 2>/dev/null" > "$out/report.log" || true
      grep -q started "$out/report.log" && break
      sleep 2
    done
    r "/bin/kill $pid" || true
    sleep 5
    r "'$md/scripts/vscode-sandbox.sh' uninstall '$code_cli' '$sb' vim-companion-spike.s5-target-c" > "$out/probe-uninstall.log" 2>&1 || true
    r "'$md/scripts/vscode-sandbox.sh' list '$code_cli' '$sb'" > "$out/list-after.txt" 2>&1
    cat "$out/report.log" "$out/list-after.txt"
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
