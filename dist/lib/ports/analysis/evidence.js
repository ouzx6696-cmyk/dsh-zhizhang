/** 引文核对 — 正文引文走 domain，模块 evidence 需要章号定位。 */
import { parseChapterNumber } from "../../domain/chapter-heading.js";
import { quoteOk } from "../../domain/evidence.js";
import { chapterText } from "./chapters.js";
export { quoteOk, extractBodyQuotes, verifyBodyQuotes } from "../../domain/evidence.js";
/** 模块证据核对：引文必须能在对应章找到。返回 bad 描述数组。 */
export function verifyModuleEvidence(card, sourceText, index) {
    const bad = [];
    for (const [i, e] of (card?.evidence ?? []).entries()) {
        const n = parseChapterNumber(e?.chapter);
        const text = Number.isFinite(n) ? chapterText(sourceText, index, n) : null;
        if (!text || !quoteOk(e?.quote, text))
            bad.push(`evidence[${i}] 引文在${Number.isFinite(n) ? `第${n}章` : "指定章"}找不到`);
    }
    return bad;
}
