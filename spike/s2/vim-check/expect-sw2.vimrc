" expect.vimrc with the indentation that VS Code 1.141.0 gives the fixture buffer in the S2 sandbox:
" editor.detectIndentation is true there (not pinned), and the buffer's one indented line (two
" spaces) makes VS Code detect "Spaces: 2" (spike/s2/data/check1/observe-1.141.0.json), while the
" configured editor.tabSize is 4. VSCodeVim shifts and indents with the detected size
" (src/actions/operator.ts L456 and L556 run editor.action.indentLines and outdentLines;
" src/actions/commands/insert.ts L351 reads editor.options.tabSize). Used through
" S2_VIMRC=expect-sw2.vimrc for the variant run of check (1); which one stands is the
" coordinator's decision.
execute 'source' fnameescape(expand('<sfile>:p:h') .. '/expect.vimrc')
set shiftwidth=2 softtabstop=2 tabstop=2
