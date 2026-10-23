import { describe, test } from "node:test";
import { expect } from "../_compat/expect.ts";
import { Scheduler, MethodRegistry, HumanFeelAuditorPort } from "../../src/lib/ports/index.ts";
import { buildPanelSnapshot } from "../../src/lib/store.ts";
import { withTempWork, padBody } from "../helpers.ts";

describe("panel nextHints · Scheduler single source", () => {
  test("buildPanelSnapshot nextHints exclude payoff_audit from default route", async () => {
    const { dir, cleanup } = await withTempWork("面板调度验");
    try {
      const snap = await buildPanelSnapshot(dir);
      const joined = snap.nextHints.join("\n");
      expect(joined).toContain(Scheduler.writeLine());
      expect(joined).not.toMatch(/→\s*payoff_audit/);
      expect(joined).not.toMatch(/candidate_accept\s*→\s*payoff_audit/);
      expect(joined).toMatch(/可选 edit/);
    } finally {
      await cleanup();
    }
  });
});

describe("draft method copy · optional edit", () => {
  test("draft whenToUse and body mention optional edit", () => {
    const draft = MethodRegistry.get("draft");
    expect(draft).toBeTruthy();
    expect(draft!.whenToUse).toMatch(/可选 edit/);
    expect(draft!.body).toMatch(/可选 edit/);
  });
});

describe("HumanFeelAuditorPort craftCue parity", () => {
  test("auditor port forwards craftCue for stiffness_tidy", () => {
    const body = padBody(
      `
主角走进房间。他看见桌上的刀。他数了数刀痕。他明白了对方的计划。众人震惊地看着他。
他心中一清，一切都清楚了。这说明规则已经生效。由此可见对方在骗他。总而言之他赢了。
店里灯还亮着，他准备交班离开这里继续下一场。
`,
      2,
    );
    const plain = HumanFeelAuditorPort.audit(body);
    expect(plain.hits.some((h) => h.code === "stiffness_tidy")).toBe(false);
    const withCue = HumanFeelAuditorPort.audit(body, {
      craftCue: "本场应落纸：信息侧漏；打断后留半截；别收成合格聪明主角",
    });
    expect(withCue.hits.some((h) => h.code === "stiffness_tidy")).toBe(true);
  });
});
