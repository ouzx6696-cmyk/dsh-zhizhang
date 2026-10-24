/**
 * Inspiration pillar — session/forge (mind primary), foundation+outline emit
 * with apply, no-apply safety, bindings.json card index, card resolution
 * paths (explicit / bound / none-with-guidance).
 */
import { afterEach, beforeEach, describe, test } from "node:test";
import { expect } from "./_compat/expect.ts";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { InspirationPort, LibraryPort } from "../src/lib/ports/index.ts";
import { ensureStorage, listWorks, readChapter, readWorkMeta } from "../src/lib/store.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "zhizhang-insp-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const paths = () => ensureStorage({}, { storageRoot: path.join(root, ".zhizhang") });

async function acceptCraft(p: any, craft = "UNIQUE_CRAFT_MARKER") {
  const book = "第一章 参考" + String.fromCharCode(10) + "参考正文足够长用于拆解。";
  const { sourceId } = await LibraryPort.importSource(p, { title: "参考", text: book });
  const { candId } = await LibraryPort.stageCard(p, {
    title: "写法状态卡", sourceId, axis: "craft",
    body: "分析",
    mechanisms: [{ name: "MECH_NAME_MARKER", experience: "e", rebuild: "r", discard: "d", failWhen: "说满" }],
    humanFeel: { writerCraft: craft, craftRange: "p1", characterState: "UNIQUE_STATE_MARKER", stateOnPage: "停一下再开口", allowedEdges: "允许偏题一句", failAsTemplate: "范文腔失败" },
    bookCraft: { continueWhy: "CONTINUE_WHY_MARKER", adjacentChange: "换人事压力", failAsShortStory: "短篇闭环失败" },
  });
  return LibraryPort.acceptCard(p, candId);
}
async function acceptMind(p: any, sell = "UNIQUE_MIND_SELL") {
  const book = "第一章 思维" + String.fromCharCode(10) + "用于创作思维拆解。";
  const { sourceId } = await LibraryPort.importSource(p, { title: "思维源", text: book });
  const { candId } = await LibraryPort.stageCard(p, {
    title: "创作思维卡", sourceId, axis: "mind",
    body: "能力代价同场；信息分期；章末换压。",
    mechanisms: [{ name: "代价同场", experience: "e", rebuild: "r", discard: "原作专名", failWhen: "百科表" }],
    mind: { sellIntoCost: sell, infoStaging: "设定晚漏", pressureMachine: "关系换压", debtAndSwap: "章末留债", readerContract: "脏吵进场", failAsEncyclopedia: "百科即失败" },
  });
  return LibraryPort.acceptCard(p, candId);
}

