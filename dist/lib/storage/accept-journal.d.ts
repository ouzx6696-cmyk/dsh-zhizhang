type Snapshot = string | null;
export declare function snapshotFile(file: string): Promise<Snapshot>;
/** A pending acceptance is never silently interpreted as a completed state. */
export declare function assertNoPendingAccept(dir: string): Promise<void>;
export declare function ensureRecoveryOwnerInactive(owner: {
    pid: number;
    host: string;
}): void;
/** Construct the intent before any of the four authoritative files are written. */
export declare function createAcceptJournal(dir: string, input: {
    chapterId: string;
    candidateId: string;
    mode: "append" | "replace";
    writes: Array<{
        file: string;
        before: Snapshot;
        content: string;
    }>;
    bodyHash: string;
    bodyFile: string;
}): Promise<string>;
/** Called by the original writer while holding all relevant locks. */
export declare function finishAcceptJournal(dir: string, id: string): Promise<void>;
export declare function inspectPendingAccept(dir: string): Promise<{
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
    chapterId: string;
    candidateId: string;
    mode: "replace" | "append";
    createdAt: string;
}>;
export declare function resumePendingAccept(dir: string): Promise<{
    chapterId: string;
    candidateId: string;
    mode: "replace" | "append";
}>;
export {};
