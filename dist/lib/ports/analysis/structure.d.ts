import type { StoragePaths } from "../../types.js";
export declare function validatePlot(plot: any): {
    errors: string[];
    warnings: never[];
};
export declare function validateRhythm(r: any): {
    errors: string[];
    warnings: string[];
};
export declare function validateCharacter(c: any): {
    errors: string[];
    warnings: never[];
};
export declare function upsertPlot(paths: StoragePaths, sourceId: any, plot: any): Promise<{
    count: number;
}>;
export declare function writeRhythm(paths: StoragePaths, sourceId: any, rhythm: any): Promise<{
    warnings: string[];
    loops: any;
}>;
export declare function upsertCharacter(paths: StoragePaths, sourceId: any, character: any): Promise<{
    count: number;
}>;
