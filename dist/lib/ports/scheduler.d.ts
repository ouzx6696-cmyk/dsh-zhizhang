export type RouteKind = "default" | "bypass";
export interface BypassRoute {
    id: string;
    title: string;
    /** When agent may enter this path. */
    when: string;
    /** Tools or flags involved. */
    via: string;
}
/** Canonical default loop — same semantics as CREATIVE_LOOP_LINE; keep in sync via ProductMap. */
export declare const SCHEDULER_DEFAULT_LINE = "\u4E66\u8FDB\u5E93\uFF08craft|mind\uFF09\u2192 library_combo_suggest\uFF081 mind + N craft\uFF0C\u53EF\u8DE8\u4E66\uFF09\u2192 inspire \u843D\u6839\u57FA/\u7EB2 \u2192 chapter_brief(lean\uFF0C\u53EA\u5403 craft\uFF09\u2192 candidate_stage \u2192 style_lint \u2192\uFF08\u53EF\u9009 edit\uFF09\u2192 candidate_accept";
/** Writing segment only (after foundation/outline ready). */
export declare const SCHEDULER_WRITE_LINE = "chapter_brief(lean) \u2192 \u521B\u4F5C \u2192 candidate_stage \u2192 style_lint \u2192\uFF08\u53EF\u9009 edit\uFF09\u2192 candidate_accept";
/** Library segment. */
export declare const SCHEDULER_LIBRARY_LINE = "library_import \u2192 dissect_brief \u2192 card_stage \u2192 card_accept \u2192 combo_suggest";
/** Inspiration segment. */
export declare const SCHEDULER_INSPIRE_LINE = "inspire_start(card_ids) \u2192 forge_brief \u2192 stage \u2192 accept(apply=true)";
export declare const SCHEDULER_BYPASSES: readonly BypassRoute[];
/** Next-step hints keyed by just-finished tool family (for receipts). */
declare const NEXT_HINTS: Record<string, string>;
export declare const Scheduler: {
    id: "port.scheduler";
    version: string;
    defaultLine(): string;
    writeLine(): string;
    libraryLine(): string;
    inspireLine(): string;
    bypasses(): readonly BypassRoute[];
    /** Receipt / status next-step; unknown keys fall back to write line. */
    nextHint(after: keyof typeof NEXT_HINTS | string): string;
    /** Panel / status default-route lines — single source; audits never listed as default. */
    panelRouteHints(): string[];
    formatDiagram(): string;
    formatForAgent(): string;
};
export {};
