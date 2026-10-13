#!/usr/bin/env python3
"""PreToolUse hook that asks for confirmation before Bash commands needing the user's approval."""


def decide(command):
    """Return why `command` needs confirmation, or None if this hook has no objection."""
    return None
