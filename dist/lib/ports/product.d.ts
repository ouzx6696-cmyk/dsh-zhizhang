export type PillarLiveStatus = "live" | "reserved";
export interface ProductPillarView {
    id: string;
    title: string;
    status: PillarLiveStatus;
    summary: string;
    capabilities: Array<{
        id: string;
        title: string;
        ready: boolean;
    }>;
    /** Stage in the single creative loop (1=库 2=灵感 3=写作). */
    loopStage: 1 | 2 | 3;
    /** What this stage hands to the next. */
    handsOffTo: string;
}
/** Canonical one-liner — identical to Scheduler.defaultLine(). */
export interface WorkflowStep {
    n: number;
    tool: string;
    do: string;
}
export interface Workflow {
    title: string;
    steps: WorkflowStep[];
    gate: string;
}
/** 显式工作流：照做，别跳步。 */
export declare const WORKFLOWS: {
    library: Workflow;
    writing: Workflow;
};
export declare const CREATIVE_LOOP_LINE = "\u4E66\u8FDB\u5E93\uFF08craft|mind\uFF09\u2192 library_combo_suggest\uFF081 mind + N craft\uFF0C\u53EF\u8DE8\u4E66\uFF09\u2192 inspire \u843D\u6839\u57FA/\u7EB2 \u2192 chapter_brief(lean\uFF0C\u53EA\u5403 craft\uFF09\u2192 candidate_stage \u2192 style_lint \u2192\uFF08\u53EF\u9009 edit\uFF09\u2192 candidate_accept";
export declare const ProductMap: {
    id: "port.product";
    version: string;
    loopLine(): string;
    pillars(): ProductPillarView[];
    methods(): {
        registry: string;
        count: number;
        briefDefaultIds: string[];
        note: string;
    };
    formatForAgent(): string;
};
