import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFakeClock } from "../support/clock.mjs";
import { importTs } from "../support/ts-loader.mjs";

const { createLockService } = await importTs("packages/core/src/lock/index.ts");
const { buildChapterContext } = await importTs("packages/fanqie/src/context/index.ts");
const { createLearningStore } = await importTs("packages/fanqie/src/learning/store.ts");
const { userPrompt, formatRunDebrief } = await importTs("apps/desktop/src/session/prompt.ts");

test("userPrompt 注入划词选区、@引用上下文与新增协作意图", () => {
  const msg = userPrompt("看看这段节奏", "diagnose", {
    workTitle: "云海闻铃",
    chapter: "ch-003",
    title: "夜探青崖",
    selection: { text: "风灯熄灭的那一刻，铜铃忽然无风自鸣。", paragraphStart: 4, paragraphEnd: 5 },
    mentions: [{ kind: "chapter", id: "ch-001", label: "雨夜开篇" }],
  });
  assert.ok(msg.includes("ch-003"), "应包含章节号");
  assert.ok(msg.includes("风灯熄灭的那一刻"), "应包含划词选区内容");
  assert.ok(msg.includes("@章节:雨夜开篇(ch-001)"), "应包含 @ 引用标签");
  assert.ok(msg.includes("深度诊断"), "应包含 diagnose 意图指导");
});

test("formatRunDebrief 为等待作者决定与失败流水线生成零额外模型调用的简报", () => {
  const awaiting = formatRunDebrief({
    id: "run-1",
    kind: "fanqie.chapter",
    state: "awaiting-author",
    target: { mode: "fanqie", path: "/tmp/work" },
    stages: ["prepare", "draft", "review"],
    usage: { input: 1200, output: 800, cached: 0, calls: 2, costUsd: 0 },
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-01T00:01:00.000Z",
  });
  assert.ok(awaiting.includes("run-1"));
  assert.ok(awaiting.includes("prepare → draft → review"));
  assert.ok(awaiting.includes("段落对照"));

  const failed = formatRunDebrief({
    id: "run-2",
    kind: "toutiao.article",
    state: "failed",
    target: { mode: "toutiao", path: "/tmp/art" },
    stages: ["prepare"],
    usage: { input: 500, output: 100, cached: 0, calls: 1, costUsd: 0 },
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-01T00:01:00.000Z",
    error: { code: "model.timeout", message: "模型响应超时" },
  });
  assert.ok(failed.includes("模型响应超时"));
});

test("buildChapterContext 将结构化 WritingBrief 注入任务块", () => {
  const bible = {
    entities: [],
    states: [],
    threads: [],
    knowledge: [],
    chapters: [],
    style: { contract: "凝练克制", rules: [], voiceSamples: [] },
    pending: [],
  };
  const packet = buildChapterContext({
    chapterId: "ch-002",
    position: 2,
    outlineText: "第二章细纲",
    previousBody: "第一章结尾。",
    bible,
    view: { position: 2, entities: [], states: [], threads: [], knowledge: [] },
    hits: [],
    recentSummaries: [],
    budget: 2000,
    previousTextMode: { kind: "full", maxChars: 2000 },
    brief: {
      goal: "让主角当众亮出账簿反杀",
      agreedBeats: ["先示弱引对手露底", "当堂摊开旧账簿"],
      mustKeepQuotes: ["这本账，我替你算了三年。"],
      avoidPatterns: ["不要用大段心理独白解释"],
    },
  });
  const taskBlock = packet.suffix.find((b) => b.source.kind === "outline");
  assert.ok(taskBlock, "应包含任务块");
  assert.ok(taskBlock.text.includes("写作任务单"));
  assert.ok(taskBlock.text.includes("让主角当众亮出账簿反杀"));
  assert.ok(taskBlock.text.includes("这本账，我替你算了三年。"));
});

test("LearningStore 支持 proposeOnly 提议态与作者显式 accept/dismiss 决策", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zz-learning-decide-"));
  try {
    const clock = createFakeClock();
    const lock = createLockService(clock);
    const store = createLearningStore(lock);
    const edit = {
      signature: "delete:filler-intro",
      kind: "delete",
      condition: "段首出现冗长铺垫时",
      change: "直接删去铺垫从动作切入",
      why: "保持开篇节奏紧凑",
      before: "其实说起来那天天气本来就不好，他才走进去。",
      after: "他推门走了进去。",
    };

    for (let i = 0; i < 3; i++) {
      await store.record(dir, [edit], {
        chapter: `ch-00${i + 1}`,
        nowIso: clock.iso(),
        proposeOnly: true,
      });
    }
    const proposed = await store.read(dir);
    assert.equal(proposed.patterns[0].status, "proposed");
    assert.equal(proposed.patterns[0].promoted, false);

    const accepted = await store.decide(dir, edit.signature, "accept", clock.iso());
    assert.equal(accepted.state.patterns[0].status, "accepted");
    assert.equal(accepted.state.patterns[0].promoted, true);
    assert.equal(accepted.rules.length, 1);

    const dismissed = await store.decide(dir, edit.signature, "dismiss", clock.iso());
    assert.equal(dismissed.state.patterns[0].status, "dismissed");
    assert.equal(dismissed.state.patterns[0].promoted, false);
    assert.equal(dismissed.rules.length, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
