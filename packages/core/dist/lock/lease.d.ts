import type { Clock } from "../clock.js";
export interface Lease {
    readonly root: string;
    readonly owner: string;
    release(): Promise<void>;
}
export declare function acquireLease(root: string, clock: Clock): Promise<Lease>;
//# sourceMappingURL=lease.d.ts.map