import { describe, expect, test } from "bun:test";
import { formatToolError, ZhizhangError } from "../../src/lib/errors.ts";
import { SYSTEM_BRIEF, __testing } from "../../src/index.ts";

describe("Tool registry + SYSTEM_BRIEF hard points", () => {
  test("registry smoke: key tools present; descriptions Chinese; product_map live", async () => {
    const names = __testing.tools.map((t) => t.name);
    for (const n of [
      "zhizhang_system_brief",
      "zhizhang_product_map",
      "zhizhang_panel_snapshot",
      "zhizhang_chapter_brief",
      "zhizhang_human_feel_audit",
      "zhizhang_novel_sense_audit",
      "zhizhang_payoff_audit",
      "zhizhang_library_import",
      "zhizhang_library_combo_suggest",
      "zhizhang_inspire_start",
      "zhizhang_foundation_append_happened",
    ]) {
      expect(names).toContain(n);
    }
    expect(names.length).toBeGreaterThanOrEqual(30);
    for (const tool of __testing.tools) {
      expect(tool.description.length).toBeGreaterThan(8);
      expect(tool.parameters.additionalProperties).toBe(false);
      expect(/[\u4e00-\u9fff]/.test(tool.description)).toBe(true);
    }
    const map = __testing.tools.find((t) => t.name === "zhizhang_product_map")!;
    const out = await map.execute({}, {});
    expect(out).toContain("已上线");
    expect(out).toContain("一条创作闭环");
    expect(__testing.ports.ProductMap.version).toBe(
      (await import("../../package.json")).version,
    );
  });

  test("SYSTEM_BRIEF pins creative path hard rules (not line-by-line copy)", () => {
    expect(SYSTEM_BRIEF).toContain("zhizhang_candidate_stage");
    expect(SYSTEM_BRIEF).toContain("zhizhang_candidate_accept");
    expect(SYSTEM_BRIEF).toContain("zhizhang_style_lint");
    expect(SYSTEM_BRIEF).toContain("lintPassToken");
    expect(SYSTEM_BRIEF).toMatch(/chapter_brief|brief/);
    expect(SYSTEM_BRIEF).toContain("library_");
    expect(SYSTEM_BRIEF).toContain("inspire_");
    expect(SYSTEM_BRIEF).not.toMatch(/预留/);
  });

  test("errors never leak stacks", async () => {
    const msg = formatToolError(new Error("boom\n    at Object.<anonymous> (/tmp/x.js:1:1)"));
    expect(msg).toContain("错误：boom");
    expect(msg).not.toContain("at Object");
    expect(formatToolError(new ZhizhangError("refuse_overwrite_final", "已定稿"))).toContain(
      "refuse_overwrite_final",
    );
    const accept = __testing.tools.find((t) => t.name === "zhizhang_candidate_accept")!;
    const out = await accept.execute({ candidate: "cand-missing" }, {});
    expect(out.startsWith("错误")).toBe(true);
    expect(out).not.toContain("    at ");
  });
});
