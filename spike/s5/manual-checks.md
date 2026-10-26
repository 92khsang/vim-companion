# Spike S5: the 12 macOS checks, classified

Final classification, made once at the end of the spike on 2026-10-26 and copied into the local
skill `mac-remote-verify`.

A check counts as run over ssh only if this spike ran it over ssh. Checks 2, 3 and 4 count as run
over ssh because the spike ran their stand-ins. Every other check is manual and lists its steps and
its expected result. `$MAC_HOST` is the Mac; `$MAC_SPIKE_DIR` is the spike's temporary directory on it.

| #   | Check                                                                     | Class                   | Evidence or steps                                                                                                                                              |
| --- | ------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Build and test the targets of row 1                                       | run over ssh            | `data/row1-final/`: 3 runs per target on the Mac and 1 per target on Linux at `aefaca4`                                                                        |
| 2   | Copy a CI build to the Mac with `scp` and smoke-test it                   | run over ssh (stand-in) | `data/standins/vscode/` and `data/standins-final/intellij/`: the VSIX and the plugin zip, copied with `scp` and installed in the sandbox IDEs                  |
| 3   | Download a release candidate, check it, install, upgrade and roll back it | run over ssh (stand-in) | the same runs: `shasum -a 256 -c` on the copied files, then 0.0.1, 0.0.2 and 0.0.1 again in the sandbox VS Code and in the IntelliJ sandbox                    |
| 4   | Prepare the Mac for user tests                                            | run over ssh (stand-in) | `data/standins/vim/` and `data/standins-final/vim/`: VSCodeVim 1.32.4 in a separate sandbox VS Code whose settings turn updates off, as the probe reports them |
| 5   | Grant Screen Recording and Accessibility (Automation was never asked)     | manual                  | below                                                                                                                                                          |
| 6   | Capture screenshots of both IDEs                                          | run over ssh            | `data/row23-post/captures/`: 10 per IDE                                                                                                                        |
| 7   | The Mac's part of the user-test checklist in both IDEs                    | manual                  | below                                                                                                                                                          |
| 8   | The hint UI at the Mac's 2× normal display density                        | manual                  | below                                                                                                                                                          |
| 9   | A theme switch while a hint shows, 125% zoom and long labels              | manual                  | below                                                                                                                                                          |
| 10  | VS Code with Modern UI on and off                                         | manual                  | below                                                                                                                                                          |
| 11  | VoiceOver smoke                                                           | manual                  | below                                                                                                                                                          |
| 12  | Revoke the permissions of check 5 by v1.0.0 at the latest                 | manual                  | below                                                                                                                                                          |

## Manual checks

### 5. Grant the permissions, once, at the Mac

Measured on macOS 27.0.1: TCC attributes every program that runs inside an ssh session, including
`screencapture`, `s5win`, `s5keys` and the sandbox VS Code started from the session with `nohup`,
to the responsible process `/usr/libexec/sshd-keygen-wrapper` (identifier
`com.apple.sshd-keygen-wrapper`), so the permissions go to that program. The IntelliJ sandbox is
started as a launchd job in `gui/<uid>`, because Java AWT cannot open a window from an ssh session,
and TCC attributes it to its own JDK `java` binary instead; rows 2 and 3 do not depend on that,
because the capturer and the key sender run in the ssh session (`data/row23-post/tcc-rows23.txt`).

Measured on macOS 27.0.1: System Settings names the Accessibility pane `Device Control and Data
Access` (Korean UI: `기기 제어 및 데이터 접근`) and the Screen Recording pane `Screen & System Audio
Recording` (`화면 및 시스템 오디오 녹음`); the localization table of `SecurityPrivacyExtension.appex`
keeps the keys `ACCESSIBILITY` and `SCREEN_CAPTURE`. Each pane opens on the Mac's screen from ssh:

