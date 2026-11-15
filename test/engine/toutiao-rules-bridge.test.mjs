import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { importBundle } from "../support/bundle.mjs";

const SCRIPTS = "packages/toutiao/skill/scripts";

test("toutiao checkCard validates a card without needing a draft file", async () => {
  const { createRulesBridge } = await importBundle("packages/toutiao/src/rules/bridge.ts");
  const bridge = createRulesBridge(SCRIPTS);
  const dir = mkdtempSync(path.join(tmpdir(), "zz-card-"));
  const good = path.join(dir, "good.json");
  const bad = path.join(dir, "bad.json");
  writeFileSync(good, JSON.stringify({ 内容线: "资讯线", 主标题: "测试标题" }));
  writeFileSync(bad, JSON.stringify({ 主标题: 3 }));
  assert.deepEqual(await bridge.checkCard(good), { ok: true, errors: [] });
  const res = await bridge.checkCard(bad);
  assert.equal(res.ok, false);
  assert.match(res.errors.join(""), /主标题/);
});

test("toutiao S3 motifs are read from the 母体 table", async () => {
  const { parseMotifsFromS3 } = await importBundle("packages/toutiao/src/domain/motifs.ts");
  const md = readFileSync("packages/toutiao/skill/references/s3-headline.md", "utf8");
  const names = parseMotifsFromS3(md).map((m) => m.name);
  assert.deepEqual(names, ["数字反差式", "身份点名式", "悬念缺口式", "原话现场式", "时间坐标式"]);
});
