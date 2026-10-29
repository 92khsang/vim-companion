# U1: right-docked UI direction

**Current layout and content approved on 2026-10-29. The complete theme/size gallery is ready for final IDE review; the U1 verdict remains pending.**

Vim Keys occupies a native right-side tool window in both IDEs. The user opens it for learning and can hide or reposition it with the IDE's own controls. Updating the displayed hint must not reveal a hidden view or take over another tool window. The intended editing focus stays in the editor; this still requires behavior verification in Phase 3.

Open [the comparison gallery](gallery/index.html) locally, or review the 72 images below. This throwaway spike must not be merged. [U1 #15](https://github.com/92khsang/vim-companion/issues/15) records the design amendment; its full theme counts and separate approval requirements remain unchanged.

## Delivery status

| Area                | Current state                                                      | Next action                                                             |
| ------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Docked layout       | Current design approved; original 16 review cases retained         | Preserve the layout and user-controlled visibility                      |
| Native Vim learning | Five reference topics and six simulated scenarios per IDE approved | Preserve the approved reference and guidance content                    |
| Final U1 approval   | Complete 24+28 gallery awaiting each IDE's review                  | Review the complete gallery separately for each IDE                     |
| Product behavior    | Not implemented by this spike                                      | Verify live input, focus, accessibility and performance in product work |

The prototype follows **reference browsing plus contextual guidance**. The six additional cases are reference, `d`, `di`, `f`, `"a3d`, and live guidance unavailable. They use fixed presentation data, not an engine observer. The reference topics are Movement, Editing, Text objects, Counts / registers, and Repeat / macros. Changing the example input does not change the selected topic. If live guidance is unavailable, no pending command is guessed and the reference stays usable. Next-parameter, next-method and next-class mappings remain separate requirements; no mappings are added here. Project-wide status is maintained in [Phase 2 #9](https://github.com/92khsang/vim-companion/issues/9).

The approved design is the [28-image gallery at the reviewed commit](https://github.com/92khsang/vim-companion/blob/9f034d3869256081378d2ac4ec8dc36aa721b5ae/spikes/u1/README.md). The decision covers both IDEs' current layout and content; the remaining theme/size criteria still apply. Scoped approvals are recorded in [Phase 2 #9](https://github.com/92khsang/vim-companion/issues/9).

## Editing space

These additional layout captures are real sandbox IDE windows with synthetic Java files. Other tool windows are closed, so opening a project tree or terminal would reduce the remaining space further. The captures use Dark 2026 / Islands Dark (compact off), at scale 1.

### Single editor, 1440 × 1000

![VS Code single editor with right-docked Vim Keys](gallery/vscode-context-single.png)

![IntelliJ single editor with right-docked Vim Keys](gallery/intellij-context-single.png)

### Split editors, 1440 × 1000

![VS Code split editors with right-docked Vim Keys](gallery/vscode-context-split.png)

![IntelliJ split editors with right-docked Vim Keys](gallery/intellij-context-split.png)

### Small split, 1100 × 800

![VS Code small split with right-docked Vim Keys](gallery/vscode-context-small-split.png)

![IntelliJ small split with right-docked Vim Keys](gallery/intellij-context-small-split.png)

### Same small split, Vim Keys hidden

The user explicitly hides the view. The harness then changes its state to prefix; it remains hidden. The companion does not change the editor layout to make room for itself.

![VS Code small split after hiding Vim Keys and updating its state](gallery/vscode-context-small-hidden.png)

![IntelliJ small split after hiding Vim Keys and updating its state](gallery/intellij-context-small-hidden.png)

## What this establishes

Measured: in one final capture per shown IntelliJ layout, the right tool window was 320 px wide and its bounds did not intersect either editor viewport. In the 1100 px split window, the two code viewports were only 283 and 282 px wide; after hiding the view they were 443 and 442 px. Docking removes code overlap but does not make a small split spacious.

Measured: the VS Code webview content was 289 CSS px wide in each shown layout. The real secondary side bar was captured with one or two editor groups. The images expose the width trade-off; no editor pixel-bound measurement is claimed for VS Code.

Measured: one fixed-state update while hidden in each sandbox left the view hidden. This is a narrow prototype visibility check, not a focus, key-ownership or engine acceptance test. No keys were injected.

The design therefore keeps showing and hiding under user control. A small window with two editors may be better used with the learning view closed, or with one editor group. The prototype does not automatically resize, reposition or open the view while displaying hints. Initial placement, window sizing and editor splits in the capture harness are explicit review setup.

## Content decisions

- Keycaps, command names and group chevrons form the main hierarchy. The prefix stays above the group name; Visual and count use separate chips.
- Badges have both icons and text, below the command label. Both IDEs show the same seven rows and `+2 more`; the two aliases remain in the data. Expansion is only illustrated.
- The Doctor notice is a fixed one-conflict scenario, not a live diagnostic result.
- The Vim tab combines reference browsing with simulated contextual guidance. Its original operator-and-motion card remains a separate review cell. Native Vim input does not require Space. All guidance examples are explicitly marked as previews, independent of S2 qualification.
- IntelliJ uses a real right-anchored, docked, pinned `Vim Keys` tool window with native Leader/Vim tabs for every state. The POPUP_LAYER host measured by S3 is not used by this direction.

## Gallery

### Idle

| VS Code: Keys view                       | IntelliJ: Leader tab                        |
| ---------------------------------------- | ------------------------------------------- |
| ![VS Code idle](gallery/vscode-idle.png) | ![IntelliJ idle](gallery/intellij-idle.png) |

### Prefix

| VS Code: `SPC › w`                           | IntelliJ: Leader tab                            |
| -------------------------------------------- | ----------------------------------------------- |
| ![VS Code prefix](gallery/vscode-prefix.png) | ![IntelliJ prefix](gallery/intellij-prefix.png) |

### Badges and long labels

| VS Code                                      | IntelliJ                                        |
| -------------------------------------------- | ----------------------------------------------- |
| ![VS Code badges](gallery/vscode-badges.png) | ![IntelliJ badges](gallery/intellij-badges.png) |

### Grammar

| VS Code: reference card                        | IntelliJ: Vim tab                                 |
| ---------------------------------------------- | ------------------------------------------------- |
| ![VS Code grammar](gallery/vscode-grammar.png) | ![IntelliJ grammar](gallery/intellij-grammar.png) |

## Native Vim learning

All six pairs below are **simulated presentation states**. They do not show observed engine input or prove that either engine supports live guidance. Each screenshot selects a different topic for review; later context updates leave the user's browsing selection intact. The gallery uses baseline Vim semantics. User remaps and engine-specific differences require separate product work.

### Reference browsing

Start with Movement; browse all five topics without entering a leader sequence.

| VS Code: Vim                                                       | IntelliJ: Vim                                                         |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| ![VS Code vim-reference preview](gallery/vscode-vim-reference.png) | ![IntelliJ vim-reference preview](gallery/intellij-vim-reference.png) |

### Pending `d`

Choose a motion or text object to finish the delete operator.

| VS Code: Vim                                       | IntelliJ: Vim                                         |
| -------------------------------------------------- | ----------------------------------------------------- |
| ![VS Code vim-d preview](gallery/vscode-vim-d.png) | ![IntelliJ vim-d preview](gallery/intellij-vim-d.png) |

### Pending `di`

Choose the inner object; `w`, `"`, and `(` are continuations, not complete commands.

| VS Code: Vim                                         | IntelliJ: Vim                                           |
| ---------------------------------------------------- | ------------------------------------------------------- |
| ![VS Code vim-di preview](gallery/vscode-vim-di.png) | ![IntelliJ vim-di preview](gallery/intellij-vim-di.png) |

### Pending `f`

Wait for an arbitrary target character on the current line, rather than listing a command menu.

| VS Code: Vim                                       | IntelliJ: Vim                                         |
| -------------------------------------------------- | ----------------------------------------------------- |
| ![VS Code vim-f preview](gallery/vscode-vim-f.png) | ![IntelliJ vim-f preview](gallery/intellij-vim-f.png) |

### Pending `"a3d`

Keep register `a`, count `3`, and the delete operator visible while waiting for the range.

| VS Code: Vim                                                     | IntelliJ: Vim                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| ![VS Code vim-register preview](gallery/vscode-vim-register.png) | ![IntelliJ vim-register preview](gallery/intellij-vim-register.png) |

### Live guidance unavailable

Keep reference browsing usable; macro playback has reference help only.

| VS Code: Vim                                                           | IntelliJ: Vim                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| ![VS Code vim-unavailable preview](gallery/vscode-vim-unavailable.png) | ![IntelliJ vim-unavailable preview](gallery/intellij-vim-unavailable.png) |

<!-- U1 MATRIX START -->

## Required theme and size gallery

Measured: the required matrix contains **24 VS Code renders and 28 IntelliJ screenshots**. The eight default dark-theme cells above also belong to this matrix; they are embedded once. Together with the 20 supplementary Vim/context images, this index contains **72 unique images**. The current layout and content approval remains recorded; final approval of this complete gallery is pending for each IDE.

Metadata: [VS Code matrix](gallery/vscode-matrix.json), [IntelliJ matrix](gallery/intellij-matrix.json).

### VS Code · Dark 2026

**badges · narrow · 170 × 1100**

![VS Code Dark 2026, badges · narrow · 170 × 1100](gallery/vscode-dark-narrow.png)

**badges · bottom · 1200 × 150**

![VS Code Dark 2026, badges · bottom · 1200 × 150](gallery/vscode-dark-bottom.png)

### VS Code · Light 2026

**idle · default · 289 × 640**

![VS Code Light 2026, idle · default · 289 × 640](gallery/vscode-light-idle.png)

**prefix · default · 289 × 640**

![VS Code Light 2026, prefix · default · 289 × 640](gallery/vscode-light-prefix.png)

**badges · default · 289 × 820**

![VS Code Light 2026, badges · default · 289 × 820](gallery/vscode-light-badges.png)

**grammar · default · 289 × 640**

![VS Code Light 2026, grammar · default · 289 × 640](gallery/vscode-light-grammar.png)

**badges · narrow · 170 × 1100**

![VS Code Light 2026, badges · narrow · 170 × 1100](gallery/vscode-light-narrow.png)

**badges · bottom · 1200 × 150**

![VS Code Light 2026, badges · bottom · 1200 × 150](gallery/vscode-light-bottom.png)

### VS Code · Default High Contrast

**idle · default · 290 × 640**

![VS Code Default High Contrast, idle · default · 290 × 640](gallery/vscode-hc-dark-idle.png)

**prefix · default · 290 × 640**

![VS Code Default High Contrast, prefix · default · 290 × 640](gallery/vscode-hc-dark-prefix.png)

**badges · default · 290 × 820**

![VS Code Default High Contrast, badges · default · 290 × 820](gallery/vscode-hc-dark-badges.png)

**grammar · default · 290 × 640**

![VS Code Default High Contrast, grammar · default · 290 × 640](gallery/vscode-hc-dark-grammar.png)

**badges · narrow · 170 × 1100**

![VS Code Default High Contrast, badges · narrow · 170 × 1100](gallery/vscode-hc-dark-narrow.png)

**badges · bottom · 1200 × 150**

![VS Code Default High Contrast, badges · bottom · 1200 × 150](gallery/vscode-hc-dark-bottom.png)

### VS Code · Default High Contrast Light

**idle · default · 290 × 640**

![VS Code Default High Contrast Light, idle · default · 290 × 640](gallery/vscode-hc-light-idle.png)

**prefix · default · 290 × 640**

![VS Code Default High Contrast Light, prefix · default · 290 × 640](gallery/vscode-hc-light-prefix.png)

**badges · default · 290 × 820**

![VS Code Default High Contrast Light, badges · default · 290 × 820](gallery/vscode-hc-light-badges.png)

**grammar · default · 290 × 640**

![VS Code Default High Contrast Light, grammar · default · 290 × 640](gallery/vscode-hc-light-grammar.png)

**badges · narrow · 170 × 1100**

![VS Code Default High Contrast Light, badges · narrow · 170 × 1100](gallery/vscode-hc-light-narrow.png)

**badges · bottom · 1200 × 150**

![VS Code Default High Contrast Light, badges · bottom · 1200 × 150](gallery/vscode-hc-light-bottom.png)

### IntelliJ condition evidence

| Theme         | Compact | Theme resource                                | Actual editor scheme   | Captured size |
| ------------- | ------- | --------------------------------------------- | ---------------------- | ------------- |
| Islands Light | Off     | `/themes/islands/ManyIslandsLight.theme.json` | `_@user_Light`         | 320 × 931     |
| Islands Light | On      | `/themes/islands/ManyIslandsLight.theme.json` | `_@user_Light`         | 320 × 942     |
| Islands Dark  | Off     | `/themes/islands/ManyIslandsDark.theme.json`  | `_@user_Islands Dark`  | 320 × 931     |
| Islands Dark  | On      | `/themes/islands/ManyIslandsDark.theme.json`  | `_@user_Islands Dark`  | 320 × 943     |
| High Contrast | Off     | `/themes/islands/HighContrast.theme.json`     | `_@user_High contrast` | 320 × 931     |
| High Contrast | On      | `/themes/islands/HighContrast.theme.json`     | `_@user_High contrast` | 320 × 942     |
| One Dark      | On      | `/one_dark.theme.json`                        | `_@user_One Dark`      | 320 × 942     |

One Dark uses plugin 6.2.2, the exact `One Dark` theme and its declared `/one_dark.xml` scheme in a fresh sandbox. No personal scheme is copied.

### IntelliJ · Islands Light · compact off

**idle**

![IntelliJ Islands Light · compact off, idle](gallery/intellij-islands-light-normal-idle.png)

**prefix**

![IntelliJ Islands Light · compact off, prefix](gallery/intellij-islands-light-normal-prefix.png)

**badges**

![IntelliJ Islands Light · compact off, badges](gallery/intellij-islands-light-normal-badges.png)

**grammar**

![IntelliJ Islands Light · compact off, grammar](gallery/intellij-islands-light-normal-grammar.png)

### IntelliJ · Islands Light · compact on

**idle**

![IntelliJ Islands Light · compact on, idle](gallery/intellij-islands-light-compact-idle.png)

**prefix**

![IntelliJ Islands Light · compact on, prefix](gallery/intellij-islands-light-compact-prefix.png)

**badges**

![IntelliJ Islands Light · compact on, badges](gallery/intellij-islands-light-compact-badges.png)

**grammar**

![IntelliJ Islands Light · compact on, grammar](gallery/intellij-islands-light-compact-grammar.png)

### IntelliJ · Islands Dark · compact on

**idle**

![IntelliJ Islands Dark · compact on, idle](gallery/intellij-islands-dark-compact-idle.png)

**prefix**

![IntelliJ Islands Dark · compact on, prefix](gallery/intellij-islands-dark-compact-prefix.png)

**badges**

![IntelliJ Islands Dark · compact on, badges](gallery/intellij-islands-dark-compact-badges.png)

**grammar**

![IntelliJ Islands Dark · compact on, grammar](gallery/intellij-islands-dark-compact-grammar.png)

### IntelliJ · High Contrast · compact off

**idle**

![IntelliJ High Contrast · compact off, idle](gallery/intellij-high-contrast-normal-idle.png)

**prefix**

![IntelliJ High Contrast · compact off, prefix](gallery/intellij-high-contrast-normal-prefix.png)

**badges**

![IntelliJ High Contrast · compact off, badges](gallery/intellij-high-contrast-normal-badges.png)

**grammar**

![IntelliJ High Contrast · compact off, grammar](gallery/intellij-high-contrast-normal-grammar.png)

### IntelliJ · High Contrast · compact on

**idle**

![IntelliJ High Contrast · compact on, idle](gallery/intellij-high-contrast-compact-idle.png)

**prefix**

![IntelliJ High Contrast · compact on, prefix](gallery/intellij-high-contrast-compact-prefix.png)

**badges**

![IntelliJ High Contrast · compact on, badges](gallery/intellij-high-contrast-compact-badges.png)

**grammar**

![IntelliJ High Contrast · compact on, grammar](gallery/intellij-high-contrast-compact-grammar.png)

### IntelliJ · One Dark · compact on

**idle**

![IntelliJ One Dark · compact on, idle](gallery/intellij-one-dark-compact-idle.png)

**prefix**

![IntelliJ One Dark · compact on, prefix](gallery/intellij-one-dark-compact-prefix.png)

**badges**

![IntelliJ One Dark · compact on, badges](gallery/intellij-one-dark-compact-badges.png)

**grammar**

![IntelliJ One Dark · compact on, grammar](gallery/intellij-one-dark-compact-grammar.png)

<!-- U1 MATRIX END -->

## Sources and capture

The preparation tool reads `root-vscode` and `window-vscode` from `spec/fixtures/hint-view/menu.json`, and `each-kind-vscode` from `spec/fixtures/hint-view/badges.json`. It adds the synthetic unsupported row `Move editor to next pane` (24 characters) before the aliases. `vim-learning.json` supplies the same fixed reference and context data to both renderers. Catalogs and original fixtures are unchanged. The Java files in `sample/` are display fixtures, not product code.

VS Code **1.141.0** supplies the real webview, secondary side bar and panel hosts. Its static gallery uses the same HTML builder, stylesheet and renderer with theme tokens captured from each sandbox host. The four themes each have a sidebar fixture and a panel fixture. The actual fixture window was 1440 × 900 within Xvfb 1440 × 1000; default sidebar content was 289 CSS px wide in Dark/Light and 290 CSS px in high contrast. Each fixture records its own window, viewport, host and computed background. The 24 required renders and the retained six dark-theme Vim previews used Google Chrome **156.0.8078.73**, at scale 1, with zero CSP violations and no viewport overflow in their recorded runs. The 170 px badge cells wrap labels and badges; the 1200 × 150 panel cells use a horizontal arrangement of the same seven visible rows, overflow count and cancel hint. High Contrast omits the blockquote background token, so the Doctor notice uses a transparent background there. The capture driver also checked that selecting Text objects survives a `d` update and an unavailable update, and that both tabs remain selectable. The four context captures are X11 captures of the VS Code window, not the desktop. The state commands update content without revealing the view; only the explicit sandbox setup opens it.

IntelliJ IDEA **2026.2.3 / 262.10968.63** runs through `runIde` in a fresh temporary sandbox. The internal `UI Gallery` action captures the actual docked component and IDE root pane with Swing `printAll`. The required matrix uses seven fresh sandbox conditions at scale 1, listed above, including both density modes and One Dark 6.2.2. The original supplementary Vim/context captures use Islands Dark with compact mode off. The actual theme resource, installed editor scheme ID, selected editor scheme and UI density are recorded in the matrix metadata. Compact mode changes the captured tool window height from 931 px to 942–943 px within the same 1440 × 1000 frame. A sandbox JDK configuration prevents unrelated SDK warnings on the synthetic Java project. No personal profile or scheme is copied, and no IdeaVim plugin is loaded.

Measured: in one native IntelliJ capture run, all six added Vim states fit vertically in the component viewport, and two context updates preserved the selected Text objects topic. The capture completed without severe IDE errors. These checks cover the prototype only.

Measured: every accepted native matrix run completed with zero severe IDE log errors and verified `sun.awt.X11.XToolkit`. The harness appends its X11 JVM argument after the IDE's launch arguments, which otherwise override it with `WLToolkit`. All published native images were recaptured after this correction.

Five preliminary runs were rejected for a platform startup `LoadingState` error during application-wide file synchronization, before gallery code. The capture sandbox sets `idea.background.write.action.enabled=false` to use the IDE's legacy VFS write path and avoid the premature progress-collection path. This setting is recorded in the metadata; the captures do not qualify the default background-write path or engine behavior. The severe-error check remains enabled; diagnostic startup tracing is recorded per condition (off for the baseline Islands Dark run). Two additional harness assertions were corrected: the loaded One Dark scheme ID is a name, not the source XML path, and the shared seven-row fixture has five badged rows. [Capture diagnostics](gallery/intellij-matrix-diagnostics.json) record these preliminary failures and capture conditions.

The native badge renderer keeps theme accent colors when they provide at least 4.5:1 contrast against the panel background, and otherwise uses the theme's regular text color. This corrects dim badge text seen in One Dark and the light theme. The matrix records checks for five visible badge labels per condition. The threshold follows [WCAG's small-text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html); it is a targeted badge check, not a complete accessibility evaluation.

Metadata: [VS Code theme](gallery/vscode-theme.json), [VS Code components](gallery/vscode-capture.json), [VS Code layouts](gallery/vscode-context.json), [IntelliJ components](gallery/intellij-capture.json), [IntelliJ layouts](gallery/intellij-context.json).

Vim reference sources: [motions and text objects](https://vimhelp.org/motion.txt.html), [operators and registers](https://vimhelp.org/change.txt.html), [repeat and macros](https://vimhelp.org/repeat.txt.html). These describe Vim semantics, not observed VSCodeVim or IdeaVim behavior.

API references: [VS Code webviews](https://code.visualstudio.com/api/extension-guides/webview), [IntelliJ tool window modes](https://www.jetbrains.com/help/idea/viewing-modes.html).

## Reproduce

Use Node 24, pnpm 11, Java 25, VS Code 1.141.0, Google Chrome, Xvfb, xdotool, ImageMagick (`import`), Python 3 with Pillow, and IntelliJ IDEA 2026.2.3. The existing Gradle 9.8.1, IntelliJ Platform plugin 2.19.0 and Kotlin 2.4.21 are unchanged. The IntelliJ build uses the installed IDE and its bundled Java plugin; it never runs Node.

From the repository root:

```bash
# Prepare shared fixture data and the component gallery.
node spec/tools/u1-gallery.mjs
bash spikes/u1/capture-vscode-theme.sh --matrix
node spec/tools/u1-gallery.mjs --matrix
node spec/tools/u1-capture-web.mjs --matrix
# Optional: recapture the supplementary dark Vim cells after changing their renderer.
# node spec/tools/u1-capture-web.mjs

# Capture the required native matrix. JAVA_HOME must point to Java 25.
U1_IDEA_HOME="$HOME/.local/share/JetBrains/Toolbox/apps/intellij-idea-ultimate" \
  U1_STARTUP_TRACE=true bash spikes/u1/capture-intellij-matrix.sh
node spec/tools/u1-matrix-index.mjs

# Additional real IDE layouts, when their content or layout changes.
env -u WAYLAND_DISPLAY xvfb-run -a -s '-screen 0 1440x1000x24' \
  node spec/tools/u1-capture-context.mjs
U1_IDEA_HOME="$HOME/.local/share/JetBrains/Toolbox/apps/intellij-idea-ultimate" \
  bash spikes/u1/capture-intellij.sh

node spec/tools/u1-check-images.mjs
# After pushing, check the exact image permalinks.
node spec/tools/u1-check-images.mjs --commit "$(git rev-parse HEAD)"
```

## Remaining work

Review the complete gallery and record final approval separately for VS Code and IntelliJ in #9. The current layout and native Vim learning content are already approved; the additional theme/size results are now ready for review. No final U1 verdict is claimed.

Live engine input, focus/key ownership, timing, accessibility beyond the targeted badge contrast check, performance, native Wayland and macOS remain unverified. The twelve Vim scenario images are simulated dark-theme examples; no live observer is implemented. S2 remains stopped. S1 and S4 remain separate unresolved work in #9.
