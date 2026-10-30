/**
 * FoundationPort — explicit author records and working-draft receipt guidance.
 * Does not invent long prose; prefers outline.ending when it aligns with body tail,
 * otherwise short body outcome.
 *
 * 基元（末拍/宽松重叠）来自 domain/ending-consistency：happened 选材是
 * 「宽松选择」而非质量判定——payoff 审计与读者合同的严格评分同在那个模块。
 */
import { readWorkMeta, appendHappenedLine } from "../work-store.js";
import { bodyTailOf, endingBodyOverlap } from "../domain/ending-consistency.js";
import { formatChapterOutcomeLine, resolveHappenedText } from "../domain/foundation-outcome.js";
export const extractBodyOutcome = bodyTailOf;
export { endingBodyOverlap, resolveHappenedText };
export const FoundationPort = {
    id: "port.foundation",
    extractBodyOutcome,
    endingBodyOverlap,
    resolveHappenedText,
    /**
     * Build a one-line happened entry. Returns empty if text is blank.
     */
    formatChapterOutcomeLine,
    /**
     * Append a short happened line for a chapter. Idempotent per chapterId marker.
     * Skips when text empty (caller should still remind).
     */
    async appendHappened(dir: string, input: any) {
        const chapterId = String(input.chapterId ?? "").trim();
        if (!chapterId) {
            const meta = await readWorkMeta(dir);
            return { meta, appended: false, line: "", reason: "empty_chapter_id" };
        }
        const line = FoundationPort.formatChapterOutcomeLine(chapterId, input.title, input.text);
        if (!line) {
            const meta = await readWorkMeta(dir);
            return { meta, appended: false, line: "", reason: "empty_text" };
        }
        return appendHappenedLine(dir, chapterId, line, input.replace === true);
    },
    /**
     * Candidate adoption updates working continuity; happened remains author material.
     */
    acceptReceiptLines(opts: any) {
        const lines = [];
        const threads = String(opts.threads ?? "").trim();
        if (opts.endingVsBodyWarn)
            lines.push(`- ending_vs_body：${opts.endingVsBodyWarn}`);
        lines.push("- 已采纳工作稿；定稿接续索引随定稿更新，作者 happened 保留不变。");
        if (threads) {
            const short = threads.length > 160 ? `${threads.slice(0, 160).trimEnd()}…` : threads;
            lines.push(`- threads_open：未结伏笔仍在 — ${short}`);
        }
        return lines;
    },
};
