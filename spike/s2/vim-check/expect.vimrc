" Vim as the oracle for the card expectations of candidate (b) (spike/s2/vim-check/expect.mjs).
" Options follow the S2 sandbox (spike/s2/harness/lib.mjs sandboxSettings: editor.autoIndent none,
" no auto closing, no format on type) and VSCodeVim 1.32.4's own defaults where Vim's defaults differ.
" The start cursor comes from the command line (-c "call cursor(...)"), after the file is read.
set nocompatible
set encoding=utf-8
" vim.autoindent defaults to true in VSCodeVim 1.32.4 and the sandbox does not override it: its
" ChangeOperator keeps the first line's indent on a linewise change (src/actions/operator.ts
" L679-694), as Vim's 'autoindent' does for cc and S. No smart, C or expression indenting
" (editor.autoIndent is none in the sandbox).
set autoindent nosmartindent nocindent indentexpr=
set backspace=indent,eol,start
" editor.insertSpaces and editor.tabSize defaults of VS Code.
set expandtab shiftwidth=4 softtabstop=4 tabstop=4
" vim.ignorecase, vim.smartcase, vim.textwidth defaults of VSCodeVim. CTRL-A and CTRL-X: VSCodeVim
" 1.32.4 parses a leading-zero number as octal and has no binary numbers
" (src/common/number/numericString.ts L14-34), so octal and hex, not Vim's default bin,hex.
set ignorecase smartcase textwidth=80 nrformats=octal,hex
" As the grammar fixture (spec/fixtures/grammar) and vim-check/vimrc.
set timeout timeoutlen=1000 ttimeout ttimeoutlen=10
set belloff=all noshowmode showcmd noruler laststatus=0 shortmess+=I
" K must not start a pager; no modelines.
set keywordprg=:echo nomodeline

" Every 50 ms: the state the harness compares (buffer, cursor, mode, registers) as one JSON line,
" written to $S2_DUMP through a rename so that a reader never sees a partial file.
let g:s2_seq = 0
let s:regs = split('" 0 1 2 3 4 5 6 7 8 9 - a b c d e f g h i j k l m n o p q r s t u v w x y z . : /')
function S2Dump(timer)
  let regs = {}
  for name in s:regs
    let regs[name] = [getregtype(name), getreg(name, 1, 1)]
  endfor
  let d = {
        \ 'seq': g:s2_seq,
        \ 'mode': mode(1),
        \ 'state': state(),
        \ 'operator': v:operator,
        \ 'pos': getpos('.'),
        \ 'vpos': getpos('v'),
        \ 'recording': reg_recording(),
        \ 'lines': getline(1, '$'),
        \ 'regs': regs,
        \ }
  let g:s2_seq += 1
  call writefile([json_encode(d)], $S2_DUMP .. '.tmp')
  call rename($S2_DUMP .. '.tmp', $S2_DUMP)
endfunction
call timer_start(50, 'S2Dump', {'repeat': -1})
