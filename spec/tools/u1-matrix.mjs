// U1's required theme/size cells; supplementary Vim and editor-context cells stay separate.
export const states = ["idle", "prefix", "badges", "grammar"];
export const vscodeThemes = [
  { id: "dark", name: "Dark 2026", colorScheme: "dark" },
  { id: "light", name: "Light 2026", colorScheme: "light" },
  { id: "hc-dark", name: "Default High Contrast", colorScheme: "dark" },
  { id: "hc-light", name: "Default High Contrast Light", colorScheme: "light" },
];
export const vscodeFixture = (id, host = "sidebar") =>
  host === "panel"
    ? `vscode-theme-${id}-panel.json`
    : id === "dark"
      ? "vscode-theme.json"
      : `vscode-theme-${id}.json`;
export const vscodeCases = vscodeThemes.flatMap((theme) => [
  ...states.map((state) => ({
    theme: theme.id,
    state,
    host: "sidebar",
    size: "default",
    name:
      theme.id === "dark" ? `vscode-${state}` : `vscode-${theme.id}-${state}`,
    height: state === "badges" ? 820 : 640,
  })),
  {
    theme: theme.id,
    state: "badges",
    host: "sidebar",
    size: "narrow",
    name: `vscode-${theme.id}-narrow`,
    width: 170,
    height: 1100,
  },
  {
    theme: theme.id,
    state: "badges",
    host: "panel",
    size: "bottom",
    name: `vscode-${theme.id}-bottom`,
    width: 1200,
    height: 150,
  },
]);
export const intellijConditions = [
  { id: "islands-light-normal", theme: "Islands Light", compact: false },
  { id: "islands-light-compact", theme: "Islands Light", compact: true },
  { id: "islands-dark-normal", theme: "Islands Dark", compact: false },
  { id: "islands-dark-compact", theme: "Islands Dark", compact: true },
  { id: "high-contrast-normal", theme: "High Contrast", compact: false },
  { id: "high-contrast-compact", theme: "High Contrast", compact: true },
  { id: "one-dark-compact", theme: "One Dark", compact: true },
];
export const intellijCases = intellijConditions.flatMap((condition) =>
  states.map((state) => ({
    ...condition,
    state,
    name:
      condition.id === "islands-dark-normal"
        ? `intellij-${state}`
        : `intellij-${condition.id}-${state}`,
  })),
);
