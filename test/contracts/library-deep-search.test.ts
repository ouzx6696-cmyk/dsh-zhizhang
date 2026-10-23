import { describe, test } from "node:test";
import { expect } from "../_compat/expect.ts";
import { cardDeepHay } from "../../src/lib/ports/library/store.ts";

/**
 * 检索 haystack 的回归护栏。
 *
 * 起因：cardDeepHay 里调用了一个没 import 的 coerceHumanFeel，
 * 异常被 searchCards 的 catch 吞掉 → 全文检索静默返回空，只能命中标题/标签。
 * 后来补上 import，又发现 haystack 只覆盖 body/mechanisms/humanFeel，
 * v2 模块的 不可照搬 / 证据引文 / 三步公式 / 失败边界全搜不到。
 * 这里逐字段钉住：少一个字段就红。
 */
const base = { title: "测试卡", body: "正文没有的探针" };

describe("技法卡全文检索 · haystack 覆盖", () => {
  test("标题与正文不在 haystack（标题走浅层匹配）", () => {
    const hay = cardDeepHay(base);
    expect(hay).toContain("正文没有的探针");
    expect(hay).not.toContain("测试卡");
  });

  test("v2：不可照搬 / 可替换 / 迁移 / 失败边界", () => {
    const hay = cardDeepHay({
      ...base,
      mustNotCopy: ["不得照搬哭音矿紫铜"],
      replaceables: ["噪音源：铁匠铺"],
      transfer: "换成嗅觉题材也成立",
      failWhen: "噪音只是背景没有参与胜负",
    });
    expect(hay).toContain("哭音矿");
    expect(hay).toContain("铁匠铺");
    expect(hay).toContain("嗅觉");
    expect(hay).toContain("没有参与胜负");
  });

  test("v2：证据引文与章号可检索", () => {
    const hay = cardDeepHay({ ...base, evidence: [{ chapter: "第10章", quote: "揉成四团塞进耳道深处" }] });
    expect(hay).toContain("耳道深处");
    expect(hay).toContain("第10章");
  });

  test("v2：三步公式与反AI腔词表可检索", () => {
    const hay = cardDeepHay({ ...base, steps: ["第一步：先承认对手更强"], bannedDiction: ["恐怖如斯"] });
    expect(hay).toContain("先承认对手更强");
    expect(hay).toContain("恐怖如斯");
  });

  test("v2：读者想要 / 情绪走向 / 戏剧单元", () => {
    const hay = cardDeepHay({ ...base, readerWant: "想看主角用脑子赢", emotionArc: "劣势—拉满—崩断", dramaticUnit: "靠听觉取胜的人" });
    expect(hay).toContain("用脑子赢");
    expect(hay).toContain("崩断");
    expect(hay).toContain("靠听觉取胜");
  });

  test("人味 / 书感 / 创作思维 / 机制仍在（原有覆盖不回退）", () => {
    const hay = cardDeepHay({
      ...base,
      humanFeel: { writerCraft: "呼吸可以不齐", characterState: "在算账" },
      bookCraft: { continueWhy: "收束后还想翻", failAsShortStory: "写成独立短篇" },
      mind: { sellIntoCost: "卖点进代价", infoStaging: "分期交付" },
      mechanisms: [{ name: "先承认对手更强", failWhen: "削得没尊严", rebuild: "换感官维度" }],
      handoff: { purpose: "本卡用途", discard: "丢掉原作人名" },
    });
    for (const probe of ["呼吸可以不齐", "在算账", "还想翻", "独立短篇", "分期交付", "削得没尊严", "丢掉原作人名"]) {
      expect(hay).toContain(probe);
    }
  });

  test("统一小写，查询大小写不敏感", () => {
    expect(cardDeepHay({ ...base, mustNotCopy: ["Railgun"] })).toContain("railgun");
  });

  test("字段缺失不抛（历史卡/v1 卡也能检索）", () => {
    expect(() => cardDeepHay({ id: "x" })).not.toThrow();
    expect(typeof cardDeepHay({ id: "x" })).toBe("string");
  });
});
