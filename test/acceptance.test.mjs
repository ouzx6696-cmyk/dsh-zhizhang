import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateLogs,
  blindAssign,
  bookOfCase,
  casePlan,
  describeMode,
  finalizeSummary,
  normalizeMode,
  pacePromptLine,
  profileMetric,
  resolveMode,
} from "../scripts/acceptance-lib.mjs";
import {
  JUDGE_ITEMS,
  buildJudgePrompt,
  judgeSummary,
  parseJudgeOutput,
} from "../packages/core/eval/score.mjs";

test("模式与任务组：默认 36 条记录，matrix 加三本档位书，long 30 章并隐含定稿轨", () => {
  const base = casePlan(resolveMode({}));
  assert.equal(base.books.length, 1);
  assert.equal(base.caseIds.length, 18);
  assert.equal(base.totalRecords, 36);
  assert.equal(base.chapterCount, 10);
  assert.equal(base.scoredCount, 17);
  assert.deepEqual(base.caseIds.slice(0, 8), [
    "head-1",
    "head-2",
    "head-3",
    "head-4",
    "head-5",
    "head-6",
    "head-7",
    "novel-plan",
  ]);

  const matrix = casePlan(resolveMode({ matrix: true }));
  assert.equal(matrix.books.length, 4);
  assert.deepEqual(
    matrix.books.slice(1).map((book) => [book.prefix, book.pace]),
    [
      ["novel-matrix-kuai", "快爽"],
      ["novel-matrix-wen", "稳推"],
      ["novel-matrix-man", "慢燃"],
    ],
  );
  assert.equal(matrix.caseIds.length, 51);
  assert.equal(matrix.totalRecords, 102);
  assert.equal(matrix.chapterCount, 40);
  assert.ok(matrix.caseIds.includes("novel-matrix-kuai-plan"));
  assert.ok(matrix.caseIds.includes("novel-matrix-man-c010"));
  assert.equal(bookOfCase(matrix.books, "novel-matrix-kuai-c003").pace, "快爽");
  assert.equal(bookOfCase(matrix.books, "novel-c003").pace, undefined);

  const long = casePlan(resolveMode({ long: true }));
  assert.equal(long.caseIds.length, 38);
  assert.equal(long.chapterCount, 30);
  assert.ok(long.caseIds.includes("novel-c030"));
  assert.equal(resolveMode({ long: true }).finalizeTrack, true);
  assert.equal(resolveMode({ matrix: true }).finalizeTrack, false);
  assert.equal(describeMode(resolveMode({})), "");
  assert.match(describeMode(resolveMode({ matrix: true })), /快爽、稳推、慢燃/);
  assert.match(describeMode(resolveMode({ finalizeTrack: true })), /模拟作者确认/);
  assert.match(pacePromptLine("慢燃"), /慢燃/);
  assert.match(pacePromptLine("稳推"), /pace/);

  assert.throws(() => normalizeMode("bad"), /mode\.json/);
  assert.throws(() => normalizeMode({ matrix: "yes" }), /布尔值/);
  assert.deepEqual(normalizeMode({ matrix: true, round: "2026-11-06" }), {
    matrix: true,
    long: false,
    finalizeTrack: false,
    judge: false,
    round: "2026-11-06",
  });
});

function syntheticRows(plan, profile) {
  const tokens = (id) => 100 + id.length;
  return plan.caseIds.map((caseId) => ({
    profile,
    caseId,
    state: "completed",
    tokens: tokens(caseId),
  }));
}

function syntheticAuthor(plan, fill = true) {
  return {
    cases: plan.caseIds
      .filter((id) => !id.endsWith("-plan"))
      .map((id) => ({
        id,
        readability: fill ? 4 : null,
        voice: fill ? 5 : null,
      })),
    continuityErrors: 1,
    resumedWithoutExtraSetup: true,
    actualCost: 12.5,
    currency: "CNY",
  };
}

const metricInput = (plan, overrides = {}) => ({
  profile: "default",
  plan,
  author: syntheticAuthor(plan),
  issues: [],
  articles: plan.headCount,
  firstQaPass: 5,
  twoQaPass: 7,
  reviews: plan.chapterCount,
  editorPass: plan.chapterCount - 2,
  hardIssues: 6,
  rows: syntheticRows(plan, "default"),
  instrumentation: null,
  judge: null,
  ...overrides,
});

