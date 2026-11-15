import { type LockService } from "@zhizhang/core/lock";
import { type Infer } from "@zhizhang/core/schema";
import { type ArticleStatus } from "../domain/status.js";
import { type LedgerMutateResult } from "../rules/bridge.js";
import { type ArticleMeta } from "../storage/articles.js";
import type { ArticleRowView } from "../view/rows.js";
export declare const CreateArticleReq: import("@zhizhang/core/schema").Parser<{
    root: string;
    id: string | undefined;
    genre: string;
    driver: string;
    scriptsDir: string | undefined;
}>;
export declare const TransitionArticleReq: import("@zhizhang/core/schema").Parser<{
    articleDir: string;
    to: "初稿待改" | "待验收" | "已验收" | "验收退回" | "已交稿";
}>;
export declare const DeliverArticleReq: import("@zhizhang/core/schema").Parser<{
    articleDir: string;
    title: string;
    body: string;
    ledgerPath: string | undefined;
    cardPath: string | undefined;
    scriptsDir: string | undefined;
    date: string | undefined;
}>;
export declare const RegisterSourceReq: import("@zhizhang/core/schema").Parser<{
    articleDir: string;
    sourceId: string;
    kind: "paste" | "file" | "classic";
    content: string;
}>;
export type CreateArticleInput = Infer<typeof CreateArticleReq>;
export type TransitionArticleInput = Infer<typeof TransitionArticleReq>;
export type DeliverArticleInput = Infer<typeof DeliverArticleReq>;
export type RegisterSourceInput = Infer<typeof RegisterSourceReq>;
export declare function createArticleCommand(rawInput: unknown, lock?: LockService): Promise<{
    articleDir: string;
    meta: ArticleMeta;
}>;
export declare function transitionArticleCommand(rawInput: unknown, lock?: LockService): Promise<{
    status: ArticleStatus;
    meta: ArticleMeta;
}>;
export declare function deliverArticleCommand(rawInput: unknown, lock?: LockService): Promise<{
    deliveryPath: string;
    status: ArticleStatus;
    ledger?: LedgerMutateResult;
}>;
export declare function registerSourceCommand(rawInput: unknown, lock?: LockService): Promise<{
    sourceId: string;
}>;
export declare function listArticleRowsCommand(root: string): Promise<{
    rows: ArticleRowView[];
}>;
//# sourceMappingURL=article.d.ts.map