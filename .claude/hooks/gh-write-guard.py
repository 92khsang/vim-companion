#!/usr/bin/env python3
"""PreToolUse hook that asks for confirmation before Bash commands needing the user's approval.

The `ask` rules in .claude/settings.json match command prefixes, also inside compound commands and
command substitutions. This hook adds what a prefix cannot show: `gh api` calls that write (a
non-GET method; -f, -F or --input, which make gh send a POST; or a GraphQL mutation), tag pushes by
name or refspec, and guarded commands behind forms the rules do not unwrap, such as `env`, `sudo`,
`xargs` with options, `bash -c`, `eval`, an absolute path, or `gh -R` and `git -C` before the
subcommand.

It parses the commands an agent writes on a best-effort basis and is not a sandbox: deliberately
obscured forms, such as `env -S`, here-strings, a command string piped into a shell or process
substitution, can pass.

Reads the PreToolUse event of the Bash or Monitor tool as JSON on stdin. Prints nothing when it has
no objection, or a PreToolUse decision with permissionDecision "ask". It never allows or denies on
its own.
"""

import json
import os
import re
import shlex
import sys

# gh command paths whose listed subcommands merge, release, tag or change repository settings.
GH_GUARDED = {
    ("pr",): {"merge"},
    ("release",): {"create", "new", "delete", "delete-asset", "edit", "upload"},
    ("workflow",): {"run", "enable", "disable"},
    ("label",): {"create", "edit", "delete", "clone"},
    ("repo",): {"edit", "delete", "rename", "archive", "unarchive"},
    ("repo", "deploy-key"): {"add", "delete"},
    ("repo", "autolink"): {"create", "delete"},
    ("secret",): {"set", "delete", "remove"},
    ("variable",): {"set", "delete", "remove"},
}
GH_VALUE_OPTIONS = {"-R", "--repo"}
GH_API_VALUE_OPTIONS = {"-H", "--header", "-q", "--jq", "-t", "--template", "-p", "--preview", "--hostname", "--cache"}

GIT_VALUE_OPTIONS = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"}
GIT_PUSH_VALUE_OPTIONS = {"-o", "--push-option", "--repo", "--receive-pack", "--exec"}
GIT_PUSH_TAG_OPTIONS = ("--tags", "--follow-tags", "--mirror")
GIT_TAG_WRITE_OPTIONS = {
    "-a", "--annotate", "-s", "--sign", "-u", "--local-user", "-f", "--force",
    "-d", "--delete", "-m", "--message", "-F", "--file", "-e", "--edit",
}
# Options that make `git tag` list or verify tags, so that a name after them creates nothing.
GIT_TAG_READ_OPTIONS = (
    "-l", "--list", "-n", "--contains", "--no-contains", "--merged", "--no-merged", "--points-at",
    "-v", "--verify",
)
GIT_TAG_VALUE_OPTIONS = {"--sort", "--format"}
# A pushed ref named like a release tag (v1, v1.0.0, 1.2.3-rc.1).
VERSION_REF = re.compile(r"^v?\d+(\.\d+)*([-+].*)?$")

