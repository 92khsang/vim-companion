#!/bin/bash
# Starts a sandbox VS Code: its own user data, extensions and HOME under <sandbox dir>.
# Runs on macOS (/bin/bash 3.2) and Linux. Every program is named by an absolute path.
#   vscode-sandbox.sh install <code cli> <sandbox dir> <vsix or extension id>...
#   vscode-sandbox.sh list    <code cli> <sandbox dir>
#   vscode-sandbox.sh start   <electron binary> <sandbox dir> <folder> <file> [report] [keylog]
# start prints the PID of the VS Code main process and returns; the caller stops it.
set -eu
cmd=$1 bin=$2 sb=$3
shift 3
/bin/mkdir -p "$sb/user-data/User" "$sb/extensions" "$sb/home"
settings() {
  # $1 report, $2 fixture, $3 keylog
  /bin/cat > "$sb/user-data/User/settings.json" <<JSON
{
  "update.mode": "none",
  "extensions.autoUpdate": false,
  "extensions.autoCheckUpdates": false,
  "telemetry.telemetryLevel": "off",
  "workbench.startupEditor": "none",
  "workbench.tips.enabled": false,
  "workbench.welcomePage.walkthroughs.openOnInstall": false,
  "security.workspace.trust.enabled": false,
  "window.restoreWindows": "none",
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  "chat.disableAIFeatures": true,
  "editor.fontSize": 16,
  "s5.report": "$1",
  "s5.fixture": "$2",
  "s5.keylog": "$3"
}
JSON
}
case $cmd in
  install)
    [ -f "$sb/user-data/User/settings.json" ] || settings "" "" ""
    for ext in "$@"; do
      HOME="$sb/home" "$bin" --user-data-dir "$sb/user-data" --extensions-dir "$sb/extensions" \
        --install-extension "$ext" --force
    done
    ;;
  list)
    HOME="$sb/home" "$bin" --user-data-dir "$sb/user-data" --extensions-dir "$sb/extensions" \
      --list-extensions --show-versions
    ;;
  start)
    folder=$1 file=$2 report=${3:-} keylog=${4:-}
    settings "$report" "$file" "$keylog"
    extra=""
    # The downloaded Linux build has no setuid sandbox helper; @vscode/test-electron passes the same flag.
    [ "$(/usr/bin/uname)" = Linux ] && extra=--no-sandbox
    HOME="$sb/home" /usr/bin/nohup "$bin" $extra --user-data-dir "$sb/user-data" --extensions-dir "$sb/extensions" \
      --use-inmemory-secretstorage --disable-workspace-trust --skip-welcome --skip-release-notes \
      --new-window "$folder" > "$sb/vscode.log" 2>&1 < /dev/null &
    echo $!
    ;;
  *)
    echo "unknown command $cmd" >&2
    exit 2
    ;;
esac
