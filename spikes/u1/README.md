# U1: right-docked UI direction

**Design review only. Final IDE approvals and the U1 verdict remain pending.**

Vim Keys occupies a native right-side tool window in both IDEs. The user opens it for learning and can hide or reposition it with the IDE's own controls. Updating the displayed hint must not reveal a hidden view or take over another tool window. The intended editing focus stays in the editor; this still requires behavior verification in Phase 3.

Open [the comparison gallery](gallery/index.html) locally, or review the 16 images below. This throwaway spike must not be merged. [U1 #15](https://github.com/92khsang/vim-companion/issues/15) records the design amendment; its full theme counts and separate approval requirements remain unchanged.

## Editing space

These are real sandbox IDE windows with synthetic Java files. Other tool windows are closed, so opening a project tree or terminal would reduce the remaining space further. The captures use Dark 2026 / Islands Dark (compact off), at scale 1.

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

Measured: in one final capture per shown IntelliJ layout, the right tool window was 320 px wide and its bounds did not intersect either editor viewport. In the 1100 px split window, the two code viewports were only 282 and 281 px wide; after hiding the view they were 442 and 441 px. Docking removes code overlap but does not make a small split spacious.

Measured: the VS Code webview content was 289 CSS px wide in each shown layout. The real secondary side bar was captured with one or two editor groups. The images expose the width trade-off; no editor pixel-bound measurement is claimed for VS Code.

Measured: one fixed-state update while hidden in each sandbox left the view hidden. This is a narrow prototype visibility check, not a focus, key-ownership or engine acceptance test. No keys were injected.

The design therefore keeps showing and hiding under user control. A small window with two editors may be better used with the learning view closed, or with one editor group. The prototype does not automatically resize, reposition or open the view while displaying hints. Initial placement, window sizing and editor splits in the capture harness are explicit review setup.

## Content decisions

- Keycaps, command names and group chevrons form the main hierarchy. The prefix stays above the group name; Visual and count use separate chips.
- Badges have both icons and text, below the command label. Both IDEs show the same seven rows and `+2 more`; the two aliases remain in the data. Expansion is only illustrated.
- The Doctor notice is a fixed one-conflict scenario, not a live diagnostic result.
- Grammar is a static operator-and-motion reference card, independent of S2 qualification.
- IntelliJ uses a real right-anchored, docked, pinned `Vim Keys` tool window with native Leader/Grammar tabs for every state. The POPUP_LAYER host measured by S3 is not used by this direction.

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

| VS Code: reference card                        | IntelliJ: Grammar tab                             |
| ---------------------------------------------- | ------------------------------------------------- |
| ![VS Code grammar](gallery/vscode-grammar.png) | ![IntelliJ grammar](gallery/intellij-grammar.png) |

## Sources and capture

The preparation tool reads `root-vscode` and `window-vscode` from `spec/fixtures/hint-view/menu.json`, and `each-kind-vscode` from `spec/fixtures/hint-view/badges.json`. It adds the synthetic unsupported row `Move editor to next pane` (24 characters) before the aliases. Catalogs and original fixtures are unchanged. The Java files in `sample/` are display fixtures, not product code.

VS Code **1.141.0** supplies the real webview and secondary side bar. Its static component gallery uses the same HTML builder, stylesheet and renderer with the captured Dark 2026 tokens. The existing four static renders used Google Chrome **156.0.8078.73**, at scale 1, with zero CSP violations and no viewport overflow. Their appearance has not changed in this revision. The four new context captures are X11 captures of the VS Code window, not the desktop. The state commands update content without revealing the view; only the explicit sandbox setup opens it.

IntelliJ IDEA **2026.2.3 / 262.10968.63** runs through `runIde` in a fresh temporary sandbox. The internal `UI Gallery` action captures the actual docked component and IDE root pane with Swing `printAll`. It uses `themes/islands/ManyIslandsDark.theme.json`, compact mode off, at scale 1. The actual editor scheme is recorded in the metadata. A sandbox JDK configuration prevents unrelated SDK warnings on the synthetic Java project. No personal profile or scheme is copied, and no IdeaVim plugin is loaded.

Metadata: [VS Code theme](gallery/vscode-theme.json), [VS Code components](gallery/vscode-capture.json), [VS Code layouts](gallery/vscode-context.json), [IntelliJ components](gallery/intellij-capture.json), [IntelliJ layouts](gallery/intellij-context.json).

API references: [VS Code webviews](https://code.visualstudio.com/api/extension-guides/webview), [IntelliJ tool window modes](https://www.jetbrains.com/help/idea/viewing-modes.html).

## Reproduce

Use Node 24, pnpm 11, Java 25, VS Code 1.141.0, Google Chrome, Xvfb, xdotool, ImageMagick (`import`), Python 3 with Pillow, and IntelliJ IDEA 2026.2.3. The existing Gradle 9.8.1, IntelliJ Platform plugin 2.19.0 and Kotlin 2.4.21 are unchanged. The IntelliJ build uses the installed IDE and its bundled Java plugin; it never runs Node.

From the repository root:

```bash
# Prepare shared fixture data and the component gallery.
node spec/tools/u1-gallery.mjs
bash spikes/u1/capture-vscode-theme.sh
node spec/tools/u1-gallery.mjs --html
node spec/tools/u1-capture-web.mjs

# Capture real IDE layouts. JAVA_HOME must point to Java 25.
env -u WAYLAND_DISPLAY xvfb-run -a -s '-screen 0 1440x1000x24' \
  node spec/tools/u1-capture-context.mjs
U1_IDEA_HOME="$HOME/.local/share/JetBrains/Toolbox/apps/intellij-idea-ultimate" \
  bash spikes/u1/capture-intellij.sh

node spec/tools/u1-check-images.mjs
# After pushing, check the exact image permalinks.
node spec/tools/u1-check-images.mjs --commit "$(git rev-parse HEAD)"
```

## Remaining work

Review the docked layout and its width cost before expanding to the complete **24 VS Code + 28 IntelliJ** theme/state gallery. IntelliJ prefix and badges now belong in the Leader tab instead of an overlay. The eight full-window layout images are additional review material; they do not replace required theme cells.

Bright and high-contrast themes, compact mode, One Dark 6.2.2, the 170 px and bottom-panel layouts, live input/focus, accessibility, performance and native Wayland/macOS remain unverified. No final U1 approval or verdict is claimed. Each IDE still needs its own final gallery approval in #9 before Phase 3 UI implementation.
