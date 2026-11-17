/** 动态状态区间：[since, until)。 */
import type { StateEntry } from "./types.js";

export function stateKey(entry: StateEntry): string {
  return [entry.entity, entry.facet, entry.field, entry.target ?? ""].join("\u0000");
}

export function statesOverlap(a: StateEntry, b: StateEntry): boolean {
  const aUntil = a.until ?? Number.POSITIVE_INFINITY;
  const bUntil = b.until ?? Number.POSITIVE_INFINITY;
  return a.since < bUntil && b.since < aUntil;
}

/** 计划值兑现比较：忽略首尾空白与连续空白。 */
export function sameValue(a: string, b: string): boolean {
  const norm = (value: string) => value.trim().replace(/\s+/g, " ");
  return norm(a) === norm(b);
}

export function replacesOverlap(states: StateEntry[]): [StateEntry, StateEntry][] {
  const groups = new Map<string, StateEntry[]>();
  for (const entry of states) {
    if (entry.mode !== "replace") continue;
    const key = stateKey(entry);
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }
  const out: [StateEntry, StateEntry][] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.since - b.since || a.id.localeCompare(b.id));
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        if (statesOverlap(sorted[i], sorted[j])) out.push([sorted[i], sorted[j]]);
      }
    }
  }
  return out;
}
