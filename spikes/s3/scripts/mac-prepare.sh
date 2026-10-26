#!/usr/bin/env bash
# Prepares the Mac for the `mac` mode of spike S3 without opening a window: copies the spike plugin, the fixture, the
# generated ideavimrc, the scripts and the Swift helpers to $MAC_SPIKE_DIR, builds the helpers with /usr/bin/swiftc,
# unpacks Temurin 25.0.4 (pinned SHA-256) under $MAC_SPIKE_DIR/tools, and runs the Gradle tasks that download the IDE
# and compile the plugin and the tests (prepareSandbox_runIde262 and compileUiTestKotlin). mac-case.sh calls it before
# every run; it can be run alone.
#   MAC_HOST=<host> MAC_SPIKE_DIR=<dir> mac-prepare.sh [ideavim-notation]
# Prints the unpacked IntelliJ IDEA the Starter will use (the contents of its .app), and the preflight of the ssh session.
set -euo pipefail
: "${MAC_HOST:?}" "${MAC_SPIKE_DIR:?}"
ideavim=${1:-IdeaVIM:2.47.3}
here="$(cd "$(dirname "$0")" && pwd)"
s3="$(cd "$here/.." && pwd)"
repo="$(cd "$s3/../.." && pwd)"
md=$MAC_SPIKE_DIR
r() { ssh -o BatchMode=yes "$MAC_HOST" "$1"; }
jdk_file=OpenJDK25U-jdk_aarch64_mac_hotspot_25.0.4_7.tar.gz
jdk_sha=5a101c54abf5a9f16c0f70d8c38ba99e6567c1ba213378f0bb04497284f051bd

r "/bin/mkdir -p '$md/spikes/s3' '$md/spec/generated/intellij' '$md/bin' '$md/tools' '$md/dl' '$md/gradle-home' '$md/prep'"
# Sources, the Gradle wrapper, the fixture and the generated rc, at their repository paths (the build file resolves
# ../fixture and ../../../spec from the plugin directory): one tar stream over ssh, without build outputs and caches.
tar -C "$repo" --exclude='spikes/s3/plugin/build' --exclude='spikes/s3/plugin/build-*' --exclude='spikes/s3/plugin/.gradle*' --exclude='spikes/s3/plugin/.intellijPlatform' \
  --exclude='spikes/s3/plugin/.kotlin' --exclude='spikes/s3/plugin/.idea' --exclude='spikes/s3/scripts/__pycache__' \
  -cf - spikes/s3/plugin spikes/s3/fixture spikes/s3/scripts spikes/s3/mac spec/generated/intellij/vim-companion.ideavimrc \
  | r "/usr/bin/tar -xf - -C '$md'"
s3md=$md/spikes/s3
r "/bin/chmod +x '$s3md/plugin/gradlew' '$s3md'/scripts/*.sh && cd '$s3md' && /usr/bin/swiftc -O -o '$md/bin/s3keys' mac/s3keys.swift && /usr/bin/swiftc -O -o '$md/bin/s5win' mac/s5win.swift && echo helpers-built"
r "if [ ! -x '$md/tools/jdk-25.0.4+7/Contents/Home/bin/java' ]; then
  /usr/bin/curl -fsSL --retry 3 -o '$md/dl/jdk.tar.gz' 'https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.4%2B7/$jdk_file' &&
  [ \"\$(/usr/bin/shasum -a 256 '$md/dl/jdk.tar.gz' | /usr/bin/cut -d' ' -f1)\" = '$jdk_sha' ] &&
  /usr/bin/tar -xzf '$md/dl/jdk.tar.gz' -C '$md/tools' && /bin/rm -f '$md/dl/jdk.tar.gz' && echo jdk-unpacked
else echo jdk-present; fi
'$md/tools/jdk-25.0.4+7/Contents/Home/bin/java' -version 2>&1 | /usr/bin/head -1"
# Headless Gradle work: the IDE downloads, the plugin jar, the sandbox and the compiled tests.
r "'$s3md/scripts/mac-job.sh' task '$md' '$md/prep' prepareSandbox_runIde262 compileUiTestKotlin -Pideavim='$ideavim' -Ps3.buildDir=build-mac > '$md/prep/gradle-prepare.log' 2>&1; rc=\$?; /usr/bin/tail -n 5 '$md/prep/gradle-prepare.log'; exit \$rc"
app=$(r "'$s3md/scripts/mac-job.sh' ide-app '$md'")
echo "ide-app $app"
r "/bin/cat '$app/Resources/build.txt'; echo; /usr/bin/plutil -extract CFBundleExecutable raw '$app/Info.plist'; /bin/ls '$app/MacOS'"
r "'$md/bin/s5win' preflight"
