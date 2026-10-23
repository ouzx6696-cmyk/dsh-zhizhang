/** Canonical one-liner — identical to Scheduler.defaultLine(). */
export declare const CREATIVE_LOOP_LINE = "\u62C6\u4E66\uFF08\u4E8B\u5B9E\u2192\u805A\u5408\u2192\u6A21\u5757\uFF09\u2192 \u4E66\u8FDB\u5E93\uFF08book|scene\uFF09\u2192 library_combo_suggest\uFF081 book + N scene\uFF0C\u53EF\u8DE8\u4E66\uFF09\u2192 inspire \u843D\u6839\u57FA/\u7EB2 \u2192 chapter_brief(lean\uFF0C\u53EA\u5403 craft\uFF09\u2192 candidate_stage \u2192 style_lint \u2192\uFF08\u53EF\u9009 edit\uFF09\u2192 candidate_accept";
export declare const ProductMap: {
    id: string;
    version: string;
    /** 运行时由 index.js 注入真实工具数；文档/面板不再硬编码 47/51/52。 */
    setToolCount(n: number): number;
    toolCount(): number;
    loopLine(): string;
    pillars(): {
        id: string;
        title: string;
        status: string;
        summary: string;
        capabilities: {
            id: string;
            title: string;
            ready: boolean;
        }[];
        loopStage: number;
        handsOffTo: string;
    }[];
    methods(): {
        registry: string;
        count: number;
        briefDefaultIds: string[];
        note: string;
    };
    formatForAgent(): string;
};
