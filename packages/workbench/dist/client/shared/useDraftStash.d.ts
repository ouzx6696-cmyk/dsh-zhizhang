import { type DraftEntry } from "../../editor/drafts.js";
export declare function useDraftStash(key: string, initial: string, text: string, baseRevision: string): {
    offer: DraftEntry | null;
    failure: string;
    stashed: string;
    base: string;
    restore: () => string;
    drop: () => void;
    settle: () => void;
};
//# sourceMappingURL=useDraftStash.d.ts.map