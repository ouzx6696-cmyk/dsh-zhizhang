/**
 * FoundationPort — append happened (当前小说状态·已发生) after chapter accept.
 * Does not invent long prose; prefers outline.ending when it aligns with body tail,
 * otherwise short body outcome (0.10.0).
 *
 * 基元（末拍/宽松重叠）来自 domain/ending-consistency：happened 选材是
 * 「宽松选择」而非质量判定——payoff 审计与读者合同的严格评分同在那个模块。
 */
import { readWorkMeta, appendHappenedLine } from "../store.js";
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
    async appendHappened(dir, input) {
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
     * Soft receipt lines after candidate_accept — remind model to refresh 当前小说状态.
     */
    acceptReceiptLines(opts) {
        const lines = [];
        const ending = String(opts.ending ?? "").trim();
        const threads = String(opts.threads ?? "").trim();
        if (opts.endingVsBodyWarn) {
            lines.push(`- ending_vs_body：${opts.endingVsBodyWarn}`);
        }
        if (opts.append?.appended) {
            const src = opts.happenedSource === "body_tail"
                ? "（来源：正文末拍）"
                : opts.happenedSource === "ending"
                    ? "（来源：纲末 ending）"
                    : "";
            lines.push(`- happened_appended：已追加「${opts.append.line}」${src}`);
        }
        else if (opts.append?.reason === "already_recorded") {
            lines.push(`- happened_skip：${opts.chapterId} 已有状态记录（未覆盖）；如本章已修订，请核对旧记录并按需用 foundation_append_happened(replace=true) 更新`);
        }
        else if (!ending && opts.happenedSource !== "body_tail") {
            lines.push(`- happened_remind：本章 ending 与正文末拍皆空，未自动追加。请用 zhizhang_foundation_set 或 zhizhang_foundation_append_happened 补一句本章后果。`);
        }
        else if (opts.append && !opts.append.appended) {
            lines.push(`- happened_remind：未能自动追加（${opts.append.reason ?? "unknown"}）。请用 zhizhang_foundation_append_happened 补记。`);
        }
        if (threads) {
            const short = threads.length > 160 ? `${threads.slice(0, 160).trimEnd()}…` : threads;
            lines.push(`- threads_open：未结伏笔仍在 — ${short}`);
        }
        else {
            lines.push(`- threads_remind：根基 threads 为空；若本章留了未了局面，请 foundation_set 补上。`);
        }
        lines.push(`- novel_state：续写前再调 chapter_brief（当前小说状态）；n≥2 会注入前章正文全文（ending/happened 作索引）。可用 zhizhang_foundation_append_happened 精修 happened。`);
        return lines;
    },
};
