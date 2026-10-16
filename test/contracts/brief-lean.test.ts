import { describe, expect, test } from "bun:test";
import {
  InspirationPort,
  MethodRegistry,
  formatTechniqueCardBlock,
  formatTechniqueCardBlockLean,
  type TechniqueCard,
} from "../../src/lib/ports/index.ts";
import { formatReaderContract } from "../../src/lib/method-assets.ts";
import { renderOutline, renderOutlineLean } from "../../src/tools/render.ts";
import { SYSTEM_BRIEF } from "../../src/tools/brief.ts";
import { ProductMap } from "../../src/lib/ports/index.ts";
import type { Outline } from "../../src/lib/types.ts";

const sampleCard: TechniqueCard = {
  schemaVersion: 1,
  id: "card-test-lean",
  sourceId: "src-x",
  title: "审讯口气",
  tags: ["谈判"],
  readingRange: "ch1",
  axis: "craft",
  status: "accepted",
  body: "长分析正文应被 lean 丢掉。" + "X".repeat(200),
  mechanisms: [
    {
      name: "价码试探",
      experience: "长体验",
      rebuild: "长重建步骤一二三",
      discard: "丢剧情",
      failWhen: "写成说明书",
    },
  ],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  humanFeel: {
    writerCraft: "高压下让弱者用手上小物抢节奏，嘴油心里算",
    craftRange: "ch1",
    characterState: "怂、嘴心打架",
    stateOnPage: "半截话、递烟式赖皮（手法证据，勿学嘴）",
    allowedEdges: "怂、半截话",
    failAsTemplate: "每句都在推进信息即失败",
  },
  bookCraft: {
    continueWhy: "绳索还在，报酬怎么付",
    adjacentChange: "从会死换成要付出什么",
    failAsShortStory: "当场两清即失败",
  },
};

const outline: Outline = {
  targetWords: 1000,
  situationLens: "夜班冷柜",
  livedScene: "称重对轨",
  stateLens: "短硬、在算账",
  locks: "不报警",
  knowledge: "她看见差额",
  conflict: "不敢说破",
  beats: "1)掂瓶 2)谎报 3)半瓶留下 4)对方笑 5)改配送",
  ending: "半瓶开过的汽水留在台上",
  synopsis: "长概要不应进 lean",
  pov: "她",
};

describe("brief-lean contract", () => {
  test("lean cards/outline/contract/defaults/SYSTEM short chain", () => {
    const leanCard = formatTechniqueCardBlockLean(sampleCard);
    const fullCard = formatTechniqueCardBlock(sampleCard);
    expect(leanCard).toContain("高压下让弱者用手上小物抢节奏");
    expect(leanCard).toContain("怂、嘴心打架");
    expect(leanCard).toContain("绳索还在");
    expect(leanCard).toContain("写法");
    expect(leanCard).toContain("状态");
    expect(leanCard).not.toContain("长分析正文");
    expect(leanCard).not.toContain("价码试探");
    expect(fullCard.length).toBeGreaterThan(leanCard.length * 2);

    const sectionLean = InspirationPort.formatCardsSection([sampleCard], {
      source: "test",
      note: "unit",
      lean: true,
    });
    expect(sectionLean).toContain("lean");
    expect(sectionLean).toContain("craft");
    expect(sectionLean).toContain("写法");
    expect(sectionLean).not.toContain("口气正例");
    expect(sectionLean).not.toContain("#### 机制");

    const leanOut = renderOutlineLean(outline);
    const fullOut = renderOutline(outline);
    expect(leanOut).toContain("处境透镜");
    expect(leanOut).toContain("半瓶开过的汽水");
    expect(leanOut).not.toContain("节拍");
    expect(leanOut).not.toContain("掂瓶");
    expect(fullOut).toContain("节拍");

    const leanContract = formatReaderContract({
      premise: "冷柜",
      planned: "近端A；中端很长很长的计划文字".repeat(5),
      threads: "伏笔很长".repeat(20),
      happened: "已发生事",
      chapterEnding: "钥匙在掌心",
      lean: true,
      continuation: true,
      previous: {
        id: "c001",
        title: "第一瓶",
        ending: "条子压在账本下",
        body: "开篇她掂了瓶。" + "中".repeat(80) + "她没再关门。" + "尾".repeat(40),
      },
    });
    expect(leanContract).toContain("条子压在账本下");
    expect(leanContract).toContain("书感三弹");
    expect(leanContract).toContain("前章正文"); // lean 注入前章全文
    expect(leanContract).toContain("开篇她掂了瓶");
    expect(leanContract).toContain("她没再关门");
    expect(leanContract).toContain("未了局面");
    expect(leanContract).not.toMatch(/必须.*留物|章末留可碰的物/);
    expect(leanContract).toContain("状态·已发生");
    // lean 截断长 planned；full 保留更多
    const fatPlanned = "近端计划要很长。".repeat(40);
    const leanFat = formatReaderContract({
      premise: "冷柜",
      planned: fatPlanned,
      threads: "伏",
      lean: true,
    });
    const fullFat = formatReaderContract({
      premise: "冷柜",
      planned: fatPlanned,
      threads: "伏",
      lean: false,
    });
    expect(leanFat.length).toBeLessThan(fullFat.length);

    expect([...MethodRegistry.briefDefaultIds]).toEqual(["style_contract"]);
    expect(MethodRegistry.resolveBriefAssets([]).found.map((a) => a.id)).toEqual([
      "style_contract",
    ]);

    expect(SYSTEM_BRIEF).toMatch(/写作段|默认路径/);
    expect(SYSTEM_BRIEF).toContain("当前小说状态");
    expect(SYSTEM_BRIEF).not.toContain("书账");
    expect(SYSTEM_BRIEF).toContain("lean");
    expect(SYSTEM_BRIEF).toMatch(/audit 仅诊断旁路|旁路/);
    expect(SYSTEM_BRIEF).not.toMatch(/建议 zhizhang_payoff_audit \/ zhizhang_human_feel_audit/);

    expect(ProductMap.version).toBe("0.10.3");
    const map = ProductMap.formatForAgent();
    expect(map).toContain("chapter_brief");
    expect(map).toMatch(/旁路|软传感|diagnose\.audit|仅诊断旁路/);
  });
});
