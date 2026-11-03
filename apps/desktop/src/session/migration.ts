import path from "node:path";
import { createHash } from "node:crypto";
import {
  atomicWrite,
  exists,
  listDir,
  readText,
  serialize,
} from "../../../../packages/core/src/fsx";
import { rootIdentity } from "../../../../packages/core/src/identity";
import type { Sessions } from "./manager";
import type { Target } from "../context";
function parseHistory(text: string | undefined): string[] {
  const rows: unknown = JSON.parse(text ?? "[]");
  if (!Array.isArray(rows) || !rows.every((row: unknown) => typeof row === "string"))
    throw new Error("会话历史索引损坏");
  return rows;
}
/** Move the legacy lookup cost to target initialization; normal history reads stay pure. */
export async function migrateSessionHistory(host: Sessions, target: Target) {
  const root = path.join(host.home, "sessions"),
    dir = await host.directory(target),
    marker = path.join(dir, "migration.json");
  await serialize("session-migration:" + dir, async () => {
    if (await exists(marker)) return;
    let migrated = 0;
    if (target.mode === "fanqie" && !(await exists(path.join(dir, "current")))) {
      for (const entry of await listDir(root)) {
        if (!entry.isDirectory() || entry.name === host.key(target)) continue;
        const old = path.join(root, entry.name),
          current = await readText(path.join(old, "current"));
        if (!current) continue;
        const text = await readText(current);
        if (!text) throw new Error("旧会话正文缺失：" + current);
        const header: unknown = JSON.parse(text.split("\n", 1)[0]);
        if (
          !header ||
          typeof header !== "object" ||
          !("cwd" in header) ||
          typeof header.cwd !== "string"
        )
          throw new Error("旧会话头损坏：" + current);
        if (rootIdentity(header.cwd) !== rootIdentity(target.root)) continue;
        const oldKey = createHash("sha256")
          .update(
            JSON.stringify({
              mode: target.mode,
              root: path.resolve(header.cwd),
              ...(target.work ? { work: target.work } : {}),
            }),
          )
          .digest("hex")
          .slice(0, 24);
        if (entry.name !== oldKey) continue;
        await atomicWrite(path.join(dir, "current"), current);
        const history = parseHistory(await readText(path.join(old, "history.json")));
        await atomicWrite(path.join(dir, "history.json"), JSON.stringify(history));
        migrated++;
        break;
      }
    }
    if (target.article) {
      const old = await host.directory({ ...target, article: undefined });
      const history = parseHistory(await readText(path.join(dir, "history.json")));
      const legacy = parseHistory(await readText(path.join(old, "history.json")));
      const current = await readText(path.join(old, "current"));
      const merged = [...new Set([...history, ...legacy, ...(current ? [current] : [])])];
      if (merged.length !== history.length) {
        await atomicWrite(path.join(dir, "history.json"), JSON.stringify(merged));
        migrated += merged.length - history.length;
      }
    }
    host.extras.log?.("legacy_sessions_migrated", { count: migrated, mode: target.mode });
    await atomicWrite(
      marker,
      JSON.stringify({ version: 1, at: new Date().toISOString(), count: migrated }),
    );
  });
}
