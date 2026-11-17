import type { IdSource } from "@zhizhang/core/id";
import type { BibleSnapshot, PendingItem } from "../bible/types.js";
import { nodesOf, type Outline } from "../outline/store.js";
import { nameKey, type LocatedItem } from "./extract.js";
import { attrCompat } from "./match.js";
export function allocateNames(
  located: LocatedItem[],
  bible: BibleSnapshot,
  outline: Outline,
  previous: PendingItem[],
  ids: IdSource,
): Map<string, string> {
  const names = new Map<string, string>();
  const entityCandidates = new Map<string, { id: string; attributes?: Record<string, string> }[]>();
  const remember = (key: string, value: { id: string; attributes?: Record<string, string> }) => {
    const items = entityCandidates.get(key);
    if (items) {
      if (!items.some((item) => item.id === value.id)) items.push(value);
    } else entityCandidates.set(key, [value]);
    if (!names.has(key)) names.set(key, value.id);
  };
  for (const entity of bible.entities)
    for (const name of [entity.name, ...entity.aliases])
      remember(`${entity.kind}:${nameKey(name)}`, { id: entity.id, attributes: entity.attributes });
  for (const { node } of nodesOf(outline)) names.set(`node:${nameKey(node.title)}`, node.id);
  for (const thread of bible.threads) names.set(`thread:${nameKey(thread.title)}`, thread.id);
  for (const pending of previous) {
    const op = pending.edited ?? pending.op;
    if (op.type === "entity.upsert")
      for (const name of [op.entity.name, ...op.entity.aliases])
        remember(`${op.entity.kind}:${nameKey(name)}`, {
          id: op.entity.id,
          attributes: op.entity.attributes,
        });
    if (op.type === "node.create") names.set(`node:${nameKey(op.node.title)}`, op.node.id);
    if (op.type === "thread.upsert") names.set(`thread:${nameKey(op.thread.title)}`, op.thread.id);
  }
  // 先分配 id，跨块 / 前向引用不依赖抽取顺序。
  for (const { item } of located) {
    if (item.type === "entity") {
      const key = `${item.kind}:${nameKey(item.name)}`,
        candidates = entityCandidates.get(key) ?? [],
        aliasCandidates = (item.aliases ?? []).flatMap(
          (alias) => entityCandidates.get(`${item.kind}:${nameKey(alias)}`) ?? [],
        ),
        compatible = [...candidates, ...aliasCandidates].find(
          (candidate) => attrCompat(item.attributes, candidate.attributes) > 0,
        ),
        id = item.ref ?? compatible?.id ?? ids.next("ent");
      remember(key, { id, attributes: item.attributes });
      for (const alias of item.aliases ?? [])
        remember(`${item.kind}:${nameKey(alias)}`, { id, attributes: item.attributes });
      names.set(item.tmp, id);
      names.set(item.tmp.replace(/^c\d+:/u, ""), id);
    } else if (["volume", "act", "chapter", "thread"].includes(item.type) && "title" in item) {
      const key = `${item.type === "thread" ? "thread" : "node"}:${nameKey(item.title)}`;
      if (!names.has(key))
        names.set(
          key,
          item.ref ??
            ids.next(
              item.type === "volume"
                ? "vol"
                : item.type === "act"
                  ? "act"
                  : item.type === "chapter"
                    ? "pl"
                    : "th",
            ),
        );
      names.set(item.tmp, names.get(key) ?? "");
      names.set(item.tmp.replace(/^c\d+:/u, ""), names.get(key) ?? "");
    }
  }
  return names;
}
