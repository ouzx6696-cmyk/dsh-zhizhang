import type { StoragePaths } from "../../types.js";
export declare function nowIso(): string;
export declare function newId(prefix: string): string;
export declare function fileExists(p: string): Promise<boolean>;
export declare function libraryDirs(paths: StoragePaths): {
    root: string;
    sources: string;
    cards: string;
    candidates: string;
    index: string;
};
export declare function emptyIndex(): Promise<{
    schemaVersion: number;
    sources: never[];
    cards: never[];
}>;
export declare function readIndex(paths: StoragePaths): Promise<any>;
export declare function writeIndex(paths: StoragePaths, idx: any): Promise<void>;
export declare function resolveSourceIdFilter(paths: StoragePaths, opts: any): Promise<Set<unknown> | null>;
export declare function filterCardRows(paths: StoragePaths, rows: any, opts: any): Promise<any>;
export declare function comboScore(row: any, query: any, deepHay: any): {
    score: number;
    matched: number;
};
/** 解码书籍文件：UTF-8 严格校验 → GB18030 回退；避免 GBK 书导入成乱码。 */
export declare function decodeBookBuffer(buf: any): {
    text: any;
    encoding: string;
    converted: boolean;
};
/** 兼容 MSYS 风格 /d/foo/bar 与带引号路径。 */
export declare function normalizeUserPath(raw: string): string;
/** 查询分词：空格 / 逗号 / 顿号 / 分号 / 加号 都算分隔符。 */
export declare function tokenizeQuery(query: any): any[];
export declare function cardDeepHay(card: any): string;
/** 索引与卡文件对齐：tags/axis/title/updatedAt 以卡文件为准（防止改了卡、索引还是旧的）。 */
export declare function reconcileIndex(paths: StoragePaths): Promise<number>;
