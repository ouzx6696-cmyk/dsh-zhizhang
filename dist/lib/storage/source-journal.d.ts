export declare function hasPendingSource(library: string): Promise<boolean>;
export declare function assertNoPendingSource(library: string): Promise<void>;
export declare function createSourceJournal(library: string, input: {
    sourceId: string;
    text: string;
    metaContent: string;
    indexBefore: string;
    indexContent: string;
}): Promise<string>;
export declare function finishSourceJournal(library: string, id: string): Promise<void>;
export declare function inspectPendingSource(library: string): Promise<{
    writes: {
        file: string;
        state: string;
    }[];
    guards: {
        file: string;
        state: string;
    }[];
    conflict: boolean;
    id: string;
    sourceId: string;
    createdAt: string;
}>;
export declare function resumePendingSource(library: string): Promise<{
    sourceId: string;
}>;
