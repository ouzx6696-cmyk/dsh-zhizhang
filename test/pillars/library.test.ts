import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  LibraryPort,
  normalizeBookCraft,
  normalizeHumanFeel,
  normalizeMind,
  normalizeAxis,
  coerceAxis,
  admitCardContent,
  formatTechniqueCardBlockLean,
  formatTechniqueCardBlock,
  hasShatterCraftCue,
  ANTI_STIFFNESS_BRIEF_LINE,
} from "../../src/lib/ports/index.ts";
import { ensureStorage } from "../../src/lib/store.ts";
import { ZhizhangError } from "../../src/lib/errors.ts";

let root: string;
const exec = { agent: { session: { header: { cwd: "" } } } };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "zhizhang-lib-"));
  (exec.agent.session.header as { cwd: string }).cwd = root;
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function paths() {
  return ensureStorage(exec, {}, path.join(root, ".zhizhang"));
}

const mech = {
  name: "半截话",
  experience: "话没说完就停",
  rebuild: "对话留白",
  discard: "原作人名",
  failWhen: "写成齐整对白交待",
};

const craftFeel = {
  writerCraft: "半截话顶着身体小动作，不说明书",
  craftRange: "导入全文",
  characterState: "想退、说不出口",
  stateOnPage: "抠杯沿、半晌才说算了",
  allowedEdges: "允许停顿、说到一半改口",
  failAsTemplate: "写成齐整范文腔即失败",
};

const mindBlock = {
  sellIntoCost: "爽点同场摊账单：能力亮相时钉死代价",
  infoStaging: "设定晚漏半拍，跟着反应走",
  pressureMachine: "强弱不对等时用关系换压",
  debtAndSwap: "章末留未兑负债，下章换主戏",
  readerContract: "开篇合同=脏吵进场+账未结",
  failAsEncyclopedia: "写成世界观百科/设定表即失败",
};

