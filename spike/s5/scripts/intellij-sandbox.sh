#!/bin/bash
# The IntelliJ sandbox of target (b), started by its run task runIde2026_2_3. macOS (/bin/bash 3.2)
# or Linux; every program is named by an absolute path and runs under `env -i`.
#   intellij-sandbox.sh setup <work dir> <commit>
#       clones <commit> into <work dir>/repo and unpacks Node, pnpm and Temurin 25.0.4 (pinned sums)
#   intellij-sandbox.sh start <work dir> <gradle user home> <gradle log> [-P<name>=<value>]...
#       starts `gradlew runIde2026_2_3` in the background and prints its PID; the probe properties
#       are s5.projectDir, s5.fixture, s5.keylog, s5.report, s5.exitAfterReport, s5.keepSandboxPlugins
#   intellij-sandbox.sh task <work dir> <gradle user home> <task> [args]...
#       runs one Gradle task in the foreground
#   intellij-sandbox.sh plugins-dir <work dir>
#       prints the sandbox plugins directory of runIde2026_2_3
set -eu
cmd=$1 work=$2
shift 2
os=$(/usr/bin/uname -s)
if [ "$os" = Darwin ]; then
  jdk_file=OpenJDK25U-jdk_aarch64_mac_hotspot_25.0.4_7.tar.gz
  jdk_sha=5a101c54abf5a9f16c0f70d8c38ba99e6567c1ba213378f0bb04497284f051bd
  java_home=$work/tools/jdk-25.0.4+7/Contents/Home
  sha256() { /usr/bin/shasum -a 256 "$1" | /usr/bin/cut -d' ' -f1; }
else
  jdk_file=OpenJDK25U-jdk_x64_linux_hotspot_25.0.4_7.tar.gz
  jdk_sha=e58fcdcd637b25c03ca84cbbcefc70d11efb8f4b4cbd05decc9f661769d77f94
  java_home=$work/tools/jdk-25.0.4+7
  sha256() { /usr/bin/sha256sum "$1" | /usr/bin/cut -d' ' -f1; }
fi
b=$work/repo/spike/s5/target-b
run_env() {
  # run_env <gradle user home> <command...>
  gh=$1
  shift
  /usr/bin/env -i HOME="$work/home" TMPDIR="$work/tmp/" PATH=/usr/bin:/bin:/usr/sbin:/sbin LANG=en_US.UTF-8 \
    JAVA_HOME="$java_home" GRADLE_USER_HOME="$gh" \
    JAVA_TOOL_OPTIONS="-XX:-UsePerfData -Djava.io.tmpdir=$work/tmp -Duser.home=$work/home" \
    ${DISPLAY:+DISPLAY=$DISPLAY} ${XDG_RUNTIME_DIR:+XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR} "$@"
}
case $cmd in
  setup)
    commit=$1
    /bin/mkdir -p "$work/tools" "$work/home" "$work/tmp" "$work/dl"
    /usr/bin/env -i HOME="$work/home" PATH=/usr/bin:/bin /usr/bin/git clone --quiet https://github.com/92khsang/vim-companion.git "$work/repo"
    /usr/bin/env -i HOME="$work/home" PATH=/usr/bin:/bin /usr/bin/git -C "$work/repo" -c advice.detachedHead=false checkout --quiet "$commit"
    /usr/bin/curl -fsSL --retry 3 -o "$work/dl/jdk.tar.gz" \
      "https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.4%2B7/$jdk_file"
    [ "$(sha256 "$work/dl/jdk.tar.gz")" = "$jdk_sha" ] || { echo "jdk sha256 mismatch" >&2; exit 1; }
    /usr/bin/tar -xzf "$work/dl/jdk.tar.gz" -C "$work/tools"
    echo "ready $(/usr/bin/git -C "$work/repo" rev-parse HEAD)"
    ;;
  start)
    gh=$1 log=$2
    shift 2
    cd "$b"
    run_env "$gh" /usr/bin/nohup "$b/gradlew" --no-daemon --console=plain runIde2026_2_3 "$@" > "$log" 2>&1 < /dev/null &
    echo $!
    ;;
  task)
    gh=$1
    shift
    cd "$b"
    run_env "$gh" "$b/gradlew" --no-daemon --console=plain "$@"
    ;;
  plugins-dir)
    echo "$b/.intellijPlatform/sandbox/s5-target-b/IU-2026.1.5/plugins_runIde2026_2_3"
    ;;
  *)
    echo "unknown command $cmd" >&2
    exit 2
    ;;
esac
