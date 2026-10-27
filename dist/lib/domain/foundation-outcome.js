/** Pure chapter outcome selection, shared by acceptance and manual state tools. */
import { bodyTailOf, endingBodyOverlap } from "./ending-consistency.js";
export function resolveHappenedText(opts) {
    const ending = String(opts.ending ?? "").trim().replace(/\s+/g, " ");
    const bodyTail = bodyTailOf(opts.body);
    const minOverlap = opts.minOverlap ?? 0.35;
    if (!ending && !bodyTail) {
        return { text: "", source: "empty", bodyTail: bodyTail || undefined };
    }
    if (!ending) {
        return { text: bodyTail, source: "body_tail", bodyTail };
    }
    if (!bodyTail) {
        return { text: ending, source: "ending" };
    }
    const overlap = endingBodyOverlap(ending, bodyTail);
    if (overlap >= minOverlap) {
        return { text: ending, source: "ending", bodyTail };
    }
    return {
        text: bodyTail,
        source: "body_tail",
        bodyTail,
        warn: `纲末 ending 与正文末拍重叠偏低（${overlap.toFixed(2)}）— 请以正文末拍核对当前小说状态；可用 foundation_append_happened 精修。`,
    };
}
export function formatChapterOutcomeLine(chapterId, title, text) {
    const t = String(text ?? "").trim().replace(/\s+/g, " ");
    if (!t)
        return "";
    const short = t.length > 200 ? `${t.slice(0, 200).trimEnd()}…` : t;
    const titleBit = title?.trim() ? `《${title.trim()}》` : "";
    return `[${chapterId}]${titleBit} ${short}`;
}
