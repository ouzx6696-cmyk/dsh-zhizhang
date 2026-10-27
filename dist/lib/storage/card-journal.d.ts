type Snapshot = string | null;
type SourceGuard = {
    sourceId: string;
    sourceFile: string;
    metaHash: string;
    sourceHash: string;
};
export declare function assertNoPendingCard(library: string): Promise<void>;
export declare function createCardJournal(library: string, input: {
    candidateId: string;
    cardId: string;
    writes: Array<{
        file: string;
        before: Snapshot;
        content: string;
    }>;
    sourceGuard?: SourceGuard;
}): Promise<string>;
export declare function finishCardJournal(library: string, id: string): Promise<void>;
export declare function inspectPendingCard(library: string): Promise<{
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
    candidateId: string;
    cardId: string;
    createdAt: string;
}>;
export declare function resumePendingCard(library: string): Promise<{
    candidateId: string;
    cardId: string;
}>;
export {};
