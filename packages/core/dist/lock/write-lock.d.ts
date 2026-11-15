import type { Clock } from "../clock.js";
export interface ResourceKey {
    kind: "work" | "article" | "library" | "ledger";
    path: string;
}
export interface StaleLock {
    lockDir: string;
    owner: string;
    pid: number;
    host: string;
    acquiredAt: string;
}
export interface AuthorConfirmation {
    confirmedByAuthor: true;
    at: string;
}
export declare function withWriteLock<T>(resource: ResourceKey, clock: Clock, fn: () => Promise<T>, waitMs?: number): Promise<T>;
export declare function inspectStaleLocks(root: string): Promise<StaleLock[]>;
export declare function clearStaleLock(lock: StaleLock, confirm: AuthorConfirmation): Promise<void>;
//# sourceMappingURL=write-lock.d.ts.map