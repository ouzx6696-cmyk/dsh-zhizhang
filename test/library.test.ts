/**
 * Library pipeline — import → plan (auto / full consent + param binding) →
 * dissect → facts → structure → v2 cards (admission + deep search) →
 * report (19 sections) → audit → combo. Tool-driven, one continuous source.
 */
import { afterEach, beforeEach, describe, test } from "node:test";
import { expect } from "./_compat/expect.ts";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { __testing } from "../src/index.ts";
import { cardDeepHay } from "../src/lib/ports/library/store.ts";
import { writePendingConfirm, assertFullConsent } from "../src/lib/ports/analysis.ts";
import { ensureStorage } from "../src/lib/store.ts";

let root: string;
let base: string;
let run: (name: string, args?: Record<string, unknown>) => Promise<string>;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "zhizhang-lib-"));
  base = path.join(root, ".zhizhang");
  await ensureStorage({}, { storageRoot: base });
  const tools = new Map(__testing.tools.map((t) => [t.name, t.execute]));
  run = (name, args = {}) => tools.get(name)!(args, {}) as Promise<string>;
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const wd = () => ({ working_dir: base });

const BOOK = [
  "第1章 差三罐", "　　凌晨两点，周砚数完货架，屏幕上的数字比昨天少了三罐咖啡。他把时间戳抄在纸条上。老蒋进来刷卡，没抬头。",
  "第2章 四秒", "　　他调出监控回放，侧窗的人影只用了四秒，手上戴着店里的一次性手套。",
  "第3章 手套", "　　手套数目不少一盒。收银机的屏幕自己亮了一下，又灭了。",
].join("\n");