describe("Library pillar · dual axis 0.7.0", () => {
  test("dissect dual-axis brief; craft+mind stage/accept; lean skips mind dump", async () => {
    const p = await paths();
    const { sourceId } = await LibraryPort.importSource(p, {
      title: "测试原作",
      author: "测",
      text: "第一章。主角用错位估值换到一罐汽水。他抠了抠杯沿，半晌才说：算了。",
      readingRange: "第1章",
      exec,
    });
    const brief = await LibraryPort.dissectBrief(p, sourceId, { maxChars: 2000 });
    expect(brief).toContain("双轴");
    expect(brief).toContain("axis=craft");
    expect(brief).toContain("axis=mind");
    expect(brief).toContain("准入样子");
    expect(brief).toContain("sellIntoCost");
    expect(brief).toContain("毒点");
    expect(brief).toContain("打碎僵硬");
    expect(brief).toContain("本场应落纸");
    expect(brief).not.toContain("必须骂");

    const craftStaged = await LibraryPort.stageCard(p, {
      title: "craft卡",
      sourceId,
      axis: "craft",
      body: "## 分析\n场面写法可迁。",
      mechanisms: [mech],
      humanFeel: craftFeel,
      bookCraft: {
        continueWhy: "差额还在，老板明天要查",
        adjacentChange: "人事压力上场",
        failAsShortStory: "写成独立短篇闭环即失败",
      },
      tags: ["craft"],
    });
    expect(craftStaged.warnings.some((w) => w.includes("未填 humanFeel"))).toBe(false);

    const mindStaged = await LibraryPort.stageCard(p, {
      title: "mind卡",
      sourceId,
      axis: "mind",
      body: "## 思维\n能力代价同场；章末换压。",
      mechanisms: [
        {
          name: "能力代价同场",
          experience: "爽点上摊账单",
          rebuild: "新作能力亮相时钉代价",
          discard: "原作专名",
          failWhen: "写成设定百科",
        },
      ],
      mind: mindBlock,
      tags: ["mind"],
    });
    expect(mindStaged.warnings.some((w) => w.includes("未填 mind"))).toBe(false);

    const { cardId: craftId } = await LibraryPort.acceptCard(p, craftStaged.candId);
    const { cardId: mindId } = await LibraryPort.acceptCard(p, mindStaged.candId);
    const craft = await LibraryPort.getCard(p, craftId);
    const mind = await LibraryPort.getCard(p, mindId);
    expect(craft.axis).toBe("craft");
    expect(mind.axis).toBe("mind");
    expect(mind.mind?.sellIntoCost).toContain("账单");

    const leanCraft = formatTechniqueCardBlockLean(craft);
    expect(leanCraft).toContain("写法：");
    expect(leanCraft).toContain("本场不完美（应落纸）");
    expect(leanCraft).not.toContain("sellIntoCost");
    const leanMind = formatTechniqueCardBlockLean(mind);
    expect(leanMind).toContain("不注入 lean");
    expect(leanMind).not.toContain("卖点→代价");

    const fullMind = formatTechniqueCardBlock(mind);
    expect(fullMind).toContain("创作思维");
    expect(fullMind).toContain("sellIntoCost");

    expect((await LibraryPort.searchCards(p, "mind")).some((h) => h.id === mindId)).toBe(true);
    expect((await LibraryPort.searchCards(p, "半截话")).some((h) => h.id === craftId)).toBe(true);

    let emptyErr: unknown;
    try {
      await LibraryPort.stageCard(p, {
        title: "空",
        sourceId,
        body: "   ",
        mechanisms: [mech],
      });
    } catch (e) {
      emptyErr = e;
    }
    expect((emptyErr as ZhizhangError).code).toBe("empty_body");
  });

  test("admit hard-rejects encyclopedia / voice teaching", async () => {
    const p = await paths();
    const { sourceId } = await LibraryPort.importSource(p, {
      title: "源",
      text: "正文一段。",
      exec,
    });
    let voiceErr: unknown;
    try {
      await LibraryPort.stageCard(p, {
        title: "角色声纹范本",
        sourceId,
        axis: "craft",
        body: "收集台词范本教创作 AI 背诵专属声音。",
        mechanisms: [mech],
      });
    } catch (e) {
      voiceErr = e;
    }
    expect((voiceErr as ZhizhangError).code).toBe("card_rejected");

    let encErr: unknown;
    try {
      await LibraryPort.stageCard(p, {
        title: "世界观词条合集",
        sourceId,
        axis: "mind",
        body: "设定百科：列出全部原作专名对照。",
        mechanisms: [mech],
        mind: mindBlock,
      });
    } catch (e) {
      encErr = e;
    }
    expect((encErr as ZhizhangError).code).toBe("card_rejected");
  });

  test("legacy card without axis coerces to craft; normalize helpers", async () => {
    const p = await paths();
    const { sourceId } = await LibraryPort.importSource(p, {
      title: "旧",
      text: "旧卡兼容。",
      exec,
    });
    // stage without axis but with humanFeel → craft
    const staged = await LibraryPort.stageCard(p, {
      title: "无轴旧形",
      sourceId,
      body: "写法分析。",
      mechanisms: [mech],
      humanFeel: craftFeel,
    });
    expect(staged.warnings.some((w) => w.includes("推断为 craft") || w.includes("默认 craft"))).toBe(
      true,
    );
    const { cardId } = await LibraryPort.acceptCard(p, staged.candId);
    const card = await LibraryPort.getCard(p, cardId);
    expect(card.axis).toBe("craft");

    expect(normalizeAxis(undefined, { hasHumanFeel: true }).axis).toBe("craft");
    expect(normalizeAxis(undefined, { hasMind: true }).axis).toBe("mind");
    expect(normalizeAxis("mind", {}).axis).toBe("mind");
    // kind=book must NOT become mind
    expect(normalizeAxis(undefined, { kind: "book", hasHumanFeel: true }).axis).toBe("craft");

    const absent = normalizeHumanFeel(undefined);
    expect(absent.humanFeel).toBeUndefined();
    const modern = normalizeHumanFeel({
      writerCraft: "信息晚漏半拍",
      characterState: "慌着还想装没事",
      stateOnPage: "手在抖却偏题聊天气",
      allowedEdges: "允许偏题",
      failAsTemplate: "写成范文腔即失败",
    });
    expect(modern.humanFeel?.writerCraft).toContain("晚漏");

    const noMind = normalizeMind(undefined);
    expect(noMind.mind).toBeUndefined();
    const mind = normalizeMind(mindBlock);
    expect(mind.mind?.debtAndSwap).toContain("换主戏");

    const noBook = normalizeBookCraft(undefined);
    expect(noBook.bookCraft).toBeUndefined();

    expect(
      admitCardContent({
        title: "剧情梗概",
        body: "全章复述原作情节链。",
        axis: "craft",
        mechanisms: [mech],
      }).hardReject,
    ).toBeTruthy();

    expect(coerceAxis({ humanFeel: craftFeel } as never)).toBe("craft");
    expect(coerceAxis({ mind: mindBlock } as never)).toBe("mind");
  });
});

