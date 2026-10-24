/**
 * Accept gates — Lint/Brief/Payoff/SaveBypass primitives, AcceptPolicy
 * composition (tri-state strict flags, short-circuit, edit path A/B/C),
 * and the double-accept race the candidate lock closes.
 */
import { describe, test } from "node:test";
import { expect } from "./_compat/expect.ts";
import { AcceptPolicy, BriefGate, LintGate, PayoffGate, SaveBypassGate, EditPort, resetPortConfig, setPortConfig } from "../src/lib/ports/index.ts";
import type { CandidateFile } from "../src/lib/types.ts";
import { __testing } from "../src/index.ts";
import { markCandidateLinted, saveChapter, setOutline, stageCandidate } from "../src/lib/store.ts";
import { withWork } from "./helpers.ts";

describe("gates · 四个原语闸", () => {
  test("LintGate：软警告 lint_hits_present；strict 硬拒 lint_hits_strict", () => {
    const soft = LintGate.evaluateAccept({ hitCount: 2, strictLint: false });
    expect(soft.ok).toBe(true);
    expect(soft.messages.some((m) => m.code === "lint_hits_present")).toBe(true);
    const hard = LintGate.evaluateAccept({ hitCount: 2, strictLint: true });
    expect(hard.ok).toBe(false);
    expect(hard.messages[0]?.code).toBe("lint_hits_strict");
  });

  test("BriefGate：缺 brief 硬拒；skip_brief 放行留痕", () => {
    expect(BriefGate.evaluateAccept({ brief: null, skipBrief: false }).messages[0]?.code).toBe("brief_required");
    expect(BriefGate.evaluateAccept({ brief: null, skipBrief: true }).ok).toBe(true);
  });

  test("PayoffGate：软提示 payoff_missing；require_payoff 硬拒", () => {
    const soft = PayoffGate.evaluateAccept({ payoff: null, requirePayoff: false });
    expect(soft.ok).toBe(true);
    expect(soft.messages[0]?.code).toBe("payoff_missing");
    expect(PayoffGate.evaluateAccept({ payoff: null, requirePayoff: true }).ok).toBe(false);
  });

  test("SaveBypassGate：大正文须 confirm_bypass", () => {
    const deny = SaveBypassGate.evaluate({ contentProvided: true, wordCount: 500, confirmBypass: false });
    expect(deny.ok).toBe(false);
    expect(deny.messages[0]?.code).toBe("bypass_confirm_required");
    expect(SaveBypassGate.evaluate({ contentProvided: true, wordCount: 500, confirmBypass: true }).ok).toBe(true);
  });
});

describe("gates · AcceptPolicy 组合", () => {
  const cand = { lintHitCount: 1, body: "短。" } as CandidateFile;

  test("brief_required 硬拒；skipBrief 放行并回软回声", () => {
    const denied = AcceptPolicy.evaluate({ candidate: cand, brief: null, payoff: null, skipBrief: false });
    expect(denied.ok).toBe(false);
    expect(denied.messages.some((m) => m.code === "brief_required")).toBe(true);
    const skipped = AcceptPolicy.evaluate({ candidate: cand, brief: null, payoff: null, skipBrief: true });
    expect(skipped.ok).toBe(true);
  });

  test("strict 三态：未传回落 PortConfig（默认严格真正生效）", () => {
    const brief = { chapterId: "c001", at: new Date().toISOString(), assetIds: ["draft"] };
    try {
      setPortConfig({ defaultRequirePayoff: true });
      const denied = AcceptPolicy.evaluate({ candidate: cand, brief, payoff: null });
      expect(denied.ok).toBe(false);
      expect(denied.messages.some((m) => m.code === "payoff_missing")).toBe(true);
    }
    finally {
      resetPortConfig();
    }
    expect(AcceptPolicy.evaluate({ candidate: cand, brief, payoff: null }).ok).toBe(true);
  });

  test("短路：brief 硬拒时不再跑人味/书感全文软传感", () => {
    const r = AcceptPolicy.evaluate({ candidate: cand, brief: null, payoff: null, skipBrief: false });
    expect(r.messages.some((m) => m.code === "human_feel_hits" || m.code === "novel_sense_hits")).toBe(false);
  });

  test("编辑路径 A：须一次显式确认；非编辑稿不给走 A；确认后验收", () => {
    const edited = { lintHitCount: 0, body: "编辑稿。", editOf: "cand-parent" } as CandidateFile;
    const silent = AcceptPolicy.evaluate({ candidate: edited, brief: null, payoff: null, skipBrief: true, acceptAfterEdit: true, confirmAcceptAfterEdit: false });
    expect(silent.ok).toBe(false);
    expect(silent.messages.some((m) => m.code === "edit_accept_confirm_required")).toBe(true);
    const notEdit = AcceptPolicy.evaluate({ candidate: { lintHitCount: 0, body: "x" } as CandidateFile, brief: null, payoff: null, skipBrief: true, acceptAfterEdit: true, confirmAcceptAfterEdit: true });
    expect(notEdit.messages.some((m) => m.code === "edit_accept_not_an_edit")).toBe(true);
    const okA = AcceptPolicy.evaluate({ candidate: edited, brief: null, payoff: null, skipBrief: true, acceptAfterEdit: true, confirmAcceptAfterEdit: true });
    expect(okA.ok).toBe(true);
    expect(okA.receiptLines.join("\n")).toMatch(/已应用编辑[\s\S]*已验收/);
  });
});

