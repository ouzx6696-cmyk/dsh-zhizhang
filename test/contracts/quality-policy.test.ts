import { describe, expect, test } from "bun:test";
import {
  QualityPolicy,
  QUALITY_AXES,
  QUALITY_BOOK_DEBT_CUE_RE,
  QUALITY_POISON_HINT,
  QUALITY_POISON_POLICY,
  ProductMap,
  MethodRegistry,
  auditNovelSense,
} from "../../src/lib/ports/index.ts";
import { formatReaderContract } from "../../src/lib/method-assets.ts";
import { SYSTEM_BRIEF } from "../../src/tools/brief.ts";
import { padBody } from "../helpers.ts";

describe("QualityPolicy surface contract", () => {
  test("single poison source + axes + version surface", () => {
    expect(QualityPolicy.id).toBe("port.quality");
    expect(QUALITY_AXES.map((a) => a.id)).toEqual([
      "feel",
      "book",
      "poison",
      "payoff",
      "style",
    ]);
    expect(QualityPolicy.poisonPolicyLine()).toBe(QUALITY_POISON_POLICY);
    expect(QualityPolicy.poisonHintLine()).toBe(QUALITY_POISON_HINT);
    expect(QUALITY_POISON_POLICY).toContain("嵌进动作与当场压力");
    expect(QUALITY_POISON_POLICY).toContain("顿号");
    expect(QUALITY_POISON_POLICY).toContain("账与数字");
    expect(QUALITY_POISON_POLICY).not.toMatch(/勿点名交差|不要|禁止/);
    expect(QUALITY_POISON_POLICY).not.toMatch(/获得物\/代价\/账/);

    const contract = formatReaderContract({
      premise: "p",
      planned: "pl",
      threads: "t",
    });
    expect(contract).toContain(QUALITY_POISON_HINT);
    expect(contract).toContain("质量面");

    const ns = MethodRegistry.get("novel_sense");
    expect(ns?.body).toMatch(/写法提醒|质量写法|嵌进动作/);

    const draft = MethodRegistry.get("draft");
    expect(draft?.body).toContain("style_contract");
    // brief co-loads style_contract — draft must not re-embed full Contract block
    expect(draft?.body).not.toContain("禁辩证套话");

    // Quality surface lives on ProductMap / QualityPolicy; SYSTEM_BRIEF stays lean (scheduler)
    expect(SYSTEM_BRIEF).toMatch(/默认路径|旁路/);
    expect(SYSTEM_BRIEF).not.toMatch(/0\.3\.7/);
    expect(ProductMap.formatForAgent()).toContain("质量面");
    expect(QualityPolicy.surfaceLine()).toContain("质量面");

    expect(ProductMap.version).toBe("0.15.3");
  });

  test("book-debt cues exclude ledger inventory; ledger-flat ending → no_book_debt", () => {
    // Assert via .test (regex.source may unicode-escape CJK in bun)
    expect(QUALITY_BOOK_DEBT_CUE_RE.test("她攥着钥匙")).toBe(true);
    expect(QUALITY_BOOK_DEBT_CUE_RE.test("不知道怎么办")).toBe(true);
    expect(QUALITY_BOOK_DEBT_CUE_RE.test("账本摊开对账单差额入账")).toBe(false);
    expect(QUALITY_BOOK_DEBT_CUE_RE.test("她把账页合上放进抽屉")).toBe(false);

    const ledgerFlat = padBody(`
店里灯亮着。她把账本摊在柜台上，对账单写满差额与结余，账页翻到最后一行入账数字。
收据与发票叠好。一切核对完毕，金额对齐，她关上账本。
店里恢复了往常的冷气声。
`, 2);
    expect(
      auditNovelSense(ledgerFlat).hits.some((h) => h.code === "no_book_debt"),
    ).toBe(true);

    const openStake = padBody(`
她把钥匙攥在掌心，门外风还在。条子压在抽屉夹层，监控红点闪着。
明天他若来调监控，她不知道怎么办。先这样站着，等风过去再说。
`, 3);
    expect(auditNovelSense(openStake).hitCount).toBe(0);
  });
});