describe("library · 拆书管线一条流（工具层）", () => {
  test("import→plan→dissect→facts→structure→卡→报告→组包，回执逐步指路", async () => {
    let out = await run("zhizhang_library_import", { title: "夜班账本", text: BOOK, ...wd() });
    const srcId = /sourceId=(src-[a-z0-9]+)/.exec(out)?.[1];
    expect(srcId).toBeTruthy();
    expect(out).toContain("下一步 2/9");

    out = await run("zhizhang_library_plan", { source: srcId, ...wd() });
    expect(out).toContain("已生成抽样计划");
    expect(out).toContain("全读（小书）");

    out = await run("zhizhang_library_dissect_brief", { source: srcId, batch: 0, ...wd() });
    expect(out).toContain("第1章");
    expect(out).toContain("下一步 4/9");

    out = await run("zhizhang_library_facts_stage", {
      source: srcId, ...wd(),
      facts: {
        n: 1, title: "差三罐",
        events: [{ desc: "周砚盘点发现咖啡少三罐", quote: "屏幕上的数字比昨天少了三罐咖啡" }],
        hook: { type: "悬念", text: "少的三罐去了哪", strength: "强" },
        unknowns: ["谁拿走了咖啡"],
      },
    });
    expect(out).toContain("已记录 1 章事实");

    out = await run("zhizhang_library_structure_stage", {
      source: srcId, kind: "plot", ...wd(),
      payload: { title: "差货追查", chapters: [1, 3], goal: "查清差货", obstacle: "无人可问", action: "对小票", result: "记账习惯", twist: "照片背面", turn: "改记账" },
    });
    expect(out).toContain("已记录剧情条");

    const staged = await run("zhizhang_library_card_stage", {
      title: "数字先于情绪", source: srcId, axis: "craft",
      layer: "scene", dimension: "hook",
      body: "把异常写成可核对的数数动作。",
      mechanisms: [{ name: "差数即钩子", experience: "差三罐开场", rebuild: "换任何数字差", discard: "便利店", failWhen: "差数只是气氛" }],
      humanFeel: { writerCraft: "先重数再开口", craftRange: "近景", characterState: "核对而非惊讶", stateOnPage: "停半拍", allowedEdges: "一句噪音", failAsTemplate: "句句报数" },
      bookCraft: { continueWhy: "想知道账的真相", adjacentChange: "换排查对象", failAsShortStory: "一章破案" },
      readerWant: "想知道差数背后的账", emotionArc: "平静-起疑-确认", dramaticUnit: "对不上的盘点",
      replaceables: ["三罐咖啡"], mustNotCopy: ["周砚"],
      evidence: [{ quote: "屏幕上的数字比昨天少了三罐咖啡", chapter: 1 }],
      steps: ["差数进场", "当场核对"], bannedDiction: ["心中一沉"],
      transfer: "实验室用量", failWhen: "超自然",
      ...wd(),
    });
    const lcand = /lcand-[a-z0-9]+/.exec(staged)?.[0];
    expect(lcand).toBeTruthy();
    out = await run("zhizhang_library_card_accept", { candidate: lcand, ...wd() });
    const cardId = /card-[a-z0-9]+/.exec(out)?.[0];
    expect(cardId).toBeTruthy();

    out = await run("zhizhang_library_card_get", { card: cardId, ...wd() });
    expect(out).toContain("操作步骤：");
    expect(out).toContain("禁用词句：心中一沉");

    out = await run("zhizhang_library_report", { source: srcId, ...wd() });
    expect(out).toContain("报告已写入");
    const reportMd = await readFile(path.join(base, "library", "analyses", srcId, "report.md"), "utf8");
    expect((reportMd.match(/^## \d+\./gm) ?? []).length).toBe(19);
    expect(reportMd).not.toContain("Infinity");

    out = await run("zhizhang_library_audit", { source: srcId, ...wd() });
    expect(out).toContain("可回溯");

    // mind 卡入池后组包成立（1 book + craft）
    const mindStaged = await run("zhizhang_library_card_stage", {
      title: "小数字撬大怀疑", source: srcId, axis: "mind",
      layer: "arc", dimension: "commercial",
      body: "卖点靠一个对不上的小数字。",
      mechanisms: [{ name: "可核对的小异常", experience: "三罐", rebuild: "任何账差", discard: "职业名词", failWhen: "不可核对" }],
      mind: { sellIntoCost: "占睡眠", infoStaging: "分月漏", pressureMachine: "劝退", debtAndSwap: "新差数", readerContract: "进场给差数", failAsEncyclopedia: "集中解释" },
      readerWant: "跟着核对", emotionArc: "笃定-重估", dramaticUnit: "小账撬旧事",
      replaceables: ["盘点差数"], mustNotCopy: ["夜班账本"],
      evidence: [{ quote: "他把时间戳抄在纸条上", chapter: 1 }],
      transfer: "会计对账", failWhen: "一次讲透",
      ...wd(),
    });
    const mindCand = /lcand-[a-z0-9]+/.exec(mindStaged)?.[0];
    await run("zhizhang_library_card_accept", { candidate: mindCand, ...wd() });

    out = await run("zhizhang_library_combo_suggest", { ...wd() });
    expect(out).toContain("组合包");
    expect(out).toContain(cardId!);
  });

  test("v2 模块缺公共字段硬拒 bad_module（v1 形状仍兼容过）", async () => {
    let out = await run("zhizhang_library_import", { title: "夜班账本", text: BOOK, ...wd() });
    const srcId = /sourceId=(src-[a-z0-9]+)/.exec(out)?.[1]!;
    out = await run("zhizhang_library_card_stage", {
      title: "缺字段", source: srcId, axis: "craft", body: "x",
      layer: "scene", dimension: "hook",
      mechanisms: [{ name: "m", failWhen: "f" }], steps: ["一步"], ...wd(),
    });
    expect(out).toContain("bad_module");
    expect(out).toContain("readerWant 为空");
    out = await run("zhizhang_library_card_stage", {
      title: "旧形状", source: srcId, axis: "craft", body: "## 写法" + String.fromCharCode(10) + "动作。",
      mechanisms: [{ name: "m", failWhen: "f" }], ...wd(),
    });
    expect(out).toContain("卡候选已暂存");
    expect(out).toContain("兼容可过");
  });
});

describe("library · Full 计划同意（工具层）", () => {
  test("有计划时 dissect(mode=full) 指路；回执参数与确认参数漂移 → bad_confirm_token", async () => {
    let out = await run("zhizhang_library_import", { title: "夜班账本", text: BOOK, ...wd() });
    const srcId = /sourceId=(src-[a-z0-9]+)/.exec(out)?.[1]!;
    await run("zhizhang_library_plan", { source: srcId, ...wd() });
    out = await run("zhizhang_library_dissect_brief", { source: srcId, mode: "full", ...wd() });
    expect(out).toContain("不会在这里生效");
    expect(out).toContain("作者同意");

    out = await run("zhizhang_library_plan", { source: srcId, mode: "full", reset: true, ...wd() });
    expect(out).toContain("Full 成本回执");
    const token = /confirm_token：(fp-[a-z0-9-]+)/.exec(out)?.[1]!;
    out = await run("zhizhang_library_plan", {
      source: srcId, mode: "full", confirm_full: true, confirm_token: token, note: "验收同意", ...wd(),
    });
    expect(out).toContain("已生成抽样计划");

    out = await run("zhizhang_library_plan", { source: srcId, mode: "full", batch_chars: 4000, reset: true, ...wd() });
    const token2 = /confirm_token：(fp-[a-z0-9-]+)/.exec(out)?.[1]!;
    out = await run("zhizhang_library_plan", {
      source: srcId, mode: "full", batch_chars: 8000, confirm_full: true, confirm_token: token2, ...wd(),
    });
    expect(out).toContain("bad_confirm_token");
    expect(out).toContain("batchChars 4000→8000");
  });
});

describe("library · 深检索 hay（少一个字段就红）", () => {
  test("v2 全字段进 hay；统一小写；空卡不炸", () => {
    const hay = cardDeepHay({
      id: "x", title: "测试卡", body: "正文没有的探针不该出现",
      humanFeel: { writerCraft: "呼吸可以不齐", characterState: "在算账" },
      bookCraft: { continueWhy: "还想翻", failAsShortStory: "独立短篇" },
      mind: { sellIntoCost: "卖点进代价", infoStaging: "分期交付" },
      mechanisms: [{ name: "先承认对手更强", failWhen: "削得没尊严", rebuild: "换感官维度" }],
      handoff: { purpose: "本卡用途", discard: "丢掉原作人名" },
      mustNotCopy: ["Railgun"],
      bannedDiction: ["空气仿佛凝固"],
      readerWant: "读者想要探针",
      emotionArc: "情绪走向探针",
      dramaticUnit: "戏剧单元探针",
      steps: ["三步公式探针"],
    });
    for (const probe of [
      "呼吸可以不齐", "在算账", "还想翻", "独立短篇", "分期交付", "削得没尊严", "丢掉原作人名",
      "railgun", "空气仿佛凝固", "读者想要探针", "情绪走向探针", "戏剧单元探针", "三步公式探针",
    ]) {
      expect(hay).toContain(probe);
    }
    expect(hay).not.toContain("测试卡");
    expect(typeof cardDeepHay({ id: "x" })).toBe("string");
  });
});

describe("library · Full 同意闸参数绑定（port 直调）", () => {
  test("同参通过；batch_chars 漂移 bad_confirm_token；旧留痕兼容", async () => {
    const p = await ensureStorage({}, { storageRoot: base });
    const params = { batchChars: 30000, totalChapters: 40, planChapters: 40 };
    await writePendingConfirm(p, "src-x", "tok-1", { chapters: 40 }, params);
    expect((await assertFullConsent(p, "src-x", "tok-1", params)).token).toBe("tok-1");
    const drift = await assertFullConsent(p, "src-x", "tok-1", { ...params, batchChars: 4000 }).catch((e: any) => e);
    expect(drift.code).toBe("bad_confirm_token");
    expect(drift.message).toContain("batchChars 30000→4000");
    await writePendingConfirm(p, "src-y", "tok-2", { chapters: 12 });
    expect((await assertFullConsent(p, "src-y", "tok-2", { batchChars: 9999 })).token).toBe("tok-2");
  });
});

const V1_CARD = {
  axis: "craft",
  body: "## 写法\n差数先落纸，再给解释。" + String.fromCharCode(10) + "动作可见，不写心理。",
  mechanisms: [{ name: "差数即钩子", failWhen: "差数只是气氛" }],
};

describe("library · 卡候选只能采纳一次", () => {
  test("同一 lcand 二次 accept 被拒，索引里仍只有一张卡", async () => {
    const out0 = await run("zhizhang_library_import", { title: "夜班账本", text: BOOK, ...wd() });
    const srcId = /sourceId=(src-[a-z0-9]+)/.exec(out0)?.[1]!;
    const staged = await run("zhizhang_library_card_stage", { title: "数字先于情绪", source: srcId, ...V1_CARD, ...wd() });
    const lcand = /lcand-[a-z0-9]+/.exec(staged)?.[0]!;
    expect(lcand).toBeTruthy();

    const first = await run("zhizhang_library_card_accept", { candidate: lcand, ...wd() });
    expect(first).toContain("cardId=card-");

    const again = await run("zhizhang_library_card_accept", { candidate: lcand, ...wd() });
    expect(again).toContain("candidate_already_accepted");

    const idx = JSON.parse(await readFile(path.join(base, "library", "index.json"), "utf8"));
    expect(idx.cards.length).toBe(1);
    const cardFiles = (await import("node:fs/promises")).readdir(path.join(base, "library", "cards"));
    expect((await cardFiles).length).toBe(1);
  });

  test("卡 / 候选 id 拼路径前先过沙箱：../ 一律 bad_id", async () => {
    let out = await run("zhizhang_library_card_get", { card: "../../index", ...wd() });
    expect(out).toContain("bad_id");
    out = await run("zhizhang_library_card_accept", { candidate: "../../index", ...wd() });
    expect(out).toContain("bad_id");
    out = await run("zhizhang_library_card_discard", { card: "../../index", confirm: true, ...wd() });
    expect(out).toContain("bad_id");
  });
});

describe("library · 计划参数兜底", () => {
  test("batch_chars 非有穷数（NaN）回退默认，不写进 NaN 分批", async () => {
    const out0 = await run("zhizhang_library_import", { title: "夜班账本", text: BOOK, ...wd() });
    const srcId = /sourceId=(src-[a-z0-9]+)/.exec(out0)?.[1]!;
    const out = await run("zhizhang_library_plan", { source: srcId, batch_chars: Number.NaN, ...wd() });
    expect(out).not.toContain("NaN");
    const plan = JSON.parse(await readFile(path.join(base, "library", "analyses", srcId, "plan.json"), "utf8"));
    expect(Number.isFinite(plan.batchChars)).toBe(true);
    expect(plan.batchChars).toBe(30000);
  });
});

describe("library · 源文本读取在库沙箱内", () => {
  test("被改坏的 meta.excerptPath 不能把读路径带出 sources/", async () => {
    const out0 = await run("zhizhang_library_import", { title: "夜班账本", text: BOOK, ...wd() });
    const srcId = /sourceId=(src-[a-z0-9]+)/.exec(out0)?.[1]!;
    // 伪造一个"库外"文本，再让 meta 指向它（../../ 从 sources/ 跳出 library/）
    await writeFile(path.join(base, "decoy.txt"), "偷来的内容不该被读到", "utf8");
    const metaPath = path.join(base, "library", "sources", `${srcId}.json`);
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    await writeFile(metaPath, JSON.stringify({ ...meta, excerptPath: "../../decoy.txt" }, null, 2) + "\n", "utf8");

    const brief = await run("zhizhang_library_dissect_brief", { source: srcId, batch: 0, ...wd() });
    expect(brief).not.toContain("偷来的内容");
    expect(brief).toContain("第1章");
  });
});
