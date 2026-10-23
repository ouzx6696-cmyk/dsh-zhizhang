import { describe, test } from "node:test";
import { expect } from "../_compat/expect.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { auditPayoff } from "../../src/lib/payoff-audit.ts";
import { EMPTY_OUTLINE } from "../../src/lib/types.ts";
import { FIXTURES, withTempWork } from "../helpers.ts";
import {
  markCandidateLinted,
  recordBriefBreadcrumb,
  saveChapter,
  setOutline,
  stageCandidate,
  buildPanelSnapshot,
} from "../../src/lib/store.ts";
import { __testing } from "../../src/index.ts";

function yebanOutline() {
  return {
    ...EMPTY_OUTLINE(),
    ending:
      "章末落在那条音频文件的属性面板上：创建时间 01:07，而林砚 00:40 才刷卡进楼。他把鼠标停在文件名上，没点开。",
    beats:
      "1. 空棚夜班日常；2. 监听里冒出一句不属于工程的话；3. 回放确认+推子/底噪排查；4. 老周假安全；5. 时间戳对不上；6. 收在具体物件上。",
    livedScene: "亲历重心：第一次听到不该出现的话并回放；推子与底噪；文件属性时间戳。",
    situationLens: "夜班录音师对不对劲的声音过敏。",
    stateLens: "克制短句。",
  };
}

function rainOutline() {
  return {
    ...EMPTY_OUTLINE(),
    ending:
      "侧窗在回放里出现，而店内此刻没有那扇窗——章末停在屏幕上那扇窗的雨声与真实墙面之间的反差上。",
    beats:
      "1. 核对货架；2. 打开监控回放；3. 23:47 段东墙多出侧窗；4. 倒回放大；5. 手掌贴墙无窗；6. 回到屏幕侧窗仍在。",
    livedScene: "亲历重心：拖拽回放进度条；手掌贴东墙；回放里的侧窗与雨。",
    situationLens: "便利店夜班核对。",
    stateLens: "克制。",
  };
}

describe("payoff-audit sensor", () => {
  test("fixture drift / rain / fixed", async () => {
    const drift = await readFile(path.join(FIXTURES, "body-yeban-drift.txt"), "utf8");
    const rain = await readFile(path.join(FIXTURES, "body-rain-payoff.txt"), "utf8");
    const fixed = await readFile(path.join(FIXTURES, "body-yeban-fixed.txt"), "utf8");

    const bad = auditPayoff(yebanOutline(), drift);
    expect(bad.ok).toBe(false);
    expect(bad.findings.map((f) => f.code)).toEqual(
      expect.arrayContaining(["speech_breath_drift", "domain_unit_reverb_mm"]),
    );

    const goodRain = auditPayoff(rainOutline(), rain);
    expect(goodRain.ok).toBe(true);
    expect(goodRain.warningCount).toBe(0);

    const codes = auditPayoff(yebanOutline(), fixed)
      .findings.filter((f) => f.severity !== "info")
      .map((f) => f.code);
    expect(codes).not.toContain("speech_breath_drift");
  });

  test("tool persists lastPayoff; accept brief_required without breadcrumb", async () => {
    const { base, meta, dir, cleanup } = await withTempWork("兑付测");
    try {
      await setOutline(dir, "c001", yebanOutline());
      const body = await readFile(path.join(FIXTURES, "body-yeban-drift.txt"), "utf8");
      await saveChapter(dir, { id: "c001", title: "一", body, status: "drafted" });
      const tool = __testing.tools.find((t) => t.name === "zhizhang_payoff_audit")!;
      const out = await tool.execute({ work: meta.key, working_dir: base, chapter: "c001" }, {});
      expect(out).toContain("speech_breath_drift");
      const snap = await buildPanelSnapshot(dir);
      expect(snap.lastPayoffByChapter["c001"]!.ok).toBe(false);

      const cand = await stageCandidate(dir, { chapterId: "c001", body: body.slice(0, 200) });
      await markCandidateLinted(dir, cand.id, 0);
      const accept = __testing.tools.find((t) => t.name === "zhizhang_candidate_accept")!;
      const denied = await accept.execute(
        { candidate: cand.id, work: meta.key, working_dir: base },
        {},
      );
      expect(denied).toContain("brief_required");
      await recordBriefBreadcrumb(dir, { chapterId: "c001", assetIds: ["draft"] });
    } finally {
      await cleanup();
    }
  });
});
