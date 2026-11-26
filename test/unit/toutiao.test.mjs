import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { FIXED_DELIVERY_ENDING, ARTICLE_STATUSES, assertArticleTransition } = await importTs(
  "packages/toutiao/src/domain/status.ts",
);
const { extractClaimCandidates } = await importTs("packages/toutiao/src/domain/index.ts");
const { createRulesBridge } = await importTs("packages/toutiao/src/rules/index.ts");
const {
  filterChangedParagraphClaims,
  mergeFactResults,
  resolveDraftTrack,
  selectBestDraftCandidate,
} = await importTs("packages/toutiao/src/pipelines/article/rules.ts");
const { isAppError } = await importTs("packages/core/src/errors/index.ts");

test("toutiao fixed ending sentence and status state machine enforce transitions", () => {
  assert.equal(FIXED_DELIVERY_ENDING, "——AI 到此止步。是否采用、何时发布由你决定。");
  assert.deepEqual([...ARTICLE_STATUSES], ["初稿待改", "待验收", "已验收", "验收退回", "已交稿"]);

  assert.doesNotThrow(() => assertArticleTransition("初稿待改", "待验收"));
  assert.doesNotThrow(() => assertArticleTransition("待验收", "已验收"));
  assert.doesNotThrow(() => assertArticleTransition("已验收", "已交稿"));

  assert.throws(
    () => assertArticleTransition("初稿待改", "已交稿"),
    (err) => isAppError(err, "gate.denied"),
  );
  assert.throws(
    () => assertArticleTransition("已交稿", "初稿待改"),
    (err) => isAppError(err, "gate.denied"),
  );
});

test("toutiao pure-TS rules bridge limits and qa enforce 34-char title max", async () => {
  const bridge = createRulesBridge();
  const limits = await bridge.limits();
  assert.equal(limits.ok, true);
  assert.equal(limits.title_max, 34);
  assert.equal(limits.pass_score, 84);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-toutiao-"));
  try {
    const okTitle = "甲".repeat(34);
    const tooLongTitle = "甲".repeat(35);
    const body = "这事儿说白了很简单，邻居老周前两天去菜市场买菜，花了三十块钱买了两斤排骨。\n\n";

    const okFile = path.join(dir, "ok.md");
    await fs.writeFile(okFile, `# ${okTitle}\n\n${body}${FIXED_DELIVERY_ENDING}\n`, "utf8");
    const okQa = await bridge.qa({ file: okFile });
    assert.ok(!okQa.hard_gates.some((g) => g.includes("标题超34字")));

    const badFile = path.join(dir, "bad.md");
    await fs.writeFile(badFile, `# ${tooLongTitle}\n\n${body}${FIXED_DELIVERY_ENDING}\n`, "utf8");
    const badQa = await bridge.qa({ file: badFile });
    assert.ok(badQa.hard_gates.some((g) => g.includes("标题超34字")));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("头条起稿赛道解析与多路起稿择优选择覆盖蓝图且规范的候选", () => {
  assert.equal(resolveDraftTrack({ genre: "微头条", driver: "新闻型" }), "micro");
  assert.equal(resolveDraftTrack({ genre: "深长图文", driver: "故事型" }), "story");
  assert.equal(resolveDraftTrack({ genre: "短图文", driver: "账本型" }), "news");

  const blueprint = {
    angle: "成本拆解",
    sections: [
      { heading: "一笔实在账", keyPoints: ["电费"] },
      { heading: "真正的拐点", keyPoints: ["时间"] },
    ],
  };
  const weak = "很短的草稿，没有标题也没有小标题。";
  const strong = [
    "# 菜市场三笔账算明白",
    "",
    "## 一笔实在账",
    "",
    "第一段内容足够扎实，交代人物与具体花费细节。".repeat(12),
    "",
    "第二段继续补充对比案例与现场细节。".repeat(12),
    "",
    "## 真正的拐点",
    "",
    "第三段转入趋势分析，给出可验证的数字逻辑。".repeat(12),
    "",
    "第四段收束全文，留出讨论空间。".repeat(12),
  ].join("\n");

  const picked = selectBestDraftCandidate([weak, strong], "菜市场三笔账算明白", blueprint);
  assert.equal(picked.index, 1);
  assert.equal(picked.draft, strong);
});

test("toutiao extractClaimCandidates extracts numeric and quoted claims", () => {
  const draft = [
    "2026年10月15日，国家统计局公布居民消费价格同比上涨1.2%。",
    "“这一政策将在年底前全面落地。”一位负责人表示。",
  ].join("\n");

  const claims = extractClaimCandidates(draft);
  assert.ok(claims.some((c) => c.kind === "number" && c.text === "1.2%"));
  assert.ok(
    claims.some((c) => c.kind === "quote" && c.text.includes("这一政策将在年底前全面落地")),
  );
});

test("toutiao extractClaimCandidates extracts date and organization entity claims", () => {
  const draft = "2026年10月15日，国家统计局公布居民消费价格同比上涨1.2%。";
  const claims = extractClaimCandidates(draft);
  assert.ok(claims.some((c) => c.kind === "date" && c.text.includes("2026年10月15日")));
  assert.ok(claims.some((c) => c.kind === "entity" && c.text.includes("国家统计局")));
});

test("mergeFactResults downgrades fabricated quotes and filterChangedParagraphClaims detects source changes", () => {
  const draft = "居民消费价格同比上涨1.2%，另一项数据增长5.8%。";
  const claims = extractClaimCandidates(draft);
  const c1 = claims.find((c) => c.text === "1.2%");
  const c2 = claims.find((c) => c.text === "5.8%");
  assert.ok(c1 && c2);
  const { merged } = mergeFactResults(
    [c1, c2],
    {
      claims: [
        {
          id: c1.id,
          status: "supported",
          sourceId: "s1",
          evidence: "居民消费价格同比上涨1.2%",
        },
        {
          id: c2.id,
          status: "supported",
          sourceId: "s1",
          evidence: "模型编造的不存在引文5.8%",
        },
      ],
    },
    [{ id: "s1", text: "国家统计局公布居民消费价格同比上涨1.2%。", hash: "hash-s1-v1" }],
  );
  assert.equal(merged[0].status, "supported");
  assert.equal(merged[0].sourceHash, "hash-s1-v1");
  assert.equal(merged[1].status, "unlocated", "来源中不存在的引文必须降级为 unlocated");

  const reusedCheck = filterChangedParagraphClaims(draft, merged, new Map([["s1", "hash-s1-v1"]]));
  assert.equal(reusedCheck.reused.length, 1);

  const changedCheck = filterChangedParagraphClaims(draft, merged, new Map([["s1", "hash-s1-v2"]]));
  assert.equal(changedCheck.reused.length, 0, "来源内容变化后旧 supported 结论必须重新核对");
  assert.ok(changedCheck.toVerify.length >= 2);
});
