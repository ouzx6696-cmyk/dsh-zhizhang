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
        cardId: any;
        title: any;
        remaining: number;
    }>;
    listCards(paths: StoragePaths, opts?: any): Promise<any>;
    searchCards(paths: StoragePaths, query: any, opts?: any): Promise<any>;
    /**
     * 推荐组合包：恰好 1 mind + 最多 N craft（可跨 source）。
     * 缺 mind → ok=false + emptyReason（不抛，便于产品面展示）。
     */
    suggestCombo(paths: StoragePaths, input?: any): Promise<{
        ok: boolean;
        cardIds: never[];
        mind: null;
        crafts: never[];
        warnings: string[];
        emptyReason: string;
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
