import type { LockService } from "@zhizhang/core/lock";
import type { AuditFinding, Bible, BibleOp, BibleView, EntityHit, Evidence, PendingItem, Provenance } from "./types.js";
export interface ProposeOpMeta {
    evidence?: Evidence;
    located?: boolean;
}
export declare function createBibleStore(lock: LockService): {
    read: (workPath: string) => Promise<Bible>;
    asOf: (bible: Bible, position: number) => BibleView;
    match: (view: BibleView, texts: string[]) => EntityHit[];
    propose: (workPath: string, ops: BibleOp[], from: Provenance, metaList?: ProposeOpMeta[]) => Promise<PendingItem[]>;
    decide: (workPath: string, id: string, decision: "accept" | "reject" | {
        edit: BibleOp;
    }) => Promise<void>;
    audit: (bible: Bible, upTo: number) => AuditFinding[];
};
//# sourceMappingURL=store.d.ts.map