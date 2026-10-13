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

// One Vim key: a <...> group with no space, "<", ">" or "|" inside (\x21-\x7e without \x3c, \x3e
// and \x7c), or one printable ASCII character other than space, "<" and "|". Without "|" a key
// can stand in a vimrc map command, where "|" would end the command.
const VIM_TOKEN =
  /<[\x21-\x3b\x3d\x3f-\x7b\x7d\x7e]+>|[\x21-\x3b\x3d-\x7b\x7d\x7e]/g;
const VIM_KEY = new RegExp(`^(?:${VIM_TOKEN.source})+$`);

export function parseVim(text: string): ParsedKey {
  if (!VIM_KEY.test(text)) {
    return {
      ok: false,
      message: `${JSON.stringify(text)} is not a Vim key: keys without spaces, each a printable ASCII character other than < and |, or a <...> group such as <C-w>`,
    };
  }
  return {
    ok: true,
    tokens: [...text.matchAll(VIM_TOKEN)].map((match) => match[0]),
  };
}

// SPC is the space key, so it sorts as " ", before every printable key.
const sortText = (token: string): string => (token === "SPC" ? " " : token);

/** Orders token arrays token by token in code-unit order; a key sorts before its longer keys. */
export function compareKeys(
  a: readonly string[],
  b: readonly string[],
): number {
  for (let i = 0; i < a.length && i < b.length; i++) {
    const x = sortText(a[i]!);
    const y = sortText(b[i]!);
    if (x !== y) return x < y ? -1 : 1;
  }
  return a.length - b.length;
}

/** Whether two token arrays are the same key. */
export function sameKey(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((token, i) => token === b[i]);
}

/** The `key` of a which-key menu item for one leader token; which-key reads Space as " ". */
export function whichKeyKey(token: string): string {
  return token === "SPC" ? " " : token;
}

/**
 * The left-hand side of an IdeaVim map command for the tokens of a key. A leader key (first token
 * SPC) becomes <leader> and its keys, with a later SPC as <Space>. A Vim key has no SPC token and
 * is written literally.
 */
export function ideavimLhs(tokens: readonly string[]): string {
  if (tokens[0] !== "SPC") return tokens.join("");
  const keys = tokens
    .slice(1)
    .map((token) => (token === "SPC" ? "<Space>" : token));
  return `<leader>${keys.join("")}`;
}

/** The `before` array of a VSCodeVim remap: one Vim notation token per key, Space as "<space>". */
export function vscodevimBefore(tokens: readonly string[]): string[] {
  return tokens.map((token) => (token === "SPC" ? "<space>" : token));
}
