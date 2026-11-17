import { AppError } from "@zhizhang/core/errors";
import type { PendingBatch, PendingItem } from "./types.js";
const REFS = new Set([
  "entity",
  "holder",
  "target",
  "cast",
  "pov",
  "location",
  "parent",
  "entities",
  "related",
  "thread",
  "keep",
  "drop",
]);
/** 作者把“待建实体”关联到现有实体后，同批次的子提案同步引用该实体。 */
export function remapBatchReferences(batch: PendingBatch): void {
  const mapping = new Map<string, string>();
  for (const item of batch.items)
    if (
      item.op.type === "entity.upsert" &&
      item.edited?.type === "entity.upsert" &&
      item.op.entity.id !== item.edited.entity.id
    )
      mapping.set(item.op.entity.id, item.edited.entity.id);
  if (!mapping.size) return;
  const visit = (value: unknown, key = ""): unknown => {
    if (typeof value === "string") return REFS.has(key) ? (mapping.get(value) ?? value) : value;
    if (Array.isArray(value)) return value.map((entry) => visit(entry, key));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, visit(entry, key)]),
      );
    return value;
  };
  for (const item of batch.items) {
    if (item.committed) continue;
    const op = visit(item.edited ?? item.op);
    // 复用唯一的操作解析器，不以断言绕过引用改写后的契约。
    if (item.edited) item.edited = AnyOpSchema(op);
    else item.op = AnyOpSchema(op);
  }
}
import { AnyOpSchema } from "./ops-schema.js";
export function sortedBatch(batch: PendingBatch): PendingBatch["items"] {
  const accepted = new Map(
    batch.items
      .filter((item) => item.decision === "accept" || item.decision === "edit")
      .map((item) => [item.id, item]),
  );
  const indegree = new Map<string, number>();
  const followers = new Map<string, string[]>();
  for (const item of accepted.values()) {
    indegree.set(item.id, 0);
    followers.set(item.id, []);
  }
  for (const item of accepted.values()) {
    for (const dependency of item.dependsOn) {
      if (!accepted.has(dependency)) continue;
      indegree.set(item.id, (indegree.get(item.id) ?? 0) + 1);
      followers.get(dependency)?.push(item.id);
    }
  }
  const queue = [...accepted.values()]
    .filter((item) => (indegree.get(item.id) ?? 0) === 0)
    .map((item) => item.id);
  const out: PendingItem[] = [];
  while (queue.length > 0) {
    const id = queue[0];
    queue.shift();
    const item = accepted.get(id);
    if (!item) continue;
    out.push(item);
    for (const follower of followers.get(id) ?? []) {
      indegree.set(follower, (indegree.get(follower) ?? 0) - 1);
      if ((indegree.get(follower) ?? 0) === 0) queue.push(follower);
    }
  }
  if (out.length !== accepted.size) {
    throw new AppError("input.invalid", "待确认条目存在循环依赖", { rule: "dependency_cycle" });
  }
  return out;
}
