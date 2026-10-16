import { describe, expect, test } from "bun:test";
import {
  formatReaderContract,
  PREV_CHAPTER_BODY_SOFT_MAX,
  resolvePreviousBody,
} from "../../src/lib/method-assets.ts";
import { ProductMap, Scheduler } from "../../src/lib/ports/index.ts";
import { SYSTEM_BRIEF } from "../../src/tools/brief.ts";

describe("prev chapter body 0.10.x", () => {
  test("versions + SYSTEM_BRIEF say full prev body", () => {
    expect(ProductMap.version).toBe("0.10.3");
    expect(Scheduler.version).toBe("0.10.3");
    expect(SYSTEM_BRIEF).toMatch(/前章.*正文全文|正文全文/);
    expect(SYSTEM_BRIEF).not.toContain("短文末");
  });

  test("resolvePreviousBody prefers body over bodyTail; soft-caps extreme length", () => {
    const both = resolvePreviousBody({
      id: "c001",
      title: "一",
      ending: "e",
      body: "正文开篇。" + "中".repeat(50) + "正文收束。",
      bodyTail: "只有尾巴",
    });
    expect(both.source).toBe("body");
    expect(both.text).toContain("正文开篇");
    expect(both.text).toContain("正文收束");
    expect(both.text).not.toContain("只有尾巴");
    expect(both.clipped).toBe(false);

    const legacy = resolvePreviousBody({
      id: "c001",
      title: "一",
      ending: "e",
      bodyTail: "旧尾巴也能注",
    });
    expect(legacy.source).toBe("bodyTail");
    expect(legacy.text).toContain("旧尾巴也能注");

    const huge = "头" + "字".repeat(PREV_CHAPTER_BODY_SOFT_MAX + 100) + "尾";
    const clipped = resolvePreviousBody({
      id: "c001",
      title: "一",
      ending: "e",
      body: huge,
    });
    expect(clipped.clipped).toBe(true);
    expect(clipped.text.length).toBeLessThanOrEqual(PREV_CHAPTER_BODY_SOFT_MAX + 2);
    expect(clipped.text.endsWith("…")).toBe(true);
  });

  test("lean contract renders full previous body as primary section", () => {
    const body =
      "第一句在桥上。" +
      "中间很长一段对质与值班册。" +
      "最后一句鞋里全是水。";
    const text = formatReaderContract({
      premise: "桥",
      planned: "续",
      threads: "表",
      happened: "[c001] 鞋里全是水",
      lean: true,
      continuation: true,
      previous: {
        id: "c001",
        title: "桥上",
        ending: "只说手套",
        body,
      },
    });
    expect(text).toContain("前章正文（续写必读 · 以正文为准）");
    expect(text).toContain("前章索引");
    expect(text).toContain("第一句在桥上");
    expect(text).toContain("最后一句鞋里全是水");
    expect(text).toContain("状态·已发生");
    expect(text).not.toContain("前章文末摘录");
    expect(text).not.toContain("短文末");
  });
});
