// T16 头条“合规且好看”专项：qa.judge / draw 开关、读者评审解析、反馈行式、metrics 入参归一。
// 端到端路径（台账落盘、质检六维、readerReview 落 meta.qa）见 flow.test.mjs 的 T16 段。
import { test } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { buildUrl, createToolHarness, tempDir } from "./helpers.mjs";

const { parseToutiaoConfig } = await import(buildUrl("toutiao/src/config.js"));
const { ArticleStore, parseFeedbackEntries, formatFeedbackLine, parseReaderReview } = await import(
  buildUrl("toutiao/src/store.js")
);

const RUBRIC = ["标题", "开篇三段", "人物", "引语", "延伸", "节奏", "结尾", "不像模板", "读完意愿"];

function reviewJson(overrides = {}) {
  const scores = Object.fromEntries(RUBRIC.map((k, i) => [k, ((i + 1) % 5) + 1]));
  const evidences = Object.fromEntries(RUBRIC.map((k) => [k, `${k}的证据`]));
  return JSON.stringify({
    scores: { ...scores, ...overrides.scores },
    evidences: { ...evidences, ...overrides.evidences },
  });
}

test("ToutiaoConfig：qa.judge 与 draw 开关解析、未知字段照旧报错", () => {
  assert.deepEqual(parseToutiaoConfig({ qa: { judge: true }, draw: { enabled: true } }).value, {
    rootDir: "outputs/toutiao",
    qa: { judge: true },
    draw: { enabled: true },
  });
  assert.deepEqual(parseToutiaoConfig({ draw: { enabled: true, max: 8 } }).value.draw, {
    enabled: true,
    max: 8,
  });
  for (const bad of [
    { qa: { judge: "yes" } },
    { draw: { enabled: "on" } },
    { draw: { max: 0 } },
    { draw: { max: 1.5 } },
    { unknownTop: 1 },
  ]) {
    const { value, issues } = parseToutiaoConfig(bad);
    assert.equal(value, undefined);
    assert.ok(issues.length >= 1, JSON.stringify(bad));
  }
});

test("parseReaderReview：散文夹 JSON 可解析、取最后一个合法对象、非法形状拒绝", () => {
  const at = "2026-11-07T00:00:00";
  const withProse = parseReaderReview(`结论：可用。\n${reviewJson()}`, 3, at);
  assert.ok(withProse);
  assert.equal(withProse.rev, 3);
  assert.equal(withProse.scores["标题"], 2);
  assert.equal(withProse.evidences["节奏"], "节奏的证据");
  const later = parseReaderReview(`${reviewJson()}\n${reviewJson({ scores: { 标题: 5 } })}`, 1, at);
  assert.equal(later.scores["标题"], 5, "取最后一个能通过校验的 JSON");
  for (const bad of [
    "没有 JSON",
    '{"scores":{"标题":6},"evidences":{}}',
    '{"scores":{},"evidences":{}}',
    reviewJson({ evidences: { 人物: "" } }),
    reviewJson({ scores: { 结尾: 0 } }),
    `[{"label":"x"}]`,
  ]) {
    assert.equal(parseReaderReview(bad, 1, at), null, bad.slice(0, 40));
  }
});

test("反馈行式：新旧两种行式解析，格式化后可往返", () => {
  const text = [
    "# 作者改稿反馈",
    "",
    "- 2026-11-01：旧原文 → 旧改后 → 更口语",
    "- 2026-11-02：新原文 → 新改后 → 更具体 ｜ 病型=3·大词空转 ｜ 位置=第 4 段 ｜ 改法=落到具体的人",
    "- 2026-11-03：只补病型 → 改后 → 动机 ｜ 病型=G2·寓意说教",
  ].join("\n");
  const items = parseFeedbackEntries(text);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], {
    date: "2026-11-01",
    original: "旧原文",
    revised: "旧改后",
    motive: "更口语",
  });
  assert.equal(items[1].病型, "3·大词空转");
  assert.equal(items[1].改法, "落到具体的人");
  assert.equal(items[2].位置, undefined);
  const line = formatFeedbackLine({
    date: "2026-11-04",
    original: "再来一条",
    revised: "改好后",
    motive: "更顺",
    病型: "16·账单味",
    改法: "先认主驱动",
  });
  assert.equal(line, "- 2026-11-04：再来一条 → 改好后 → 更顺 ｜ 病型=16·账单味 ｜ 改法=先认主驱动");
  const [round] = parseFeedbackEntries(line);
  assert.equal(round.病型, "16·账单味");
  assert.equal(round.位置, undefined);
});

test("metrics_import 入参在边界归一：CSV 表头校验、引号闭合、metrics 缺日期被拒", async () => {
  const h = await createToolHarness({ mode: "toutiao", cwd: await tempDir() });
  const headerBad = await h.call("toutiao_metrics_import", {
    articleId: "2026-11-07-x",
    csv: "日期,曝光\n2026-11-01,10\n",
  });
  assert.equal(headerBad.code, "INVALID_ARGS");
  assert.match(headerBad.message, /表头不认识/);
  const unterminated = await h.call("toutiao_metrics_import", {
    articleId: "2026-11-07-x",
    csv: '日期,展现\n2026-11-01,"10\n',
  });
  assert.match(unterminated.message, /引号没有闭合/);
  const noDate = await h.call("toutiao_metrics_import", {
    articleId: "2026-11-07-x",
    metrics: [{ impressions: 10 }],
  });
  assert.match(noDate.message, /date/);
  const badDate = await h.call("toutiao_metrics_import", {
    articleId: "2026-11-07-x",
    metrics: [{ date: "11月1日", impressions: 10 }],
  });
  assert.match(badDate.message, /date/);
  const emptyRow = await h.call("toutiao_metrics_import", {
    articleId: "2026-11-07-x",
    metrics: [{ date: "2026-11-01" }],
  });
  assert.match(emptyRow.message, /没有任何指标值/);
  const wrongType = await h.call("toutiao_metrics_import", {
    articleId: "2026-11-07-x",
    metrics: [{ date: "2026-11-01", impressions: { n: 1 } }],
  });
  assert.match(wrongType.message, /数字或原文文本/);
});

test("attachReaderReview：没有质检记录时返回 false 且不改 meta", async () => {
  const root = await tempDir("writer-rr-");
  const store = new ArticleStore(root);
  const m = await store.create("rr", { line: "资讯线", genre: "短图文" });
  const review = parseReaderReview(reviewJson(), 0, "2026-11-07T00:00:00");
  assert.ok(review);
  assert.equal(await store.attachReaderReview(m.id, review), false);
  const meta = await store.get(m.id);
  assert.equal(meta.qa.length, 0);
  await rm(root, { recursive: true, force: true });
});
