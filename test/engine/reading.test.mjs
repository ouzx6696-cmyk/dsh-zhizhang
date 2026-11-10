import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureStorage } from "../../build/fanqie/src/engine/storage/paths.js";
import { createWork } from "../../build/fanqie/src/engine/work-store.js";
import { LibraryPort } from "../../build/fanqie/src/engine/ports/library.js";
import {
  setReadingBenchmark,
  setReadingOpening,
} from "../../build/fanqie/src/engine/services/benchmark.js";
import { readWorkMeta } from "../../build/fanqie/src/engine/storage/work-meta.js";
import { scanStyle, scanWorkStyle } from "../../build/fanqie/src/engine/style-linter.js";
import { withPluginConfig } from "../../build/fanqie/src/engine/runtime-config.js";
import {
  readingMetrics,
  readingWarnings,
  DEFAULT_READING_TARGETS,
  parseOpeningTiming,
} from "../../build/fanqie/src/engine/reading-radar.js";

test("对标书只存数值，可标注时序和清除；统计与实验密度路径复用生产扫描", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "reading-benchmark-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = await ensureStorage(null, { storageRoot: root });
  const { dir } = await createWork(paths, { key: "reading", title: "对标" });
  const raw =
    "第1章 入口\n他觉得风里有些许冷意。\n“走😀！”\n第2章 票\n些许纸灰落在门边。\n他拿到了一张票。\n";
  const file = path.join(root, "source.txt");
  await writeFile(file, raw);
  const source = await LibraryPort.importSource(paths, { title: "统计源", file });
  const benchmark = await setReadingBenchmark(paths, dir, source.sourceId);
  assert.equal(benchmark.sampledChapters, 2);
  assert.ok(benchmark.targets.dialogueShare[1] > 0);
  const stored = (await readWorkMeta(dir)).readingBenchmark;
  assert.equal(JSON.stringify(stored).includes("纸灰落在门边"), false);
  await setReadingOpening(dir, { anomalyRatio: 0.3, abilityChapter: 2, firstPayoffChapter: 3 });
  assert.equal((await readWorkMeta(dir)).readingBenchmark.opening.anomalyRatio, 0.3);
  assert.throws(() =>
    parseOpeningTiming({ anomalyRatio: 2, abilityChapter: 1, firstPayoffChapter: 1 }),
  );
  const prose = "他觉得门外有些许冷意。" + "他推开门走进了站台。".repeat(50);
  const legacy = await scanStyle(prose, Infinity);
  const modern = await withPluginConfig({ pursuit: { radar: true } }, () =>
    scanWorkStyle(dir, prose),
  );
  assert.ok(legacy.totalHits > modern.totalHits);
  assert.equal(
    modern.hits.some((hit) => hit.match.startsWith("他觉得")),
    false,
  );
  const [metrics] = await readingMetrics([
    { number: 1, body: "此前" + "旧事".repeat(80) + "。\n……\n“走😀！”" },
  ]);
  assert.equal(metrics.dialogueShare > 0, true);
  assert.ok(metrics.recapCharacters > 150);
  assert.ok(
    readingWarnings(metrics, DEFAULT_READING_TARGETS, 2000).some((w) => w.includes("回顾")),
  );
  await setReadingBenchmark(paths, dir, undefined);
  assert.equal((await readWorkMeta(dir)).readingBenchmark, undefined);
  const invalid = path.join(root, "invalid.txt");
  await writeFile(invalid, "没有目录");
  const bad = await LibraryPort.importSource(paths, { title: "无目录", file: invalid });
  await assert.rejects(setReadingBenchmark(paths, dir, bad.sourceId), /缺少章节标题/);
});