describe("gates · 并发双采纳竞态（候选锁）", () => {
  test("Promise.allSettled 双 accept 恰好一个成功，ledger 一条记录", async () => {
    const { dir, cleanup } = await withWork("双采纳竞态");
    try {
      await saveChapter(dir, { id: "c001", title: "一", body: "旧正文。", status: "planned" });
      const cand = await stageCandidate(dir, { chapterId: "c001", body: "新正文第一稿。" });
      await markCandidateLinted(dir, cand.id, 0);
      const { acceptCandidate, readLedger } = await import("../src/lib/store.ts");
      const results = await Promise.allSettled([
        acceptCandidate(dir, cand.id, "replace"),
        acceptCandidate(dir, cand.id, "replace"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
      const rejected = results.filter((r) => r.status === "rejected");
      expect((rejected[0].reason as { code?: string }).code).toBe("candidate_already_accepted");
      const ledger = await readLedger(dir);
      expect(ledger.entries.filter((e: any) => String(e.summary ?? "").includes("采纳候选")).length).toBe(1);
    }
    finally {
      await cleanup();
    }
  });
});

describe("gates · 编辑 A/B/C 活链", () => {
  test("stage 编辑稿 → B 仅候选；A 无确认拒；A+confirm 采纳并验收", async () => {
    const { base, dir, key, cleanup } = await withWork("编辑环");
    try {
      const tools = new Map(__testing.tools.map((t) => [t.name, t.execute]));
      const staged = await tools.get("zhizhang_candidate_stage")!({ chapter: "c001", content: "写手稿：她把条子压进账本，没再关门。雨还在下。", work: key, working_dir: base }, {});
      const parentId = staged.match(/候选已暂存：(cand-\w+)/)?.[1];
      const edited = await tools.get("zhizhang_candidate_edit_stage")!({
        parent: parentId,
        content: "账本在桌上。条子压着。她没说话。风还在响。灯还亮着。门没关严。雨声很轻。脚步很慢。账本在桌上。条子压着。她没说话。风还在响。灯还亮着。门没关严。雨声很轻。脚步很慢。账本在桌上。条子压着。她没说话。风还在响。灯还亮着。门没关严。雨声很轻。脚步很慢。",
        mode: "polish-depolish",
        work: key,
        working_dir: base,
      }, {});
      const editId = edited.match(/编辑候选已暂存：(cand-\w+)/)?.[1];
      expect(editId).toBeTruthy();
      expect(EditPort.resolveChoice(null)).toBe(null);
      expect(EditPort.choiceMenuLine()).toMatch(/未表态按 B/);

      const bOut = await tools.get("zhizhang_candidate_edit_decide")!({ candidate: editId, choice: "B", work: key, working_dir: base }, {});
      expect(bOut).toMatch(/路径 B|仅作候选/);

      const aFail = await tools.get("zhizhang_candidate_edit_decide")!({ candidate: editId, choice: "A", work: key, working_dir: base }, {});
      expect(aFail).toMatch(/edit_accept_confirm_required|confirm_accept_after_edit/);

      await markCandidateLinted(dir, editId!, 0);
      const aOk = await tools.get("zhizhang_candidate_edit_decide")!({ candidate: editId, choice: "A", confirm_accept_after_edit: true, skip_brief: true, work: key, working_dir: base }, {});
      expect(aOk).toMatch(/已采纳/);
      expect(aOk).toMatch(/已应用编辑/);
      expect(aOk).toMatch(/已验收/);
    }
    finally {
      await cleanup();
    }
  });
});
