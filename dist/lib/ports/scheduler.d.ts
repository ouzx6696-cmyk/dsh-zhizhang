/** Canonical default loop — same semantics as CREATIVE_LOOP_LINE; keep in sync via ProductMap. */
export declare const SCHEDULER_DEFAULT_LINE = "\u6309\u6700\u7EC8\u4EA7\u7269\u8FDB\u5165\uFF1A\u7247\u6BB5\u5206\u6790\uFF08\u53EF\u4E0D\u5165\u5E93\uFF09\uFF5C\u89C4\u5212\uFF08\u53C2\u8003\u53EF\u9009\uFF09\uFF5C\u6B63\u6587\u5199\u4F5C\u6216\u4FEE\u8BA2\uFF1B\u5DF2\u6709\u4F9D\u636E\u76F4\u63A5\u590D\u7528\uFF0C\u4E0D\u81EA\u52A8\u8DE8\u9636\u6BB5";
/** Writing segment only (after foundation/outline ready). */
export declare const SCHEDULER_WRITE_LINE = "chapter_brief(lean) \u2192 \u521B\u4F5C\u4E0E\u56DE\u8BFB \u2192 candidate_stage \u2192 candidate_accept\uFF08\u5185\u7F6E\u626B\u63CF\uFF0C\u7F16\u8F91\u53EF\u9009\uFF1B\u91C7\u7EB3\u4E0D\u7B49\u4E8E\u5B9A\u7A3F\uFF09";
/** Library segment. */
export declare const SCHEDULER_LIBRARY_LINE = "library_import \u2192 library_plan\uFF08auto 10% / full \u987B\u540C\u610F\uFF09\u2192 dissect_brief(batch) \u2192 facts_stage\uFF08\u767D\u63CF\uFF09\u2192 structure_stage\uFF08\u5267\u60C5/\u8282\u594F/\u4EBA\u7269\uFF09\u2192 card_stage\uFF08v2 \u6A21\u5757\uFF09\u2192 card_accept \u2192 report \u2192 combo_suggest";
/** Inspiration segment. */
export declare const SCHEDULER_INSPIRE_LINE = "inspire_start(goal\uFF0Ccard_ids \u53EF\u9009) \u2192 forge_brief \u2192 stage \u2192 accept(apply=true)";
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
    /**
     * 启用回执用的紧凑定向（约 0.5K 字符）。全图留在 zhizhang_product_map
     * 工具与常驻 SYSTEM_BRIEF 里——启用瞬间不再整页复述调度文本。
     */
    formatEnableSummary(): string;
};
