import type { LockService } from "@zhizhang/core/lock";
import { type Infer } from "@zhizhang/core/schema";
import { type ArticleStatus } from "../domain/status.js";
export declare const ArticleMetaSchema: import("@zhizhang/core/schema").Parser<{
    format: "zhizhang/1.3";
    id: string;
    genre: string;
    driver: string;
    status: "初稿待改" | "待验收" | "已验收" | "验收退回" | "已交稿";
    chosenTitle: string | undefined;
    rulesVersion: string;
    history: {
        to: string;
        at: string;
    }[];
}>;
export type ArticleMeta = Infer<typeof ArticleMetaSchema>;
export declare function createArticle(articleDir: string, input: {
    id: string;
    genre: string;
    driver: string;
    rulesVersion: string;
    nowIso: string;
}, lock: LockService): Promise<ArticleMeta>;
export declare function registerSource(articleDir: string, sourceId: string, kind: "paste" | "file" | "classic", content: string, nowIso: string, lock: LockService): Promise<void>;
export declare function transitionArticleStatus(articleDir: string, to: ArticleStatus, nowIso: string, lock: LockService): Promise<ArticleMeta>;
export declare function writeDeliverySheet(articleDir: string, title: string, body: string, nowIso: string, lock: LockService): Promise<string>;
//# sourceMappingURL=articles.d.ts.map