/**
 * Domain layer — pure functions, no disk. Ending-consistency verdict matrix,
 * soft radars, card schema, chapter headings, coverage math.
 */
import { describe, test } from "node:test";
import { expect } from "./_compat/expect.ts";
import { scoreEnding, toCnNumber, clockAliases, endingBodyOverlap } from "../src/lib/domain/ending-consistency.ts";
import { auditPayoff } from "../src/lib/payoff-audit.ts";
import { formatReaderContract } from "../src/lib/method-assets.ts";
import { EMPTY_OUTLINE } from "../src/lib/types.ts";
import { lintStyle } from "../src/lib/style-linter.ts";
import { HumanFeelGate } from "../src/lib/ports/human-feel-gate.ts";
import { NovelSenseGate } from "../src/lib/ports/novel-sense-gate.ts";
import { toCardView } from "../src/lib/domain/card-schema.ts";
import { parseChapterHeading, cnNumber } from "../src/lib/domain/chapter-heading.ts";
import { computeCoverage, AUTO_CONFIDENCE_CAP } from "../src/lib/domain/coverage.ts";
import { padBody } from "./helpers.ts";

const outlineWith = (ending: string) => ({ ...EMPTY_OUTLINE(), ending });
/** payoff 的 ending 类 finding code。 */
const endingCodes = (outline: any, body: string) => auditPayoff(outline, body).findings
  .filter((f: any) => f.code.startsWith("ending_"))
  .map((f: any) => f.code);
/** 读者合同是否给出「纲末与正文可能不一致」警告（与 payoff 必须同向）。 */
const readerWarns = (ending: string, body: string) =>
  formatReaderContract({
    premise: "p",
    planned: "pl",
    threads: "t",
    lean: true,
    continuation: true,
    previous: { id: "c001", title: "一", ending, body },
  }).includes("前章纲末与正文可能不一致");

describe("domain · ending 一致性矩阵", () => {
  test("中文数字与时钟别名（00:40 ↔ 零点四十）", () => {
    expect(toCnNumber(0)).toBe("零");
    expect(toCnNumber(40)).toBe("四十");
    expect(toCnNumber(99)).toBe("九十九");
    expect(clockAliases("00:40")).toContain("零点四十");
    const sc = scoreEnding("他 00:40 刷卡进楼。", "他零点四十刷卡进楼，没回头。");
    expect(sc.strongHits).toBeGreaterThan(0);
    expect(sc.score as number).toBeGreaterThanOrEqual(0.5);
  });

  test("矛盾矩阵：payoff 与读者合同同向（改写两静 / 强缺失双报 / 对齐通过）", () => {
    const rainEnding = "侧窗在回放里出现，而店内此刻没有那扇窗——章末停在屏幕上那扇窗的雨声与真实墙面之间的反差上。";
    const rainBody = "二十三点四十七。画面东墙多出一扇侧窗，窗框外是雨。回到屏幕，回放里的侧窗仍在，雨正打上去。";
    expect(endingCodes(outlineWith(rainEnding), rainBody).filter((c) => c !== "ending_ok")).toEqual([]);
    expect(readerWarns(rainEnding, rainBody)).toBe(false);

    const missEnding = "他把侧窗的窗框钉死，回放里再也没有那扇窗。";
    const missBody = "她把账本合上，没再说话。灯灭之后雨停了半拍。";
    expect(endingCodes(outlineWith(missEnding), missBody)).toContain("ending_missing");
    expect(readerWarns(missEnding, missBody)).toBe(true);

    const okEnding = "雨还在下，他把钥匙插回侧窗的锁孔。";
    const okBody = "雨还在下。他把钥匙插回侧窗的锁孔，转了两圈。";
    expect(endingCodes(outlineWith(okEnding), okBody)).toContain("ending_ok");
    expect(readerWarns(okEnding, okBody)).toBe(false);
  });

  test("空审计不再静默 ok：ending_unchecked", () => {
    const r = auditPayoff(outlineWith("好。"), "他把门带上。");
    expect(r.findings.map((f: any) => f.code)).toContain("ending_unchecked");
    expect(r.ok).toBe(false);
  });

  test("per-work lexicon 注入解锁严格审计", () => {
    const ending = "他把令牌交还给守塔人。";
    const body = "令牌离手，守塔人收进抽屉。";
    expect(auditPayoff(outlineWith(ending), body).findings
      .filter((f: any) => f.severity === "warning" && f.code.startsWith("ending_"))).toEqual([]);
    expect(auditPayoff(outlineWith(ending), body, { lexicon: ["令牌", "守塔人"] }).findings
      .map((f: any) => f.code)).toContain("ending_ok");
    expect(auditPayoff(outlineWith(ending), "他绕开塔门走了。", { lexicon: ["令牌", "守塔人"] }).findings
      .map((f: any) => f.code)).toContain("ending_missing");
  });

  test("foundation 侧保持宽松选择口径（0.35 大网，选择非裁决）", () => {
    const overlap = endingBodyOverlap("他把值班本合上，灯灭了。", "值班本合上以后，灯才灭。他又检查了一遍门锁。");
    expect(overlap).toBeGreaterThan(0);
    expect(overlap).toBeLessThan(1);
  });
});

