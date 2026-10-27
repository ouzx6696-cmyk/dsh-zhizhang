export declare function hasPendingAnalysis(library: string): Promise<boolean>;
export declare function assertNoPendingAnalysis(library: string): Promise<void>;
export declare function createAnalysisJournal(library: string, input: {
    sourceId: string;
    dataFile: string;
    writes: Array<{
        file: string;
        before: string | null;
        content: string;
    }>;
}): Promise<string>;
export declare function finishAnalysisJournal(library: string, id: string): Promise<void>;
export declare function inspectPendingAnalysis(library: string): Promise<{
    writes: {
        file: string;
        state: string;
    }[];
    conflict: boolean;
    id: string;
    sourceId: string;
    dataFile: string;
    createdAt: string;
}>;
export declare function resumePendingAnalysis(library: string): Promise<{
    sourceId: string;
    dataFile: string;
}>;
