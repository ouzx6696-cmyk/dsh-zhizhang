import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const cli = fileURLToPath(new URL("../scripts/fanqie-corpus.mjs", import.meta.url));
async function corpus(t, books) {
  const dir = await mkdtemp(path.join(tmpdir(), "fanqie-corpus-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await Promise.all(books.map((book, i) => writeFile(path.join(dir, `${i}.txt`), book.body)));
  const manifest = path.join(dir, "input.json");
  await writeFile(
    manifest,
    JSON.stringify({
      books: books.map((book, i) => ({ id: `sample-${i}`, kind: book.kind, file: `${i}.txt` })),
    }),
  );
  return (...args) =>
    spawnSync(process.execPath, [cli, "--manifest", manifest, ...args], { encoding: "utf8" });
}

test("离线标尺经真实章节解析和雷达统计，区分两组并不泄露正文", async (t) => {
  const run = await corpus(t, [
    { kind: "human", body: "\uFEFF第一章 章标题不计\r\n门开了。\r\n\r\n“走😀！”\r\n……\r\n" },
    { kind: "ai", body: "第1章 样例\n他觉得门外有些许异常。\n---\n" },
  ]);
  const result = run("--limit", "1");
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  const human = report.books[0].chapters[0];
  assert.equal(human.characters, 9);
  assert.equal(human.paragraphs, 2);
  assert.equal(human.dialogueShare, 0.3333);
  assert.equal(human.endingCharacters, 5);
  assert.equal(human.separatorLinesExcluded, 1);
  assert.equal(human.shortParagraphShare, 1);
  assert.equal(report.evaluation.groups.human.chapterWarningRate, 0);
  assert.equal(report.evaluation.groups.ai.chapterWarningRate, 1);
  assert.equal(report.evaluation.warningRateGap, 1);
  assert.equal(report.evaluation.status, "baseline-only");
  assert.match(report.linterHash, /^[a-f0-9]{64}$/);
  assert.match(report.books[0].sourceHash, /^[a-f0-9]{64}$/);
  for (const fragment of ["门开了", "走😀", "章标题不计", "他觉得", "异常"])
    assert.equal(result.stdout.includes(fragment), false);
});

test("缺AI组、不足30章及章号缺口明确标记数据不足", async (t) => {
  const run = await corpus(t, [{ kind: "human", body: "第2章 样例\n门开了。\n" }]);
  const report = JSON.parse(run().stdout);
  assert.equal(report.evaluation.status, "insufficient-data");
  assert.equal(report.evaluation.groups.ai.chapterWarningRate, null);
  assert.equal(report.books[0].sampleComplete, false);
  assert.equal(JSON.parse(run("--limit", "1").stdout).books[0].sampleComplete, false);
});

test("重复章号、空章、无目录、错误编码及无效参数不被当成有效样本", async (t) => {
  for (const body of ["第1章 一\n门开了。\n第1章 二\n他出门了。", "第1章 空\n", "没有章节标题"]) {
    const run = await corpus(t, [{ kind: "human", body }]);
    assert.notEqual(run().status, 0);
  }
  const run = await corpus(t, [{ kind: "human", body: Buffer.from([0xff, 0xfe]) }]);
  assert.notEqual(run().status, 0);
  assert.notEqual(run("--limit", "0").status, 0);
});
