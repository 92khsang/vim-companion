import assert from "node:assert/strict";

const patch = (source, before, after) => {
  assert.equal(
    source.split(before).length,
    2,
    "fault instrumentation hook must be unique",
  );
  return source.replace(before, after);
};
export function releaseTracing(source) {
  return patch(
    source,
    "  prefix = [];\n  await vscode.commands.executeCommand(",
    '  prefix = [];\n  record("release-request", {reason});\n  await vscode.commands.executeCommand(',
  );
}
export function faultLeader(source) {
  source = releaseTracing(source);
  return patch(
    source,
    "  context.subscriptions.push(",
    `  context.subscriptions.push(
    vscode.commands.registerCommand("s1.matrix.throw",()=>{
      record("fault",{kind:"throw"});throw new Error("S1 injected leaf failure");
    }),
    vscode.commands.registerCommand("s1.matrix.hang",()=>{
      record("fault",{kind:"hang"});return new Promise(()=>{});
    }),`,
  );
}
export function faultProbe(source) {
  source = patch(
    source,
    'const vscode = require("vscode");',
    'const vscode = require("vscode");\nconst {createFaultProbe} = require("./matrix-fault-probe.cjs");',
  );
  return patch(
    source,
    "  const methods = {",
    `  const faults=createFaultProbe(vscode,context);
  const methods = {
    faultSetup:(parameters)=>faults.setup(parameters),
    faultAction:(parameters)=>faults.action(parameters),
    faultEvents:()=>faults.snapshot(),`,
  );
}
export function faultCatalog(catalog) {
  return {
    ...catalog,
    leaves: [
      ...catalog.leaves,
      {
        id: "fault.throw",
        keys: ["x", "t"],
        exec: { command: "s1.matrix.throw" },
        exit: "input",
      },
      {
        id: "fault.hang",
        keys: ["x", "h"],
        exec: { command: "s1.matrix.hang" },
        exit: "input",
      },
    ],
  };
}
