import { type LockService } from "@zhizhang/core/lock";
import type { AuditFinding, Bible, BibleOp, BibleView, PendingItem, Provenance } from "../bible/types.js";
export declare function readBible(workPath: string, lock?: LockService): Promise<Bible>;
export declare function viewBibleAt(workPath: string, position: number, lock?: LockService): Promise<BibleView>;
export declare function proposeBibleOps(workPath: string, ops: BibleOp[], from: Provenance, lock?: LockService): Promise<PendingItem[]>;
export declare function decideBiblePending(workPath: string, id: string, decision: "accept" | "reject" | {
    edit: BibleOp;
}, lock?: LockService): Promise<void>;
export declare function auditBible(workPath: string, upTo: number, lock?: LockService): Promise<AuditFinding[]>;
//# sourceMappingURL=bible.d.ts.map