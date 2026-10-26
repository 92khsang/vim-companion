#!/bin/bash
# Print one normalized line per item of the adapter's dependency surface at git ref $1.
ref=$1
show() { git show "$ref:$1" 2>/dev/null; }
norm() { tr -s ' \t' ' ' | sed 's/^ //'; }
echo "export: $(show extension.ts | grep -c 'getAndUpdateModeHandler')"
echo "base-fn: $(show extensionBase.ts | grep -E 'function getAndUpdateModeHandler' | norm)"
echo "base-map-use: $(show extensionBase.ts | grep -c 'ModeHandlerMap\.')"
echo "map-field: $(show src/mode/modeHandlerMap.ts | grep -E 'modeHandlerMap *[:=]|modeHandlerMap = new' | norm)"
echo "map-export: $(show src/mode/modeHandlerMap.ts | grep -E "export (const|class|abstract class) ModeHandlerMap" | norm)"
for f in modeData recordedState; do echo "vimState.$f: $(show src/state/vimState.ts | grep -E "^ *(public |private |readonly )*$f[?!]?( *[:=])" | head -1 | norm)"; done
for f in actionsRun actionsRunPressedKeys actionKeys bufferedKeys count operatorCount registerName hasRunOperator; do echo "recorded.$f: $(show src/state/recordedState.ts | grep -E "^ *(public |private |readonly |get )*$f[?!]?( *[:(=])" | head -1 | norm)"; done
echo "modeData-type: $(show src/state/vimState.ts | grep -E 'modeData' | head -3 | norm | tr '\n' '|')"
echo "mode-enum: $(show src/mode/mode.ts | sed -n '/export enum Mode/,/}/p' | tr -d ' \n')"
for f in actionType isCompleteAction keysPressed; do echo "base.$f: $(show src/actions/base.ts | grep -E "^ *(public |private |readonly |abstract |static )*$f[?!]?( *[:=(])" | head -1 | norm)"; done
echo "register-name: $(git grep -h "'cmd_register'" "$ref" -- src 2>/dev/null | head -1 | norm)"
echo "webpack-opt: $(show webpack.config.js | grep -E "mode:|minimize|concatenateModules|mangleExports|devtool" | norm | tr '\n' '|')"
