import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";

const specDir = join(import.meta.dirname, "..");
const cli = join(specDir, "tools/refresh-ids.mts");
const base = mkdtempSync(join(tmpdir(), "refresh-ids-"));
// The runs never see the real home directory.
const home = join(base, "home");
mkdirSync(home);

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

function refresh(...args: string[]) {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    [cli, ...args],
    { encoding: "utf8", env: { ...process.env, HOME: home } },
  );
  return { status, stdout, stderr };
}

/** A run that could not refresh: exit 2, nothing on stdout, an ids:refresh message with `text`. */
function cannotRun(text: string) {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    status: 2,
    stdout: "",
    stderr: expect.stringMatching(new RegExp(`^ids:refresh: .*${escaped}`)),
  };
}

describe("ids:refresh", () => {
  test("exits 2 with a message when it cannot run", () => {
    const root = join(base, "cannot-run", "spec");
    const nowhere = join(base, "nowhere");
    const usage = {
      status: 2,
      stdout: "",
      stderr: "ids:refresh: name the IDE to refresh: vscode or intellij\n",
    };
    expect([
      refresh(),
      refresh("emacs"),
      refresh("vscode", "intellij"),
      refresh("vscode", "--plugin", "IdeaVIM"),
      refresh("intellij", "--extension", "vscodevim.vim"),
      refresh("vscode", "--codes", "code"),
      refresh("vscode", "--root", root, "--code", join(nowhere, "code")),
      refresh("intellij", "--root", root, "--ide-home", nowhere),
    ]).toEqual([
      usage,
      usage,
      usage,
      {
        status: 2,
        stdout: "",
        stderr: "ids:refresh: --plugin is an option of intellij, not vscode\n",
      },
      {
        status: 2,
        stdout: "",
        stderr:
          "ids:refresh: --extension is an option of vscode, not intellij\n",
      },
      cannotRun("'--codes'"),
      cannotRun(join(nowhere, "resources/app/package.json")),
      cannotRun(join(nowhere, "product-info.json")),
    ]);
  });
});
