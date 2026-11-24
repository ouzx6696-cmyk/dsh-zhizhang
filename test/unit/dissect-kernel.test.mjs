import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "../support/ts-loader.mjs";

const { buildChapterContext } = await importTs("packages/fanqie/src/context/index.ts");
const {
  auditTechniqueCards,
  scanSourceChapters,
  stratifiedSampleSource,
  verifyQuoteAgainstSource,
} = await importTs("packages/fanqie/src/pipelines/dissect/sampling.ts");

describe("拆书测绘、引文核验与技法填充内核", () => {
  it("多章长篇文本 → 按章界识别并执行开篇/中段/收尾分层抽样", () => {
    const chapters = Array.from({ length: 14 }, (_, i) => {
      const idx = i + 1;
      const ending =
        idx % 2 === 0 ? "警报骤然响起，暗门轰然坍塌。" : "门后站着的究竟是谁？他停下了脚步。";
      return `第${idx}章 风起青崖${idx}\n沈砚推开药铺木门，听见檐角铜铃作响。\n${ending}`;
    }).join("\n\n");

    const scanned = scanSourceChapters(chapters);
    assert.equal(scanned.length, 14);
    assert.match(scanned[0].hookType, /悬念提问型/);
    assert.match(scanned[1].hookType, /危机降临型/);

    const report = stratifiedSampleSource(chapters, 7, 2000);
    assert.equal(report.chapterCount, 14);
    assert.equal(report.sampledCount, 7);
    assert.equal(report.readScope, "sampled");
    assert.ok(report.chunks[0].includes("第1章"));
    assert.ok(report.chunks[report.chunks.length - 1].includes("第14章"));
  });

  it("技法卡引文核验 → 精准区分逐字命中、部分命中与未核验", () => {
    const source = [
      "第一章 雾起青崖",
      "沈砚把最后一只铜铃挂上檐角时，街口那辆青布马车正好停在药铺门前。",
      "车里传出的声音不高，却压过了雨打芭蕉的碎响。",
    ].join("\n");

    const exact = verifyQuoteAgainstSource(source, "街口那辆青布马车正好停在药铺门前");
    assert.equal(exact.status, "verified");
    assert.equal(exact.sourceLine, 2);

    const partial = verifyQuoteAgainstSource(source, "街口那辆青布马车正好停在茶馆门前");
    assert.equal(partial.status, "partial");

    const missing = verifyQuoteAgainstSource(source, "这段台词完全是模型编造的句子");
    assert.equal(missing.status, "unverified");

    const audited = auditTechniqueCards(source, [
      { id: "c1", example: "车里传出的声音不高，却压过了雨打芭蕉的碎响" },
      { id: "c2", example: "完全不存在于原文的杜撰引文" },
    ]);
    assert.equal(audited.stats.verified, 1);
    assert.equal(audited.stats.unverified, 1);
    assert.equal(audited.cards[0].quoteStatus, "verified");
    assert.equal(audited.cards[0].quoteLine, 3);
    assert.equal(audited.cards[1].quoteStatus, "unverified");
  });

  it("章节上下文组装 → 本章/场景实操卡晋升 l2-craft 并携带防抄袭与失效边界，宏观卡保留在 l6", () => {
    const bible = {
      entities: [],
      states: [],
      threads: [],
      knowledge: [],
      chapters: [],
      style: { rules: [] },
      pending: [],
    };
    const view = { asOf: 2, entities: [], states: [], threads: [], knowledge: [] };

    const packet = buildChapterContext({
      chapterId: "ch-002",
      position: 2,
      outlineText: "沈砚追查古井玉牌来源",
      bible,
      view,
      hits: [],
      recentSummaries: [],
      referenceCards: [
        {
          id: "craft-1",
          title: "看足筹码再掀桌",
          category: "冲突",
          scope: "chapter",
          layer: "scene",
          dimension: "rhythm",
          pattern: "先亮出对手明面筹码，再通过反常细节完成反制",
          emotionArc: "压抑→试探→亮底→反杀→余韵",
          steps: ["展示对手压迫", "埋入反常物证", "以最小动作掀翻局面"],
          transfer: "用本书古井契约重造筹码，不复用原作身份",
          mustNotCopy: ["原作人物名", "原作拍卖会桥段"],
          failWhen: "主角没有事先掌握可验证底牌时会沦为机械降神",
          usage: "谈判对峙场",
        },
        {
          id: "macro-1",
          title: "双线悬疑卷结构",
          category: "结构",
          scope: "work",
          layer: "book",
          dimension: "structure",
          pattern: "明线破案、暗线揭身世，每卷末交汇",
          usage: "全书分卷节奏",
        },
      ],
      budget: 8000,
      previousTextMode: { kind: "tail", chars: 800 },
    });

    const craft = packet.suffix.find((b) => b.id === "l2-craft");
    const macro = packet.suffix.find((b) => b.id === "l6-plan-reference");
    assert.ok(craft, "chapter/scene craft card should be promoted to l2-craft");
    assert.equal(craft.layer, 2);
    assert.match(craft.text, /看足筹码再掀桌/);
    assert.match(craft.text, /严禁照搬：原作人物名；原作拍卖会桥段/);
    assert.match(craft.text, /失效边界：主角没有事先掌握可验证底牌/);
    assert.match(craft.text, /实操步骤：展示对手压迫 → 埋入反常物证 → 以最小动作掀翻局面/);

    assert.ok(macro, "work-level book card should stay in l6-plan-reference");
    assert.match(macro.text, /双线悬疑卷结构/);
  });
});
