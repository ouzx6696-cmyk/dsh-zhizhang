/** 前章解析 — brief / accept / audit / panel 共用，避免四份实现漂移。 */
import { EMPTY_OUTLINE } from "../types.js";
import { listChapters, readChapter } from "../work-store.js";

/**
 * 取当前章的前一章（按章序）。
 * - idx>0 → 前一章；
 * - idx===0 或 章未登记（idx<0）→ null。
 *   此前「未登记」会回退到最后一章：给未创建的章注入错误的 prev，
 *   续写合同与同构对照都会被带偏。未登记的章应先 outline_set/chapter_save 进 meta。
 * 返回 { meta, body, outline } 或 null。
 */
export async function resolvePrevChapter(dir: string, chapterId: string) {
    const chapters = await listChapters(dir);
    if (!chapters.length) return null;
    const idx = chapters.findIndex((c: any) => c.id === chapterId);
    if (idx <= 0) return null;
    const prevMeta = chapters[idx - 1];
    try {
        const prev = await readChapter(dir, prevMeta.id);
        return { meta: prevMeta, body: prev.body || "", outline: prev.outline, revision: prev.revision, missing: false };
    }
    catch (err: any) {
        if (err?.code !== "ENOENT") throw err;
        return { meta: prevMeta, body: "", outline: EMPTY_OUTLINE(), revision: undefined, missing: true };
    }
}

export async function resolvePrevBody(dir: string, chapterId: string) {
    const prev = await resolvePrevChapter(dir, chapterId);
    return prev?.body || null;
}
