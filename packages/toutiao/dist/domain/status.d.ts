export declare const ARTICLE_STATUSES: readonly ["初稿待改", "待验收", "已验收", "验收退回", "已交稿"];
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];
export declare const ARTICLE_TRANSITIONS: Record<ArticleStatus, readonly ArticleStatus[]>;
export declare const FIXED_DELIVERY_ENDING: "\u2014\u2014AI \u5230\u6B64\u6B62\u6B65\u3002\u662F\u5426\u91C7\u7528\u3001\u4F55\u65F6\u53D1\u5E03\u7531\u4F60\u51B3\u5B9A\u3002";
export declare function assertArticleTransition(from: ArticleStatus, to: ArticleStatus): void;
//# sourceMappingURL=status.d.ts.map