test("指标汇总：合成 run-records 得到确定的比率、均分与门槛判定", () => {
  const plan = casePlan(resolveMode({}));
  const item = profileMetric(metricInput(plan));
  assert.equal(item.firstQaPassRate, 5 / 7);
  assert.equal(item.twoQaPassRate, 1);
  assert.equal(item.editorPassRate, 0.8);
  assert.equal(item.averageHardIssues, 0.6);
  assert.equal(
    item.tokens,
    syntheticRows(plan, "default").reduce((sum, row) => sum + row.tokens, 0),
  );
  assert.equal(item.cost, 12.5);
  assert.equal(item.authorScored, 17);
  assert.equal(item.authorAverage, 4.5);
  assert.equal(item.automaticThresholdsMet, true);
  assert.ok(!("instrumentation" in item) && !("judge" in item));

  const partial = profileMetric(metricInput(plan, { author: syntheticAuthor(plan, false) }));
  assert.equal(partial.authorScored, 0);
  assert.equal(partial.authorAverage, null);

  const failed = profileMetric(
    metricInput(plan, { issues: ["novel-c001：任务缺失、重复或未完成"], reviews: 9 }),
  );
  assert.equal(failed.automaticThresholdsMet, false, "有 issue 或审读缺失不得达线");

  const matrix = casePlan(resolveMode({ matrix: true }));
  const matrixItem = profileMetric(metricInput(matrix, { reviews: matrix.chapterCount }));
  assert.equal(matrixItem.editorPassRate, (matrix.chapterCount - 2) / matrix.chapterCount);
  assert.equal(matrixItem.authorScored, 47);
});

test("完成与通过判定：记录数、作者核验与连续性门槛", () => {
  const plan = casePlan(resolveMode({}));
  const records = [...syntheticRows(plan, "default"), ...syntheticRows(plan, "original")];
  const metrics = ["default", "original"].map((profile) =>
    profileMetric(metricInput(plan, { profile, rows: syntheticRows(plan, profile) })),
  );
  const summary = finalizeSummary(metrics, records, plan);
  assert.deepEqual(summary, { complete: true, human: true, passed: true });

  const short = finalizeSummary(metrics, records.slice(0, 35), plan);
  assert.equal(short.complete, false);
  assert.equal(short.passed, false);

  const lenient = metrics.map((item) => ({ ...item, continuityErrors: 3 }));
  const strict = finalizeSummary(lenient, records, plan);
  assert.equal(strict.human, false);
  assert.equal(strict.passed, false);
});

const logLines = [
  JSON.stringify({
    at: "t",
    event: "handoff",
    conversationId: "s1",
    intentSource: "author",
    methodIds: ["m1", "m2"],
  }),
  JSON.stringify({
    at: "t",
    event: "handoff",
    conversationId: "s1",
    intentSource: "auto",
    methodIds: ["m1"],
  }),
  JSON.stringify({ at: "t", event: "handoff", intentSource: "author", methodIds: ["m3"] }),
  JSON.stringify({ at: "t", event: "handoff", methodIds: "oops" }),
  JSON.stringify({ at: "t", event: "tool_call", tool: "fanqie_method_get", role: "writer" }),
  JSON.stringify({
    at: "t",
    event: "tool_call",
    tool: "fanqie_chapter_save",
    role: "writer",
    denied: true,
  }),
  JSON.stringify({
    at: "t",
    event: "tool_call",
    tool: "writer_read_url",
    role: "editor",
    error: "boom",
  }),
  JSON.stringify({ at: "t", event: "context_compacted", trigger: "threshold" }),
  JSON.stringify({ at: "t", event: "context_compacted", reason: "manual" }),
  JSON.stringify({ at: "t", event: "context_compacted" }),
  JSON.stringify({ at: "t", event: "model_usage", provider: "deepseek" }),
  "not json",
  "",
];

test("仪器日志聚合：handoff/工具调用/压缩统计，字段缺失进未记录桶，坏行计数", () => {
  const stats = aggregateLogs([{ name: "2026-11-06.jsonl", lines: logLines }]);
  assert.equal(stats.logFiles, 1);
  assert.equal(stats.events, 11);
  assert.equal(stats.malformedLines, 1);
  assert.equal(stats.handoff.count, 4);
  assert.deepEqual(stats.handoff.intentSource, { author: 2, auto: 1, 未记录: 1 });
  assert.deepEqual(stats.handoff.methodReads, { occurrences: 4, distinct: 3, average: 1.33 });
  assert.deepEqual(stats.toolCalls, { total: 3, deniedOrErrored: 2, share: 0.67 });
  assert.equal(stats.contextCompacted.count, 3);
  assert.deepEqual(stats.contextCompacted.triggers, { threshold: 1, manual: 1, 未记录: 1 });

  const quiet = aggregateLogs([
    { name: "2026-11-07.jsonl", lines: [JSON.stringify({ event: "model_usage" })] },
  ]);
  assert.equal(quiet.handoff.count, 0);
  assert.equal(quiet.handoff.methodReads, null);
  assert.equal(quiet.toolCalls.share, null);
});

