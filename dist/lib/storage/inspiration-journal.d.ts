import type { StoragePaths } from "../types.js";
export declare function assertNoPendingInspiration(inspiration: string): Promise<void>;
export declare function assertNoInspirationMarker(dir: string): Promise<void>;
export declare function createInspirationJournal(paths: StoragePaths, input: {
    workKey: string;
    candidateId: string;
    chapterId?: string;
    writes: Array<{
        target: "work" | "inspiration";
        file: string;
        before: string | null;
        content: string;
    }>;
}): Promise<string>;
export declare function finishInspirationJournal(paths: StoragePaths, id: string): Promise<void>;
export declare function inspectPendingInspiration(paths: StoragePaths): Promise<{
    writes: {
        target: "work" | "inspiration";
        file: string;
        state: string;
    }[];
    conflict: boolean;
    id: string;
    workKey: string;
    candidateId: string;
    createdAt: string;
}>;
export declare function resumePendingInspiration(paths: StoragePaths): Promise<{
    workKey: string;
    candidateId: string;
}>;
