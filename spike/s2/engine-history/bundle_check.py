import sys, zipfile, re, glob, os
# Static check of each VSCodeVim package: does the bundle still carry, unmangled, every name the
# inspector adapter relies on? Reads the zip only; executes nothing.
NAMES = ["getAndUpdateModeHandler", "ModeHandlerMap", "modeHandlerMap", "vimState", "modeData",
         "recordedState", "actionsRun", "actionsRunPressedKeys", "actionKeys", "bufferedKeys",
         "operatorCount", "registerName", "hasRunOperator", "isCompleteAction", "keysPressed",
         "actionType", "cmd_register"]
def ver(p): return tuple(int(x) for x in re.search(r"vim-(\d+)\.(\d+)\.(\d+)\.vsix", p).groups())
rows = []
for p in sorted(glob.glob(os.path.join(sys.argv[1], "*.vsix")), key=ver):
    with zipfile.ZipFile(p) as z:
        js = z.read("extension/out/extension.js").decode("utf-8", "replace")
    missing = [n for n in NAMES if n not in js]
    exp = bool(re.search(r"getAndUpdateModeHandler", js)) and bool(re.search(r"exports\.getAndUpdateModeHandler|getAndUpdateModeHandler:\(\)=>|getAndUpdateModeHandler=", js))
    mapdef = len(re.findall(r"ModeHandlerMap\b", js))

    rows.append((os.path.basename(p), len(js), exp, mapdef, ",".join(missing) or "-"))
print("package bytes exportFound ModeHandlerMapRefs missingNames")
for r in rows: print(*r)