# Wrappers that run the command given after their own options, with the options that take a value.
WRAPPERS = {
    "env": {"-u", "--unset", "-C", "--chdir", "-S", "--split-string"},
    "command": set(),
    "builtin": set(),
    "noglob": set(),
    "exec": {"-a"},
    "nohup": set(),
    "time": set(),
    "sudo": {"-u", "--user", "-g", "--group", "-h", "--host", "-p", "--prompt", "-C", "--close-from", "-D", "--chdir"},
    "doas": {"-u", "-C"},
    "xargs": {"-n", "-L", "-P", "-I", "-d", "-E", "-s", "-a", "--max-args", "--max-procs", "--delimiter", "--arg-file"},
    "timeout": {"-s", "--signal", "-k", "--kill-after"},
    "nice": {"-n", "--adjustment"},
    "setsid": set(),
    "stdbuf": {"-i", "-o", "-e"},
}
SHELLS = {"bash", "sh", "zsh", "dash", "ksh"}
SHELL_VALUE_OPTIONS = {"--rcfile", "--init-file"}
KEYWORDS = {"if", "then", "else", "elif", "fi", "do", "done", "while", "until", "{", "}", "!"}
ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
# A redirection operator as shlex splits it off its file descriptor and target: >, >>, >&, &>, <<.
REDIRECTION = re.compile(r"^&?[<>][<>&|]*$")
# Characters after which a `#` starts a comment, because a new word begins there.
COMMENT_STARTS = {" ", "\t", "\n", ";", "&", "|", "(", ")"}
# A heredoc operator and its delimiter word; a quoted delimiter turns off expansion in the body.
HEREDOC = re.compile(r"(?<!<)<<(?!<)(-?)[ \t]*(\\?)(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\3")
BLANK_QUOTES = str.maketrans("'\"", "  ")
BLANK_QUOTES_AND_EXPANSIONS = str.maketrans("'\"`$", "    ")
FALLBACK = re.compile(r"\bgh\b.*\b(api|merge|release|workflow|label|repo|secret|variable)\b|\bgit\b.*\b(push|tag)\b", re.S)
PLACEHOLDER = "__substitution__"


def decide(command):
    """Return why `command` needs confirmation, or None if this hook has no objection."""
    try:
        reasons = _reasons(command)
    except ValueError:
        if FALLBACK.search(command):
            return "Could not parse this command, and it mentions a guarded gh or git command."
        return None
    return "; ".join(dict.fromkeys(reasons)) or None


def _reasons(text):
    outer, inner = _extract_substitutions(_neutralize_heredocs(text))
    reasons = []
    for nested in inner:
        reasons += _reasons(nested)
    for words in _simple_commands(outer):
        reasons += _command_reasons(words)
    return reasons


def _neutralize_heredocs(text):
    """Blank the quotes in heredoc bodies, and `$` and backticks too when the delimiter is quoted.

    A body is data, so its apostrophes must not open shell quotes. Its lines stay in place, because a
    body fed to a shell, as in `ssh host <<'EOF'` or `cat <<'EOF' | bash`, runs as commands. A
    heredoc without its terminator line is left alone.
    """
    lines = text.split("\n")
    i = 0
    while i < len(lines):
        start = i + 1
        for match in HEREDOC.finditer(lines[i]):
            strip_tabs, backslash, quote, tag = match.groups()
            end = start
            while end < len(lines) and (lines[end].lstrip("\t") if strip_tabs else lines[end]) != tag:
                end += 1
            if end == len(lines):
                break
            table = BLANK_QUOTES_AND_EXPANSIONS if backslash or quote else BLANK_QUOTES
            for j in range(start, end):
                lines[j] = lines[j].translate(table)
            start = end + 1
        i = start
    return "\n".join(lines)


def _extract_substitutions(text):
    """Replace $(...) and `...` with a placeholder and return their contents for separate checks.

    Also drops comments up to the end of their line, so that a comment cannot hide the next line.
    """
    out, inner = [], []
    i, quote = 0, None
    while i < len(text):
        c = text[i]
        if quote == "'":
            quote = None if c == "'" else quote
            out.append(c)
            i += 1
        elif c == "\\":
            out.append(text[i:i + 2])
            i += 2
        elif c == "'" and quote is None:
            quote = "'"
            out.append(c)
            i += 1
        elif c == "#" and quote is None and (not out or out[-1] in COMMENT_STARTS):
            end = text.find("\n", i)
            i = len(text) if end < 0 else end
        elif c == '"':
            quote = None if quote == '"' else '"'
            out.append(c)
            i += 1
        elif text.startswith("$(", i):
            end = _closing_paren(text, i + 2)
            inner.append(text[i + 2:end])
            out.append(PLACEHOLDER)
            i = end + 1
        elif c == "`":
            end = text.find("`", i + 1)
            if end < 0:
                raise ValueError("unbalanced backtick")
            inner.append(text[i + 1:end])
            out.append(PLACEHOLDER)
            i = end + 1
        else:
            out.append(c)
            i += 1
    if quote:
        raise ValueError("unbalanced quote")
    return "".join(out), inner


