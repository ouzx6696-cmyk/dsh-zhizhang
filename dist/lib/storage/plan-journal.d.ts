export declare function hasPendingPlan(library: string): Promise<boolean>;
export declare function assertNoPendingPlan(library: string): Promise<void>;
export declare function createPlanJournal(library: string, input: {
    sourceId: string;
    clearConfirm: boolean;
    writes: Array<{
        file: string;
        before: string | null;
        content?: string;
    }>;
}): Promise<string>;
export declare function finishPlanJournal(library: string, id: string): Promise<void>;
export declare function inspectPendingPlan(library: string): Promise<{
    writes: {
        file: string;
        state: string;
    }[];
    conflict: boolean;
    id: string;
    sourceId: string;
    createdAt: string;
}>;
export declare function resumePendingPlan(library: string): Promise<{
    sourceId: string;
}>;
