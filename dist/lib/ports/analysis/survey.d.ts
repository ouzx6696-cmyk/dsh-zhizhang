import type { StoragePaths } from "../../types.js";
export declare function readSurvey(paths: StoragePaths, sourceId: any): Promise<any>;
export declare function writeSurvey(paths: StoragePaths, sourceId: any, survey: any): Promise<any>;
/** 没有测绘、或事实层变了，就补/重建一次。 */
export declare function ensureSurvey(paths: StoragePaths, sourceId: string, sourceText: string, facts: any[] | undefined, index: any[]): Promise<any>;