def _closing_paren(text, start):
    depth, quote, i = 1, None, start
    while i < len(text):
        c = text[i]
        if quote:
            if c == quote:
                quote = None
            elif c == "\\" and quote == '"':
                i += 1
        elif c in "'\"":
            quote = c
        elif c == "\\":
            i += 1
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError("unbalanced command substitution")


def _simple_commands(text):
    text = text.replace("\\\n", " ").replace("\n", ";")
    lexer = shlex.shlex(text, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    lexer.commenters = ""  # _extract_substitutions has dropped the comments, which end at a newline
    tokens = list(lexer)
    words, skip_next = [], False
    for k, token in enumerate(tokens):
        if skip_next:
            skip_next = False
        elif REDIRECTION.match(token):
            skip_next = True
        elif token.isdigit() and k + 1 < len(tokens) and REDIRECTION.match(tokens[k + 1]):
            pass  # the file descriptor of a redirection such as 2>&1
        elif token and set(token) <= set(";&|()"):
            if words:
                yield words
            words = []
        else:
            words.append(token)
    if words:
        yield words


def _command_reasons(words):
    words = list(words)
    while words:
        head = words[0]
        name = os.path.basename(head)
        if ASSIGNMENT.match(head) or head in KEYWORDS:
            words.pop(0)
        elif name in WRAPPERS:
            words = _skip_options(words[1:], WRAPPERS[name], stop_at_assignment=name != "env")
            if name == "timeout":
                words = words[1:]  # its DURATION operand comes before the command
        elif name in SHELLS:
            script = _shell_script(words[1:])
            return _reasons(script) if script is not None else []
        elif name == "eval":
            return _reasons(" ".join(words[1:]))
        elif name == "gh":
            return _gh_reasons(words[1:])
        elif name == "git":
            return _git_reasons(words[1:])
        else:
            return []
    return []


def _skip_options(words, value_options, stop_at_assignment=True):
    """Drop a wrapper's options (and env's NAME=value pairs) and return the wrapped command."""
    i = 0
    while i < len(words):
        word = words[i]
        if word in value_options:
            i += 2
        elif word.startswith("-") or (not stop_at_assignment and ASSIGNMENT.match(word)):
            i += 1
        else:
            break
    return words[i:]


def _shell_script(args):
    """Return the command string that a shell runs with -c, or None when it reads a file or stdin."""
    runs_string, i = False, 0
    while i < len(args) and args[i].startswith(("-", "+")) and args[i] != "--":
        arg = args[i]
        i += 1
        if arg in SHELL_VALUE_OPTIONS:
            i += 1
        elif not arg.startswith("--"):
            runs_string = runs_string or "c" in arg
            if "o" in arg or "O" in arg:
                i += 1  # -o, +o, -O and +O take an option name
    if i < len(args) and args[i] == "--":
        i += 1
    if not runs_string:
        return None
    return args[i] if i < len(args) else ""


def _positionals(args, value_options):
    found, i = [], 0
    while i < len(args):
        if args[i] in value_options:
            i += 2
            continue
        if not args[i].startswith("-"):
            found.append(args[i])
        i += 1
    return found


def _gh_reasons(args):
    names = _positionals(args, GH_VALUE_OPTIONS)
    if names[:1] == ["api"]:
        reason = _gh_api_reason(args[args.index("api") + 1:])
        return [reason] if reason else []
    for depth in (1, 2):
        if len(names) > depth and names[depth] in GH_GUARDED.get(tuple(names[:depth]), ()):
            return [f"`gh {' '.join(names[:depth + 1])}` needs the user's approval"]
    return []


def _gh_api_reason(args):
    method, fields, has_input, endpoint = None, [], False, None
    i = 0
    while i < len(args):
        arg = args[i]
        value = args[i + 1] if i + 1 < len(args) else ""
        step = 1
        if arg in ("-X", "--method"):
            method, step = value, 2
        elif arg.startswith("--method="):
            method = arg.split("=", 1)[1]
        elif arg.startswith("-X"):
            method = arg[2:]
        elif arg in ("-f", "-F", "--field", "--raw-field"):
            fields.append(value)
            step = 2
        elif arg.startswith(("--field=", "--raw-field=")):
            fields.append(arg.split("=", 1)[1])
        elif arg.startswith(("-f", "-F")) and not arg.startswith("--"):
            fields.append(arg[2:])
        elif arg == "--input":
            has_input, step = True, 2
        elif arg.startswith("--input="):
            has_input = True
        elif arg in GH_API_VALUE_OPTIONS:
            step = 2
        elif not arg.startswith("-") and endpoint is None:
            endpoint = arg
        i += step

    method = (method or "").upper()
    if method in ("GET", "HEAD"):
        return None
    if method:
        return f"`gh api -X {method}` writes to GitHub"
    if endpoint == "graphql":
        # gh always POSTs GraphQL and only a mutation writes, so the query must be readable here.
        # A query from a file, stdin, $VAR, ${VAR} or $(...) is not.
        queries = [value for name, _, value in (f.partition("=") for f in fields) if name == "query"]
        if has_input or not queries or any(
            q.startswith("@") or PLACEHOLDER in q or "${" in q or "{" not in q for q in queries
        ):
            return "`gh api graphql` sends a query the guard cannot read, which may be a mutation"
        if any(re.search(r"\bmutation\b", q) for q in queries):
            return "`gh api graphql` runs a mutation"
        return None
    if fields or has_input:
        return "`gh api` with -f/-F/--input sends a POST, which writes to GitHub"
    return None


def _git_reasons(args):
    i = 0
    while i < len(args) and args[i].startswith("-"):
        i += 2 if args[i] in GIT_VALUE_OPTIONS else 1
    if i >= len(args):
        return []
    sub, rest = args[i], args[i + 1:]
    if sub == "push":
        reason = _git_push_reason(rest)
    elif sub == "tag":
        reason = _git_tag_reason(rest)
    else:
        reason = None
    return [reason] if reason else []


def _git_push_reason(args):
    if "--dry-run" in args or "-n" in args:
        return None
    for flag in GIT_PUSH_TAG_OPTIONS:
        # git accepts any unambiguous prefix of a long option, such as --tag or --follow.
        if any(len(arg) > 2 and flag.startswith(arg) for arg in args):
            return f"`git push {flag}` pushes tags"
    refspecs = _positionals(args, GIT_PUSH_VALUE_OPTIONS)[1:]
    if "tag" in refspecs:
        return "`git push <remote> tag <name>` pushes a tag"
    for refspec in refspecs:
        for ref in refspec.lstrip("+").split(":"):
            # A variable such as "v$VERSION" is not expanded here, so only its prefix can tell.
            if ref.startswith(("refs/tags/", "v$")) or VERSION_REF.match(ref):
                return f"`git push` of `{refspec}` pushes or deletes a tag"
    return None


def _git_tag_reason(args):
    writes = any(a in GIT_TAG_WRITE_OPTIONS or a.startswith(("--message=", "--file=", "--local-user=")) for a in args)
    reads = any(a.startswith(GIT_TAG_READ_OPTIONS) for a in args)
    if writes or (not reads and _positionals(args, GIT_TAG_VALUE_OPTIONS)):
        return "`git tag` creates or deletes a tag"
    return None


def _ask(reason):
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "ask",
                "permissionDecisionReason": reason,
            }
        },
        sys.stdout,
    )


def main():
    raw = sys.stdin.read()
    try:
        event = json.loads(raw)
        if event.get("tool_name") not in ("Bash", "Monitor"):
            return
        reason = decide((event.get("tool_input") or {}).get("command") or "")
    except Exception:  # noqa: BLE001 - a guard bug must not let a guarded command through
        reason = "Could not check this command" if FALLBACK.search(raw) else None
    if reason:
        _ask(reason)


if __name__ == "__main__":
    main()
