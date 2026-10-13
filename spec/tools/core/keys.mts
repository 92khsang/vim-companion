// Key notation. A leader key is "SPC" and then keys separated by single spaces, such as "SPC w h";
// a Vim key is Vim notation without spaces, such as "gra" or "<C-w>h". Parsing turns both into
// token arrays, and the renderers turn token arrays into what each engine expects.

export type ParsedKey =
  { ok: true; tokens: string[] } | { ok: false; message: string };

export function parseLeader(text: string): ParsedKey {
  return { ok: false, message: `not implemented: ${text}` };
}