describe("Library pillar · multi-source filter + combo 0.7.1", () => {
  async function seedTwoBooks() {
    const p = await paths();
    const a = await LibraryPort.importSource(p, {
      title: "龙族开篇",
      author: "江南",
      text: "台风夜里，路灯歪着。",
      exec,
    });
    const b = await LibraryPort.importSource(p, {
      title: "另一本都市",
      author: "测乙",
      text: "便利店灯管嗡嗡响。",
      exec,
    });
    const mindA = await LibraryPort.stageCard(p, {
      title: "A思维-能力代价",
      sourceId: a.sourceId,
      axis: "mind",
      body: "能力与代价同场；信息分期。",
      mechanisms: [
        {
          name: "能力代价同场",
          experience: "爽点上摊账",
          rebuild: "新作同场钉代价",
          discard: "原作专名",
          failWhen: "写成设定百科",
        },
      ],
      mind: mindBlock,
      tags: ["mind", "代价"],
    });
    const craftA = await LibraryPort.stageCard(p, {
      title: "A技法-半截话",
      sourceId: a.sourceId,
      axis: "craft",
      body: "半截话顶身体。",
      mechanisms: [mech],
      humanFeel: craftFeel,
      bookCraft: {
        continueWhy: "账未结",
        failAsShortStory: "短篇闭环即失败",
      },
      tags: ["craft", "半截话"],
    });
    const craftB = await LibraryPort.stageCard(p, {
      title: "B技法-小物抢节奏",
      sourceId: b.sourceId,
      axis: "craft",
      body: "弱者用热水杯压场。",
      mechanisms: [
        {
          name: "小物抢节奏",
          experience: "递烟/递杯",
          rebuild: "高压戏给弱者手上小事",
          discard: "原作道具专名",
          failWhen: "写成说明书动作",
        },
      ],
      humanFeel: {
        ...craftFeel,
        writerCraft: "高压戏用小物抢话权",
        characterState: "怕，但还在算",
        stateOnPage: "拧瓶盖拧到白指节",
      },
      bookCraft: {
        continueWhy: "关系压还在",
        failAsShortStory: "短篇闭环即失败",
      },
      tags: ["craft", "小物"],
    });
    const mindB = await LibraryPort.stageCard(p, {
      title: "B思维-信息分期",
      sourceId: b.sourceId,
      axis: "mind",
      body: "设定晚漏半拍。",
      mechanisms: [
        {
          name: "信息分期",
          experience: "跟着反应走",
          rebuild: "新作设定晚半拍",
          discard: "原作世界观词条",
          failWhen: "开篇百科倾倒",
        },
      ],
      mind: {
        ...mindBlock,
        infoStaging: "设定跟着反应晚漏半拍",
        sellIntoCost: "都市能力亮相也要账单",
      },
      tags: ["mind", "分期"],
    });
    const { cardId: mindAId } = await LibraryPort.acceptCard(p, mindA.candId);
    const { cardId: craftAId } = await LibraryPort.acceptCard(p, craftA.candId);
    const { cardId: craftBId } = await LibraryPort.acceptCard(p, craftB.candId);
    const { cardId: mindBId } = await LibraryPort.acceptCard(p, mindB.candId);
    return {
      p,
      sourceA: a.sourceId,
      sourceB: b.sourceId,
      mindAId,
      craftAId,
      craftBId,
      mindBId,
    };
  }

  test("list/search filter by sourceId, sourceTitle, axis", async () => {
    const { p, sourceA, sourceB, mindAId, craftAId, craftBId } = await seedTwoBooks();

    const onlyA = await LibraryPort.listCards(p, { sourceId: sourceA });
    expect(onlyA.every((c) => c.sourceId === sourceA)).toBe(true);
    expect(onlyA.some((c) => c.id === mindAId)).toBe(true);
    expect(onlyA.some((c) => c.id === craftBId)).toBe(false);

    const byTitle = await LibraryPort.listCards(p, { sourceTitle: "龙族" });
    expect(byTitle.every((c) => c.sourceId === sourceA)).toBe(true);

    const crafts = await LibraryPort.listCards(p, { axis: "craft" });
    expect(crafts.every((c) => c.axis === "craft")).toBe(true);
    expect(crafts.length).toBe(2);

    const minds = await LibraryPort.listCards(p, {
      sourceIds: [sourceA, sourceB],
      axis: "mind",
    });
    expect(minds.every((c) => c.axis === "mind")).toBe(true);
    expect(minds.length).toBe(2);

    const hit = await LibraryPort.searchCards(p, "小物", { axis: "craft" });
    expect(hit.some((c) => c.id === craftBId)).toBe(true);
    expect(hit.some((c) => c.id === craftAId)).toBe(false);

    const filterOnly = await LibraryPort.searchCards(p, "", { sourceId: sourceB });
    expect(filterOnly.every((c) => c.sourceId === sourceB)).toBe(true);
    expect(filterOnly.length).toBe(2);
  });

  test("suggestCombo = 1 mind + N craft, cross-source; no mind → empty", async () => {
    const { p, sourceA, sourceB, mindAId, craftAId, craftBId } = await seedTwoBooks();

    const combo = await LibraryPort.suggestCombo(p, {
      craftCount: 2,
      query: "小物",
      preferMindSourceIds: [sourceA],
    });
    expect(combo.ok).toBe(true);
    expect(combo.mind?.id).toBe(mindAId);
    expect(combo.cardIds[0]).toBe(mindAId);
    expect(combo.crafts.length).toBe(2);
    expect(combo.cardIds.length).toBe(3);
    // query prefers 小物 craft; cross-book allowed
    expect(combo.crafts.some((c) => c.id === craftBId)).toBe(true);
    expect(combo.crafts.every((c) => c.axis === "craft")).toBe(true);

    const cross = await LibraryPort.suggestCombo(p, {
      sourceIds: [sourceA, sourceB],
      craftCount: 1,
      preferMindSourceIds: [sourceB],
    });
    expect(cross.ok).toBe(true);
    expect(cross.mind?.sourceId).toBe(sourceB);
    expect(cross.crafts.length).toBe(1);

    // pool with only crafts from one source that has no mind after filter
    // Filter to source that we strip minds... use axis-less empty via fake: only craftA by accepting nothing else
    const onlyCraftPool = await LibraryPort.suggestCombo(p, {
      sourceIds: [sourceA],
      craftCount: 2,
      query: "不存在的主题词xyzzy",
    });
    // sourceA has mind — still ok
    expect(onlyCraftPool.ok).toBe(true);
    expect(onlyCraftPool.mind).toBeTruthy();

    // craft-only sourceB filtered... sourceB has mind too.
    // Create isolated source with only craft:
    const c = await LibraryPort.importSource(p, {
      title: "只有技法的书",
      text: "一段。",
      exec,
    });
    const onlyCraft = await LibraryPort.stageCard(p, {
      title: "孤技法",
      sourceId: c.sourceId,
      axis: "craft",
      body: "只有技法。",
      mechanisms: [mech],
      humanFeel: craftFeel,
    });
    await LibraryPort.acceptCard(p, onlyCraft.candId);
    const noMind = await LibraryPort.suggestCombo(p, {
      sourceIds: [c.sourceId],
      craftCount: 2,
    });
    expect(noMind.ok).toBe(false);
    expect(noMind.cardIds).toEqual([]);
    expect(noMind.emptyReason).toContain("无 mind");
  });
});

describe("Library · anti-stiffness 0.10.5", () => {
  test("permission allowedEdges soft-warns; shatter helpers", async () => {
    const perm = normalizeHumanFeel({
      writerCraft: "信息从误认里漏",
      characterState: "第一下会急",
      stateOnPage: "手先动",
      allowedEdges: "可以留毛边",
      failAsTemplate: "句句收齐即失败",
    });
    expect(perm.warnings.some((w) => w.includes("许可句") || w.includes("应落纸"))).toBe(true);
    expect(hasShatterCraftCue("本场应落纸：半截；信息侧漏")).toBe(true);
    expect(hasShatterCraftCue("气味先行")).toBe(false);
    expect(ANTI_STIFFNESS_BRIEF_LINE).toContain("反僵硬");
  });
});
