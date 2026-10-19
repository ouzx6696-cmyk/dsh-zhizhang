import { describe, expect, test } from "bun:test";
import {
  CREATIVE_LOOP_LINE,
  ProductMap,
  QualityPolicy,
  QUALITY_AXES,
  LibraryPort,
  InspirationPort,
  Scheduler,
  SCHEDULER_BYPASSES,
} from "../../src/lib/ports/index.ts";
import { SYSTEM_BRIEF } from "../../src/tools/brief.ts";

describe("product loop holistic contract", () => {
  test("one loop line shared by Scheduler + ProductMap + SYSTEM_BRIEF", async () => {
    const pkg = await import("../../package.json");
    expect(ProductMap.version).toBe(pkg.version);
    expect(ProductMap.version).toBe("0.15.3");
    expect(Scheduler.version).toBe("0.15.3");

    const line = ProductMap.loopLine();
    expect(line).toBe(CREATIVE_LOOP_LINE);
    expect(line).toBe(Scheduler.defaultLine());
    expect(line).toContain("library_combo_suggest");
    expect(line).toContain("inspire");
    expect(line).toContain("chapter_brief");
    expect(line).toContain("candidate_accept");
    expect(line).toMatch(/可选 edit/);

    expect(SYSTEM_BRIEF).toContain("默认路径");
    expect(SYSTEM_BRIEF).toContain("library_combo_suggest");
    expect(SYSTEM_BRIEF).toContain("只吃 craft");
    expect(SYSTEM_BRIEF).toContain("旁路");
    expect(SYSTEM_BRIEF).not.toMatch(/三根独立支柱/);
    expect(SYSTEM_BRIEF).not.toMatch(/→\s*payoff_audit\s*→\s*candidate_accept/);
  });

  test("pillars are loop stages with handoff, all live", () => {
    const pillars = ProductMap.pillars();
    expect(pillars.map((p) => p.loopStage)).toEqual([1, 2, 3]);
    expect(pillars.every((p) => p.status === "live")).toBe(true);
    expect(pillars.every((p) => p.handsOffTo.length > 8)).toBe(true);
    expect(LibraryPort.summary).toMatch(/闭环第1段|第1段/);
    expect(InspirationPort.summary).toMatch(/闭环第2段|第2段/);

    const map = ProductMap.formatForAgent();
    expect(map).toContain("一条创作闭环");
    expect(map).toContain("调度");
    expect(map).toContain("旁路");
    expect(map).toContain("分喂纪律");
    expect(map).toContain(CREATIVE_LOOP_LINE);
  });

  test("quality axes use feel not voice; dual-feed narrative intact", () => {
    expect(QUALITY_AXES.map((a) => a.id)).toEqual([
      "feel",
      "book",
      "poison",
      "payoff",
      "style",
    ]);
    expect(QualityPolicy.surfaceLine()).toContain("人味");
    expect(SYSTEM_BRIEF).toMatch(/craft.*写法|写法\+状态/);
    expect(SYSTEM_BRIEF).toContain("mind");
  });
});

describe("scheduler default vs bypass", () => {
  test("default write line excludes routine audits", () => {
    const w = Scheduler.writeLine();
    expect(w).toContain("chapter_brief");
    expect(w).toContain("candidate_accept");
    expect(w).toMatch(/可选 edit/);
    expect(w).not.toMatch(/payoff_audit|human_feel_audit|novel_sense_audit/);
  });

  test("bypasses are explicit and few", () => {
    expect(SCHEDULER_BYPASSES.length).toBeGreaterThanOrEqual(5);
    expect(SCHEDULER_BYPASSES.length).toBeLessThanOrEqual(8);
    const ids = SCHEDULER_BYPASSES.map((b) => b.id);
    expect(ids).toContain("diagnose.audit");
    expect(ids).toContain("brief.full");
    expect(ids).toContain("save.direct");
    expect(ids).toContain("finalize.ship");
    expect(ids).toContain("multi.draft");
    const diagram = Scheduler.formatDiagram();
    expect(diagram).toContain("DEFAULT");
    expect(diagram).toContain("BYPASS");
  });
});