describe("inspiration · 会话与 forge", () => {
  test("craft_only 免 mind；forge 吃 mind 主粮 + craft 辅且顺序在方法包前", async () => {
    const p = await paths();
    const { cardId: craftId } = await acceptCraft(p, "UNIQUE_CRAFT_MARKER_031");
    const { cardId: mindId } = await acceptMind(p, "UNIQUE_MIND_SELL_070");

    const craftOnly = await InspirationPort.startSession(p, { goal: "仅技法", cardIds: [craftId], craftOnly: true });
    expect((await InspirationPort.forgeBrief(p, craftOnly.sessionId))).toContain("仅技法试写");

    // combo 回执里每张卡 id 出现两次，照抄传入必须去重——否则 forge 重复渲染、分轴计数翻倍
    const dup = await InspirationPort.startSession(p, { goal: "去重", cardIds: [craftId, mindId, craftId, mindId] });
    expect(dup.mindCount).toBe(1);
    expect(dup.craftCount).toBe(1);
    const session = await InspirationPort.getSession(p, dup.sessionId);
    expect(session.cardIds.length).toBe(2);

    const { sessionId } = await InspirationPort.startSession(p, {
      goal: "夜班店员发现冷柜对轨", genre: "都市轻科幻", cardIds: [craftId, mindId],
    });
    const forge = await InspirationPort.forgeBrief(p, sessionId);
    expect(forge).toContain("mind · 主粮");
    expect(forge).toContain("UNIQUE_MIND_SELL_070");
    expect(forge).toContain("UNIQUE_CRAFT_MARKER_031");
    const idxMind = forge.indexOf("UNIQUE_MIND_SELL_070");
    const idxCraft = forge.indexOf("UNIQUE_CRAFT_MARKER_031");
    expect(idxMind).toBeGreaterThan(-1);
    expect(idxMind).toBeLessThan(idxCraft);
  });

  test("无 mind 又未 craft_only → 拒", async () => {
    const p = await paths();
    const { cardId } = await acceptCraft(p);
    let threw = false;
    try {
      await InspirationPort.startSession(p, { goal: "x", cardIds: [cardId] });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

describe("inspiration · 根基/章纲 apply（显式 accept 才写作品）", () => {
  test("foundation+outline apply 建作品写章纲；apply=false 不建", async () => {
    const p = await paths();
    const { cardId: c1 } = await acceptCraft(p, "BIND_CRAFT_1");
    const { cardId: m1 } = await acceptMind(p, "BIND_MIND_1");
    const { sessionId } = await InspirationPort.startSession(p, { goal: "绑定作", cardIds: [c1, m1] });

    const f = await InspirationPort.stageEmit(p, sessionId, {
      kind: "foundation",
      payload: { locks: "不得出现原作人名", characters: "夜班店员周砚", planned: "冷柜对轨换货", style: "克制、限知" },
    });
    const o = await InspirationPort.stageEmit(p, sessionId, {
      kind: "outline",
      payload: { chapter: "01", title: "第三格结霜", ending: "换回汽水，账对不上", situationLens: "对账焦虑", livedScene: "第一次对轨", stateLens: "冷、在算", targetWords: 900 },
    });
    const accF = await InspirationPort.acceptEmit(p, f.candId, { workKey: "双轨冷柜", apply: true, title: "双轨冷柜", genre: "都市", premise: "对轨" });
    expect(accF.applied).toBe(true);
    await InspirationPort.acceptEmit(p, o.candId, { workKey: "双轨冷柜", apply: true });

    const dir = path.join(p.works, "双轨冷柜");
    expect((await readWorkMeta(dir)).foundation.characters).toContain("周砚");
    expect((await readChapter(dir, "01")).title).toBe("第三格结霜");

    const staged = await InspirationPort.stageEmit(p, sessionId, { kind: "foundation", payload: { locks: "x", characters: "y" } });
    const noApply = await InspirationPort.acceptEmit(p, staged.candId, { workKey: "不应创建", apply: false });
    expect(noApply.applied).toBe(false);
    expect((await listWorks(p)).length).toBe(1);

    // bindings.json：workKey → 绑定卡（E4 索引），新采纳排前
    const bindings = JSON.parse(await readFile(path.join(p.inspiration, "bindings.json"), "utf8"));
    expect(bindings["双轨冷柜"][0]).toBe(c1);
  });
});

describe("inspiration · chapter_brief 取卡三路", () => {
  test("genre 命中卡内文也不注入；显式 card_ids 照常；未 accept 硬拒", async () => {
    const p = await paths();
    const { cardId } = await acceptCraft(p, "UNIQUE_CRAFT_MARKER_200");
    const byGenre = await InspirationPort.resolveCardsForBrief(p, { genre: "UNIQUE_CRAFT_MARKER_200" });
    expect(byGenre.source).toBe("none");
    expect(byGenre.note).toContain("library_combo_suggest");
    const explicit = await InspirationPort.resolveCardsForBrief(p, { cardIds: [cardId] });
    expect(explicit.source).toBe("explicit");
    let threw = false;
    try {
      await InspirationPort.resolveCardsForBrief(p, { cardIds: ["card-not-exist"] });
    }
    catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("bindings 快路径取卡（免扫目录）；索引指向死卡回退不炸", async () => {
    const p = await paths();
    const { cardId: c1 } = await acceptCraft(p, "BIND_CRAFT_1");
    const { cardId: m1 } = await acceptMind(p, "BIND_MIND_1");
    const { sessionId } = await InspirationPort.startSession(p, { goal: "绑定作", cardIds: [c1, m1] });
    const { candId } = await InspirationPort.stageEmit(p, sessionId, { kind: "foundation", payload: { locks: "l", characters: "c" } });
    await InspirationPort.acceptEmit(p, candId, { workKey: "绑定的作品", apply: true });

    await rm(path.join(p.inspiration, "candidates"), { recursive: true, force: true });
    const resolved = await InspirationPort.resolveCardsForBrief(p, { workKey: "绑定的作品", limit: 3 });
    expect(resolved.source).toBe("inspire_apply");
    expect(resolved.cardIds).toContain(c1);
    expect(resolved.cardIds).toContain(m1);

    await mkdir(path.join(p.inspiration), { recursive: true });
    await writeFile(path.join(p.inspiration, "bindings.json"), JSON.stringify({ ghost: ["card-gone"] }));
    const r = await InspirationPort.resolveCardsForBrief(p, { workKey: "ghost" });
    expect(r.source).toBe("none");
  });
});
