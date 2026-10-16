import { describe, expect, test } from "bun:test";
import { MethodRegistry } from "../../src/lib/ports/index.ts";
import { formatReaderContract } from "../../src/lib/method-assets.ts";

describe("MethodRegistry contract", () => {
  test("lean brief defaults; full pack still available", () => {
    expect([...MethodRegistry.briefDefaultIds]).toEqual(["style_contract"]);
    expect(MethodRegistry.briefFullIds).toContain("novel_sense");
    expect(MethodRegistry.briefFullIds).toContain("tomato_four_q");
    const lean = MethodRegistry.resolveBriefAssets([]);
    expect(lean.found.map((a) => a.id)).toEqual(["style_contract"]);
    const full = MethodRegistry.resolveBriefAssets([], "full");
    expect(full.found.map((a) => a.id)).toEqual(
      expect.arrayContaining(["novel_sense", "style_contract", "draft", "tomato_four_q"]),
    );
    const ids = MethodRegistry.list().map((a) => a.id);
    expect(ids).toContain("novel_sense");
    expect(ids).toContain("draft");
    const ns = MethodRegistry.get("novel_sense");
    expect(ns?.body.length).toBeGreaterThan(40);
  });

  test("reader contract shape + poison hint + previous block", () => {
    const text = formatReaderContract({
      premise: "夜班冷柜",
      planned: "01发现 02查账",
      threads: "条子未结",
      happened: "",
      chapterEnding: "钥匙在掌心",
      continuation: true,
      previous: {
        id: "c001",
        title: "第一瓶",
        ending: "条子压在账本下",
        summary: "对轨后差额",
        bodyTail: "她没再关门。",
      },
    });
    expect(text).toContain("本书读者合同");
    expect(text).toMatch(/写法提醒|质量写法/);
    expect(text).toContain("质量面");
    expect(text).toContain("前章正文");
    expect(text).toContain("条子压在账本下");
  });
});
