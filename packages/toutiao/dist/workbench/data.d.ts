import { type ArticleStatus } from "../domain/status.js";
import { type QaCheckResult, type RulesLimits } from "../rules/bridge.js";
import { type ArticleMeta } from "../storage/articles.js";
import type { ArticleRowView } from "../view/rows.js";
export declare const TOUTIAO_ACTIONS: readonly ["new", "continue", "review", "revise"];
export type ToutiaoAction = (typeof TOUTIAO_ACTIONS)[number];
export interface ToutiaoConfig {
    scriptsDir?: string;
    ledgerPath?: string;
    roots?: string[];
}
export interface ArticleRow extends ArticleRowView {
    root: string;
    rev: number;
    qa: {
        score: number;
        pass: boolean;
        current: boolean;
    } | null;
    delivered: boolean;
}
export declare function listArticles(roots: string[], config?: ToutiaoConfig): Promise<{
    roots: string[];
    statuses: ArticleStatus[];
    articles: ArticleRow[];
    limits?: RulesLimits;
    issues: Array<{
        root: string;
        id?: string;
        error: string;
    }>;
}>;
export declare function articleDetail(rootIn: string, id: string, config?: ToutiaoConfig): Promise<{
    root: string;
    id: string;
    title: string;
    status: "初稿待改" | "待验收" | "已验收" | "验收退回" | "已交稿";
    genre: string;
    driver: string;
    rulesVersion: string;
    card: {
        主问题: string | undefined;
        核心事实: string | undefined;
        读者: string | undefined;
        内容线: string | undefined;
        present: boolean;
    };
    draft: {
        name: string;
        sha256: string;
        text: string;
        truncated: boolean;
    } | null;
    qa: QaCheckResult | null;
    qaValid: boolean;
    qaProblem: string | undefined;
    delivery: string | null;
    history: {
        to: string;
        at: string;
    }[];
    adoptable: boolean;
    updatedAt: string;
}>;
export declare function saveAuthorDraft(rootIn: string, id: string, text: string, expected: {
    sha256?: string;
}, config?: ToutiaoConfig): Promise<{
    warning?: string | undefined;
    status: "初稿待改" | "待验收" | "已验收" | "验收退回" | "已交稿";
    chars: number;
    sha256: string;
}>;
export declare function articleManuscript(rootIn: string, id: string, config?: ToutiaoConfig): Promise<{
    title: string;
    text: string;
    qaValid: boolean;
}>;
export declare function adopt(rootIn: string, id: string, expected: {
    sha256: string;
}, config?: ToutiaoConfig): Promise<{
    meta: ArticleMeta;
    deliveryPath: string;
}>;
export declare function buildToutiaoDelivery(rootIn: string, input: {
    action: string;
    id?: string;
    note?: string;
}): Promise<{
    action: "review" | "revise" | "new" | "continue";
    id: string | undefined;
    text: string;
}>;
//# sourceMappingURL=data.d.ts.map