/** Canonical default loop — same semantics as CREATIVE_LOOP_LINE; keep in sync via ProductMap. */
export declare const SCHEDULER_DEFAULT_LINE = "\u62C6\u4E66\uFF08\u4E8B\u5B9E\u2192\u805A\u5408\u2192\u6A21\u5757\uFF09\u2192 \u4E66\u8FDB\u5E93\uFF08book|scene\uFF09\u2192 library_combo_suggest\uFF081 book + N scene\uFF0C\u53EF\u8DE8\u4E66\uFF09\u2192 inspire \u843D\u6839\u57FA/\u7EB2 \u2192 chapter_brief(lean\uFF0C\u53EA\u5403 craft\uFF09\u2192 candidate_stage \u2192 style_lint \u2192\uFF08\u53EF\u9009 edit\uFF09\u2192 candidate_accept";
/** Writing segment only (after foundation/outline ready). */
export declare const SCHEDULER_WRITE_LINE = "chapter_brief(lean) \u2192 \u521B\u4F5C \u2192 candidate_stage \u2192 style_lint \u2192\uFF08\u53EF\u9009 edit\uFF09\u2192 candidate_accept";
/** Library segment. */
export declare const SCHEDULER_LIBRARY_LINE = "library_import \u2192 library_plan\uFF08auto 10% / full \u987B\u540C\u610F\uFF09\u2192 dissect_brief(batch) \u2192 facts_stage\uFF08\u767D\u63CF\uFF09\u2192 structure_stage\uFF08\u5267\u60C5/\u8282\u594F/\u4EBA\u7269\uFF09\u2192 card_stage\uFF08v2 \u6A21\u5757\uFF09\u2192 card_accept \u2192 report \u2192 combo_suggest";
/** Inspiration segment. */
export declare const SCHEDULER_INSPIRE_LINE = "inspire_start(card_ids) \u2192 forge_brief \u2192 stage \u2192 accept(apply=true)";
export declare const SCHEDULER_BYPASSES: {
    id: string;
    title: string;
    when: string;
    via: string;
}[];
export declare const Scheduler: {
    id: string;
    version: string;
    defaultLine(): string;
    writeLine(): string;
    libraryLine(): string;
    inspireLine(): string;
    bypasses(): {
        id: string;
        title: string;
        when: string;
        via: string;
    }[];
    /** Receipt / status next-step; unknown keys fall back to write line. */
    nextHint(after: string): string;
    /** Panel / status default-route lines — single source; audits never listed as default. */
    panelRouteHints(): string[];
    formatDiagram(): string;
    formatForAgent(): string;
};
