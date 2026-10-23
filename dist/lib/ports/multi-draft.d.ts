export declare const MULTI_DRAFT_DISABLED_CODE = "multi_draft_disabled";
export declare function envMultiDraftFlag(): boolean;
export declare function isMultiDraftEnabled(): boolean;
export declare const MultiDraftPort: {
    id: string;
    version: string;
    disabledCode: string;
    isEnabled: typeof isMultiDraftEnabled;
    enableHint(): string;
    /** Refuse unify tools when feature off. Throws Error with .code = multi_draft_disabled. */
    requireEnabled(): void;
    parentView(cand: any): {
        id: any;
        draftLabel: any;
        wordCount: number;
        note: any;
        preview: string;
    };
    /**
     * Positive merge brief — keep plot/pressure, pick best voice edges, one continuous chapter.
     * No 不要xx stacks.
     */
    formatUnifyBrief(input: any): string;
    afterUnifyStageLines(opts: any): string[];
};
