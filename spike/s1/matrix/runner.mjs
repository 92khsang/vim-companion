import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

export const versions = {
  "1.134.0": "110a328ea54b42367b803ec53ee0bf52ef26b419",
  "1.141.0": "2a59476c9bfc",
};

export function buildMatrixRunner(baseline, source, options, boundedUrl) {
  assert.ok(Object.hasOwn(versions, options.version));
  assert.ok(["same", "separate"].includes(options.affinity));
  assert.ok(
    [
      "entry-exit",
      "cancel",
      "native",
      "native-baseline",
      "query",
      "count",
      "visual",
      "visual-baseline",
      "fault",
      "vb-entry",
      "vb-pause",
      "hangul",
      "restart",
      "cold",
      "focus",
    ].includes(options.row ?? "entry-exit"),
  );
  assert.equal(typeof options.editContext, "boolean");
  let code = baseline.toString();
  const replace = (before, after) => {
    assert.equal(
      code.split(before).length,
      2,
      "matrix runner hook must be unique: " + before,
    );
    code = code.replace(before, after);
  };
  // Imports and resource paths in this temporary runner still point to the
  // retained source tree. Existing entrypoints and guards are never rewritten.
  code = code.replace(
    /from "(\.\/[^\"]+)"/g,
    (_match, path) =>
      "from " + JSON.stringify(pathToFileURL(join(source, path)).href),
  );
  replace(
    "const source = import.meta.dirname;",
    "const source = " + JSON.stringify(source) + ";",
  );
  code =
    `import { installMatrix } from ${JSON.stringify(pathToFileURL(join(source, "matrix/install.mjs")).href)};\nconst matrixOptions = ${JSON.stringify(options)};\n` +
    code;
  code =
    `import { connectMatrixObserver, clockSamples } from ${JSON.stringify(pathToFileURL(join(source, "matrix/observer.mjs")).href)};\nlet matrixObserver;\n` +
    code;
  code =
    `import {resourceErrors} from ${JSON.stringify(pathToFileURL(join(source, "matrix/resource-errors.mjs")).href)};\n` +
    code;
  replace(
    "  result.product = {",
    '  assert.ok(!result.product.target,"version-pinned binary must support portable mode");\n  result.product = {',
  );
  replace(
    '  const data = join(root, "data");',
    '  const portable = join(root,"portable");\n  const data = join(portable,"user-data");',
  );
  replace(
    '  cpSync(vim, join(extensions, "vscodevim.vim-1.32.4"), { recursive: true });',
    `  result.sandboxIsolation={portable,data,argv:matrixOptions.accessibility === "on" ? {"force-renderer-accessibility":true} : {}};
  writeFileSync(join(portable,"argv.json"),JSON.stringify(result.sandboxIsolation.argv,null,2)+"\\n");
  cpSync(vim, join(extensions, "vscodevim.vim-1.32.4"), { recursive: true });`,
  );
  replace(
    "        S1_SOCKET: socketPath,",
    "        S1_SOCKET: socketPath,\n        VSCODE_PORTABLE: portable,",
  );
  replace(
    '  result.hello = await call("hello");',
    `  result.hello = await call("hello");
  assert.equal(result.hello.sandbox.portable,portable,"portable mode was not retained in the extension host");
  assert.ok(result.hello.sandbox.globalStorage.startsWith(data+"/"),"storage escaped the owned portable data directory");`,
  );
  replace(
    "  console.log(`Delivery proved; checking ${gate} at ${delayMs} ms.`);",
    `  result.resourcePreflight=resourceErrors(root);
  save();
  assert.equal(result.resourcePreflight.errors.length,0,"sandbox resource errors invalidate the measurement environment");
  console.log(\`Delivery proved; checking \${gate} at \${delayMs} ms.\`);`,
  );
  replace(
    "  if (visualDiagnostic) {\n    const reservation",
    "  if (matrixOptions.observe) {\n    const reservation",
  );
  replace(
    "      ...(visualDiagnostic\n        ? [",
    "      ...(matrixOptions.observe\n        ? [",
  );
  replace(
    '  result.initial = await call("warm");',
    `  result.initial = await call("warm");
  if (matrixOptions.observe) {
    matrixObserver = await connectMatrixObserver({port: debugPort, until});
    result.matrix.renderer = matrixObserver.metadata;
    result.matrix.clocksBefore = {
      renderer: await clockSamples(() => matrixObserver.clock()),
      hosts: await clockSamples(() => call("clock")),
    };
  }`,
  );
  replace(
    "      let phaseDelayMs = 0;",
    "      const rendererBefore = await matrixObserver.begin();\n      let phaseDelayMs = 0;",
  );
  replace(
    "      const sentinel = await settled();\n      const errors = [];",
    "      const sentinel = await settled();\n      const rendererAfter = await matrixObserver.read();\n      const errors = [];",
  );
  replace(
    "        phaseDelayMs,\n        injectedAt,",
    "        phaseDelayMs,\n        renderer: { before: rendererBefore, after: rendererAfter },\n        injectedAt,",
  );
  replace(
    '  result.loadWindows = await call("loadWindows");',
    `  result.loadWindows = await call("loadWindows");
  if (matrixObserver) result.matrix.clocksAfter = {
    renderer: await clockSamples(() => matrixObserver.clock()),
    hosts: await clockSamples(() => call("clock")),
  };`,
  );
  replace(
    "  observer?.close();",
    "  observer?.close();\n  matrixObserver?.close();",
  );
  replace(
    '    "entry-exit",\n    "cancel",',
    '    "entry-exit",\n    "query",\n    "count",\n    "visual",\n    "visual-baseline",\n    "fault",\n    "vb-entry",\n    "vb-pause",\n    "hangul",\n    "restart",\n    "cold",\n    "cancel",',
  );
  code =
    `import { runQuery } from ${JSON.stringify(pathToFileURL(join(source, "matrix/query.mjs")).href)};\n` +
    code;
  replace(
    '  } else if (gate !== "entry-exit") {',
    `  } else if (gate === "query") {
    await runQuery({result, call, inject, settled, noPending, save, text, observer: matrixObserver,
      phase: async () => {
        if (!loaded) return 0;
        phaseSeed = (Math.imul(1664525, phaseSeed) + 1013904223) >>> 0;
        const delay = phaseSeed % 100;
        await sleep(delay);
        return delay;
      },
    });
  } else if (gate !== "entry-exit") {`,
  );
  replace(
    "  processes.push(ide);",
    `  processes.push(ide);
  result.matrix.ideLauncher = {pid: ide.pid};
  ide.once("spawn", () => { result.matrix.ideLauncher.started = new Date().toISOString(); });
  ide.once("exit", (code, signal) => { result.matrix.ideLauncher.finished = new Date().toISOString(); result.matrix.ideLauncher.exit = {code, signal}; });`,
  );
  replace(
    "  result.finished = new Date().toISOString();\n  save();",
    "  // Save only after the owned IDE launcher has exited.",
  );
  replace(
    "  console.log(`Saved ${output}; sandbox logs retained at ${root}`);",
    `  if (result.matrix?.ideLauncher) {
    const cleanupDeadline = Date.now() + 5000;
    while (!result.matrix.ideLauncher.finished && Date.now() < cleanupDeadline) await sleep(25);
    if (!result.matrix.ideLauncher.finished) {
      result.cleanupError = "IDE launcher did not exit within five seconds";
      result.status = "harness-error";
      process.exitCode = 1;
    }
  }
  result.finished = new Date().toISOString();
  save();
  console.log(\`Saved \${output}; sandbox logs retained at \${root}\`);`,
  );
  replace(
    "  result.finished = new Date().toISOString();\n  save();",
    `  result.resourceFinal=resourceErrors(root);
  if(result.resourceFinal.errors.length){result.environmentInvalid=true;process.exitCode=1;if(result.status!=="discrepancy")result.status="harness-error";}
  result.finished = new Date().toISOString();
  save();`,
  );
  replace(
    '      readFileSync(join(source, "probe/package.json"), "utf8"),',
    '      readFileSync(join(extensions, "vim-companion-spike.s1-probe-0.0.0/package.json"), "utf8"),',
  );
  replace(
    '  const pattern =\n    gate === "entry-exit"',
    '  const pattern = gate === "count" ? ["3", "space", "b", "n", "j"] :\n    gate === "entry-exit"',
  );
  code =
    `import { runCount } from ${JSON.stringify(pathToFileURL(join(source, "matrix/count.mjs")).href)};\n` +
    code;
  replace(
    '  } else if (gate === "query") {\n    await runQuery({result, call, inject, settled, noPending, save, text, observer: matrixObserver,',
    '  } else if (["query", "count"].includes(gate)) {\n    await (gate === "count" ? runCount : runQuery)({result, call, inject, settled, noPending, save, text, workspace, file, observer: matrixObserver,',
  );
  replace(
    'const baseline = gate === "native-baseline";',
    'const baseline = ["native-baseline", "visual-baseline", "vb-entry", "vb-pause"].includes(gate);',
  );
  code =
    `import { runVisual } from ${JSON.stringify(pathToFileURL(join(source, "matrix/visual.mjs")).href)};\n` +
    code;
  replace(
    '  } else if (["query", "count"].includes(gate)) {',
    `  } else if (["visual", "visual-baseline"].includes(gate)) {
    await runVisual({result,call,inject,settled,noPending,save,referencePath,
      phase:async()=>{
        if(!loaded)return 0;
        phaseSeed=(Math.imul(1664525,phaseSeed)+1013904223)>>>0;
        const delay=phaseSeed%100;await sleep(delay);return delay;
      },
    });
  } else if (["query", "count"].includes(gate)) {`,
  );
  replace(
    `  if (baseline) {
    const path = join(
      extensions,
      "vim-companion-spike.s1-probe-0.0.0/package.json",
    );
    const probeManifest = JSON.parse(readFileSync(path, "utf8"));
    probeManifest.extensionDependencies = ["vscodevim.vim"];
    writeFileSync(path, JSON.stringify(probeManifest));
  }`,
    "  // The matrix installer finalizes dependencies before recording hashes.",
  );
  code =
    `import {recordOwned,readOwned,ownedIdentities,terminateOwned} from ${JSON.stringify(pathToFileURL(join(source, "matrix/lifecycle.mjs")).href)};\nlet matrixAbortReason;\n` +
    code;
  replace(
    "const processes = [];",
    `const processes = [];
function matrixCheck() { if(matrixAbortReason) throw new Error("matrix aborted: "+matrixAbortReason.message); }
function matrixAbort(reason) {
  matrixAbortReason ??= reason;
  result.abort = matrixAbortReason;
  save();
  pending?.reject(new Error("matrix aborted: "+reason.message));
}
for(const signal of ["SIGINT","SIGTERM"]) process.on(signal,()=>matrixAbort({kind:"signal",message:signal}));
process.on("uncaughtException",(error)=>matrixAbort({kind:"error",message:String(error)}));
process.on("unhandledRejection",(error)=>matrixAbort({kind:"error",message:String(error)}));`,
  );
  replace(
    "async function call(method, params = {}) {",
    "async function call(method, params = {}) {\n  matrixCheck();",
  );
  replace(
    "    last = await fn();",
    "    matrixCheck();\n    last = await fn();",
  );
  replace(
    'const xdo = (args) =>\n  execFileSync("xdotool", args, { env: environment, encoding: "utf8" }).trim();',
    'const xdo = (args) => { matrixCheck(); return execFileSync("xdotool", args, { env: environment, encoding: "utf8" }).trim(); };',
  );
  replace(
    "  processes.push(xvfb);",
    "  processes.push(xvfb);\n  recordOwned(process.env.S1_PROCESS_LEDGER,processes);",
  );
  replace(
    "  processes.push(ide);",
    '  processes.push(ide);\n  recordOwned(process.env.S1_PROCESS_LEDGER,processes);\n  ide.on("error",(error)=>matrixAbort({kind:"error",message:String(error)}));',
  );
  replace(
    "      const message = JSON.parse(buffer.slice(0, newline));",
    `      let message;
      try {message=JSON.parse(buffer.slice(0,newline));}
      catch(error){matrixAbort({kind:"error",message:String(error)});return;}`,
  );
  replace(
    '      if (pending?.id !== message.id)\n        throw new Error("unexpected probe response");',
    '      if (pending?.id !== message.id) {matrixAbort({kind:"error",message:"unexpected probe response"});return;}',
  );
  replace(
    '  result.status = "harness-error";\n  result.error = String(error);',
    '  if(result.status !== "discrepancy") result.status = matrixAbortReason?.kind === "signal" ? "interrupted" : "harness-error";\n  result.error = String(error);',
  );
  replace(
    "  // Save only after the owned IDE launcher has exited.",
    "  save();",
  );
  replace(
    `  for (const child of processes.reverse()) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }`,
    "  result.cleanup = await terminateOwned(ownedIdentities(processes));",
  );
  replace(
    `  if (result.matrix?.ideLauncher) {
    const cleanupDeadline = Date.now() + 5000;
    while (!result.matrix.ideLauncher.finished && Date.now() < cleanupDeadline) await sleep(25);
    if (!result.matrix.ideLauncher.finished) {
      result.cleanupError = "IDE launcher did not exit within five seconds";
      result.status = "harness-error";
      process.exitCode = 1;
    }
  }`,
    `  if(result.cleanup.remaining.length) {result.cleanupError="owned process groups remain";process.exitCode=1;}
  if(matrixAbortReason?.kind === "signal" && result.status !== "discrepancy") result.status="interrupted";`,
  );
  code =
    `import {runFault} from ${JSON.stringify(pathToFileURL(join(source, "matrix/fault.mjs")).href)};\n` +
    code;
  replace(
    '  } else if (["visual", "visual-baseline"].includes(gate)) {',
    `  } else if(gate === "fault") {
    await runFault({result,call,inject,settled,noPending,save,text,observer:matrixObserver,workspace,xdo,window,
      phase:async()=>{
        if(!loaded)return 0;
        phaseSeed=(Math.imul(1664525,phaseSeed)+1013904223)>>>0;
        const delay=phaseSeed%100;await sleep(delay);return delay;
      },
      createSink:async()=>{
        const sink=spawn("xmessage",["-name","S1FaultSink","-title","S1FaultSink","-buttons","OK","S1 isolated focus target"],{env:environment,detached:true,stdio:"ignore"});
        processes.push(sink);recordOwned(process.env.S1_PROCESS_LEDGER,processes);
        sink.on("error",(error)=>matrixAbort({kind:"error",message:String(error)}));
        return until(()=>{
          try {const ids=xdo(["search","--onlyvisible","--name","S1FaultSink"]).split("\\n");return ids.length===1 && ids[0];}
          catch{return false;}
        },"fault focus sink did not appear");
      },
    });
  } else if (["visual", "visual-baseline"].includes(gate)) {`,
  );
  replace(
    '  const pattern = gate === "count" ? ["3", "space", "b", "n", "j"] :',
    '  const pattern = gate === "fault" ? ["space","w","x","t","h","z","j"] : ["visual","visual-baseline"].includes(gate) ? ["v","V","ctrl+v","e","space","w","h","j"] : gate === "count" ? ["3", "space", "b", "n", "j"] :',
  );
  replace("function save() {", "function writeResult() {");
  replace(
    "const environment = { ...process.env };",
    `function save(){
    try{writeResult();return true;}
    catch(error){
      result.persistenceError=String(error);process.exitCode=1;
      matrixAbortReason??={kind:"error",message:"result persistence failed: "+String(error)};
      return false;
    }
  }
  const environment = { ...process.env };
  delete environment.NODE_CHANNEL_FD;`,
  );
  replace("  const xvfb = spawn(", "  matrixCheck();\n  const xvfb = spawn(");
  replace("  const ide = spawn(", "  matrixCheck();\n  const ide = spawn(");
  replace(
    '        const sink=spawn("xmessage",',
    '        matrixCheck();\n        const sink=spawn("xmessage",',
  );
  if (boundedUrl) {
    replace(
      JSON.stringify(pathToFileURL(join(source, "bounded-gates.mjs")).href),
      JSON.stringify(boundedUrl),
    );
    replace(
      "      referencePath,\n      call,",
      `      referencePath,
      matrixCase: matrixOptions.case,
      matrixPhase: async () => {
        if (!loaded) return 0;
        phaseSeed = (Math.imul(1664525, phaseSeed) + 1013904223) >>> 0;
        const delay = phaseSeed % 100;
        await sleep(delay);
        return delay;
      },
      call,`,
    );
  }
  replace(
    'assert.ok(gate === "entry-exit" || (!loaded && delayMs === 10));',
    'assert.ok(["entry-exit", "cancel", "native", "native-baseline", "query", "count", "visual", "visual-baseline", "fault", "vb-entry", "vb-pause", "hangul", "restart", "cold"].includes(gate), "unsupported matrix row");',
  );
  replace(
    '  assert.equal(result.product.version, "1.141.0");',
    `  assert.equal(result.product.version, matrixOptions.version);
  assert.ok(result.product.commit.startsWith(${JSON.stringify(versions[options.version])}), "unexpected IDE build");`,
  );
  replace(
    "  if (boundary || visualDiagnostic) {",
    "  installMatrix({ source, extensions, result, options: matrixOptions });\n  if (boundary || visualDiagnostic) {",
  );
  replace(
    '    "editor.editContext": true,',
    '    "editor.editContext": matrixOptions.editContext,\n    ...(matrixOptions.row === "focus" ? {"editor.accessibilitySupport":matrixOptions.accessibility ?? "off"} : {}),',
  );
  replace(
    "    const same = JSON.stringify(previous) === JSON.stringify(value);",
    `    const comparable = (snapshot) => snapshot && { ...snapshot, matrixObservation: undefined };
    const same = JSON.stringify(comparable(previous)) === JSON.stringify(comparable(value));`,
  );
  replace(
    "    return same && idle(value) ? value : false;",
    "    return same && idle(value) && value.matrixObservation.engineStable ? value : false;",
  );
  replace(
    '      check(after.viewColumn === 1, "left group not active");',
    `      const arrivals = rendererAfter.events.filter((event) => event.type === "keydown" && !event.ctrl && !event.alt && !event.meta);
      check(rendererAfter.overflow === 0, "renderer event overflow");
      check(JSON.stringify(arrivals.map((event) => event.key)) === JSON.stringify([" ", "w", "h", "j"]), "renderer did not observe the exact injected sequence");
      check(arrivals.slice(0, 3).every((event) => event.target?.editor && !event.target?.quickInput), "editor DOM focus was lost before the leaf");
      check(!rendererAfter.events.some((event) => event.type === "window-blur"), "IDE window lost focus during the trial");
      check(after.viewColumn === 1, "left group not active");`,
  );
  replace(
    '      check(after.viewColumn === 1, "left group not active");',
    `      check(
        JSON.stringify({ ...after, matrixObservation: undefined, sentinel: undefined, sentinelSequence: undefined }) ===
        JSON.stringify({ ...sentinel, matrixObservation: undefined, sentinel: undefined, sentinelSequence: undefined }),
        "state changed before final sentinel",
      );
      check(after.viewColumn === 1, "left group not active");`,
  );
  replace(
    "        finalSentinel: sentinel.sentinel,",
    "        finalSnapshot: sentinel,\n        finalSentinel: sentinel.sentinel,",
  );
  replace(
    "  result.settings = settings;",
    `  settings["extensions.experimental.affinity"] = matrixOptions.affinity === "separate"
    ? { "vim-companion-spike.s1-leader": 1 } : {};
  result.scope = "S1 " + (matrixOptions.row ?? "entry-exit") + " environment matrix; first-discrepancy stop; other required rows remain separate";
  result.condition.affinity = matrixOptions.affinity === "separate" ? "separate extension hosts" : "same extension host";
  result.condition.instances = matrixOptions.instances ?? 1;
  result.condition.instanceCountMeaning = "configured maximum; batch overlap intervals recorded separately";
  result.condition.cpuAffinity = readFileSync("/proc/self/status", "utf8").match(/^Cpus_allowed_list:\\s*(.*)$/m)?.[1];
  result.settings = settings;`,
  );
  replace(
    "  else assert.equal(result.hello.pid, result.hello.leaderPid);",
    `  else if (matrixOptions.affinity === "separate") assert.notEqual(result.hello.pid, result.hello.leaderPid, "companion must run in a separate host");
  else assert.equal(result.hello.pid, result.hello.leaderPid);`,
  );
  code =
    `import { runRemap, remapSettings } from ${JSON.stringify(pathToFileURL(join(source, "matrix/remap.mjs")).href)};\n` +
    code;
  replace(
    '  } else if(gate === "fault") {',
    `  } else if(gate.startsWith("vb-")) {
    await runRemap({result,call,inject,settled,noPending,save,text,observer:matrixObserver,xdo,
      phase:async()=>{if(!loaded)return 0;phaseSeed=(Math.imul(1664525,phaseSeed)+1013904223)>>>0;const delay=phaseSeed%100;await sleep(delay);return delay;},
      traceRead:()=>globSync("portable/user-data/logs/**/vscodevim.vim/Vim*.log",{cwd:root}).sort().map(file=>{const bytes=readFileSync(join(root,file));return {file,bytes:bytes.length,text:bytes.toString("utf8")};}),
    });
  } else if(gate === "fault") {`,
  );
  replace(
    '      "--new-window",',
    '      "--new-window",\n      ...(gate.startsWith("vb-") ? ["--log", "vscodevim.vim:trace"] : []),',
  );
  replace(
    "  result.settings = settings;",
    `  if(gate.startsWith("vb-")) {
    const remaps = remapSettings(JSON.parse(readFileSync(join(source,"matrix/catalog.json"),"utf8")));
    settings["vim.normalModeKeyBindingsNonRecursive"] = remaps;
    settings["vim.visualModeKeyBindingsNonRecursive"] = remaps;
    settings["vim.timeout"] = 1000;
    result.matrix.requestedAffinity = matrixOptions.affinity;
    result.matrix.affinityMeaning = "Companion absent; requested same/separate labels retain the required condition grid but no companion host exists";
  }
  result.settings = settings;`,
  );
  code =
    `import {runHangul} from ${JSON.stringify(pathToFileURL(join(source, "matrix/hangul.mjs")).href)};\n` +
    code;
  replace(
    '  } else if(gate.startsWith("vb-")) {',
    `  } else if(gate === "hangul") {
    await runHangul({result,call,inject,settled,noPending,save,text,observer:matrixObserver,
      phase:async()=>{if(!loaded)return 0;phaseSeed=(Math.imul(1664525,phaseSeed)+1013904223)>>>0;const delay=phaseSeed%100;await sleep(delay);return delay;},
    });
  } else if(gate.startsWith("vb-")) {`,
  );
  if (options.row === "focus") {
    code =
      `import {runFocus} from ${JSON.stringify(pathToFileURL(join(source, "matrix/focus.mjs")).href)};\n` +
      code;
    replace(
      '    "cold",\n    "cancel",',
      '    "cold",\n    "focus",\n    "cancel",',
    );
    replace(
      '"hangul", "restart", "cold"].includes(gate)',
      '"hangul", "restart", "cold", "focus"].includes(gate)',
    );
    replace(
      '  } else if(gate === "hangul") {',
      `  } else if(gate === "focus") {
      await runFocus({result,call,inject,settled,noPending,save,observer:matrixObserver,workspace,xdo,window,environment,check:matrixCheck,until,
        phase:async()=>{if(!loaded)return 0;phaseSeed=(Math.imul(1664525,phaseSeed)+1013904223)>>>0;const delay=phaseSeed%100;await sleep(delay);return delay;},
      });
    } else if(gate === "hangul") {`,
    );
    replace(
      '  const pattern = gate === "fault"',
      '  const pattern = gate === "focus" ? [...new Set(["space",...JSON.parse(readFileSync(join(source,"matrix/catalog.json"),"utf8")).leaves.flatMap(leaf=>leaf.keys.map(key=>key==="/"?"slash":key))])] : gate === "fault"',
    );
  }
  if (["restart", "cold"].includes(options.row)) {
    code =
      `import {runRestart} from ${JSON.stringify(pathToFileURL(join(source, "matrix/restart.mjs")).href)};\n` +
      code;
    code =
      `import {runCold} from ${JSON.stringify(pathToFileURL(join(source, "matrix/cold.mjs")).href)};\n` +
      code;
    replace(
      "          const connection = net.createConnection(socketPath);",
      '          const connection = net.createConnection(JSON.parse(readFileSync(socketPath+".ready.json","utf8")).socketPath);',
    );
    replace(
      '  result.hello = await call("hello");',
      '  await call("calibrate");\n  result.hello = await call("hello");',
    );
    replace(
      "        S1_SOCKET: socketPath,",
      '        S1_SOCKET: socketPath,\n        S1_STARTUP_CALIBRATION: "1",\n        S1_STARTUP_PHASE_FILE: join(extensions,".s1-startup-phase.json"),',
    );
    replace(
      '  } else if(gate === "hangul") {',
      `  } else if(gate === "cold") {
      result.calibrationLoadWindows=await call("loadWindows");
      await runCold({result,call,inject,settled,noPending,save,text,xdo,check:matrixCheck,until,processes,
        calibration:{root,data,extensions,workspace,file,environment,code,ide},
        closeCalibrationObserver:()=>{matrixObserver?.close();matrixObserver=undefined;},
      });
    } else if(gate === "restart") {
      result.calibrationLoadWindows=await call("loadWindows");
      await runRestart({result,call,inject,settled,noPending,save,text,observer:matrixObserver,
        base:socketPath,phaseFile:join(extensions,".s1-startup-phase.json"),check:matrixCheck,
        phase:async()=>{if(!loaded)return 0;phaseSeed=(Math.imul(1664525,phaseSeed)+1013904223)>>>0;const delay=phaseSeed%100;await sleep(delay);return delay;},
      });
    } else if(gate === "hangul") {`,
    );
    replace(
      '  result.loadWindows = await call("loadWindows");',
      "  // Startup rows retain each host epoch load window separately.",
    );
    replace(
      "  if (matrixObserver) result.matrix.clocksAfter = {",
      '  if (matrixObserver && !["restart", "cold"].includes(gate)) result.matrix.clocksAfter = {',
    );
  }
  return {
    code,
    baselineSha256: createHash("sha256").update(baseline).digest("hex"),
  };
}
