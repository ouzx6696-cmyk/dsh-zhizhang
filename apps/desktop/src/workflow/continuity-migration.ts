import path from "node:path";
import { readFile } from "node:fs/promises";
import { atomicWrite, readText, sha256 } from "../../../../packages/core/src/fsx";
import { readWorkMeta } from "../../../../packages/fanqie/src/engine/storage/work-meta";
import { withResourceLock } from "../../../../packages/fanqie/src/engine/storage/process-lock";
import { readContinuity, parseContinuity } from "./continuity";

/**
 * 把旧根基里的已发生、读者已知与伏笔逐行转成待确认条目，不自动认定为新事实。
 * 先按元数据哈希备份 meta.json（同一份元数据只备份一次），已在待确认或已确认里的行跳过。
 */
export function migrateLegacyContinuity(dir: string) {
  return withResourceLock(dir, async () => {
    const meta = await readWorkMeta(dir),
      state = await readContinuity(dir);
    const backup = path.join(
      dir,
      "writer-migration-backups",
      sha256(JSON.stringify(meta)).slice(0, 24) + ".json",
    );
    if ((await readText(backup)) === undefined)
      await atomicWrite(backup, await readFile(path.join(dir, "meta.json"), "utf8"));
    for (const [kind, source] of [
      ["thread", meta.foundation.threads],
      ["knowledge", meta.foundation.readerKnowledge],
      ["timeline", meta.foundation.happened],
    ] as const)
      for (const line of source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)) {
        const id = sha256(kind + line).slice(0, 24);
        if (
          !state.pending.some((row) => row.id === id) &&
          !state.facts.some((row) => row.subject === line.slice(0, 80) && row.value === line)
        )
          state.pending.push({
            id,
            kind,
            subject: line.slice(0, 80),
            value: line,
            quote: line,
            chapter: "legacy",
            bodyHash: sha256(line),
            reason: "旧自由文本迁移，尚未确认人物、时间及证据",
          });
      }
    await atomicWrite(
      path.join(dir, "writer-continuity.json"),
      JSON.stringify(parseContinuity(state), null, 2),
    );
    return { backup, state };
  });
}
