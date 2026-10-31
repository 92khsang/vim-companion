import assert from "node:assert/strict";
import test from "node:test";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

test("real DOM updates preserve the selected tab/topic, ignore stale revisions and restore reference state", () => {
  const directory = mkdtempSync(join(tmpdir(), "s1-dock-renderer-"));
  cpSync(new URL("web", import.meta.url), join(directory, "web"), {
    recursive: true,
  });
  writeFileSync(
    join(directory, "test.html"),
    `<!doctype html><html><head><meta charset="utf-8"></head>
<body data-instance="1"><main id="keys"></main><pre id="result">pending</pre>
<script>
const messages = [];
let saved = {tab:'vim', topic:'objects'};
window.acquireVsCodeApi = () => ({ getState:()=>saved, setState:(value)=>saved=value, postMessage:(value)=>messages.push(value) });
</script>
<script src="web/reference.js"></script><script src="web/state.js"></script><script src="web/renderer.js"></script>
<script>
try {
  const check = (value, label) => { if(!value) throw new Error(label); };
  const token = messages.find(m=>m.type==='s1-ready').instance;
  const send = (revision, phase, prefix=[]) => window.dispatchEvent(new MessageEvent('message', {data:{type:'s1-state', instance:token,state:{revision,phase,session:phase==='idle'?null:1,prefix}}}));
  const last = () => messages.filter(m=>m.type==='s1-applied').at(-1);
  check(last().tab==='vim' && last().topic==='objects', 'restore reference selection');
  send(2,'active',['w']);
  check(last().leaderText.includes('Focus left group'), 'live window prefix');
  check(last().tab==='vim' && last().topic==='objects', 'input changed selection');
  check(!last().leaderText.includes('Visual') && !last().leaderText.includes('×3'), 'fixture chips');
  const count=messages.length;
  send(1,'active',[]);
  check(messages.length===count,'stale prefix rendered');
  send(3,'idle');
  check(!last().leaderText.includes('SPC') && last().leaderText.includes('no active prefix'),'cleanup');
  send(2,'active',['w']);
  check(last().phase==='idle','stale revival');
  check(saved.tab==='vim' && saved.topic==='objects','transient state overwrote preferences');
  document.querySelectorAll('.tab')[0].click();
  check(last().tab==='leader' && last().topic==='objects','tab switch changed topic');
  check(document.querySelector('section').hidden===false,'leader hidden');
  document.querySelector('#result').textContent='passed';
} catch(error) { document.querySelector('#result').textContent='failed: '+error.message; }
</script></body></html>`,
  );
  const output = execFileSync(
    process.env.S1_CHROME ?? "/usr/bin/google-chrome",
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--user-data-dir=" + join(directory, "profile"),
      "--dump-dom",
      "file://" + join(directory, "test.html"),
    ],
    { encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "ignore"] },
  );
  assert.match(output, /<pre id="result">passed<\/pre>/);
});
