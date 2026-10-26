#!/bin/bash
# Runs on the Mac (/bin/bash 3.2): Gradle tasks of the S3 plugin under `env -i`, with every program named by an
# absolute path, and the `uiTest` task as a one-shot launchd job in the console user's GUI session, because Java AWT
# cannot open a window from an ssh session ("WindowServer is not available"; spike S5, intellij-sandbox.sh).
#   mac-job.sh task <spike dir> <run dir> <gradle args>...        one Gradle task in the foreground (no window)
#   mac-job.sh start <spike dir> <run dir> <gradle args>...       bootstraps `gradlew <args>` as a launchd job in
#                                                                 gui/<uid>, output in <run dir>/gradle.log; prints its PID
#   mac-job.sh run-fg <spike dir> <run dir> <gradle args>...      the job's program (used by start)
#   mac-job.sh stop-job <run dir>                                 removes the launchd job after the IDE has exited
#   mac-job.sh ide-app <spike dir>                                prints the unpacked IntelliJ IDEA 2026.2.3 (its .app contents)
# <spike dir> is $MAC_SPIKE_DIR: it holds spikes/s3/plugin (the Gradle project, at the repository's relative path so that
# the build file finds ../fixture and ../../../spec), tools/ (Temurin 25.0.4), gradle-home/ and bin/.
# <run dir> gives the JVMs their HOME, TMPDIR and user.home, so that nothing of the run touches the user's profile.
set -eu
cmd=$1
shift
java_home() { echo "$1/tools/jdk-25.0.4+7/Contents/Home"; }
plugin_dir() { echo "$1/spikes/s3/plugin"; }
run_env() {
  # run_env <spike dir> <run dir> <command...>
  local md=$1 run=$2
  shift 2
  /bin/mkdir -p "$run/home" "$run/tmp"
  /usr/bin/env -i HOME="$run/home" TMPDIR="$run/tmp/" PATH=/usr/bin:/bin:/usr/sbin:/sbin LANG=en_US.UTF-8 \
    JAVA_HOME="$(java_home "$md")" GRADLE_USER_HOME="$md/gradle-home" \
    JAVA_TOOL_OPTIONS="-XX:-UsePerfData -Djava.io.tmpdir=$run/tmp -Duser.home=$run/home" "$@"
}
gradle() {
  # gradle <spike dir> <run dir> <args>...
  local md=$1 run=$2
  shift 2
  cd "$(plugin_dir "$md")"
  run_env "$md" "$run" "$(plugin_dir "$md")/gradlew" --no-daemon --console=plain --project-cache-dir "$(plugin_dir "$md")/.gradle-mac" "$@"
}
case $cmd in
  task)
    gradle "$@"
    ;;
  run-fg)
    gradle "$@"
    ;;
  start)
    md=$1 run=$2
    shift 2
    label=s3.uitest.$$
    plist=$run/launchd.plist
    {
      echo '<?xml version="1.0" encoding="UTF-8"?>'
      echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
      echo "<plist version=\"1.0\"><dict><key>Label</key><string>$label</string>"
      echo "<key>WorkingDirectory</key><string>$(plugin_dir "$md")</string>"
      echo "<key>StandardOutPath</key><string>$run/gradle.log</string><key>StandardErrorPath</key><string>$run/gradle.log</string>"
      echo '<key>RunAtLoad</key><true/><key>ProgramArguments</key><array>'
      for a in /bin/bash "$0" run-fg "$md" "$run" "$@"; do
        echo "<string>$(printf '%s' "$a" | /usr/bin/sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g')</string>"
      done
      echo '</array></dict></plist>'
    } > "$plist"
    echo "$label" > "$run/launchd.label"
    /bin/launchctl bootstrap "gui/$(/usr/bin/id -u)" "$plist"
    pid=""
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      pid=$(/bin/launchctl print "gui/$(/usr/bin/id -u)/$label" 2>/dev/null | /usr/bin/awk '$1=="pid" {print $3; exit}')
      [ -n "$pid" ] && break
      /bin/sleep 1
    done
    echo "$pid"
    ;;
  stop-job)
    run=$1
    [ -f "$run/launchd.label" ] && /bin/launchctl bootout "gui/$(/usr/bin/id -u)/$(/bin/cat "$run/launchd.label")" || true
    ;;
  ide-app)
    md=$1
    # The IntelliJ Platform Gradle Plugin unpacks the macOS installer (a dmg) with hdiutil and rsync into a transform
    # directory that holds the contents of the dmg's `IntelliJ IDEA.app/Contents` (Info.plist, MacOS/idea,
    # Resources/build.txt) without the .app directory; S3Ide.CopiedIdeInstaller turns it back into a .app.
    for dir in "$md"/gradle-home/caches/*/transforms/*/transformed/*; do
      [ -f "$dir/Info.plist" ] && [ -f "$dir/Resources/build.txt" ] || continue
      if /usr/bin/grep -q '^IU-262.10968.63' "$dir/Resources/build.txt"; then echo "$dir"; exit 0; fi
    done
    echo "no IntelliJ IDEA 2026.2.3 (IU-262.10968.63) under $md/gradle-home" >&2
    exit 1
    ;;
  *)
    echo "unknown command $cmd" >&2
    exit 2
    ;;
esac
