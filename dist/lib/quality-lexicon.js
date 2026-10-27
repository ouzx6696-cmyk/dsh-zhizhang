/**
 * per-work 质量词表装载。
 *
 * 兑付审计的默认锚点词是题材域词（见 domain/ending-consistency 的
 * DEFAULT_ENDING_LEXICON）；换题材的书可放 `<作品目录>/quality-lexicon.json`：
 *
 *   { "endingKeywords": ["令牌", "守塔人", "潮汐"] }
 *
 * 文件存在且非空时覆盖默认词表（经 mtime 读缓存，热改即生效）；
 * 缺文件或为空返回 undefined，调用方回落默认。
 */
import path from "node:path";
import { readJsonCached } from "./file-cache.js";
export async function loadEndingLexicon(dir) {
    try {
        const raw = await readJsonCached(path.join(dir, "quality-lexicon.json"));
        const list = Array.isArray(raw?.endingKeywords)
            ? raw.endingKeywords.map((x) => String(x).trim()).filter(Boolean)
            : [];
        return list.length ? list : undefined;
    }
    catch {
        return undefined;
    }
}
