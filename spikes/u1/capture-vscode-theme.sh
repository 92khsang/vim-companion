#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d /tmp/vim-companion-u1-vscode.XXXXXX)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/user/User" "$work/extensions" "$work/project"
cat > "$work/user/User/settings.json" <<'JSON'
{
  "workbench.colorTheme": "Dark 2026",
  "workbench.startupEditor": "none",
  "workbench.secondarySideBar.defaultVisibility": "visible",
  "window.restoreWindows": "none",
  "window.newWindowDimensions": "maximized",
  "security.workspace.trust.enabled": false,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "extensions.autoUpdate": false
}
JSON
env -u WAYLAND_DISPLAY U1_CAPTURE_DIR="$root/spikes/u1/gallery" \
  timeout 90s xvfb-run -a -s '-screen 0 1440x1000x24' \
  /usr/share/code/code --no-sandbox --disable-gpu --skip-welcome --skip-release-notes --new-window --ozone-platform=x11 --force-device-scale-factor=1 \
  --user-data-dir "$work/user" --extensions-dir "$work/extensions" \
  --extensionDevelopmentPath="$root/spikes/u1/vscode" "$work/project" \
  > "$work/code.log" 2>&1 || { tail -30 "$work/code.log"; exit 1; }
test -s "$root/spikes/u1/gallery/vscode-theme.json"
printf '%s\n' 'Captured Dark 2026 from the sandbox webview (Xvfb 1440x1000).'
