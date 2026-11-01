import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const identities = new WeakMap();
const ledgers = new Map();

export function processIdentity(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return { pid, group: Number(fields[2]), startTicks: fields[19] };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export function ownedIdentities(children) {
  return children
    .map((child) => {
      const identity = identities.get(child) ?? processIdentity(child.pid);
      if (identity) identities.set(child, identity);
      return identity;
    })
    .filter(Boolean);
}
export function recordOwned(file, children) {
  const known = ledgers.get(file) ?? new Map();
  ledgers.set(file, known);
  for (const identity of ownedIdentities(children))
    known.set(identity.group, identity);
  const groups = [...known.values()];
  for (const group of groups)
    if (group.group !== group.pid)
      throw new Error("owned child is not a private process group");
  if (typeof process.send === "function")
    process.send({ s1Ownership: true, writerPid: process.pid, groups });
  const temporary = file + ".tmp";
  writeFileSync(temporary, JSON.stringify({ writerPid: process.pid, groups }), {
    mode: 0o600,
  });
  renameSync(temporary, file);
}
export function readOwned(file, writerPid) {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (value.writerPid !== writerPid)
      throw new Error("unexpected process-ledger owner");
    return value.groups;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
export function groupAlive(group) {
  const current = processIdentity(group.pid);
  if (current && current.startTicks !== group.startTicks)
    throw new Error("owned PID has been reused; refusing to signal it");
  try {
    process.kill(-group.group, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}
export function signalOwned(group, signal) {
  if (!groupAlive(group)) return false;
  try {
    process.kill(-group.group, signal);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}
export async function terminateOwned(
  groups,
  { graceMs = 3000, killWaitMs = 2000 } = {},
) {
  const unique = [
    ...new Map(
      groups.filter(Boolean).map((group) => [group.group, group]),
    ).values(),
  ];
  const record = {
    started: new Date().toISOString(),
    groups: unique,
    signals: [],
    errors: [],
  };
  const blocked = new Set();
  const alive = (group) => {
    if (blocked.has(group.group)) return false;
    try {
      return groupAlive(group);
    } catch (error) {
      blocked.add(group.group);
      record.errors.push({ group: group.group, error: String(error) });
      return false;
    }
  };
  const signal = (group, name) => {
    try {
      if (signalOwned(group, name))
        record.signals.push({
          group: group.group,
          signal: name,
          at: new Date().toISOString(),
        });
    } catch (error) {
      blocked.add(group.group);
      record.errors.push({ group: group.group, error: String(error) });
    }
  };
  for (const group of unique) signal(group, "SIGTERM");
  const wait = async (deadline) => {
    while (Date.now() < deadline && unique.some(alive)) await sleep(25);
  };
  await wait(Date.now() + graceMs);
  for (const group of unique) if (alive(group)) signal(group, "SIGKILL");
  await wait(Date.now() + killWaitMs);
  record.remaining = unique.filter(
    (group) => alive(group) || blocked.has(group.group),
  );
  record.finished = new Date().toISOString();
  return record;
}
