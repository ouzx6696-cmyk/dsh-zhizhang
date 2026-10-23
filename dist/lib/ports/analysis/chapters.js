/** 章节目录 — 支持阿拉伯/中文数字与序章。 */
import { CHAPTER_HEADING_RE, FRONT_HEADING_RE, parseChapterHeading, } from "../../domain/chapter-heading.js";
function fresh(re) {
    return new RegExp(re.source, re.flags);
}
/** 解析章节目录：第1章 / 第一章 / 序章。返回 [{n,title,start,end}]。 */
export function chapterIndex(text) {
    const t = String(text ?? "").replace(/^\uFEFF/, "");
    const out = [];
    const re = fresh(CHAPTER_HEADING_RE);
    let m;
    while ((m = re.exec(t))) {
        const parsed = parseChapterHeading(m[0]);
        if (parsed)
            out.push({ n: parsed.n, title: parsed.title, start: m.index, end: t.length });
    }
    const frontRe = fresh(FRONT_HEADING_RE);
    const front = frontRe.exec(t);
    if (front && (!out.length || front.index < out[0].start)) {
        const parsed = parseChapterHeading(front[0]);
        if (parsed)
            out.push({ n: parsed.n, title: parsed.title, start: front.index, end: t.length });
    }
    out.sort((a, b) => a.start - b.start);
    for (let i = 0; i < out.length; i++)
        out[i].end = i + 1 < out.length ? out[i + 1].start : t.length;
    return out;
}
export function totalChapters(index) {
    return index.filter((c) => c.n > 0).length;
}
export function chapterText(text, index, n) {
    const hit = index.find((c) => c.n === Number(n));
    if (!hit)
        return null;
    return String(text).slice(hit.start, hit.end);
}
export function chapterTitle(index, n) {
    return index.find((c) => c.n === Number(n))?.title ?? "";
}
/** 百分比位置最近的章（用于 30/60/85 抽样）。 */
export function nearestChapter(index, ratio) {
    const chapters = index.filter((c) => c.n > 0);
    if (!chapters.length)
        return null;
    const target = chapters[0].start + (chapters[chapters.length - 1].start - chapters[0].start) * ratio;
    let best = chapters[0];
    for (const c of chapters) {
        if (Math.abs(c.start - target) < Math.abs(best.start - target))
            best = c;
    }
    return best.n;
}
