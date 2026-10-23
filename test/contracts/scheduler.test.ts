import { describe, test } from "node:test";
import { expect } from "../_compat/expect.ts";
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

  test("panelRouteHints uses writeLine and never puts audit on default path", () => {
    const hints = Scheduler.panelRouteHints();
    expect(hints.length).toBeGreaterThanOrEqual(1);
    const joined = hints.join("\n");
    expect(joined).toContain(Scheduler.writeLine());
    expect(joined).toMatch(/可选 edit/);
    expect(joined).not.toMatch(/→\s*payoff_audit/);
    expect(joined).not.toMatch(/candidate_accept\s*→\s*payoff_audit/);
    expect(joined).toMatch(/diagnose\.audit|诊断旁路/);
  });

});
