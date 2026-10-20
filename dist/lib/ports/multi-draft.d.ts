/**
 * MultiDraftPort — optional旁路：同章多草稿 → 统一整理 brief → unify_stage。
 * Default OFF (PortConfig.multiDraftEnabled / env DSH_ZHIZHANG_MULTI_DRAFT).
 * Staging N drafts is always allowed; unify_* tools require enabled.
 */
import type { CandidateFile } from "../types.js";
export declare const MULTI_DRAFT_DISABLED_CODE = "multi_draft_disabled";
export declare function envMultiDraftFlag(): boolean;
export declare function isMultiDraftEnabled(): boolean;
export interface UnifyParentView {
    id: string;
    draftLabel?: string;
    wordCount: number;
    note?: string;
    preview: string;
}
export interface UnifyBriefInput {
    chapterId: string;
    workKey?: string;
    parents: UnifyParentView[];
    /** Optional target words hint (avg / max of parents). */
    targetWords?: number;
}
export declare const MultiDraftPort: {
    id: "port.multi_draft";
    version: string;
    disabledCode: string;
    isEnabled: typeof isMultiDraftEnabled;
    enableHint(): string;
    /** Refuse unify tools when feature off. Throws Error with .code = multi_draft_disabled. */
    requireEnabled(): void;
    parentView(cand: Pick<CandidateFile, "id" | "body" | "draftLabel" | "note">): UnifyParentView;
    /**
     * Positive merge brief — keep plot/pressure, pick best voice edges, one continuous chapter.
     * No 不要xx stacks.
     */
    formatUnifyBrief(input: UnifyBriefInput): string;
    afterUnifyStageLines(opts: {
        unifyCandId: string;
        parentIds: string[];
        chapterId: string;
        wordCount: number;
    }): string[];
};
