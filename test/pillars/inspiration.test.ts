import { afterEach, beforeEach, describe, test } from "node:test";
import { expect } from "../_compat/expect.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { InspirationPort, LibraryPort } from "../../src/lib/ports/index.ts";
import { ensureStorage, listWorks, readChapter, readWorkMeta } from "../../src/lib/store.ts";
import { ZhizhangError } from "../../src/lib/errors.ts";

let root: string;
const exec = { agent: { session: { header: { cwd: "" } } } };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "zhizhang-insp-"));
  (exec.agent.session.header as { cwd: string }).cwd = root;
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function paths() {
  return ensureStorage(exec, {}, path.join(root, ".zhizhang"));
}

async function acceptCraft(p: Awaited<ReturnType<typeof paths>>, markers?: {
  craft?: string;
  state?: string;
  mech?: string;
  continueWhy?: string;
}) {
  const { sourceId } = await LibraryPort.importSource(p, {
    title: "参考",
    text: "参考正文足够长用于拆解。",
    exec,
  });
  const { candId } = await LibraryPort.stageCard(p, {
    title: "写法状态卡",
    sourceId,
    axis: "craft",
    body: "分析",
    mechanisms: [
      {
        name: markers?.mech ?? "MECH_NAME_MARKER",
        experience: "e",
        rebuild: "r",
        discard: "d",
        failWhen: "说满",
      },
    ],
    humanFeel: {
      writerCraft: markers?.craft ?? "UNIQUE_CRAFT_MARKER",
      craftRange: "p1",
      characterState: markers?.state ?? "UNIQUE_STATE_MARKER",
      stateOnPage: "停一下再开口",
      allowedEdges: "允许偏题一句",
      failAsTemplate: "范文腔失败",
    },
    bookCraft: {
      continueWhy: markers?.continueWhy ?? "CONTINUE_WHY_MARKER",
      adjacentChange: "换人事压力",
      failAsShortStory: "短篇闭环失败",
    },
  });
  return LibraryPort.acceptCard(p, candId);
}

async function acceptMind(p: Awaited<ReturnType<typeof paths>>, markers?: { sell?: string }) {
  const { sourceId } = await LibraryPort.importSource(p, {
    title: "思维源",
    text: "用于创作思维拆解。",
    exec,
  });
  const { candId } = await LibraryPort.stageCard(p, {
    title: "创作思维卡",
    sourceId,
    axis: "mind",
    body: "能力代价同场；信息分期；章末换压。",
    mechanisms: [
      {
        name: "代价同场",
        experience: "e",
        rebuild: "r",
        discard: "原作专名",
        failWhen: "百科表",
      },
    ],
    mind: {
      sellIntoCost: markers?.sell ?? "UNIQUE_MIND_SELL",
      infoStaging: "设定晚漏",
      pressureMachine: "关系换压",
      debtAndSwap: "章末留债换主戏",
      readerContract: "脏吵进场+账未结",
      failAsEncyclopedia: "百科即失败",
    },
  });
  return LibraryPort.acceptCard(p, candId);
}

