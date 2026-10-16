import { describe, expect, test } from "bun:test";
import {
  Scheduler,
  SCHEDULER_BYPASSES,
  ProductMap,
} from "../../src/lib/ports/index.ts";
import { __testing } from "../../src/index.ts";

describe("Scheduler port", () => {
  test("ProductMap embeds scheduler diagram", () => {
    const map = ProductMap.formatForAgent();
    expect(map).toContain("默认 DEFAULT");
    expect(map).toContain("旁路 BYPASS");
    expect(map).toContain("diagnose.audit");
  });

  test("nextHint covers key handoffs", () => {
    expect(Scheduler.nextHint("library_combo")).toMatch(/inspire_start|chapter_brief/);
    expect(Scheduler.nextHint("chapter_brief")).toMatch(/candidate_stage/);
    expect(Scheduler.nextHint("project_create")).not.toMatch(/payoff_audit\s*→/);
  });

  test("audit tools are labeled bypass; style_lint is default-chain gate", () => {
    const byName = Object.fromEntries(__testing.tools.map((t) => [t.name, t.description]));
    expect(byName["zhizhang_payoff_audit"]).toMatch(/旁路/);
    expect(byName["zhizhang_human_feel_audit"]).toMatch(/旁路/);
    expect(byName["zhizhang_novel_sense_audit"]).toMatch(/旁路/);
    expect(byName["zhizhang_style_lint"]).toMatch(/默认链|工程闸/);
    expect(byName["zhizhang_product_map"]).toMatch(/调度/);
  });

  test("project_create receipt does not prescribe routine audit chain", async () => {
    // unit: nextHint only (create needs fs); assert scheduler source
    const hint = Scheduler.nextHint("project_create");
    expect(hint).not.toMatch(/payoff_audit/);
    expect(hint).not.toMatch(/review_ledger/);
    expect(SCHEDULER_BYPASSES.some((b) => b.id === "diagnose.audit")).toBe(true);
  });
});
