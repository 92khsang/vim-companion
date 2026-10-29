#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d /tmp/vim-companion-u1-vscode.XXXXXX)
trap 'rm -rf "$work"' EXIT
capture() {
  local slug="$1" theme="$2" host="$3" output="$4"
  local profile="$work/$slug-$host"
  mkdir -p "$profile/user/User" "$profile/extensions" "$profile/project"
  python3 - "$profile/user/User/settings.json" "$theme" <<'PY'
import json,sys
with open(sys.argv[1], 'w') as f:
 json.dump({"workbench.colorTheme":sys.argv[2], "workbench.startupEditor":"none", "workbench.secondarySideBar.defaultVisibility":"visible", "window.restoreWindows":"none", "window.newWindowDimensions":"maximized", "security.workspace.trust.enabled":False, "telemetry.telemetryLevel":"off", "update.mode":"none", "extensions.autoUpdate":False}, f)
PY
  env -u WAYLAND_DISPLAY U1_CAPTURE_DIR="$root/spikes/u1/gallery" U1_CAPTURE_HOST="$host" U1_CAPTURE_FILE="$output" \
    timeout 90s xvfb-run -a -s '-screen 0 1440x1000x24' \
    /usr/share/code/code --no-sandbox --disable-gpu --skip-welcome --skip-release-notes --new-window --ozone-platform=x11 --force-device-scale-factor=1 \
    --user-data-dir "$profile/user" --extensions-dir "$profile/extensions" \
    --extensionDevelopmentPath="$root/spikes/u1/vscode" "$profile/project" \
    > "$profile/code.log" 2>&1 || { tail -30 "$profile/code.log"; exit 1; }
  test -s "$root/spikes/u1/gallery/$output"
  printf 'Captured %s / %s from the sandbox webview.\n' "$theme" "$host"
}
if [[ "${1:-}" == "--matrix" ]]; then
  while IFS='|' read -r slug theme; do
    if [[ "$slug" == "dark" ]]; then output="vscode-theme.json"; else output="vscode-theme-$slug.json"; fi
    capture "$slug" "$theme" sidebar "$output"
    capture "$slug" "$theme" panel "vscode-theme-$slug-panel.json"
  done <<'THEMES'
dark|Dark 2026
light|Light 2026
hc-dark|Default High Contrast
hc-light|Default High Contrast Light
THEMES
else
  capture dark 'Dark 2026' sidebar vscode-theme.json
fi
