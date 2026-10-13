// The catalog as the tools see it once it is valid. The schemas in spec/schema/ describe the same
// shapes for the JSON files and must match these types exactly.

export type Ide = "vscode" | "intellij";

export type Mode = "n" | "x";

/** Leader keys such as "SPC w h" and Vim keys such as "gra"; at least one key in total. */
export type KeySet = { leader?: string[]; vim?: string[] };

export type SupportLevel = "full" | "partial" | "none";

/** `partial` and `none` carry a note that says what is missing. */
export type Support = { level: SupportLevel; note?: string };

/** An old key kept until version `until`; its label is "Moved to <primary key of that kind>". */
export type Alias = { keys: KeySet; until: string };

export type VscodeExec =
  | {
      command: string;
      /** The positional arguments of the command. */
      args?: unknown[];
    }
  | { vimKeys: string };

export type VscodeBinding = {
  exec: VscodeExec;
  exit: "input" | "editor";
  repeatable: boolean;
  count: "none" | "repeat";
};

export type IntellijBinding = ({ action: string } | { ideavimKeys: string }) & {
  /** Absent: the keys are built into IdeaVim. Set: they come from a plugin mapping, so the map
   * is recursive. */
  provider?: string;
  /** Default true. False marks an `<Action>` that acts as a motion, which IdeaVim cannot run in
   * Visual or Operator-pending mode. */
  motionSafe?: boolean;
};

export type Entry = {
  /** "<category>.<name>"; the category is also the stem of the file that holds the entry. */
  id: string;
  category: string;
  keys: KeySet;
  label: string;
  description: string;
  examples: string[];
  rationale: string;
  stage: "stable" | "experimental";
  /** Default ["n"]; applies to every key of the entry and of its aliases. */
  modes?: Mode[];
  aliases?: Alias[];
  vscode?: VscodeBinding;
  intellij?: IntellijBinding;
  /** How the keys of each engine behave. Both are required when one IDE runs engine keys and the
   * other a command or action; an IDE that runs a command or action shows that it differs from
   * Vim where its engine has one. */
  semantics?: { vscodevim?: string; ideavim?: string };
  /** Required when an IDE implements one of the entry's Vim keys by a remap instead of natively. */
  deviation?: { shadows: string; origin: string; note: string };
  /** A missing IDE means `full` when the entry has a block for that IDE. */
  support?: { vscode?: Support; intellij?: Support };
  verifiedAgainst: {
    vscode: string;
    vscodevim: string;
    intellij: string;
    ideavim: string;
  };
};

/** The label of a leader prefix such as "SPC w". */
export type Group = { keys: string; label: string };

/** `sethandler` arguments for a Ctrl key; `mac`, when present, replaces `handler` on macOS. */
export type CtrlKey = { key: string; handler: string; mac?: string };

export type Catalog = {
  entries: Entry[];
  groups: Group[];
  ctrlKeys: CtrlKey[];
  retiredIds: string[];
};

/** The entries and groups of a catalog, which bind the keys; a fixture's inline catalog is this. */
export type KeyCatalog = Pick<Catalog, "entries" | "groups">;

/** `file` is a repo-relative POSIX path; `where` names the entry, case or field. */
export type Diagnostic = {
  file: string;
  where: string;
  /** A stable string such as "DUPLICATE_ID". */
  code: string;
  message: string;
};
