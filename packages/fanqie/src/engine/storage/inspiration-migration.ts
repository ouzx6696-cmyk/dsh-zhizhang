import path from "node:path";
import { Diagnostics } from "../../../../core/src/diagnostics.js";
import { stateRoot } from "../../../../core/src/paths.js";
import { atomicWrite, exists, listDir, nowIso, readJson } from "../../../../core/src/fsx.js";
import { NovelError } from "../errors.js";
import { asObject, asString, asStringArray } from "../parse.js";
import type { StoragePaths } from "../types.js";
import { assertResourceId } from "./primitives.js";
import { withResourceLock } from "./process-lock.js";
const MARKER = ".writer-bindings-migration.json";
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
async function completed(root: string) {
  const marker = await readJson<unknown>(path.join(root, MARKER));
  if (marker === undefined) return false;
  if (asObject(marker, "灵感迁移标记").version !== 1)
    throw new NovelError("bad_migration", "灵感迁移标记版本无效，请保留并核对。");
  return true;
}
/** Project initialization owns this migration; read paths never scan or rewrite legacy history. */
export async function migrateInspirationBindings(paths: StoragePaths) {
  const root = paths.inspiration,
    pending = path.join(root, ".writer-inspiration-pending.json");
  if (await completed(root)) return;
  if (await exists(pending)) return;
  await withResourceLock(root, async () => {
    if ((await completed(root)) || (await exists(pending))) return;
    const bindings = (await readInspirationBindings(root)) ?? {},
      hits: { workKey: string; sessionId: string; at: number }[] = [];
    for (const file of await listDir(path.join(root, "candidates"))) {
      if (!file.name.endsWith(".json")) continue;
      if (!file.isFile())
        throw new NovelError("bad_inspiration_candidate", `旧灵感候选不是普通文件：${file.name}`);
      const candidate = asObject(
        await readJson<unknown>(path.join(root, "candidates", file.name)),
        "旧灵感候选",
      );
      if (candidate.status !== "accepted" || candidate.appliedWorkKey === undefined) continue;
      const workKey = assertResourceId(asString(candidate, "appliedWorkKey", { required: true }));
      if (bindings[workKey]?.length) continue;
      const at = Date.parse(
        asString(candidate, "acceptedAt") ??
          asString(candidate, "updatedAt") ??
          asString(candidate, "createdAt", { required: true }),
      );
      if (!Number.isFinite(at))
        throw new NovelError("bad_inspiration_candidate", `旧灵感候选时间无效：${file.name}`);
      hits.push({
        workKey,
        sessionId: assertResourceId(asString(candidate, "sessionId", { required: true })),
        at,
      });
    }
    hits.sort((a, b) => b.at - a.at);
    for (const hit of hits) {
      const session = asObject(
        await readJson<unknown>(path.join(root, "sessions", `${hit.sessionId}.json`)),
        "旧灵感会话",
      );
      const ids = asStringArray(session, "cardIds") ?? [];
      const selected = bindings[hit.workKey] ?? [];
      for (const id of ids) {
        if (selected.length >= 24) break;
        const safe = assertResourceId(id, "技法卡 id");
        if (selected.includes(safe)) continue;
        const card = asObject(
          await readJson<unknown>(path.join(paths.library, "cards", `${safe}.json`)),
          "旧绑定技法卡",
        );
        if (card.status === "accepted") selected.push(safe);
        if (selected.length >= 24) break;
      }
      bindings[hit.workKey] = selected;
    }
    await atomicWrite(path.join(root, "bindings.json"), JSON.stringify(bindings, null, 2) + "\n");
    const works = Object.keys(bindings).length;
    await new Diagnostics(stateRoot()).write("inspiration_bindings_migrated", { root, works });
    await atomicWrite(
      path.join(root, MARKER),
      JSON.stringify({ version: 1, at: nowIso(), works }) + "\n",
    );
  });
}
