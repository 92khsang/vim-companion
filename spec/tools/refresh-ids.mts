// pnpm ids:refresh vscode|intellij (design §8): rewrites ids/<ide>.json of the spec directory from
// the IDE installed on this machine. Exits 2 when it cannot run.
//   vscode   [--code <binary>] [--extension <publisher.name>]... [--drop-extension <publisher.name>]...
//   intellij [--ide-home <dir>] [--plugins-dir <dir>] [--plugin <dir or .jar>]... [--drop-plugin <name>]...
// --root <dir>: the spec directory to write to; by default the one this file is in.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

type Ide = "vscode" | "intellij";

const OPTIONS = {
  root: { type: "string" },
  code: { type: "string" },
  extension: { type: "string", multiple: true },
  "drop-extension": { type: "string", multiple: true },
  "ide-home": { type: "string" },
  "plugins-dir": { type: "string" },
  plugin: { type: "string", multiple: true },
  "drop-plugin": { type: "string", multiple: true },
} as const;

/** The IDE that each option other than --root belongs to. */
const OWNER: Record<string, Ide> = {
  code: "vscode",
  extension: "vscode",
  "drop-extension": "vscode",
  "ide-home": "intellij",
  "plugins-dir": "intellij",
  plugin: "intellij",
  "drop-plugin": "intellij",
};

type Values = ReturnType<typeof parseOptions>["values"];

function parseOptions() {
  return parseArgs({ options: OPTIONS, allowPositionals: true });
}

function main(): void {
  const { values, positionals } = parseOptions();
  const [ide, ...rest] = positionals;
  if ((ide !== "vscode" && ide !== "intellij") || rest.length > 0) {
    throw new Error("name the IDE to refresh: vscode or intellij");
  }
  for (const name of Object.keys(values)) {
    const owner = OWNER[name];
    if (owner !== undefined && owner !== ide) {
      throw new Error(`--${name} is an option of ${owner}, not ${ide}`);
    }
  }
  if (ide === "vscode") refreshVscode(values);
  else refreshIntellij(values);
}

function refreshVscode(values: Values): void {
  const code = resolve(values.code ?? "/usr/share/code/code");
  readJson(join(dirname(code), "resources/app/package.json"));
}

function refreshIntellij(values: Values): void {
  const ideHome = resolve(
    values["ide-home"] ??
      join(
        homedir(),
        ".local/share/JetBrains/Toolbox/apps/intellij-idea-ultimate",
      ),
  );
  readJson(join(ideHome, "product-info.json"));
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

try {
  main();
} catch (error) {
  console.error(`ids:refresh: ${(error as Error).message}`);
  process.exitCode = 2;
}
