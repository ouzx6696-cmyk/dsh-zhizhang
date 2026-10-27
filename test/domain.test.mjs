/** Small checks for the deterministic rules used by the writing flow. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreEnding } from "../dist/lib/domain/ending-consistency.js";
import { parseChapterHeading } from "../dist/lib/domain/chapter-heading.js";
import { toCardView } from "../dist/lib/domain/card-schema.js";
import { computeCoverage, AUTO_CONFIDENCE_CAP } from "../dist/lib/domain/coverage.js";
import { auditPayoff } from "../dist/lib/payoff-audit.js";
import { formatReaderContract } from "../dist/lib/method-assets.js";
import { EMPTY_OUTLINE } from "../dist/lib/types.js";
import { lintStyle } from "../dist/lib/style-linter.js";
import { LintGate, HumanFeelGate, AcceptPolicy } from "../dist/lib/ports/index.js";
test("末拍检测理解时间别名，并对缺失落点一致告警", () => {
    assert.ok(scoreEnding("他 00:40 刷卡进楼。", "他零点四十刷卡进楼，没回头。").strongHits > 0);
    const ending = "他把侧窗的窗框钉死，回放里再也没有那扇窗。";
    const body = "她把账本合上，没再说话。灯灭之后雨停了半拍。";
    const findings = auditPayoff({ ...EMPTY_OUTLINE(), ending }, body).findings;
    assert.ok(findings.some((finding) => finding.code === "ending_missing"));
    const contract = formatReaderContract({ premise: "p", planned: "pl", threads: "t", lean: true, continuation: true, previous: { id: "c001", title: "一", ending, body } });
    assert.ok(contract.includes("前章纲末与正文可能不一致"));
});
test("中文章标题与旧卡格式仍可读取", () => {
    assert.equal(parseChapterHeading("第一章 开端")?.n, 1);
    assert.equal(parseChapterHeading("第12章 对峙")?.n, 12);
    assert.equal(parseChapterHeading("没有标题"), null);
    assert.equal(toCardView({ id: "c1", title: "旧卡", body: "动作", status: "accepted" }).legacy, true);
    assert.equal(toCardView({ id: "c2", title: "新卡", body: "x", status: "accepted", mechanisms: [{ name: "m", failWhen: "f" }], layer: "scene", dimension: "hook" }).legacy, false);
});
test("机械检测只报告信号，不声称创作质量合格", () => {
    assert.ok(lintStyle("他心中涌起一股难以言喻的感动，不禁叹了口气。").length > 0);
    assert.equal(lintStyle("他把伞收进桶里，没说话。").length, 0);
    assert.equal(LintGate.evaluateAccept({ hitCount: 2, strictLint: false }).ok, true);
    assert.equal(LintGate.evaluateAccept({ hitCount: 2, strictLint: true }).ok, false);
    assert.equal(HumanFeelGate.evaluateAccept({ body: "他觉得很难过，心中一沉。".repeat(20) }).ok, true);
    const coverage = computeCoverage({ scope: { chapters: 4, mode: "full" } }, [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }], [{ dimension: "hook" }, { dimension: "rhythm" }], { total: 2, ok: 2 }, { survey: true, plots: [{}], rhythms: [{}], characters: [{}], autoCap: true });
    assert.equal(coverage.capped, true);
    assert.ok(coverage.confidence <= AUTO_CONFIDENCE_CAP);
});
test("编辑候选采纳前须明确确认", () => {
    const candidate = { body: "编辑稿", lintHitCount: 0, editOf: "cand-parent" };
    const denied = AcceptPolicy.evaluate({ candidate, brief: null, payoff: null, skipBrief: true, acceptAfterEdit: true, confirmAcceptAfterEdit: false });
    assert.equal(denied.ok, false);
    assert.ok(denied.messages.some((m) => m.code === "edit_accept_confirm_required"));
    assert.equal(AcceptPolicy.evaluate({ candidate, brief: null, payoff: null, skipBrief: true, acceptAfterEdit: true, confirmAcceptAfterEdit: true }).ok, true);
});

test("证据按实际原文核对，心理词不误拒对白，重号不静默合并", async () => {
    const { quoteOk } = await import("../dist/lib/domain/evidence.js");
    assert.equal(quoteOk("她说我害怕", "她说：我害怕。"), false);
    assert.equal(quoteOk("她说：我害怕。", "她说：我害怕。"), true);
    const { chapterIndex, chapterText } = await import("../dist/lib/ports/analysis/chapters.js");
    const { validateChapterFacts } = await import("../dist/lib/ports/analysis/facts.js");
    const { buildPlan } = await import("../dist/lib/ports/analysis/plan.js");
    const text = "第一章 夜归\n她说：我害怕。随后关门。\n第一章 番外\n他打开窗。";
    const index = chapterIndex(text);
    assert.equal(chapterText(text, index, 1), null);
    assert.throws(() => buildPlan({ sourceId: "src-test", index }), e => e.code === "ambiguous_chapter_numbers");
    const result = validateChapterFacts({ n: 1, sourceStart: index[0].start, events: [{ desc: "她说：我害怕。随后关门。", quote: "她说：我害怕。随后关门。" }] }, text, index);
    assert.equal(result.errors.length, 0);
    assert.ok(result.warnings.length > 0);
});
