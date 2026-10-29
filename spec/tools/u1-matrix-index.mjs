// Keep the matrix inventory, evidence and review links together without duplicating baseline images.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  states,
  vscodeThemes,
  vscodeCases,
  intellijConditions,
  intellijCases,
} from "./u1-matrix.mjs";
const root = fileURLToPath(new URL("../../spikes/u1/", import.meta.url));
const gallery = join(root, "gallery");
const read = (name) => JSON.parse(readFileSync(join(gallery, name), "utf8"));
const conditions = intellijConditions.map((condition) => {
  const capture = read(`intellij-${condition.id}.json`);
  assert.equal(capture.theme, condition.theme);
  assert.equal(capture.compactMode, condition.compact);
  assert.equal(capture.uiDensity, condition.compact ? "COMPACT" : "DEFAULT");
  assert.equal(capture.logSevereCount, 0);
  assert.equal(capture.awtToolkit, "sun.awt.X11.XToolkit");
  assert.equal(capture.backgroundWriteActionProperty, "false");
  const badges = capture.captures.find(
    (item) => item.state === "badges",
  ).badgeChecks;
  assert.equal(badges.length, 5);
  assert.ok(badges.every((item) => item.contrast >= 4.5));
  assert.deepEqual(
    capture.captures.map((item) => item.state).sort(),
    [...states].sort(),
  );
  return capture;
});
const native = {
  conditions: conditions.map(({ captures, ...metadata }) => metadata),
  captures: conditions.flatMap((condition) =>
    condition.captures.map((capture) => ({
      ...capture,
      condition: condition.condition,
      theme: condition.theme,
      compactMode: condition.compactMode,
      editorScheme: condition.editorScheme,
      themeResource: condition.themeResource,
    })),
  ),
};
assert.equal(native.captures.length, 28);
writeFileSync(
  join(gallery, "intellij-matrix.json"),
  JSON.stringify(native, null, 2) + "\n",
);
const web = read("vscode-matrix.json");
assert.deepEqual(
  web.captures.map((item) => item.file).sort(),
  vscodeCases.map((item) => `${item.name}.png`).sort(),
);
assert.equal(web.captures.length, 24);
assert.ok(web.captures.every((item) => item.violations.length === 0));
let markdown = `## Required theme and size gallery\n\nMeasured: the required matrix contains **24 VS Code renders and 28 IntelliJ screenshots**. The eight default dark-theme cells above also belong to this matrix; they are embedded once. Together with the 20 supplementary Vim/context images, this index contains **72 unique images**. The current layout and content approval remains recorded; final approval of this complete gallery is pending for each IDE.\n\nMetadata: [VS Code matrix](gallery/vscode-matrix.json), [IntelliJ matrix](gallery/intellij-matrix.json).\n\n`;
let html = `<section id="matrix"><div class="section-title"><span>MATRIX</span><div><h2>Themes and constrained space</h2><p>24 VS Code renders and 28 IntelliJ screenshots. Default dark cells appear above. All images are from sandbox fixtures; click a label to open the full image.</p></div></div>`;
for (const theme of vscodeThemes) {
  markdown += `### VS Code · ${theme.name}\n\n`;
  html += `<h3>VS Code · ${theme.name}</h3><div class="matrix-grid">`;
  for (const cell of vscodeCases.filter((item) => item.theme === theme.id)) {
    const capture = web.captures.find(
      (item) => item.file === `${cell.name}.png`,
    );
    const label = `${cell.state} · ${cell.size} · ${capture.width} × ${capture.height}`;
    if (theme.id === "dark" && cell.size === "default") continue;
    markdown += `**${label}**\n\n![VS Code ${theme.name}, ${label}](gallery/${cell.name}.png)\n\n`;
    html += `<figure${cell.size === "bottom" ? ' class="matrix-wide"' : ""}><figcaption><a href="${cell.name}.png">${label}</a></figcaption><img loading="lazy" src="${cell.name}.png" alt="VS Code ${theme.name}, ${label}" /></figure>`;
  }
  html += `</div>`;
}
markdown += `### IntelliJ condition evidence\n\n| Theme | Compact | Theme resource | Actual editor scheme | Captured size |\n| --- | --- | --- | --- | --- |\n`;
for (const c of conditions)
  markdown += `| ${c.theme} | ${c.compactMode ? "On" : "Off"} | \`${c.themeResource}\` | \`${c.editorScheme}\` | ${c.captures[0].width} × ${c.captures[0].height} |\n`;
markdown += `\nOne Dark uses plugin 6.2.2, the exact \`One Dark\` theme and its declared \`/one_dark.xml\` scheme in a fresh sandbox. No personal scheme is copied.\n\n`;
for (const condition of intellijConditions) {
  if (condition.id === "islands-dark-normal") continue;
  const label = `${condition.theme} · compact ${condition.compact ? "on" : "off"}`;
  markdown += `### IntelliJ · ${label}\n\n`;
  html += `<h3>IntelliJ · ${label}</h3><div class="matrix-grid">`;
  for (const cell of intellijCases.filter((item) => item.id === condition.id)) {
    markdown += `**${cell.state}**\n\n![IntelliJ ${label}, ${cell.state}](gallery/${cell.name}.png)\n\n`;
    html += `<figure><figcaption><a href="${cell.name}.png">${cell.state}</a></figcaption><img loading="lazy" src="${cell.name}.png" alt="IntelliJ ${label}, ${cell.state}" /></figure>`;
  }
  html += `</div>`;
}
html += `</section>`;
function replaceSection(path, content) {
  const start = "<!-- U1 MATRIX START -->",
    end = "<!-- U1 MATRIX END -->";
  const source = readFileSync(path, "utf8");
  const block = `${start}\n${content}\n${end}`;
  if (source.includes(start))
    writeFileSync(
      path,
      source.slice(0, source.indexOf(start)) +
        block +
        source.slice(source.indexOf(end) + end.length),
    );
  else if (path.endsWith(".md"))
    writeFileSync(
      path,
      source.replace(
        "## Sources and capture",
        `${block}\n\n## Sources and capture`,
      ),
    );
  else
    writeFileSync(path, source.replace("    </main>", `${block}\n    </main>`));
}
replaceSection(join(root, "README.md"), markdown);
replaceSection(join(gallery, "index.html"), html);
console.log(
  "Indexed the complete 24+28 matrix; retained all supplementary review cells.",
);
