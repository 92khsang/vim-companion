// Key notation. A leader key is "SPC" and then keys separated by single spaces, such as "SPC w h";
// a Vim key is Vim notation without spaces, such as "gra" or "<C-w>h". Parsing turns both into
// token arrays, and the renderers turn token arrays into what each engine expects.

export type ParsedKey =
  { ok: true; tokens: string[] } | { ok: false; message: string };

// "SPC", then one or more keys after single spaces; each key is SPC or one character of the alphabet.
const LEADER_KEY = /^SPC(?: (?:SPC|[a-zA-Z0-9/?:=]))+$/;

export function parseLeader(text: string): ParsedKey {
  if (!LEADER_KEY.test(text)) {
    return {
      ok: false,
      message: `${JSON.stringify(text)} is not a leader key: "SPC" and then keys separated by single spaces, each SPC or one of a-z A-Z 0-9 / ? : =`,
    };
  }
  return { ok: true, tokens: text.split(" ") };
}

export function parseVim(text: string): ParsedKey {
  return { ok: false, message: `not implemented: ${text}` };
}
