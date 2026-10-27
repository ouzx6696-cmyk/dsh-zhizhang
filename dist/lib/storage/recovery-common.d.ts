type Snapshot = string | null;
export declare function snapshotFile(file: string): Promise<Snapshot>;
export declare function ensureRecoveryOwnerInactive(owner: {
    pid: number;
    host: string;
}): void;
export interface RecordedWrite {
    file: string;
    before: string | null;
    after: string | null;
    content?: string;
}
export declare function applyRecordedWrites(writes: RecordedWrite[], code: string): Promise<void>;
export {};
