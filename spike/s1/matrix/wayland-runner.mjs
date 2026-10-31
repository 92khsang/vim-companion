import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function buildWaylandRunner(input, source) {
  let code = input;
  const replace = (before, after) => {
    assert.equal(
      code.split(before).length,
      2,
      "native runner hook must be unique: " + before,
    );
    code = code.replace(before, after);
  };
  const sessionUrl = JSON.stringify(
    pathToFileURL(join(source, "matrix/wayland-session.mjs")).href,
  );
  code =
    `import {startWayland} from ${sessionUrl};\nlet nativeSession;\n` + code;
  replace(
    "import {runHangul} from " +
      JSON.stringify(pathToFileURL(join(source, "matrix/hangul.mjs")).href),
    "import {runWayland as runHangul} from " +
      JSON.stringify(pathToFileURL(join(source, "matrix/wayland.mjs")).href),
  );
  const start = code.indexOf("  matrixCheck();\n  const xvfb = spawn(");
  const end = code.indexOf("  let debugPort;", start);
  assert.ok(start > 0 && end > start);
  code =
    code.slice(0, start) +
    `  nativeSession = await startWayland({root,processes,result,until,check:matrixCheck});
  for(const key of Object.keys(environment)) delete environment[key];
  Object.assign(environment,nativeSession.environment);
  result.condition.display="Native Wayland in private GNOME Shell";
  result.condition.layout="kr/kr104; ASCII positions inherit us; Left Control/Shift chords";
  result.nativeSession.ideFlags=["--ozone-platform=wayland","--enable-wayland-ime","--wayland-text-input-version=3"];
` +
    code.slice(end);
  replace(
    'const inject = (keys) =>\n  xdo(["key", "--clearmodifiers", "--delay", String(delayMs), ...keys]);',
    "const inject = (keys) => nativeSession.inject(keys,delayMs);",
  );
  replace(
    '    "dbus-run-session",\n    [\n      "--",\n      code,',
    "    code,\n    [",
  );
  replace(
    '      "--ozone-platform=x11",',
    '      "--ozone-platform=wayland",\n      "--enable-wayland-ime",\n      "--wayland-text-input-version=3",',
  );
  replace(
    '        XDG_RUNTIME_DIR: join(root, "runtime"),\n        XDG_CONFIG_HOME: join(root, "config"),\n        XDG_DATA_HOME: join(root, "xdg-data"),\n        XDG_CACHE_HOME: join(root, "cache"),',
    "        // Inherit the private compositor bus, IBus and XDG paths.",
  );
  const windowStart = code.indexOf("  const window = await until(() => {");
  const windowEnd = code.indexOf(
    '  await call("open", { file });',
    windowStart,
  );
  assert.ok(windowStart > 0 && windowEnd > windowStart);
  code =
    code.slice(0, windowStart) +
    `  const window=String(ide.pid);
  result.nativeSession.focus=await nativeSession.focus(ide.pid);
` +
    code.slice(windowEnd);
  replace(
    "    await runHangul({result,call,inject,settled,noPending,save,text,observer:matrixObserver,",
    "    await runHangul({result,call,inject,settled,noPending,save,text,observer:matrixObserver,native:nativeSession,until,check:matrixCheck,",
  );
  replace(
    '  console.log("Sandbox ready; proving 1000 probe keys.");',
    `  result.nativeSession.preDeliveryWarmup={before:nativeSession.state(),snapshot:await call("snapshot")};
  if(!result.nativeSession.preDeliveryWarmup.before.inputMode){
    inject(["i"]);
    await until(async()=>(await call("snapshot")).mode===1,"native IME warmup did not enter Insert");
    result.nativeSession.preDeliveryWarmup.insert=await until(()=>{const value=nativeSession.state();return value.inputMode && value;},"IBus properties never appeared in the editor",10000);
    inject(["Escape"]);await settled();
  }
  result.nativeSession.beforeDelivery=await until(()=>{const value=nativeSession.state();return value.inputMode && value;},"IBus properties unavailable before delivery",10000);
  assert.equal(result.nativeSession.beforeDelivery.source,"ibus:hangul");
  assert.equal(result.nativeSession.beforeDelivery.inputMode?.symbol,"EN");
  console.log("Sandbox ready; proving 1000 native probe keys.");`,
  );
  replace(
    "  result.cleanup = await terminateOwned(ownedIdentities(processes));",
    "  result.cleanup = await terminateOwned(ownedIdentities(processes));\n  if(nativeSession){result.nativeCleanup=nativeSession.stop();if(result.nativeCleanup.remaining.length||result.nativeCleanup.errors.length){result.cleanupError='private Wayland services were not fully stopped';process.exitCode=1;if(result.status!=='discrepancy')result.status='harness-error';}}",
  );
  return code;
}
