import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export function focusProbe(source) {
  const header = 'const vscode = require("vscode");',
    methods = "  const methods = {";
  assert.equal(source.split(header).length, 2);
  assert.equal(source.split(methods).length, 2);
  return source
    .replace(
      header,
      header +
        '\nconst {createFocusProbe}=require("./matrix-focus-probe.cjs");',
    )
    .replace(
      methods,
      `  const focus=createFocusProbe(vscode,context);
  const methods = {
    focusSetup:(parameters)=>focus.setup(parameters),
    focusState:()=>focus.state(),
    focusProviders:()=>focus.providers(),`,
    );
}

export function focusManifest(manifest, catalog) {
  manifest.contributes.commands ??= [];
  const predicate =
    "vim.mode =~ /^(Normal|Visual)/ && (editorTextFocus || !inputFocus)";
  for (const [capture, condition] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])
    manifest.contributes.keybindings.push({
      key: "ctrl+alt+0",
      command: "s1.focus.sentinel",
      args: { capture, predicate: condition },
      when:
        [
          capture ? "vimCompanion.leaderActive" : "",
          condition ? `(${predicate})` : "",
        ]
          .filter(Boolean)
          .join(" && ") || "true",
    });
  const keys = [
    ...new Set(["space", ...catalog.leaves.flatMap((leaf) => leaf.keys)]),
  ];
  for (const key of keys) {
    const argument = key === "/" ? "slash" : key;
    if (
      !manifest.contributes.keybindings.some(
        (binding) => binding.key === key && binding.when === "s1.delivery",
      )
    )
      manifest.contributes.keybindings.push({
        key,
        command: "s1.deliveryKey",
        args: argument,
        when: "s1.delivery",
      });
  }
  manifest.contributes.commands.push({
    command: "s1.focus.sentinel",
    title: "S1 focus predicate sentinel",
  });
  return manifest;
}

export function installFocusProviders(source, extensions) {
  const artifacts = {};
  for (const name of ["primary", "secondary"]) {
    const folder = "vim-companion-spike.s1-focus-" + name + "-0.0.0";
    const root = join(extensions, folder);
    mkdirSync(root);
    const manifest = {
      name: "s1-focus-" + name,
      publisher: "vim-companion-spike",
      version: "0.0.0",
      displayName: "S1 " + name + " provider",
      engines: { vscode: "^1.134.0" },
      main: "./focus-provider.cjs",
      activationEvents: ["onLanguage:s1-focus"],
      contributes: {
        ...(name === "primary"
          ? { languages: [{ id: "s1-focus", extensions: [".s1focus"] }] }
          : {}),
        commands: ["configure", "events"].map((id) => ({
          command: "s1.focus." + name + "." + id,
          title: "S1 provider " + id,
        })),
      },
    };
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify(manifest, null, 2),
    );
    for (const file of [
      "focus-provider.cjs",
      "focus-server.cjs",
      "lsp-framing.cjs",
    ])
      writeFileSync(
        join(root, file),
        readFileSync(join(source, "matrix", file)),
      );
    for (const file of [
      "package.json",
      "focus-provider.cjs",
      "focus-server.cjs",
      "lsp-framing.cjs",
    ])
      artifacts[folder + "/" + file] = createHash("sha256")
        .update(readFileSync(join(root, file)))
        .digest("hex");
  }
  return artifacts;
}
