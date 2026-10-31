import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function resourceErrors(root) {
  const files = [
    ...new Set([
      ...globSync("code.log", { cwd: root }),
      ...globSync("cold/**/code.log", { cwd: root }),
      ...globSync("data/logs/**/*.log", { cwd: root }),
      ...globSync("portable/user-data/logs/**/*.log", { cwd: root }),
      ...globSync("gnome/log/*.log", { cwd: root }),
    ]),
  ];
  const errors = [];
  for (const file of files) {
    const lines = readFileSync(join(root, file), "utf8").split("\n");
    for (const [index, line] of lines.entries())
      if (/\b(?:EMFILE|ENOSPC)\b|inotify_init[^\n]*failed/i.test(line))
        errors.push({
          file,
          line: index + 1,
          text: line.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 1000),
        });
  }
  return {
    inspectedFiles: files,
    limits: Object.fromEntries(
      ["max_user_instances", "max_user_watches"].map((name) => [
        name,
        Number(readFileSync("/proc/sys/fs/inotify/" + name, "utf8")),
      ]),
    ),
    errors,
  };
}
