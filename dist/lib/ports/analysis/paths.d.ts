import type { StoragePaths } from "../../types.js";
export declare function assertSourceId(id: string): string;
export { nowIso } from "../../storage/primitives.js";
export declare function analysisPaths(paths: StoragePaths, sourceId: any): {
    dir: string;
    meta: string;
    chapters: string;
    plots: string;
    rhythms: string;
    characters: string;
    survey: string;
    report: string;
};
export declare function readJson(file: string, fallback: any): Promise<any>;
export declare function readJsonl(file: string): Promise<any[]>;
export declare function writeJsonl(file: string, rows: any): Promise<void>;
export declare function ensureDir(dir: string): Promise<string>;
