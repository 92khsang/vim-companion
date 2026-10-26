" expect.vimrc plus session state that a fresh Vim lacks and a long-lived VSCodeVim session keeps
" from earlier rows: every register written, a last search pattern, a last f/t character, marks
" a-z and A-Z, two jump-list entries and a last Visual area. A row whose expectation under this
" vimrc differs from the one under expect.vimrc reads such state, so the fresh-Vim answer is not
" the answer of a VS Code session in which other rows ran before it (check (1) resets the text and
" the cursor, not this state). Used through S2_VIMRC=expect-prestate.vimrc; the state is set at
" VimEnter, after `-c "call cursor(...)"` placed the start cursor, and the cursor is put back with
" its preferred column (getcurpos() and setpos() with five items), so that j and k are unaffected.
execute 'source' fnameescape(expand('<sfile>:p:h') .. '/expect.vimrc')
function S2PreState()
  let start = getcurpos()
  for name in split('0 1 2 3 4 5 6 7 8 9 - a b c d e f g h i j k l m n o p q r s t u v w x y z')
    call setreg(name, 'R' .. name, 'c')
  endfor
  call setreg('"', 'Rq', 'c')
  call setreg('/', 'eta')
  call setcharsearch({'char': 'e', 'forward': 1, 'until': 0})
  let i = 0
  for m in split('abcdefghijklmnopqrstuvwxyz', '\zs')
    call setpos("'" .. m, [0, i % 4 + 1, i % 7 + 1, 0])
    call setpos("'" .. toupper(m), [bufnr(), (i + 2) % 4 + 1, i % 5 + 1, 0])
    let i += 1
  endfor
  call cursor(4, 6)
  normal! m'
  call cursor(3, 9)
  normal! m'
  call setpos("'<", [0, 3, 1, 0])
  call setpos("'>", [0, 3, 7, 0])
  call setpos('.', start)
endfunction
autocmd VimEnter * call S2PreState()
