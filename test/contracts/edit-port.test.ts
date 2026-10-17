import { describe, expect, test } from "bun:test";
import {
  AcceptPolicy,
  EditPort,
  Scheduler,
  ProductMap,
} from "../../src/lib/ports/index.ts";
import type { CandidateFile } from "../../src/lib/types.ts";
import { __testing } from "../../src/index.ts";
import { markCandidateLinted } from "../../src/lib/store.ts";
import { withTempWork } from "../helpers.ts";
import { SYSTEM_BRIEF } from "../../src/tools/brief.ts";

describe("EditPort + A/B/C accept contract", () => {
  test("default mode and brief are positive; modes include polish-depolish", () => {
    expect(EditPort.defaultMode).toBe("polish-depolish");
    expect(EditPort.normalizeMode("")).toBe("polish-depolish");
    expect(EditPort.normalizeMode("polish-rhythm")).toBe("polish-rhythm");
    const brief = EditPort.formatEditBrief({ mode: "polish-depolish" });
    expect(brief).toContain("要写成什么样");
    expect(brief).toMatch(/选 A|A 编辑/);
    expect(brief).toContain("卖点节拍");
    expect(brief).not.toMatch(/脏话配额/);
    // 0.11.1：保留毛边 / 反齐刷；去AI味≠范文齐句
    expect(brief).toMatch(/毛边|半截念头/);
    expect(brief).toMatch(/去AI味[^\n]*≠|≠ 磨成范文齐句|范文齐句/);
    expect(brief).toMatch(/齐刷短句|熨平|主语砍光|匀速吐字/);
    expect(brief).toMatch(/退回写手|polish-rhythm/);
    expect(EditPort.modeInfo("polish-depolish").focus).toMatch(/毛边|禁止.*熨平|主语砍光/);
    expect(EditPort.version).toBe("0.11.1");
  });

  test("edit soft hints surface uniform_short_run without blocking A/B/C", () => {
    const hints = EditPort.softHintLines([
      {
        code: "uniform_short_run",
        text: "过齐：连续短句长度接近",
      },
    ]);
    expect(hints.some((l) => l.includes("编辑软提示"))).toBe(true);
    expect(hints.some((l) => l.includes("uniform_short_run"))).toBe(true);
    expect(hints.some((l) => /退回写手|polish-rhythm/.test(l))).toBe(true);
    const receipt = EditPort.afterStageLines({
      editCandId: "cand-e",
      parentCandId: "cand-w",
      mode: "polish-depolish",
      chapterId: "c001",
      softHits: [{ code: "uniform_short_run", text: "过齐" }],
    });
    expect(receipt.join("\n")).toMatch(/uniform_short_run/);
    expect(receipt.join("\n")).toMatch(/选：A|请用户选/);
  });

  test("resolveChoice and unset→B safety messaging", () => {
    expect(EditPort.resolveChoice("A")).toBe("A");
    expect(EditPort.resolveChoice("编辑后直接验收")).toBe("A");
    expect(EditPort.resolveChoice("B")).toBe("B");
    expect(EditPort.resolveChoice("C")).toBe("C");
    expect(EditPort.resolveChoice(null)).toBe(null);
    expect(EditPort.choiceMenuLine()).toMatch(/未表态按 B/);
  });

  test("AcceptPolicy path A: confirm required; not-an-edit denied; normal accept ok", () => {
    const writer = { lintHitCount: 0, body: "短。", editOf: undefined } as CandidateFile;
    const edited = {
      lintHitCount: 0,
      body: "编辑后短。",
      editOf: "cand-parent",
    } as CandidateFile;

    const silent = AcceptPolicy.evaluate({
      candidate: edited,
      brief: null,
      payoff: null,
      skipBrief: true,
      acceptAfterEdit: true,
      confirmAcceptAfterEdit: false,
    });
    expect(silent.ok).toBe(false);
    expect(silent.messages.some((m) => m.code === "edit_accept_confirm_required")).toBe(
      true,
    );

    const notEdit = AcceptPolicy.evaluate({
      candidate: writer,
      brief: null,
      payoff: null,
      skipBrief: true,
      acceptAfterEdit: true,
      confirmAcceptAfterEdit: true,
    });
    expect(notEdit.ok).toBe(false);
    expect(notEdit.messages.some((m) => m.code === "edit_accept_not_an_edit")).toBe(true);

    const okA = AcceptPolicy.evaluate({
      candidate: edited,
      brief: null,
      payoff: null,
      skipBrief: true,
      acceptAfterEdit: true,
      confirmAcceptAfterEdit: true,
    });
    expect(okA.ok).toBe(true);
    expect(okA.receiptLines.some((l) => l.includes("已应用编辑"))).toBe(true);
    expect(okA.receiptLines.some((l) => l.includes("已验收"))).toBe(true);

    const normal = AcceptPolicy.evaluate({
      candidate: writer,
      brief: null,
      payoff: null,
      skipBrief: true,
    });
    expect(normal.ok).toBe(true);
    expect(normal.receiptLines.some((l) => l.includes("已应用编辑"))).toBe(false);
  });

  test("scheduler / product / SYSTEM_BRIEF mention optional edit", () => {
    expect(Scheduler.writeLine()).toMatch(/可选 edit/);
    expect(Scheduler.defaultLine()).toMatch(/可选 edit/);
    expect(Scheduler.nextHint("style_lint")).toMatch(/edit|A\/B\/C/);
    // 编辑非必经：lint 后可直接 accept
    expect(Scheduler.nextHint("style_lint")).toMatch(/直接 candidate_accept|或直接/);
    expect(ProductMap.formatForAgent()).toMatch(/可选 edit|A\/B\/C|编辑/);
    expect(SYSTEM_BRIEF).toMatch(/可选 edit/);
    expect(SYSTEM_BRIEF).toMatch(/confirm|A\/B\/C|禁止静默/);
    expect(SYSTEM_BRIEF).not.toMatch(/必须.*edit_brief|每章.*edit/);
  });

  test("tools registered: edit_brief / edit_stage / edit_decide", () => {
    const names = __testing.tools.map((t) => t.name);
    expect(names).toContain("zhizhang_candidate_edit_brief");
    expect(names).toContain("zhizhang_candidate_edit_stage");
    expect(names).toContain("zhizhang_candidate_edit_decide");
    const decide = __testing.tools.find((t) => t.name === "zhizhang_candidate_edit_decide")!;
    expect(decide.description).toMatch(/禁止静默|confirm_accept_after_edit/);
  });

  test("live tool path: stage edit → B leaves chapter; A without confirm fails; A+confirm accepts", async () => {
    const { base, dir, meta, cleanup } = await withTempWork("编辑环");
    try {
      const stage = __testing.tools.find((t) => t.name === "zhizhang_candidate_stage")!;
      const editStage = __testing.tools.find(
        (t) => t.name === "zhizhang_candidate_edit_stage",
      )!;
      const decide = __testing.tools.find(
        (t) => t.name === "zhizhang_candidate_edit_decide",
      )!;
    
      const staged = await stage.execute(
        {
          chapter: "c001",
          content: "写手稿：她把条子压进账本，没再关门。雨还在下。",
          work: meta.key,
          working_dir: base,
        },
        {},
      );
      const parentId = staged.match(/候选已暂存：(cand-\w+)/)?.[1];
      expect(parentId).toBeTruthy();

      const edited = await editStage.execute(
        {
          parent: parentId,
          content: '账本在桌上。条子压着。她没说话。风还在响。灯还亮着。门没关严。雨声很轻。脚步很慢。账本在桌上。条子压着。她没说话。风还在响。灯还亮着。门没关严。雨声很轻。脚步很慢。账本在桌上。条子压着。她没说话。风还在响。灯还亮着。门没关严。雨声很轻。脚步很慢。',
          mode: "polish-depolish",
          work: meta.key,
          working_dir: base,
        },
        {},
      );
      const editId = edited.match(/编辑候选已暂存：(cand-\w+)/)?.[1];
      expect(editId).toBeTruthy();
      expect(edited).toMatch(/选：A|请用户选/);
      // soft tip when body is齐刷短句（不阻断）
      expect(edited).toMatch(/uniform_short_run|编辑软提示/);

      const bOut = await decide.execute(
        { candidate: editId, choice: "B", work: meta.key, working_dir: base },
        {},
      );
      expect(bOut).toMatch(/路径 B|仅作候选/);
      expect(bOut).not.toMatch(/已验收（编辑后/);

      // A without confirm
      const aFail = await decide.execute(
        {
          candidate: editId,
          choice: "A",
          work: meta.key,
          working_dir: base,
        },
        {},
      );
      expect(aFail).toMatch(/edit_accept_confirm_required|须一次显式确认|confirm_accept_after_edit/);

      await markCandidateLinted(dir, editId!, 0);
      // need brief skip for accept
      const aOk = await decide.execute(
        {
          candidate: editId,
          choice: "A",
          confirm_accept_after_edit: true,
          skip_brief: true,
          work: meta.key,
          working_dir: base,
        },
        {},
      );
      expect(aOk).toMatch(/已采纳/);
      expect(aOk).toMatch(/已应用编辑/);
      expect(aOk).toMatch(/已验收/);
    } finally {
      await cleanup();
    }
  });
});
