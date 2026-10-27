/**
 * 卡 schema — v2 模块字段、校验、v1→v2 适配视图。
 *
 * 下游（格式化 / 审计 / 报告 / 覆盖率 / 灵感注入）只应看到 v2 视图；
 * v1 旧卡在边界处由 toCardView() 补齐字段并标记 legacy，不再到处写
 * `schemaVersion === 2 || layer` 的分支。
 */
export declare const LAYERS: string[];
export declare const DIMENSIONS: string[];
export declare const HOOK_TYPES: string[];
export declare const HOOK_STRENGTHS: string[];
/** v2 模块必填/可选字段的单一描述（校验、文档、工具 schema 都从这里读）。 */
export declare const CARD_V2_FIELDS: ({
    key: string;
    label: string;
    type: string;
    required: boolean;
    min?: undefined;
} | {
    key: string;
    label: string;
    type: string;
    required: boolean;
    min: number;
})[];
/** 动态 JSON 卡（v1/v2 混用），字段逐个校验，所以用宽松记录类型。 */
export type AnyRecord = Record<string, any>;
export declare function deriveAxis(layer: string, dimension: string): "mind" | "craft";
/** v2 模块校验；v1 卡不走这里（用 toCardView 适配后再校验会缺 evidence）。 */
export declare function validateModule(card: AnyRecord): {
    errors: string[];
    warnings: string[];
};
/** 是否 v2 模块（显式 layer/dimension 或 schemaVersion 2）。 */
export declare function isV2Card(card: AnyRecord | null | undefined): boolean;
/**
 * v1→v2 适配视图。下游只读这个视图；原卡不变。
 * v1 没有 layer/dimension/evidence，按 axis/kind 推断一个最保守的层与维度，
 * 并标 legacy=true；报告/审计必须显式提示「旧卡」。
 */
export declare function toCardView(card: AnyRecord | null | undefined): {
    legacy: boolean;
} | {
    schemaVersion: number;
    layer: string;
    dimension: string;
    axis: string;
    readerWant: string;
    emotionArc: string;
    dramaticUnit: string;
    replaceables: any[];
    mustNotCopy: any[];
    transfer: string;
    failWhen: string;
    evidence: any[];
    steps: any[];
    bannedDiction: any[];
    mechanisms: any[];
    legacy: boolean;
};
