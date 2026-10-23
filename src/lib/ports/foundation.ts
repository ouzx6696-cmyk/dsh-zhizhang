/**
 * FoundationPort — append happened (当前小说状态·已发生) after chapter accept.
 * Does not invent long prose; prefers outline.ending when it aligns with body tail,
 * otherwise short body outcome (0.10.0).
 */
import { readWorkMeta, setFoundation } from "../store.js";
const CHAPTER_MARK = (chapterId: string) => `[${chapterId}]`;
/** Last ~1–2 sentences / up to maxLen chars from body — short outcome only. */
export function extractBodyOutcome(body: string, maxLen: any = 120) {
    const raw = String(body ?? "").trim().replace(/\s+/g, " ");
    if (!raw)
        return "";
    const slice = raw.length > maxLen * 2 ? raw.slice(-(maxLen * 2)) : raw;
    const parts = slice
        .split(/(?<=[。！？])|(?<=…)|(?<=……)/)
        .map((s: string) => s.trim())
        .filter(Boolean);
    let picked = "";
    if (parts.length === 0) {
        picked = slice;
    }
    else if (parts.length === 1) {
        picked = parts[0];
    }
    else {
        picked = `${parts[parts.length - 2]} ${parts[parts.length - 1]}`.trim();
    }
    if (picked.length > maxLen)
        picked = `${picked.slice(-maxLen).trim()}`;
    return picked;
}
/** Meaningful tokens (≥2 chars) from ending for overlap check. */
export function significantTokens(text: string) {
    const t = String(text ?? "").trim();
    if (!t)
        return [];
    const out = [];
    const cjk = t.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
    for (const w of cjk) {
        out.push(w);
        // sliding bigrams so「账本」等中段词不被切丢
        for (let i = 0; i + 2 <= w.length; i += 1) {
            out.push(w.slice(i, i + 2));
        }
    }
    const latin = t.match(/[A-Za-z0-9]{2,}/g) ?? [];
    out.push(...latin);
    const quoted = t.match(/[「『"']([^」』"']{1,12})[」』"']/g) ?? [];
    for (const q of quoted) {
        const inner = q.slice(1, -1).trim();
        if (inner.length >= 1)
            out.push(inner);
    }
    return [...new Set(out.filter((x: any) => x.length >= 1))];
}
/** Ratio of ending tokens found in bodyTail (0–1). Empty ending → 1. */
export function endingBodyOverlap(ending: any, bodyTail: any) {
    const tokens = significantTokens(ending);
    if (tokens.length === 0)
        return 1;
    const hay = String(bodyTail ?? "");
    if (!hay.trim())
        return 0;
    let hit = 0;
    for (const tok of tokens) {
        if (hay.includes(tok))
            hit += 1;
    }
    return hit / tokens.length;
}
/**
 * Choose short happened text: ending if it aligns with body tail; else body outcome.
 * Never invents long prose from body beyond extractBodyOutcome.
 */
export function resolveHappenedText(opts: any) {
    const ending = String(opts.ending ?? "").trim().replace(/\s+/g, " ");
    const bodyTail = extractBodyOutcome(opts.body);
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
        warn: `纲末 ending 与正文末拍重叠偏低（${overlap.toFixed(2)}）— 已用正文末拍写入当前小说状态·已发生；可用 foundation_append_happened 精修。`,
    };
}
export const FoundationPort = {
    id: "port.foundation",
    extractBodyOutcome,
    endingBodyOverlap,
    resolveHappenedText,
    /**
     * Build a one-line happened entry. Returns empty if text is blank.
     */
    formatChapterOutcomeLine(chapterId: string, title: string, text: string) {
        const t = String(text ?? "").trim().replace(/\s+/g, " ");
        if (!t)
            return "";
        const short = t.length > 200 ? `${t.slice(0, 200).trimEnd()}…` : t;
        const titleBit = title?.trim() ? `《${title.trim()}》` : "";
        return `${CHAPTER_MARK(chapterId)}${titleBit} ${short}`;
    },
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
        const mark = CHAPTER_MARK(chapterId);
        const meta0 = await readWorkMeta(dir);
        const existing = String(meta0.foundation.happened ?? "");
        if (existing.includes(mark)) {
            return { meta: meta0, appended: false, line, reason: "already_recorded" };
        }
        const next = existing.trim() ? `${existing.trim()}\n${line}` : line;
        const meta = await setFoundation(dir, { happened: next });
        return { meta, appended: true, line };
    },
    /**
     * Soft receipt lines after candidate_accept — remind model to refresh 当前小说状态.
     */
    acceptReceiptLines(opts: any) {
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
            lines.push(`- happened_skip：${opts.chapterId} 已在当前小说状态·已发生中（未重复追加）`);
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
