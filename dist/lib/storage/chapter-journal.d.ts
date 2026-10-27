export declare function hasPendingChapterSave(dir: string): Promise<boolean>;
export declare function assertNoPendingChapterSave(dir: string): Promise<void>;
export declare function createChapterJournal(dir: string, input: {
    chapterId: string;
    writes: Array<{
        file: string;
        before: string | null;
        content: string;
    }>;
}): Promise<string>;
export declare function createWorkRecordJournal(dir: string, input: {
    kind: "brief" | "payoff" | "lint" | "stage";
    chapterId: string;
    candidateId?: string;
    writes: Array<{
        file: string;
        before: string | null;
        content: string;
    }>;
}): Promise<string>;
export declare function finishChapterJournal(dir: string, id: string): Promise<void>;
export declare function inspectPendingChapterSave(dir: string): Promise<{
    writes: {
        file: string;
        state: string;
    }[];
    conflict: boolean;
    id: string;
    chapterId: string;
    candidateId: string | undefined;
    kind: "brief" | "payoff" | "lint" | "stage" | undefined;
    createdAt: string;
}>;
export declare function resumePendingChapterSave(dir: string): Promise<{
    chapterId: string;
    candidateId: string | undefined;
    kind: "brief" | "payoff" | "lint" | "stage" | undefined;
}>;
