/** state.add 的区间规划：开闭、截断、计划兑现与逆操作。 */
import { AppError } from "@zhizhang/core/errors";
import { sameValue, stateKey } from "./interval.js";
import type { AnyOp, StateEntry } from "./types.js";

export interface StateChange {
  before: StateEntry;
  after: StateEntry;
}

export interface StatePlan {
  entry: StateEntry;
  added: boolean;
  changes: StateChange[];
}

const clone = <T>(value: T): T => structuredClone(value);

function conflict(entry: StateEntry, existing: StateEntry, rule: string): never {
  throw new AppError("storage.conflict", `状态区间冲突：${entry.id} / ${existing.id}`, {
    rule,
    id: entry.id,
    existing: existing.id,
    since: entry.since,
  });
}

/** 不修改入参；调用方负责把 plan 应用到真源。 */
export function planStateAdd(states: StateEntry[], incoming: StateEntry): StatePlan {
  const entry = clone(incoming);
  if (entry.until !== undefined && entry.until <= entry.since) {
    throw new AppError("input.invalid", "状态区间 until 必须大于 since", {
      path: "$.entry.until",
      rule: "until_le_since",
    });
  }
  if (entry.mode === "add") return { entry, added: true, changes: [] };

  const changes: StateChange[] = [];
  const same = states.filter(
    (state) => state.mode === "replace" && stateKey(state) === stateKey(entry),
  );

  for (const current of same) {
    if (
      current.since < entry.since &&
      (current.until === undefined || current.until > entry.since)
    ) {
      const before = clone(current);
      const after: StateEntry = { ...before, until: entry.since, rev: before.rev + 1 };
      changes.push({ before, after });
      continue;
    }
    if (current.since === entry.since) {
      if (sameValue(current.value, entry.value)) {
        if (current.status === "confirmed" && entry.status === "confirmed") {
          return { entry, added: false, changes };
        }
        if (current.status === "planned" && entry.status === "confirmed") {
          const before = clone(current);
          const after: StateEntry = {
            ...before,
            status: "confirmed",
            ...(entry.evidence ? { evidence: entry.evidence } : {}),
            rev: before.rev + 1,
          };
          changes.push({ before, after });
          return { entry, added: false, changes };
        }
      }
      conflict(entry, current, "same_since");
    }
    if (current.since > entry.since && (entry.until === undefined || entry.until > current.since)) {
      if (current.status !== "planned") conflict(entry, current, "overlap_confirmed");
      entry.until = current.since;
    }
  }

  if (entry.until !== undefined && entry.until <= entry.since) {
    throw new AppError("input.invalid", "状态区间被截断为空", {
      path: "$.entry.until",
      rule: "until_le_since",
    });
  }
  return { entry, added: true, changes };
}

export function applyStatePlan(states: StateEntry[], plan: StatePlan): void {
  for (const change of plan.changes) {
    const index = states.findIndex((state) => state.id === change.before.id);
    if (index === -1) {
      throw new AppError("input.not_found", `State not found: ${change.before.id}`, {
        id: change.before.id,
      });
    }
    states[index] = change.after;
  }
  if (plan.added) states.push(plan.entry);
}

/** 逆操作：先删新条目，再把被关闭/兑现的旧条目按原样恢复。 */
export function invertStatePlan(plan: StatePlan): AnyOp[] {
  const inverse: AnyOp[] = [];
  if (plan.added) {
    inverse.push({ type: "state.delete", id: plan.entry.id, expectedRev: plan.entry.rev });
  }
  for (const change of [...plan.changes].reverse()) {
    inverse.push({
      type: "state.delete",
      id: change.before.id,
      expectedRev: change.after.rev,
    });
    inverse.push({ type: "state.add", entry: clone(change.before) });
  }
  return inverse;
}
