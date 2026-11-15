import type { Clock } from "../clock.js";
import { type Lease } from "./lease.js";
import { type AuthorConfirmation, type ResourceKey, type StaleLock } from "./write-lock.js";
export interface LockService {
    lease(root: string): Promise<Lease>;
    write<T>(resource: ResourceKey, fn: () => Promise<T>, opts?: {
        wait?: number;
    }): Promise<T>;
    serial<T>(key: string, fn: () => Promise<T>): Promise<T>;
    inspectStale(root: string): Promise<StaleLock[]>;
    clearStale(lock: StaleLock, confirm: AuthorConfirmation): Promise<void>;
}
export declare function createLockService(clock: Clock): LockService;
//# sourceMappingURL=service.d.ts.map