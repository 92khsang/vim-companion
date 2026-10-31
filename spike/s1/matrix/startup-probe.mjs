import assert from "node:assert/strict";

// Convert the matrix observer into an eager passive endpoint. Engine inspection
// and companion RPC remain unavailable until the runner records its first input.
export function startupProbe(source) {
  const replace = (before, after) => {
    assert.equal(
      source.split(before).length,
      2,
      "startup probe hook must be unique: " + before,
    );
    source = source.replace(before, after);
  };
  replace('const reader = require("./inspect-reader.cjs");', "let reader;");
  replace(
    "let map, Register, queue, leader, load;",
    "let map, Register, queue, leader, load;\nlet attached = false;",
  );
  const start = source.indexOf(
    '  await vscode.extensions.getExtension("vscodevim.vim").activate();',
  );
  const end = source.indexOf("  context.subscriptions.push(", start);
  assert.ok(start > 0 && end > start);
  source =
    source.slice(0, start) +
    `  let leaderMetadata = null;
  const calibration = process.env.S1_STARTUP_CALIBRATION === "1" && JSON.parse(require("node:fs").readFileSync(process.env.S1_STARTUP_PHASE_FILE)).calibration === true;
  const companionMarker = () => {
    try {
      const fs=require("node:fs");
      const phase=JSON.parse(fs.readFileSync(process.env.S1_STARTUP_PHASE_FILE));
      const marker=JSON.parse(fs.readFileSync(process.env.S1_SOCKET+".leader-ready.json"));
      return marker.token === phase.token ? marker : null;
    } catch { return null; }
  };
  let startupSentinel = null, startupSequence = 0;
  const epoch = performance.timeOrigin;
  async function attach() {
    if (!vscode.extensions.getExtension("vscodevim.vim")?.isActive)
      throw new Error("post-input engine observation requested before natural Vim activation");
    reader ??= require("./inspect-reader.cjs");
    const companion = companionMarker();
    if (companion) {
      leaderMetadata = await vscode.commands.executeCommand("s1.matrix.meta");
      if(leaderMetadata.pid !== companion.pid || leaderMetadata.timeOrigin !== companion.epoch)
        throw new Error("companion marker belongs to another host epoch");
      leader = {pid:leaderMetadata.pid,
        snapshot:()=>vscode.commands.executeCommand("s1.matrix.snapshot"),
        clearEvents:()=>vscode.commands.executeCommand("s1.matrix.clear")};
    }
    const loadExtension = vscode.extensions.getExtension("vim-companion-spike.s1-load");
    load = loadExtension?.isActive ? loadExtension.exports : null;
    map = await reader.modeHandlerMap();
    Register = await reader.registerClass();
    queue = await reader.keyQueue();
    attached = true;
    return {pid:process.pid,epoch,companionActivationObserved:Boolean(companion),leaderPid:leaderMetadata?.pid ?? null};
  }
  context.subscriptions.push(vscode.commands.registerCommand("s1.startupSentinel",value=>{
    startupSentinel??={...value,time:performance.now()};startupSequence++;
  }));
` +
    source.slice(end);
  replace(
    "  const methods = {",
    `  const methods = {
    attach,
    saveFixture:async()=>{await vscode.commands.executeCommand("workbench.action.files.saveAll");return true;},
    calibrate:async()=>{
      if(!calibration)throw new Error("calibration is disabled in a measured startup");
      for(const id of ["vscodevim.vim","vim-companion-spike.s1-load"])
        await vscode.extensions.getExtension(id)?.activate();
      await vscode.commands.executeCommand("s1.matrix.meta");
      return attach();
    },
    passive:()=>({pid:process.pid,epoch,time:performance.now(),
      vimActive:Boolean(vscode.extensions.getExtension("vscodevim.vim")?.isActive),
      companionActive:Boolean(companionMarker()),companionMarker:companionMarker(),
      startupSentinel,startupSequence,windowFocused:vscode.window.state.focused,
      active:vscode.window.activeTextEditor && {uri:vscode.window.activeTextEditor.document.uri.toString(),
        column:vscode.window.activeTextEditor.viewColumn,text:vscode.window.activeTextEditor.document.getText(),dirty:vscode.window.activeTextEditor.document.isDirty,
        selections:vscode.window.activeTextEditor.selections.map(s=>[s.anchor.line,s.anchor.character,s.active.line,s.active.character])},
      editors:vscode.window.visibleTextEditors.map(editor=>({uri:editor.document.uri.toString(),column:editor.viewColumn,
        selections:editor.selections.map(s=>[s.anchor.line,s.anchor.character,s.active.line,s.active.character])})),
    }),
    restart:()=>{
      const requested={pid:process.pid,epoch,time:performance.now()};
      setImmediate(()=>void vscode.commands.executeCommand("workbench.action.restartExtensionHost"));
      return requested;
    },`,
  );
  replace(
    "    restart:()=>{",
    `    closeWindow:()=>{
      setImmediate(()=>void vscode.commands.executeCommand("workbench.action.closeWindow"));
      return true;
    },
    restart:()=>{`,
  );
  replace(
    '      leader: await vscode.commands.executeCommand("s1.matrix.clock"),',
    '      leader: attached && leaderMetadata ? await vscode.commands.executeCommand("s1.matrix.clock") : null,',
  );
  replace(
    "async function snapshot() {\n  return observe(",
    'async function snapshot() {\n  if (!attached) throw new Error("engine snapshot before post-input attach");\n  return observe(',
  );
  replace(
    "    warm: async () => {\n      map = await reader.modeHandlerMap();\n      Register = await reader.registerClass();\n      queue = await reader.keyQueue();\n      return snapshot();\n    },",
    "    warm: async () => { await attach(); return snapshot(); },",
  );
  replace(
    "            if (!methods[request.method])",
    `            if (!attached && !["hello","passive","clock","attach"].includes(request.method) && !(calibration && ["open","calibrate"].includes(request.method)))
              throw new Error("probe operation requires post-input attach");
            if (!methods[request.method])`,
  );
  replace(
    "  server.listen(process.env.S1_SOCKET);",
    `  const socketPath = process.env.S1_SOCKET + "." + process.pid + ".sock";
  server.listen(socketPath,()=>{
    const fs=require("node:fs");
    const rendezvous=process.env.S1_SOCKET+".ready.json";
    fs.writeFileSync(rendezvous+".tmp",JSON.stringify({pid:process.pid,epoch,socketPath}));
    fs.renameSync(rendezvous+".tmp",rendezvous);
  });`,
  );
  return source;
}