```bash
ssh $MAC_HOST '/usr/bin/open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"'
ssh $MAC_HOST '/usr/bin/open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"'
```

Steps:

1. In Privacy & Security > Screen & System Audio Recording, click `+`, press `Cmd+Shift+G`, type
   `/usr/libexec/sshd-keygen-wrapper`, press Return, click Open, and turn its switch on.
2. In Privacy & Security > Device Control and Data Access, turn `sshd-keygen-wrapper` on if it is
   listed; otherwise add it with `+` as in step 1 and turn it on.
3. If a dialog asks whether `sshd-keygen-wrapper` may control System Events, click Allow. The
   spike's key sender posts CGEvents and never triggered that dialog; only `osascript` would.

Expected result: `ssh $MAC_HOST "$MAC_SPIKE_DIR/bin/s5win preflight"` prints `screenCapture=true`,
`postEvent=true` and `axTrusted=true`. Measured: the Accessibility grant alone turned `postEvent`
true as well; the TCC log showed one Modify of `kTCCServiceAccessibility` and no PostEvent row
(`data/row23-post/tcc-grant.txt`).

### 7. The Mac's part of the user-test checklist in both IDEs

Steps: in VS Code with the profile `UAT` (VSCodeVim 1.32.4) and in IntelliJ IDEA with IdeaVim
2.47.3, open a source file, press `SPC` in Normal mode and walk every leader group and command of
the catalog; then go through the UI rubric: the same terms and notation in both IDEs, the empty and
error states, flicker and perceived delay, and keyboard-only use.

Expected result: every acceptance criterion holds in both IDEs, and every rubric item passes as it
does on Linux.

### 8. The hint UI at 2× normal display density

Steps: on the Mac's built-in Retina display (2×), show the hint UI in both IDEs at the default
font size.

Expected result: text and key labels are sharp, nothing is clipped or overlaps, and spacing matches
the approved mock-up.

### 9. A theme switch while a hint shows, 125% zoom and long labels

Steps: while a hint shows, switch the theme (VS Code: `Cmd+K Cmd+T`; IntelliJ IDEA: Settings >
Appearance & Behavior > Appearance > Theme). Set the zoom to 125% (IntelliJ IDEA: Settings >
Appearance & Behavior > Appearance > Zoom; VS Code: `window.zoomLevel`) and show the hint again.
Show a group whose labels are the longest in the catalog.

Expected result: the hint takes the new theme's colours without a restart, stays legible at 125%,
and long labels are shortened or wrapped as the UI specification says, never cut off mid-glyph.

### 10. VS Code with Modern UI on and off

Steps: in VS Code 1.141, set `workbench.experimental.modernUI` (Settings: "Modern UI Update") to
`true`, reload the window and show the hint UI; then set it to `false`, reload and show it again.

Expected result: the hint UI shows and works in both states, with no overlap with the floating
side bars or panel.

### 11. VoiceOver smoke

Steps: turn VoiceOver on (`Cmd+F5`). Start VS Code, which detects the screen reader, and IntelliJ
IDEA with Settings > Appearance & Behavior > Appearance > Support screen readers on (restart
required). Show a hint in each IDE.

Expected result: VoiceOver announces the hint's title and items, and the hint can be used and
dismissed from the keyboard.

### 12. Revoke the permissions by v1.0.0 at the latest

Inferred: until then, any ssh login of that Mac user can record the screen and send keys, because
the permissions go to the program behind every ssh session, and so can any sandbox IDE or other
program that such a login starts.

Steps: in System Settings > Privacy & Security, select `sshd-keygen-wrapper` under Screen & System
Audio Recording and under Device Control and Data Access, and remove it with `-` (or turn its
switch off). Under Automation, turn off System Events for it if it is listed.

Expected result: `ssh $MAC_HOST "$MAC_SPIKE_DIR/bin/s5win preflight"` prints
`screenCapture=false`, `postEvent=false` and `axTrusted=false`.