describe("domain · 软雷达", () => {
  test("lintStyle 拦 AI 腔，放过干净段落", () => {
    expect(lintStyle("他心中涌起一股难以言喻的感动，不禁叹了口气。").length).toBeGreaterThan(0);
    expect(lintStyle("他把伞收进桶里，没说话。").length).toBe(0);
  });

  test("HumanFeel / NovelSense 是软传感（warn 不 deny）", () => {
    expect(HumanFeelGate.evaluateAccept({ body: padBody("他觉得很难过，心中一沉。") }).ok).toBe(true);
    expect(NovelSenseGate.evaluateAccept({ body: padBody("这一夜就这样过去了。") }).ok).toBe(true);
  });

  test("尾钩检测：强钩 1 个即中", () => {
    const r = NovelSenseGate.evaluateAccept({ body: padBody("门外传来了钥匙转动的声音。") });
    expect(r.messages.some((m: any) => m.code === "no_book_debt" && m.level === "warn")).toBe(false);
  });
});

describe("domain · 卡 schema / 章号 / 覆盖率", () => {
  test("v1 卡读入补齐并标 legacy；v2 不标", () => {
    expect(toCardView({ id: "c1", title: "旧卡", body: "## 写法\n动作。", status: "accepted" }).legacy).toBe(true);
    expect(toCardView({
      id: "c2",
      title: "新卡",
      body: "x",
      status: "accepted",
      mechanisms: [{ name: "m", failWhen: "f" }],
      layer: "scene",
      dimension: "hook",
    }).legacy).toBe(false);
  });

  test("中文章号识别", () => {
    expect(parseChapterHeading("第一章 开端")?.n).toBe(1);
    expect(parseChapterHeading("第12章 对峙")?.n).toBe(12);
    expect(parseChapterHeading("序章 黑夜")?.kind).toBeTruthy();
    expect(parseChapterHeading("没有标题")).toBeNull();
    expect(cnNumber("四十")).toBe(40);
  });

  test("覆盖率权重与 Auto 封顶", () => {
    const cov = computeCoverage(
      { scope: { chapters: 4, mode: "full" } },
      [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }],
      [{ dimension: "hook" }, { dimension: "rhythm" }],
      { total: 2, ok: 2 },
      { survey: true, plots: [{}], rhythms: [{}], characters: [{}], autoCap: true },
    );
    expect(cov.capped).toBe(true);
    expect(cov.confidence).toBeLessThanOrEqual(AUTO_CONFIDENCE_CAP);
  });
});
