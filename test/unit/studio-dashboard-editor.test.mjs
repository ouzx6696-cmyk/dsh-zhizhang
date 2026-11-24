import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { importTs } from "../support/ts-loader.mjs";

const { buildPipelineGraph, buildStudioDashboardModel } = await importTs(
  "apps/desktop/src/renderer/features/workspace/dashboard-model.ts",
);
const { cardInjectionTier, parseLineList, techniqueCardToMarkdown } = await importTs(
  "apps/desktop/src/renderer/features/library/technique-markdown.ts",
);
const { importLibrarySource, readLibraryCards, saveLibraryCards } = await importTs(
  "packages/fanqie/src/commands/library.ts",
);

describe("Studio D3 仪表盘模型与交互式技法编辑器", () => {
  it("拆解/整理/填充三段进度与 Agent 流水线节点图 → 按真实状态准确计算", () => {
    const model = buildStudioDashboardModel(
      { totalSources: 2, dissectedSources: 1, sourcesWithCards: 1, totalCards: 5 },
      { mode: "fanqie", boundCardCount: 3, chapterCount: 4, finalCount: 2, draftedCount: 3 },
      {
        stageLabels: ["准备", "节拍", "起稿", "审读", "交付"],
        state: "running",
        activeIndex: 2,
      },
      {
        dissectLabel: "拆解",
        organizeLabel: "整理",
        fillLabel: "填充",
        dissectHint: (d, t) => `${d}/${t}`,
        organizeHint: (c, s) => `${c}卡/${s}源`,
        fillHintFanqie: (b, d, t) => `${b}卡 ${d}/${t}`,
        fillHintToutiao: (_s, st) => st,
      },
    );

    assert.equal(model.metrics[0].percent, 50);
    assert.equal(model.metrics[1].percent, 68);
    assert.ok(model.metrics[2].percent > 50);
    assert.equal(model.nodes.length, 5);
    assert.equal(model.nodes[0].status, "done");
    assert.equal(model.nodes[1].status, "done");
    assert.equal(model.nodes[2].status, "running");
    assert.equal(model.nodes[3].status, "pending");
    assert.equal(model.links[0].completed, true);
    assert.equal(model.links[1].active, true);
    assert.equal(model.links[2].active, false);

    const awaiting = buildPipelineGraph({
      stageLabels: ["准备", "节拍", "起稿", "交付"],
      state: "awaiting-author",
      activeIndex: 4,
    });
    assert.equal(awaiting.nodes[2].status, "done");
    assert.equal(awaiting.nodes[3].status, "awaiting");
  });

  it("技法卡逻辑结构 Markdown 编译器 → 正确区分 L2/L6 注入层级并输出完整结构", () => {
    assert.equal(cardInjectionTier("scene"), "l2-craft");
    assert.equal(cardInjectionTier("chapter"), "l2-craft");
    assert.equal(cardInjectionTier("book"), "l6-reference");
    assert.deepEqual(parseLineList("条目一\n\n  条目二  \r\n"), ["条目一", "条目二"]);

    const md = techniqueCardToMarkdown(
      {
        id: "card-1",
        title: "先亮底牌再掀桌",
        category: "冲突",
        layer: "scene",
        dimension: "rhythm",
        pattern: "先用明面筹码压制主角，再借细节反制",
        readerWant: "看主角冷静反杀",
        emotionArc: "压抑→试探→反杀",
        steps: ["展示对手优势", "埋入反常物证", "一击掀翻局面"],
        transfer: "迁移至古井契约谈判场",
        usage: "高张力对峙戏",
        failWhen: "缺少事先铺垫的硬筹码",
        mustNotCopy: ["原作人名", "拍卖行设定"],
        bannedDiction: ["嘴角勾起一抹冷笑"],
        example: "车里传出的声音不高，却压过了雨打芭蕉的碎响。",
        quoteStatus: "verified",
        quoteLine: 3,
      },
      {
        layerLabel: (v) => v,
        dimensionLabel: (v) => v,
        quoteStatusLabel: () => "原文逐字核验",
        tierL2: "L2 实操高优注入",
        tierL6: "L6 宏观参考注入",
        metaTier: "注入层级",
        metaLayer: "作用层级",
        metaDimension: "技法维度",
        metaQuote: "原文核验",
        secPattern: "核心机制",
        secSteps: "实操步骤",
        secTransfer: "迁移边界",
        secGuard: "防抄袭红线",
        secExample: "原文引证",
        fieldEmotionArc: "情绪曲线",
        fieldReaderWant: "读者预期",
        fieldDramaticUnit: "戏剧单元",
        fieldTransfer: "迁移重造",
        fieldUsage: "适用时机",
        fieldFailWhen: "失效边界",
        fieldMustNotCopy: "严禁照搬",
        fieldBannedDiction: "禁用套话",
      },
    );

    assert.match(md, /# 先亮底牌再掀桌/);
    assert.match(md, /L2 实操高优注入/);
    assert.match(md, /原文逐字核验 \(L3\)/);
    assert.match(md, /1\. 展示对手优势/);
    assert.match(md, /严禁照搬\*\*：原作人名；拍卖行设定/);
    assert.match(md, /> 车里传出的声音不高/);
  });

  it("saveLibraryCards → 原子落盘并在原文存在时自动执行逐字引文核验", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zz-lib-save-"));
    try {
      await importLibrarySource(tmp, {
        id: "src-demo",
        title: "青崖样章",
        content: "第一章 雾起青崖\n沈砚指尖顿了顿，铜铃在风里轻轻一晃。",
      });
      const saved = await saveLibraryCards(tmp, "src-demo", [
        {
          id: "c-edit-1",
          title: "微动作停顿收尾",
          category: "文风",
          layer: "line",
          dimension: "prose",
          pattern: "用具体器物声响承接情绪转折",
          example: "沈砚指尖顿了顿，铜铃在风里轻轻一晃",
          usage: "章末收束",
        },
      ]);
      assert.equal(saved.cards[0].quoteStatus, "verified");
      assert.equal(saved.cards[0].quoteLine, 2);

      const reread = await readLibraryCards(tmp, "src-demo");
      assert.equal(reread.cards.length, 1);
      assert.equal(reread.cards[0].title, "微动作停顿收尾");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
