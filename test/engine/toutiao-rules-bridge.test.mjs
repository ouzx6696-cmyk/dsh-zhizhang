import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { importBundle } from "../support/bundle.mjs";
import { createFakeClock } from "../support/clock.mjs";
import { importTs } from "../support/ts-loader.mjs";

const { createLockService } = await importTs("packages/core/src/lock/index.ts");
const { FIXED_DELIVERY_ENDING, createArticle, transitionArticleStatus, writeDeliverySheet } =
  await importTs("packages/toutiao/src/index.ts");

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

test("头条 writeDeliverySheet 幂等防重复追加固定末句", async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "zhizhang-delivery-"));
  try {
    const clock = createFakeClock();
    const lock = createLockService(clock);
    const articleDir = path.join(dir, "tt-001");
    await createArticle(
      articleDir,
      {
        id: "tt-001",
        genre: "短图文",
        driver: "账本型",
        rulesVersion: "2.0",
        nowIso: clock.iso(),
      },
      lock,
    );
    await transitionArticleStatus(articleDir, "待验收", clock.iso(), lock);
    await transitionArticleStatus(articleDir, "已验收", clock.iso(), lock);

    const draftWithEnding = `正文内容。\n\n${FIXED_DELIVERY_ENDING}`;
    const deliveryPath = await writeDeliverySheet(
      articleDir,
      "标题",
      draftWithEnding,
      clock.iso(),
      lock,
    );
    const content = await fs.readFile(deliveryPath, "utf8");
    const occurrences = content.split(FIXED_DELIVERY_ENDING).length - 1;
    assert.equal(occurrences, 1, "固定末句只能出现一次");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