describe("Inspiration pillar · dual axis 0.7.0", () => {
  test("mind required unless craft_only; forge feeds mind primary + craft aux", async () => {
    const p = await paths();
    const { cardId: craftId } = await acceptCraft(p, {
      craft: "UNIQUE_CRAFT_MARKER_031",
      state: "UNIQUE_STATE_MARKER_031",
      mech: "MECH_NAME_MARKER_032",
      continueWhy: "BOOK_CONTINUE_033",
    });
    const { cardId: mindId } = await acceptMind(p, { sell: "UNIQUE_MIND_SELL_070" });

    // craft-only without flag → reject
    let mindReq: unknown;
    try {
      await InspirationPort.startSession(p, {
        goal: "缺 mind",
        cardIds: [craftId],
      });
    } catch (e) {
      mindReq = e;
    }
    expect((mindReq as ZhizhangError).code).toBe("mind_required");

    // craft_only ok
    const craftOnly = await InspirationPort.startSession(p, {
      goal: "仅技法试写",
      cardIds: [craftId],
      craftOnly: true,
    });
    expect(craftOnly.craftOnly).toBe(true);
    const forgeOnly = await InspirationPort.forgeBrief(p, craftOnly.sessionId);
    expect(forgeOnly).toContain("仅技法试写");
    expect(forgeOnly).toContain("UNIQUE_CRAFT_MARKER_031");

    // dual: mind + craft
    const { sessionId } = await InspirationPort.startSession(p, {
      goal: "都市轻科幻：夜班店员发现冷柜短暂对轨",
      genre: "都市轻科幻",
      cardIds: [craftId, mindId],
    });
    const forge = await InspirationPort.forgeBrief(p, sessionId);
    expect(forge).toContain("灵感推演简报");
    expect(forge).toContain("mind · 主粮");
    expect(forge).toContain("UNIQUE_MIND_SELL_070");
    expect(forge).toContain("UNIQUE_CRAFT_MARKER_031");
    expect(forge).toContain("UNIQUE_STATE_MARKER_031");
    expect(forge).toContain("主吃 mind");
    expect(forge).toContain("相邻换压力");
    expect(forge).not.toContain("口气正例");
    const idxMind = forge.indexOf("UNIQUE_MIND_SELL_070");
    const idxCraft = forge.indexOf("UNIQUE_CRAFT_MARKER_031");
    const idxMethods = forge.indexOf("共享方法包");
    expect(idxMind).toBeGreaterThan(-1);
    expect(idxMind).toBeLessThan(idxCraft);
    expect(idxCraft).toBeLessThan(idxMethods);

    // lean formatCardsSection: craft only
    const craftCard = await LibraryPort.getCard(p, craftId);
    const mindCard = await LibraryPort.getCard(p, mindId);
    const leanSec = InspirationPort.formatCardsSection([craftCard, mindCard], {
      source: "test",
      note: "unit",
      lean: true,
    });
    expect(leanSec).toContain("lean");
    expect(leanSec).toContain("UNIQUE_CRAFT_MARKER_031");
    expect(leanSec).not.toContain("UNIQUE_MIND_SELL_070");
    expect(leanSec).toContain("未注入 lean");

    const fCand = await InspirationPort.stageEmit(p, sessionId, {
      kind: "foundation",
      payload: {
        locks: "不得出现原作人名",
        characters: "夜班店员周砚",
        planned: "冷柜对轨换货",
        style: "克制、器物细节、限知",
        threads: "对账单差货",
      },
    });
    expect(fCand.styleReminder).toContain("主吃 mind");
    const oCand = await InspirationPort.stageEmit(p, sessionId, {
      kind: "outline",
      payload: {
        chapter: "01",
        title: "第三格结霜",
        ending: "换回汽水，现场少货，账对不上",
        situationLens: "夜班对账焦虑",
        livedScene: "第一次对轨",
        stateLens: "冷、在算账",
        targetWords: 900,
      },
    });
    const accF = await InspirationPort.acceptEmit(p, fCand.candId, {
      workKey: "双轨冷柜",
      apply: true,
      title: "双轨冷柜",
      genre: "都市轻科幻",
      premise: "冷柜对轨",
    });
    expect(accF.applied).toBe(true);
    await InspirationPort.acceptEmit(p, oCand.candId, { workKey: "双轨冷柜", apply: true });
    const dir = path.join(p.works, "双轨冷柜");
    expect((await readWorkMeta(dir)).foundation.characters).toContain("周砚");
    expect((await readChapter(dir, "01")).title).toBe("第三格结霜");

    // no apply
    const { cardId: c2 } = await acceptCraft(p);
    const { cardId: m2 } = await acceptMind(p);
    const s2 = await InspirationPort.startSession(p, { goal: "新作", cardIds: [c2, m2] });
    const staged = await InspirationPort.stageEmit(p, s2.sessionId, {
      kind: "foundation",
      payload: { locks: "x", characters: "y" },
    });
    const noApply = await InspirationPort.acceptEmit(p, staged.candId, {
      workKey: "不应创建",
      apply: false,
    });
    expect(noApply.applied).toBe(false);
    expect((await listWorks(p)).length).toBe(1);
  });
});

