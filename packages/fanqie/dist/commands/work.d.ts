import { type LockService } from "@zhizhang/core/lock";
import { type WorkMeta } from "../storage/work.js";
export interface WorkSummary {
    id: string;
    title: string;
    workPath: string;
    grade: WorkMeta["grade"];
    created: string;
}
export declare function createWork(workPath: string, input: {
    id: string;
    title: string;
    profile?: string;
    grade?: WorkMeta["grade"];
}, lock?: LockService): Promise<WorkMeta>;
export declare function getWork(workPath: string): Promise<WorkMeta>;
export declare function listWorks(worksRoot: string): Promise<WorkSummary[]>;
export declare function updateWorkSettings(workPath: string, patch: Partial<WorkMeta["settings"]> & {
    grade?: WorkMeta["grade"];
    profile?: string;
}, lock?: LockService): Promise<WorkMeta>;
//# sourceMappingURL=work.d.ts.map