/**
 * 未保存源码草稿的持久化读写：
 * - 文件后端：读写工作目录下的 `.zhizhang/drafts/<key>.json`
 * - 浏览器后端：兼容 `localStorage` 暂存，防止意外关闭丢失
 */
export declare const DRAFTS_DIR = ".zhizhang/drafts";
export interface DraftEntry {
    text: string;
    savedAt: number;
    baseRevision: string;
}
export interface DraftFileBackend {
    readFile(filePath: string): Promise<string | null>;
    writeFile(filePath: string, content: string): Promise<void>;
    removeFile(filePath: string): Promise<void>;
    listFiles?(dirPath: string): Promise<string[]>;
}
/** The draft of one slot ("official" or a candidate id) of a novel chapter. */
export declare function chapterDraftKey({ base, work, chapter, slot, }: {
    base?: string;
    work: string;
    chapter: string;
    slot: string;
}): string;
/** The draft of a Toutiao article's working text. */
export declare function articleDraftKey({ root, id }: {
    root: string;
    id: string;
}): string;
export declare function draftFileName(key: string): string;
export declare function draftFilePath(workDir: string, key: string): string;
/** Node.js 文件系统后端（按需动态加载 node:fs/promises 与 node:path，避免影响浏览器打包）。 */
export declare function createNodeDraftBackend(): DraftFileBackend;
/** 从 `.zhizhang/drafts/` 读取草稿；内容损坏时自动清理并返回 null。 */
export declare function readDraftFile(workDir: string, key: string, backend?: DraftFileBackend): Promise<DraftEntry | null>;
/** 将草稿写入 `.zhizhang/drafts/`，返回保存时间戳。 */
export declare function writeDraftFile(workDir: string, key: string, text: string, baseRevision: string, backend?: DraftFileBackend): Promise<number>;
/** 删除 `.zhizhang/drafts/` 下指定草稿。 */
export declare function clearDraftFile(workDir: string, key: string, backend?: DraftFileBackend): Promise<void>;
/** The stored draft in browser localStorage, or null; an unreadable entry is removed. */
export declare function readDraft(key: string): DraftEntry | null;
/** Stores draft in browser localStorage and returns the saved timestamp. */
export declare function writeDraft(key: string, text: string, baseRevision: string): number;
export declare function clearDraft(key: string): void;
/** Drafts of every other work, offered for clearing when storage is full. */
export declare function otherDraftKeys(key: string): string[];
//# sourceMappingURL=drafts.d.ts.map