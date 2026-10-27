import type { StoragePaths } from "../../types.js";
export declare function ensureAnalysis(paths: StoragePaths, sourceId: any, sourceText: any): Promise<any>;
export declare function writeAnalysisMeta(paths: StoragePaths, sourceId: any, patch: any): Promise<any>;
/** Caller holds the library lock and has already captured the data file before reading it. */
export declare function commitAnalysisUpdate(paths: StoragePaths, sourceId: string, dataFile: string, dataBefore: string | null, content: string, patch: (meta: any) => any): Promise<void>;
export declare function readAnalysisBundle(paths: StoragePaths, sourceId: any): Promise<{
    meta: any;
    chapters: any[];
    plots: any[];
    rhythms: any;
    characters: any[];
    survey: any;
}>;
export declare function listAnalyses(paths: StoragePaths): Promise<{
    sourceId: string;
    stage: any;
    facts: number;
    totalChapters: any;
    scope: any;
    plots: number;
    updatedAt: any;
}[]>;
