import type { IdSource } from "@zhizhang/core/id";
import type { EntityKind, PendingItem, Provenance } from "../bible/types.js";
import type { LocatedItem } from "./extract.js";
export function addRelations(
  rows: LocatedItem[],
  result: PendingItem[],
  entityId: (name: string, kind?: EntityKind) => string,
  ids: IdSource,
  provenance: Provenance,
) {
  const seen = new Set<string>();
  for (const { item } of rows) {
    if (item.type !== "entity") continue;
    const entity = entityId(item.name, item.kind);
    const parent = result.find(
      (row) => row.op.type === "entity.upsert" && row.op.entity.id === entity,
    );
    for (const relation of item.relations ?? []) {
      const target = entityId(relation.to),
        key = `${entity}:${target}:${relation.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const dependency = result.find(
        (row) => row.op.type === "entity.upsert" && row.op.entity.id === target,
      );
      result.push({
        id: ids.next("p"),
        op: {
          type: "state.add",
          entry: {
            id: ids.next("st"),
            entity,
            target,
            facet: "relation",
            field: "关系",
            value: relation.label,
            since: 1,
            mode: "replace",
            status: "planned",
            provenance,
            src: parent?.src,
            rev: 0,
          },
        },
        group: entity,
        change: "new",
        decision: "undecided",
        dependsOn: [...(parent ? [parent.id] : []), ...(dependency ? [dependency.id] : [])],
        notes: [],
        src: parent?.src,
      });
    }
  }
}
export function completeThreadRefs(
  result: PendingItem[],
  ids: IdSource,
  provenance: Provenance,
  created: Map<string, string>,
) {
  const newThreads = new Map<string, string>();
  for (const pending of [...result]) {
    if (pending.op.type !== "node.create") continue;
    for (const ref of [...(pending.op.node.plant ?? []), ...(pending.op.node.pay ?? [])]) {
      if (ref.thread) {
        pending.dependsOn.push(ref.thread);
        continue;
      }
      if (!ref.title) continue;
      let id = newThreads.get(ref.title);
      if (!id) {
        id = ids.next("th");
        newThreads.set(ref.title, id);
        const itemId = ids.next("p");
        created.set(id, itemId);
        result.push({
          id: itemId,
          op: {
            type: "thread.upsert",
            thread: {
              id,
              title: ref.title,
              kind: "foreshadow",
              opened: 1,
              importance: "minor",
              beats: [],
              status: "open",
              provenance,
              rev: 0,
            },
          },
          group: "threads",
          change: "new",
          decision: "undecided",
          dependsOn: [],
          notes: ["import.unresolved_reference"],
        });
      }
      ref.thread = id;
      delete ref.title;
      pending.dependsOn.push(id);
    }
  }
}
