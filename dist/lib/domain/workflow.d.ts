/**
 * 工作流 — 全插件唯一来源。
 * SYSTEM_BRIEF / ProductMap / 工具 description / 回执 "N/9" / 文档都从这里读。
 */
export declare const STORY_PACES: readonly ["快爽", "稳推", "慢燃"];
export declare const AUTO_SAMPLE_HEAD = 10;
export declare const AUTO_SAMPLE_TAIL = 3;
export declare const AUTO_SAMPLE_RATIO = 0.1;
export declare const DISSECT_STEPS: WorkflowStep[];
export declare const WRITE_STEPS: WorkflowStep[];
export declare const DISSECT_STEP_COUNT: number;
export declare const WRITE_STEP_COUNT: number;
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
export declare const WORKFLOWS: Record<string, Workflow>;
/** 回执/描述里的 "N/9"；未知 kind 返回空串。 */
export declare function stepLabel(kind: string, n: number): string;
/** 工具 description 的 "【拆书 4/9 事实层】" 前缀。 */
export declare function stepPrefix(kind: string, n: number, label: string): string;
