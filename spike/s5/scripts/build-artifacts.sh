#!/usr/bin/env bash
# Builds the stand-ins for checks 2 and 3 on the agent host from a clean clone of <commit>:
# the target (c) VSIX and the target (b) plugin zip, each as version 0.0.1 and as the
# higher-versioned rebuild 0.0.2, plus SHA256SUMS in the format that `shasum -a 256 -c` reads.
#   build-artifacts.sh <commit> <out dir>
# Needs node, pnpm and a JDK 25 on PATH or in JAVA_HOME; GRADLE_USER_HOME may point to a cache.
set -euo pipefail
commit=$1 out=$2
mkdir -p "$out"
src=$(mktemp -d "${S5_BUILD_ROOT:-/tmp}/s5build.XXXXXX")
git clone --quiet https://github.com/92khsang/vim-companion.git "$src/repo"
git -C "$src/repo" -c advice.detachedHead=false checkout --quiet "$commit"
c=$src/repo/spike/s5/target-c
b=$src/repo/spike/s5/target-b
(cd "$c" && pnpm install --frozen-lockfile > "$out/build-c-install.log" 2>&1)
for v in 0.0.1 0.0.2; do
  (cd "$c" && pnpm pkg set version="$v" && pnpm exec vsce package --no-dependencies --skip-license \
    -o "$out/s5-target-c-$v.vsix" > "$out/build-c-$v.log" 2>&1)
  (cd "$b" && ./gradlew --no-daemon --console=plain -PpluginVersion="$v" buildPlugin > "$out/build-b-$v.log" 2>&1 \
    && cp build/distributions/s5-target-b-"$v".zip "$out/")
done
(cd "$out" && sha256sum s5-target-c-0.0.1.vsix s5-target-c-0.0.2.vsix s5-target-b-0.0.1.zip s5-target-b-0.0.2.zip > SHA256SUMS)
echo "$commit" > "$out/COMMIT"
rm -rf "$src"
cat "$out/SHA256SUMS"
