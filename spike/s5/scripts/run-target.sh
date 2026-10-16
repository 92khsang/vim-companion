#!/bin/bash
# Spike S5 row 1: runs one target in a fresh run directory, on macOS (/bin/bash 3.2) or Linux.
#   run-target.sh <a|b|c> <run dir> <cache dir, or "fresh">
# <run dir> already holds the git clone in <run dir>/repo. The script downloads Node 24.21.0,
# pnpm 11.28.5 and Temurin 25.0.4, checks them against pinned SHA-256 sums, unpacks them into
# <run dir>/tools and runs the target with every program named by an absolute path. Each command
# runs under `env -i` with a PATH of absolute directories, HOME and TMPDIR inside the run
# directory, and JAVA_HOME, GRADLE_USER_HOME and the pnpm store set explicitly.
# "fresh" puts GRADLE_USER_HOME and the pnpm store in the run directory (a cold start).
# Results go to <run dir>/results: steps.tsv (step, exit code, seconds), counts.tsv, env.tsv, logs.
set -u
target=$1 run=$2 cache=$3
real_home=${HOME:-/nonexistent}
repo=$run/repo
res=$run/results
/bin/mkdir -p "$res" "$run/tools/bin" "$run/home" "$run/tmp" "$run/dl"
if [ "$cache" = fresh ]; then cache=$run/cache; fi
/bin/mkdir -p "$cache"

os=$(/usr/bin/uname -s)
case $os in
  Darwin)
    node_name=node-v24.21.0-darwin-arm64 node_ext=tar.gz
    node_sha=bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057
    jdk_file=OpenJDK25U-jdk_aarch64_mac_hotspot_25.0.4_7.tar.gz
    jdk_sha=5a101c54abf5a9f16c0f70d8c38ba99e6567c1ba213378f0bb04497284f051bd
    jdk_home_rel=jdk-25.0.4+7/Contents/Home
    sha256() { /usr/bin/shasum -a 256 "$1" | /usr/bin/cut -d' ' -f1; }
    ;;
  Linux)
    node_name=node-v24.21.0-linux-x64 node_ext=tar.xz
    node_sha=fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6
    jdk_file=OpenJDK25U-jdk_x64_linux_hotspot_25.0.4_7.tar.gz
    jdk_sha=e58fcdcd637b25c03ca84cbbcefc70d11efb8f4b4cbd05decc9f661769d77f94
    jdk_home_rel=jdk-25.0.4+7
    sha256() { /usr/bin/sha256sum "$1" | /usr/bin/cut -d' ' -f1; }
    ;;
  *) echo "unsupported OS $os" >&2; exit 2 ;;
esac
pnpm_sha=1ef4e447a68713656064f3f174c0f44719960a043a3fe2299169d08cf1dbf8ee

now() { /bin/date +%s; }
step() {
  # step <name> <command...>: runs the command, logs it, records exit code and duration.
  name=$1
  shift
  t0=$(now)
  echo "### $name: $*" >> "$res/run.log"
  "$@" >> "$res/run.log" 2>&1
  rc=$?
  printf '%s\t%s\t%s\n' "$name" "$rc" "$(($(now) - t0))" >> "$res/steps.tsv"
  return $rc
}
fetch() {
  # fetch <url> <file> <sha256>
  /usr/bin/curl -fsSL --retry 3 -o "$run/dl/$2" "$1" || return 1
  got=$(sha256 "$run/dl/$2")
  [ "$got" = "$3" ] || { echo "sha256 mismatch for $2: $got" >&2; return 1; }
}

: > "$res/steps.tsv"
/usr/bin/touch "$run/marker"
step fetch-node fetch "https://nodejs.org/dist/v24.21.0/$node_name.$node_ext" "node.$node_ext" "$node_sha" &&
step fetch-pnpm fetch https://registry.npmjs.org/pnpm/-/pnpm-11.28.5.tgz pnpm.tgz "$pnpm_sha" &&
step fetch-jdk fetch "https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.4%2B7/$jdk_file" jdk.tar.gz "$jdk_sha" &&
step unpack-node /usr/bin/tar -xf "$run/dl/node.$node_ext" -C "$run/tools" &&
step mkdir-pnpm /bin/mkdir -p "$run/tools/pnpm" &&
step unpack-pnpm /usr/bin/tar -xzf "$run/dl/pnpm.tgz" -C "$run/tools/pnpm" &&
step unpack-jdk /usr/bin/tar -xzf "$run/dl/jdk.tar.gz" -C "$run/tools" || { echo "toolchain setup failed"; exit 1; }

