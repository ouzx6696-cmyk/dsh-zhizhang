// @ts-nocheck
/** 前章解析 — brief / accept / audit / panel 共用，避免四份实现漂移。 */
import { listChapters, readChapter } from "../store.js";

/**
 * 取当前章的前一章（按章序）。章不存在时退回最后一章（与旧行为一致）。
 * 返回 { meta, body, outline } 或 null。
 */
export async function resolvePrevChapter(dir, chapterId) {
    try {
        const chapters = await listChapters(dir);
        if (!chapters.length)
            return null;
        const idx = chapters.findIndex((c) => c.id === chapterId);
        let prevMeta = null;
        if (idx > 0) {
            prevMeta = chapters[idx - 1];
        }
        else if (idx < 0) {
            const last = chapters[chapters.length - 1];
            if (last.id !== chapterId)
                prevMeta = last;
        }
        if (!prevMeta)
            return null;
        const prev = await readChapter(dir, prevMeta.id);
        return { meta: prevMeta, body: prev.body || "", outline: prev.outline };
    }
    catch {
        return null;
    }
}

export async function resolvePrevBody(dir, chapterId) {
    const prev = await resolvePrevChapter(dir, chapterId);
    return prev?.body || null;
}
