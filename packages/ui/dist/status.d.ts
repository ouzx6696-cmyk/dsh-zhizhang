export type StatusMode = "fanqie" | "toutiao";
type StatusTone = "neutral" | "info" | "warning" | "success" | "danger";
/** 业务状态词；界面判断“已交稿”时用这个常量，不读展示文案。 */
export declare const TOUTIAO_DELIVERED = "\u5DF2\u4EA4\u7A3F";
export declare function statusInfo(mode: StatusMode, status?: string): {
    label: string;
    tone: StatusTone;
    dot: string;
};
export declare const statusLabel: (mode: StatusMode, status?: string) => string;
export declare const statusTone: (mode: StatusMode, status?: string) => StatusTone;
export declare const ARTICLE_STEPS: string[];
export declare function articleProgress(article?: {
    status?: string;
    draft?: unknown;
    rev?: number;
    qa?: {
        pass?: boolean;
        rev?: number;
    }[];
    card?: {
        present?: boolean;
    };
} | null): 0 | 4 | 2 | 1 | 3 | 5;
export {};
//# sourceMappingURL=status.d.ts.map