export function startupLeader(source) {
  const before = "  return {\n    pid: process.pid,";
  assert.equal(source.split(before).length, 2);
  return source.replace(
    before,
    `  const fs=require("node:fs");
  const phase=JSON.parse(fs.readFileSync(process.env.S1_STARTUP_PHASE_FILE));
  const marker=process.env.S1_SOCKET+".leader-ready.json";
  fs.writeFileSync(marker+"."+process.pid+".tmp",JSON.stringify({pid:process.pid,epoch:performance.timeOrigin,token:phase.token,time:performance.now()}));
  fs.renameSync(marker+"."+process.pid+".tmp",marker);
  return {
    pid: process.pid,`,
  );
}

export function startupManifest(manifest) {
  return {
    ...manifest,
    activationEvents: ["*"],
    extensionDependencies: [],
    contributes: {
      ...manifest.contributes,
      commands: [
        ...(manifest.contributes.commands ?? []),
        { command: "s1.startupSentinel", title: "S1 startup readiness probe" },
      ],
      keybindings: [
        ...manifest.contributes.keybindings,
        ...[false, true].map((active) => ({
          key: "ctrl+alt+8",
          command: "s1.startupSentinel",
          args: { ready: true, capture: active },
          when:
            "editorTextFocus && vim.active && " +
            (active ? "" : "!") +
            "vimCompanion.leaderActive",
        })),
      ],
    },
  };
}
