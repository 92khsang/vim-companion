#!/usr/bin/env python3
"""Spike S5 script (spike/s5/scripts/console-state.py at commit 8fc284d, unchanged). Prints the console state from `ioreg -n Root -d1 -a`: whether a user is on the console and
whether the screen is locked. Usage: python3 -I console-state.py <plist file>"""
import plistlib
import sys

d = plistlib.load(open(sys.argv[1], "rb"))
users = [u for u in d.get("IOConsoleUsers", []) if u.get("kCGSSessionOnConsoleKey")]
locked = any(u.get("CGSSessionScreenIsLocked") for u in users)
print(("on-console" if users else "no-console-user") + " " + ("locked" if locked else "unlocked"))
