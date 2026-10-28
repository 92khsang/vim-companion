# U1: first UI direction

**Initial review only. No IDE approval or U1 verdict has been recorded.**

This throwaway spike covers one direction in one theme per IDE: VS Code **Dark 2026** and IntelliJ **Islands Dark**, compact mode off. It is not Phase 3 product code and must not be merged. The complete acceptance criteria remain in [U1 #15](https://github.com/92khsang/vim-companion/issues/15).

Open [the comparison gallery](gallery/index.html) locally for a side-by-side review. The eight images are also embedded below for GitHub review.

## Design decisions for review

- Keycaps, command names and group chevrons form the main hierarchy. The prefix stays visible above the group name.
- Visual mode and the count appear as separate chips. The UI observes and explains; it owns no editor keys.
- Every exception has an icon and a text label. Badges sit below the command name so they do not compete with long labels.
- Both IDEs use the same fixture rows. The badge state shows seven rows and `+2 more`; the two alias rows remain in the data. This is a static overflow illustration, not an implemented expansion interaction.
- The Doctor banner is an illustrative one-conflict scenario. No live diagnostic was run.
- Grammar is a static operator-and-motion reference card. It makes no claim about S2 input observation or tier qualification.
- IntelliJ uses native Swing tabs for Leader and Grammar. Its overlay is shown in a neutral frame; S3's selected `POPUP_LAYER` host is not exercised here.

## Gallery

### Idle

| VS Code: Keys view                       | IntelliJ: Leader tab                        |
| ---------------------------------------- | ------------------------------------------- |
| ![VS Code idle](gallery/vscode-idle.png) | ![IntelliJ idle](gallery/intellij-idle.png) |

### Prefix

| VS Code: `SPC › w`                           | IntelliJ: neutral overlay                       |
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

The Node preparation tool reads `root-vscode` and `window-vscode` from `spec/fixtures/hint-view/menu.json`, and `each-kind-vscode` from `spec/fixtures/hint-view/badges.json`. It adds the synthetic unsupported row `Move editor to next pane` (24 characters) before the alias rows. Both renderers consume that one prepared data set; the catalogs and original fixtures are unchanged.

The VS Code spike is a real `WebviewViewProvider`. The extension and static pages use the same HTML builder, CSS and renderer. A fresh VS Code **1.141.0** sandbox captures theme variables from the secondary side bar's webview. Its measured content width is **289 CSS px** at scale **1**; this is the webview content width, not the entire side bar including workbench chrome. The capture runs on a **1440×1000** Xvfb screen. The preliminary PNG viewports use heights of **580 px**, or **820 px** for badges. Full IDE window geometry and a bottom-panel theme capture are deferred to the complete gallery.

Headless **Google Chrome 156.0.8078.73** renders the four static pages at scale **1**, with the captured side bar background. Each page uses a nonce-based script CSP and external stylesheets. The capture records CSP violations from before the renderer loads. The four final captures reported **0 CSP events** and no viewport overflow. These checks are capture sanity checks, not the Phase 3 acceptance suite.

The Swing prototype runs through `runIde` in a fresh sandbox, using the installed IntelliJ IDEA **2026.2.3 / 262.10968.63**. Its internal `UI Gallery` action draws real Swing components in neutral frames and exports each displayed component with `printAll`, at scale **1**. The theme resource is `themes/islands/ManyIslandsDark.theme.json`. The actual editor scheme is recorded in [the capture metadata](gallery/intellij-capture.json); no personal theme or scheme is copied. The plugin has no IdeaVim dependency and sends no key.

Metadata: [VS Code theme](gallery/vscode-theme.json), [VS Code renders](gallery/vscode-capture.json), [IntelliJ renders](gallery/intellij-capture.json).

API references consulted: [VS Code webview security and theme variables](https://code.visualstudio.com/api/extension-guides/webview), [IntelliJ local platform dependency](https://plugins.jetbrains.com/docs/intellij/tools-intellij-platform-gradle-plugin-faq.html).

## Reproduce this direction

Use the repository's Node 24 and pnpm 11, Java 25, VS Code 1.141.0, Google Chrome, Xvfb and IntelliJ IDEA 2026.2.3. The image checker uses Python 3 and Pillow to decode PNGs. Gradle 9.8.1, the IntelliJ Platform plugin 2.19.0 and Kotlin 2.4.21 follow the existing spike toolchain. No browser automation package is required.

From the repository root:

```bash
node spec/tools/u1-gallery.mjs
bash spikes/u1/capture-vscode-theme.sh
node spec/tools/u1-gallery.mjs --html
node spec/tools/u1-capture-web.mjs

# JAVA_HOME must point to Java 25. U1_IDEA_HOME points to the installed IDE.
U1_IDEA_HOME="$HOME/.local/share/JetBrains/Toolbox/apps/intellij-idea-ultimate" \
  bash spikes/u1/capture-intellij.sh

node spec/tools/u1-check-images.mjs

# After pushing, verify the eight image URLs at the exact reviewed commit.
node spec/tools/u1-check-images.mjs --commit "$(git rev-parse HEAD)"
```

The IDE scripts use temporary profiles/projects and Xvfb; they do not open the user's project or edit personal IDE settings. The IntelliJ Gradle build consumes the already prepared JSON and never runs Node. Set `U1_CHROME` to use a different Chromium executable; the resulting version is recorded.

## Remaining work

Review the hierarchy, density, badge placement and grammar card independently for each IDE. A response to this first direction is not the final U1 approval.

After the direction is accepted, finish the **24 VS Code + 28 IntelliJ** theme/size gallery in #15, including the narrow and bottom-panel states, both high-contrast themes, compact mode, and One Dark 6.2.2. Capture the remaining environment metadata and verify the final image permalinks. Only then request and record each IDE's approval in #9. No input, focus, timing, accessibility, performance or production UI acceptance claim is made by this spike.
