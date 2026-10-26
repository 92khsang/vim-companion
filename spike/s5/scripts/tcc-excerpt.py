#!/usr/bin/env python3
# Spike S5: cuts the raw output of
#   /usr/bin/log show --style compact --predicate 'subsystem == "com.apple.TCC" AND eventMessage CONTAINS "AUTHREQ"'
# down to the requests whose responsible process is one of the given identifiers, keeping every row
# of each request (AUTHREQ_CTX, AUTHREQ_ATTRIBUTION, AUTHREQ_SUBJECT and AUTHREQ_RESULT) in the
# original order, and prints a header that counts what was kept and what was left out. Other
# processes' requests are left out without naming them.
#   tcc-excerpt.py <raw log> <responsible identifier>... > <excerpt>
# Run sanitize.sh on the excerpt before committing it.
import collections
import re
import sys

raw_path, wanted = sys.argv[1], set(sys.argv[2:])
lines = open(raw_path, encoding="utf-8", errors="replace").read().splitlines()
msg_re = re.compile(r"msgID=([0-9.]+)")
responsible, accessing, service, result = {}, {}, {}, {}
for line in lines:
    m = msg_re.search(line)
    if not m:
        continue
    k = m.group(1)
    if "AUTHREQ_CTX" in line:
        s = re.search(r"service=(kTCCService\w+)", line)
        if s:
            service[k] = s.group(1)
    elif "AUTHREQ_ATTRIBUTION" in line:
        r = re.search(r"responsible=\{TCCDProcess: identifier=([^,}]+)", line)
        # The process that asked: `requesting=`, or `accessing=` when the row has only that.
        a = re.search(r"(?:requesting|accessing)=\{TCCDProcess: identifier=([^,}]+)", line)
        responsible[k] = r.group(1) if r else "none"
        accessing[k] = a.group(1) if a else "none"
    elif "AUTHREQ_RESULT" in line:
        v = re.search(r"authValue=(\d+)", line)
        if v:
            result[k] = v.group(1)
requests = set(service) | set(responsible) | set(result)
kept = {k for k in requests if responsible.get(k) in wanted}
others = collections.Counter(responsible.get(k, "none") for k in requests - kept)
stamps = [l[:23] for l in lines if re.match(r"\d{4}-\d\d-\d\d \d\d:\d\d:\d\d", l)]
print(f"# Raw log: {len(lines)} lines from {stamps[0]} to {stamps[-1]}, {len(requests)} requests.")
print(f"# Kept: every row of the {len(kept)} requests whose responsible process is one of "
      f"{', '.join(sorted(wanted))}.")
n_other = sum(1 for r in others if r != "none")
print(f"# Left out: {sum(n for r, n in others.items() if r != 'none')} requests of {n_other} other "
      f"responsible process{'es' if n_other != 1 else ''} and "
      f"{others.get('none', 0)} requests without an attribution row.")
print("# Kept requests by responsible process, requesting process, service and authValue:")
counts = collections.Counter(
    (responsible[k], accessing[k], service.get(k, "none"), result.get(k, "none")) for k in kept)
for (r, a, s, v), n in sorted(counts.items(), key=lambda x: (x[0][0], -x[1], x[0][1], x[0][2])):
    print(f"#  {n:4d} responsible={r} requesting={a} service={s} authValue={v}")
apple_events = sum(1 for l in lines if "kTCCServiceAppleEvents" in l)
print(f"# Rows that name kTCCServiceAppleEvents anywhere in the raw log: {apple_events}.")
for line in lines:
    m = msg_re.search(line)
    if m and m.group(1) in kept:
        print(line)
