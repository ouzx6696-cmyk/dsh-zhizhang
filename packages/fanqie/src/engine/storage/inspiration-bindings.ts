import path from "node:path";
import { atomicWrite, exists, readJson } from "../../../../core/src/fsx.js";
import { NovelError } from "../errors.js";
import { asObject, asStringArray } from "../parse.js";
import type { StoragePaths } from "../types.js";
import { assertResourceId } from "./primitives.js";
import { withResourceLock } from "./process-lock.js";
export async function readInspirationBindings(
  root: string,
): Promise<Record<string, string[]> | undefined> {
  const value = await readJson<unknown>(path.join(root, "bindings.json"));
  if (value === undefined) return undefined;
  const raw = asObject(value, "灵感绑定索引"),
    bindings: Record<string, string[]> = {};
  for (const key of Object.keys(raw)) {
    assertResourceId(key, "作品 key");
    const ids = asStringArray(raw, key);
    if (!ids) throw new NovelError("bad_bindings", "参考卡绑定索引格式损坏，请保留并检查原文件。");
    bindings[key] = ids.map((id) => assertResourceId(id, "技法卡 id"));
  }
  return bindings;
}
/**
 * Removes card ids from the existing bindings index (same file shape). Scoped to one work when
 * `workKey` is given. Refuses while an inspiration apply is pending, since its recovery compares
 * bindings.json against the snapshot it took. Returns the works whose bindings changed.
 */
export async function unbindCards(
  paths: StoragePaths,
  cardIds: readonly string[],
  workKey?: string,
): Promise<string[]> {
  const root = paths.inspiration,
    file = path.join(root, "bindings.json"),
    drop = new Set(cardIds.map((id) => assertResourceId(id, "技法卡 id")));
  if (!drop.size || !(await exists(file))) return [];
  return withResourceLock(root, async () => {
    if (await exists(path.join(root, ".writer-inspiration-pending.json")))
      throw new NovelError(
        "inspiration_pending",
        "有未完成的灵感应用，先用 fanqie_inspire_status(recovery=inspect) 检查并恢复，再解除绑定。",
      );
    const bindings = (await readInspirationBindings(root)) ?? {},
      changed: string[] = [];
    for (const key of Object.keys(bindings)) {
      if (workKey !== undefined && key !== workKey) continue;
      const next = bindings[key].filter((id) => !drop.has(id));
      if (next.length === bindings[key].length) continue;
      bindings[key] = next;
      changed.push(key);
    }
    if (changed.length) await atomicWrite(file, JSON.stringify(bindings, null, 2) + "\n");
    return changed;
  });
}