node_dir=$run/tools/$node_name
java_home=$run/tools/$jdk_home_rel
# pnpm calls itself by name from package scripts, so it needs an executable named pnpm on PATH.
/bin/cat > "$run/tools/bin/pnpm" <<SH
#!/bin/sh
exec "$node_dir/bin/node" "$run/tools/pnpm/package/bin/pnpm.mjs" "\$@"
SH
/bin/chmod +x "$run/tools/bin/pnpm"
pnpm=$run/tools/bin/pnpm
path=$run/tools/bin:$node_dir/bin:/usr/bin:/bin:/usr/sbin:/sbin
store=$cache/pnpm-store
gradle_home=$cache/gradle-home
extra=""
# Linux target (c) needs the Xvfb display that the caller set up.
[ "$os" = Linux ] && extra="DISPLAY=${DISPLAY:-} XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-}"
e() {
  # Runs a command in a clean environment; every directory in PATH is absolute.
  /usr/bin/env -i HOME="$run/home" TMPDIR="$run/tmp/" PATH="$path" LANG=en_US.UTF-8 CI=true \
    JAVA_HOME="$java_home" GRADLE_USER_HOME="$gradle_home" \
    JAVA_TOOL_OPTIONS="-Djava.io.tmpdir=$run/tmp -Duser.home=$run/home" $extra "$@"
}

{
  printf 'os\t%s %s\n' "$(/usr/bin/uname -s)" "$(/usr/bin/uname -m)"
  [ "$os" = Darwin ] && printf 'macos\t%s %s\n' "$(/usr/bin/sw_vers -productVersion)" "$(/usr/bin/sw_vers -buildVersion)"
  printf 'commit\t%s\n' "$(/usr/bin/git -C "$repo" rev-parse HEAD)"
  printf 'node\t%s\n' "$(e "$node_dir/bin/node" --version)"
  printf 'pnpm\t%s\n' "$(e "$pnpm" --version)"
  printf 'java\t%s\n' "$(e "$java_home/bin/java" -version 2>&1 | /usr/bin/head -2 | /usr/bin/tr '\n' ' ')"
  printf 'PATH\t%s\n' "$path"
  printf 'JAVA_HOME\t%s\n' "$java_home"
  printf 'GRADLE_USER_HOME\t%s\n' "$gradle_home"
  printf 'pnpm_store\t%s\n' "$store"
} > "$res/env.tsv" 2>&1

status=0
case $target in
  a)
    cd "$repo" || exit 1
    step install e "$pnpm" install --frozen-lockfile --ignore-scripts --store-dir "$store" || status=1
    step typecheck e "$pnpm" typecheck || status=1
    step spec-check e "$pnpm" spec:check || status=1
    step check-ids e "$pnpm" check-ids || status=1
    step gen-check e "$pnpm" gen --check || status=1
    step test e "$pnpm" test --coverage || status=1
    # vitest prints "Tests  <n> passed (<n>)"; keep the summary lines without colour codes.
    /usr/bin/tr -d '\033' < "$res/run.log" | /usr/bin/sed -e 's/\[[0-9;]*m//g' | /usr/bin/grep -E '^ *(Test Files|Tests) ' > "$res/counts.tsv"
    ;;
  b)
    cd "$repo/spike/s5/target-b" || exit 1
    step gradle e "$repo/spike/s5/target-b/gradlew" --no-daemon --console=plain buildPlugin testOn2026_2_3 || status=1
    /bin/cp -R build/test-results "$res/test-results" 2>/dev/null
    /bin/cp build/distributions/*.zip "$res/" 2>/dev/null
    /usr/bin/grep -h -o -E '<testsuite [^>]*' build/test-results/testOn2026_2_3/*.xml > "$res/counts.tsv" 2>/dev/null
    /usr/bin/grep -h -o 'S5 test IDE build: [^ <]*' build/test-results/testOn2026_2_3/*.xml >> "$res/counts.tsv" 2>/dev/null
    ;;
  c)
    cd "$repo/spike/s5/target-c" || exit 1
    step install e "$pnpm" install --frozen-lockfile --store-dir "$store" || status=1
    step test e "$pnpm" test || status=1
    /usr/bin/tr -d '\033' < "$res/run.log" | /usr/bin/sed -e 's/\[[0-9;]*m//g' | /usr/bin/grep -E '^ *[0-9]+ (passing|failing|pending)' > "$res/counts.tsv"
    ;;
  *) echo "unknown target $target" >&2; exit 2 ;;
esac
printf 'status\t%s\n' "$status" >> "$res/steps.tsv"
# What changed outside the run directory and the cache directory while the run lasted. The user may
# be working on the machine, so this lists every entry newer than the run's start marker.
for d in "$real_home" "$real_home/Library" "$real_home/Library/Caches" "$real_home/Library/Application Support" \
  "$real_home/Library/Preferences" "$real_home/Library/Logs" "$real_home/Library/Java" "$real_home/.cache" \
  "$real_home/.config" "$real_home/.local/share" "$real_home/.local/state" "$real_home/.gradle" "$real_home/.m2" \
  "$real_home/.npm" "$real_home/.vscode" /tmp "${TMPDIR:-/tmp}"; do
  [ -d "$d" ] && /usr/bin/find "$d" -mindepth 1 -maxdepth 1 -newer "$run/marker" 2>/dev/null
done | /usr/bin/grep -v -F "$run" | /usr/bin/grep -v -F "$cache" | /usr/bin/sed -e "s#^$real_home#~#" | /usr/bin/sort -u > "$res/outside-changes.txt"
exit $status
