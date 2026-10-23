/** Canonical polish modes from the optimizer skill; default = polish-depolish. */
export declare const EDIT_MODE_IDS: string[];
export declare const EditPort: {
    id: string;
    version: string;
    defaultMode: string;
    skillDoc: string;
    listModes(): any[];
    normalizeMode(raw: string): string;
    modeInfo(mode: any): any;
    /**
     * Agent-facing edit brief — positive craft framing; hard ban-list stays short.
     * Model must NOT claim已定稿; user picks A/B/C after rewrite.
     * Depolish: keep breath & rough edges; forbid flattening for “去AI味”.
     */
    formatEditBrief(input?: any): string;
    /** Parse user/agent choice; null = unset (safety = B). */
    resolveChoice(raw: string): "A" | "B" | "C" | null;
    choiceMenuLine(): string;
    /**
     * Soft hints after edit_stage — surface uniform_short_run etc. without blocking.
     */
    softHintLines(hits: any): string[];
    /** Receipt lines right after edit_stage (never accept here). */
    afterStageLines(opts: any): string[];
    /**
     * Accept-path flags for A.
     * - acceptAfterEdit without confirm → hard deny (never silent A)
     * - acceptAfterEdit + confirm but candidate not an edit → deny
     * - no acceptAfterEdit → allow (normal / B accept)
     */
    evaluateAcceptFlags(input: any): {
        ok: boolean;
        messages: any;
    };
    /** Receipt extras when A succeeded. */
    acceptPathAReceiptLines(): string[];
    decideChoiceLines(choice: any, opts: any): string[];
};
