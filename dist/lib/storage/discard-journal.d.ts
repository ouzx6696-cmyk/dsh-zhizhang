export declare function hasPendingDiscard(library: string): Promise<boolean>;
export declare function assertNoPendingDiscard(library: string): Promise<void>;
export declare function createDiscardJournal(library: string, input: {
    cardId: string;
    indexBefore: string;
    indexContent: string;
    cardBefore: string | null;
}): Promise<string>;
export declare function finishDiscardJournal(library: string, id: string): Promise<void>;
export declare function inspectPendingDiscard(library: string): Promise<{
    writes: {
        file: string;
        state: string;
    }[];
    conflict: boolean;
    id: string;
    cardId: string;
    createdAt: string;
}>;
export declare function resumePendingDiscard(library: string): Promise<{
    cardId: string;
}>;
