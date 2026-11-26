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

test("toutiao pure-TS limits、styles 与 checkCard 完整校验规则表与立项卡", async () => {
  const { createRulesBridge } = await importBundle("packages/toutiao/src/rules/bridge.ts");
  const bridge = createRulesBridge(SCRIPTS);

  const info = await bridge.limits();
  assert.equal(info.title_max, 34);
  assert.equal(info.pass_score, 84);
  assert.ok(info.drivers.includes("账本型"));
  assert.ok(info.lines.includes("资讯线"));

  const styles = await bridge.styles();
  assert.ok(styles.allOpenings.length >= 6);
  assert.ok(styles.allEndings.length >= 5);

  const dir = mkdtempSync(path.join(tmpdir(), "zz-card-"));
  try {
    const good = path.join(dir, "good.json");
    const bad = path.join(dir, "bad.json");
    writeFileSync(good, JSON.stringify({ 内容线: "资讯线", 主标题: "测试标题" }));
    writeFileSync(bad, JSON.stringify({ 主标题: 3 }));
    assert.deepEqual(await bridge.checkCard(good), { ok: true, errors: [] });
    const res = await bridge.checkCard(bad);
    assert.equal(res.ok, false);
    assert.match(res.errors.join(""), /主标题/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("toutiao pure-TS qa、ledgerAdd/Show/Status 与 metricsImport 闭环（含公式防注入）", async () => {
  const { createRulesBridge } = await importBundle("packages/toutiao/src/rules/bridge.ts");
  const bridge = createRulesBridge(SCRIPTS);
  const dir = await fs.mkdtemp(path.join(tmpdir(), "zz-qa-ts-"));
  try {
    const ledgerPath = path.join(dir, "ledger.csv");
    const overlongDraft = path.join(dir, "overlong.md");
    await fs.writeFile(
      overlongDraft,
      `# ${"超长标题用来触发三十四字硬闸校验并且超出限制".repeat(2)}\n\n正文段落一，讲清事件经过和实际账目。2026年3月，一家社区门诊公开收费明细，平均单次花费下降35%。\n\n正文段落二，补充一线数据与对比，帮读者看懂省下的钱花在哪里。\n`,
      "utf8",
    );
    const failQa = await bridge.qa({ file: overlongDraft, mode: "short" });
    assert.equal(failQa.ok, true);
    assert.equal(failQa.passed, false);
    assert.ok(failQa.hard_gates.some((g) => g.includes("标题超过") || g.includes("34")));

    const card1Path = path.join(dir, "card-1.json");
    const card2Path = path.join(dir, "card-2.json");
    await fs.writeFile(
      card1Path,
      JSON.stringify({
        体裁: "短图文",
        内容线: "资讯线",
        主驱动: "账本型",
        母体: "数字反差式",
        开头式: "事实落点",
        结尾式: "留个具体问题",
        主标题: "社区食堂把菜价降到十二块，三个月后老板算出了新账",
      }),
      "utf8",
    );
    await fs.writeFile(
      card2Path,
      JSON.stringify({
        体裁: "短图文",
        内容线: "资讯线",
        主驱动: "账本型",
        母体: "数字反差式",
        开头式: "事实落点",
        结尾式: "留个具体问题",
        主标题: "=SUM(A1:A2)防注入测试",
      }),
      "utf8",
    );

    const add1 = await bridge.ledgerAdd({
      card: card1Path,
      ledger: ledgerPath,
      articleId: "art-1",
      status: "已验收",
      date: "2026-03-01",
    });
    assert.equal(add1.ok, true);

    const add2 = await bridge.ledgerAdd({
      card: card2Path,
      ledger: ledgerPath,
      articleId: "art-2",
      status: "已验收",
      date: "2026-03-02",
    });
    assert.equal(add2.ok, true);

    const shown = await bridge.ledgerShow({ ledger: ledgerPath, last: 5 });
    assert.equal(shown.ok, true);
    assert.equal(shown.total, 2);
    const csvRaw = await fs.readFile(ledgerPath, "utf8");
    assert.ok(csvRaw.includes("'=SUM(A1:A2)"), "公式注入字符在 CSV 落盘时须转义");
    assert.equal(shown.rows[1]["主标题"], "=SUM(A1:A2)防注入测试", "读回台账时应还原原始标题");

    const statusRes = await bridge.ledgerStatus({
      title: "社区食堂把菜价降到十二块，三个月后老板算出了新账",
      to: "已发",
      ledger: ledgerPath,
      articleId: "art-1",
    });
    assert.equal(statusRes.ok, true);
    assert.equal(statusRes.row?.["状态"], "已发");

    const importRes = await bridge.metricsImport({
      articleId: "art-1",
      ledger: ledgerPath,
      metricsJson: JSON.stringify([{ 日期: "2026-03-05", 展现: "12000", 阅读: "1800" }]),
    });
    assert.equal(importRes.ok, true);
    assert.equal(importRes.row?.["阅读"], "1800");

    const goodDraft = path.join(dir, "good.md");
    await fs.writeFile(
      goodDraft,
      [
        "# 社区食堂把菜价降到十二块，三个月后老板算出了新账",
        "",
        "2026年3月，杭州拱墅区一家开在老小区门口的社区食堂贴出一张新账单：两荤一素12元，老人再减2元。大家本来以为撑不过两个月，结果三个月过去，日均客流从140人涨到380人。",
        "",
        "## 这笔账怎么算出来的",
        "",
        "老板老周没靠补贴硬扛，他先把最占成本的三项拆开算了一遍。第一是采购，附近三家菜场每天早市六点半前收尾货，按整筐拿价，单斤青菜能省1.4元；第二是人手，后厨从四个人改成三个人配半成品切配，每月人工省下6500元；第三是翻台，午市十一点到一点半错峰开窗，老人十一点先吃，上班族十二点来，桌面周转翻了一倍。",
        "",
        "有人算过，一单毛利看着只有3.2元，可一天380单就是1216元，一个月净剩近一万八，比以前卖22元套餐反而稳当。",
        "",
        "## 普通人能看懂的门道",
        "",
        "很多街边小店总觉得涨价才能活，其实老社区最认的是确定性：明码标价、分量不缩水、天天开灯。你把饭菜做踏实，回头客就会替你省下所有推广费。",
        "",
        "你家附近也有这种越便宜越红火的小店吗？说说你最常点的那道菜。",
      ].join("\n"),
      "utf8",
    );

    const qaWithLedger = await bridge.qa({
      file: goodDraft,
      card: card1Path,
      ledger: ledgerPath,
      mode: "short",
      articleId: "art-3",
    });
    assert.equal(qaWithLedger.ok, true);
    assert.ok(typeof qaWithLedger.overall === "number" && qaWithLedger.overall > 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
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
