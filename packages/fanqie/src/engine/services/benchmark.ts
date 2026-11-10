import { assertWorkspaceWritable } from "../../../../core/src/workspace-lock.js";
import { sha256 } from "../../../../core/src/fsx.js";
import { LibraryPort } from "../ports/library.js";
import {
  readingMetrics,
  buildReadingBenchmark,
  type ReadingBenchmark,
  parseOpeningTiming,
} from "../reading-radar.js";
import { readWorkMeta, writeWorkMeta } from "../storage/work-meta.js";
import { withResourceLock } from "../storage/process-lock.js";
import type { StoragePaths } from "../types.js";

export async function setReadingBenchmark(
  paths: StoragePaths,
  dir: string,
  sourceId: string | undefined,
  python?: string,
) {
  await assertWorkspaceWritable(dir);
  const before = JSON.stringify((await readWorkMeta(dir)).readingBenchmark);
  let benchmark: ReadingBenchmark | undefined;
  if (sourceId !== undefined) {
    const source = await LibraryPort.getSourceIndexed(paths, sourceId);
    const index = source.index.filter((row) => row.n > 0);
    if (!index.length || new Set(index.map((row) => row.n)).size !== index.length)
      throw new Error("对标书缺少章节标题或有重复章号");
    const chapters = index.slice(0, 30).map((row) => {
      const raw = source.text.slice(row.start, row.end),
        newline = raw.indexOf("\n");
      if (newline < 0 || !raw.slice(newline + 1).trim())
        throw new Error("对标书有空章，请先整理书源");
      return { number: row.n, body: raw.slice(newline + 1).trim() };
    });
    benchmark = buildReadingBenchmark(
      sourceId,
      source.text,
      await readingMetrics(chapters, python),
    );
    if (sha256((await LibraryPort.getSource(paths, sourceId)).text) !== benchmark.sourceHash)
      throw new Error("统计期间对标书已变化，请重新计算");
  }
  return withResourceLock(dir, async () => {
    await assertWorkspaceWritable(dir);
    const meta = await readWorkMeta(dir);
    if (JSON.stringify(meta.readingBenchmark) !== before) throw new Error("对标设置已变化，未覆盖");
    if (benchmark === undefined) delete meta.readingBenchmark;
    else meta.readingBenchmark = benchmark;
    await writeWorkMeta(dir, meta);
    return benchmark;
  });
}

export async function setReadingOpening(dir: string, value: unknown) {
  const opening = parseOpeningTiming(value);
  return withResourceLock(dir, async () => {
    await assertWorkspaceWritable(dir);
    const meta = await readWorkMeta(dir);
    if (!meta.readingBenchmark) throw new Error("请先设置对标书");
    meta.readingBenchmark = { ...meta.readingBenchmark, opening };
    await writeWorkMeta(dir, meta);
    return meta.readingBenchmark;
  });
}