test("盲评配对：同种子可复现，A/B 互补且两种标签都出现，换种子会改变指派", () => {
  const caseIds = Array.from({ length: 17 }, (_, i) =>
    i < 7 ? "head-" + (i + 1) : "novel-c" + String(i - 6).padStart(3, "0"),
  );
  const first = blindAssign(caseIds, "2026-11-06");
  const second = blindAssign(caseIds, "2026-11-06");
  assert.deepEqual(first, second);
  for (const [index, pair] of first.entries()) {
    assert.equal(pair.caseId, caseIds[index]);
    assert.equal(pair.pairId, "pair-" + caseIds[index]);
    assert.notEqual(pair.a, pair.b);
    assert.ok(["default", "original"].includes(pair.a));
  }
  const labels = first.flatMap((pair) => [pair.a, pair.b]);
  assert.ok(labels.includes("default") && labels.includes("original"));
  assert.ok(first.some((pair) => pair.a === "default"));
  assert.ok(first.some((pair) => pair.a === "original"));
  const other = blindAssign(caseIds, "2026-11-07");
  assert.ok(
    first.some((pair, index) => pair.a !== other[index].a),
    "不同轮次种子应至少改变一处 A/B 指派",
  );
});

const judgeJson = (kind, value) =>
  JSON.stringify({
    scores: Object.fromEntries(JUDGE_ITEMS[kind].map((name) => [name, value])),
    evidences: Object.fromEntries(JUDGE_ITEMS[kind].map((name) => [name, "证据：" + name])),
  });

test("评审解析：合法输出（含围栏）可解析，非法与缺字段逐项报错", () => {
  const parsed = parseJudgeOutput("```json\n" + judgeJson("chapter", 4) + "\n```", "chapter");
  assert.equal(parsed.average, 4);
  assert.equal(parsed.scores["追读意愿"], 4);
  assert.match(parsed.evidences["章末"], /证据/);
  assert.equal(parseJudgeOutput(judgeJson("article", 3), "article").average, 3);

  const mixed = judgeJson("chapter", 4).replace('"局面改变":4', '"局面改变":2');
  assert.equal(parseJudgeOutput(mixed, "chapter").scores["局面改变"], 2);
  assert.ok(Math.abs(parseJudgeOutput(mixed, "chapter").average - (8 * 4 + 2) / 9) < 0.01);

  assert.throws(() => parseJudgeOutput("综合 90 分，写得不错", "chapter"), /JSON/);
  assert.throws(() => parseJudgeOutput("{}", "chapter"), /scores/);
  assert.throws(() => parseJudgeOutput('{"scores":{},"evidences":{}}', "chapter"), /评分缺失/);
  const noEvidence = JSON.stringify({
    scores: Object.fromEntries(JUDGE_ITEMS.chapter.map((name) => [name, 3])),
    evidences: {},
  });
  assert.throws(() => parseJudgeOutput(noEvidence, "chapter"), /缺少证据/);
  const outOfRange = judgeJson("chapter", 3).replace('"人味":3', '"人味":6');
  assert.throws(() => parseJudgeOutput(outOfRange, "chapter"), /超出 1–5/);
  const fraction = judgeJson("article", 3).replace('"标题":3', '"标题":3.5');
  assert.throws(() => parseJudgeOutput(fraction, "article"), /整数/);
  assert.throws(() => parseJudgeOutput(judgeJson("chapter", 4), "nope"), /评审对象类型/);

  const prompt = buildJudgePrompt("# 标尺\n第九项看追读意愿。", "chapter", "第七章 雾渡", "正文…");
  assert.match(prompt, /追读意愿/);
  assert.match(prompt, /第七章 雾渡/);
  assert.match(prompt, /正文…/);
  assert.doesNotMatch(buildJudgePrompt("# 标尺", "article", undefined, "稿"), /章节题名/);
});

test("评审汇总：章级与篇级分项均分、追读与读完意愿，空结果为 null", () => {
  const results = [
    {
      caseId: "novel-c001",
      kind: "chapter",
      ...parseJudgeOutput(judgeJson("chapter", 5), "chapter"),
    },
    {
      caseId: "novel-c002",
      kind: "chapter",
      ...parseJudgeOutput(judgeJson("chapter", 3), "chapter"),
    },
    { caseId: "head-1", kind: "article", ...parseJudgeOutput(judgeJson("article", 4), "article") },
  ];
  const summary = judgeSummary(results);
  assert.equal(summary.chapters.count, 2);
  assert.equal(summary.chapters.overall, 4);
  for (const name of JUDGE_ITEMS.chapter) assert.equal(summary.chapters.items[name], 4);
  assert.equal(summary.articles.count, 1);
  assert.equal(summary.articles.overall, 4);
  assert.equal(summary.willingness.chapter, 4);
  assert.equal(summary.willingness.article, 4);
  assert.equal(judgeSummary([]), null);
});
