import type { StoragePaths } from "../types.js";
export * from "./library/schema.js";
export { auditCardContent, normForMatch } from "./library/audit.js";
export declare const LibraryPort: {
    id: string;
    status: string;
    title: string;
    summary: string;
    capabilities(): {
        id: string;
        title: string;
        ready: boolean;
    }[];
    ensureLibrary(paths: StoragePaths): Promise<StoragePaths>;
    importSource(paths: StoragePaths, input: any): Promise<{
        sourceId: string;
        charCount: any;
        encoding: string;
        converted: boolean;
        excerptPath: string;
        warning: string | undefined;
    }>;
    getSource(paths: StoragePaths, sourceId: any): Promise<{
        meta: any;
        text: string;
    }>;
    /**
     * getSource + 已解析的章索引。整本书（可能数 MB）此前在 dissect / 卡
     * stage / accept / audit 里被反复整读 + 全文正则重扫；这里按文本文件
     * mtime+size 缓存文本与章索引，未变时全部命中。
     */
    getSourceIndexed(paths: StoragePaths, sourceId: any): Promise<{
        meta: any;
        text: string;
        index: any[];
    }>;
    listSources(paths: StoragePaths): Promise<any>;
    dissectBrief(paths: StoragePaths, sourceId: any, opts?: any): Promise<string>;
    stageCard(paths: StoragePaths, input: any): Promise<{
        candId: string;
        title: string;
        warnings: string[];
    }>;
    acceptCard(paths: StoragePaths, candId: any): Promise<{
        cardId: string;
        title: any;
        warnings: string[];
        judgment: string[];
    }>;
    discardCard(paths: StoragePaths, cardId: any): Promise<{
        cardId: string;
        title: any;
        remaining: any;
    }>;
    listCards(paths: StoragePaths, opts?: any): Promise<any>;
    searchCards(paths: StoragePaths, query: any, opts?: any): Promise<any>;
    /**
     * 推荐组合包：优先 1 mind + 最多 N craft；有用的 craft 可独立返回。
     * 缺 mind 不阻断；没有任何可用卡时返回空原因。
     */
    suggestCombo(paths: StoragePaths, input?: any): Promise<{
        ok: boolean;
        cardIds: any[];
        mind: null;
        crafts: any[];
        warnings: string[];
        emptyReason: string | undefined;
    } | {
        ok: boolean;
        cardIds: any[];
        mind: {
            id: any;
            title: any;
            sourceId: any;
            axis: string;
            tags: any;
        };
        crafts: {
            id: any;
            title: any;
            sourceId: any;
            axis: string;
            tags: any;
        }[];
        warnings: string[];
        emptyReason?: undefined;
    }>;
    auditCards(paths: StoragePaths, opts?: any): Promise<({
        id: any;
        title: any;
        axis: any;
        layer: any;
        dimension: any;
        evidenceQuotes: any;
        evidenceVerified: number;
        unverifiable: any;
        skippedShort: never[];
        bodyQuotes: number;
        bodyVerified: number;
        bodyUnverifiable: string[];
        bodySkipped: number;
        warnings: string[];
        chapterOk: boolean;
    } | {
        evidenceQuotes: number;
        evidenceVerified: number;
        skippedShort: string[];
        unverifiable: string[];
        located: any[];
        chapterOk: boolean | null;
        warnings: string[];
        id: any;
        title: any;
        axis: any;
        layer?: undefined;
        dimension?: undefined;
        bodyQuotes?: undefined;
        bodyVerified?: undefined;
        bodyUnverifiable?: undefined;
        bodySkipped?: undefined;
    })[]>;
    getCard(paths: StoragePaths, cardId: any): Promise<any>;
    getCandidate(paths: StoragePaths, candId: any): Promise<any>;
};
