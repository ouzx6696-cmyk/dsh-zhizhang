import type { Hunk } from "./diff.js";
export type EditCategory = Hunk["kind"];
export interface ClassifiedEdit {
    kind: EditCategory;
    signature: string;
    condition: string;
    change: string;
    why: string;
    before: string;
    after: string;
}
export declare function classifyHunk(hunk: Hunk): ClassifiedEdit;
export declare function classifyHunks(hunks: Hunk[]): ClassifiedEdit[];
//# sourceMappingURL=classify.d.ts.map