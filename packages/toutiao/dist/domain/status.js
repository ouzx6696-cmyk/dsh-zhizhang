import { AppError } from "@zhizhang/core/errors";
export const ARTICLE_STATUSES = [
    "初稿待改",
    "待验收",
    "已验收",
    "验收退回",
    "已交稿",
];
export const ARTICLE_TRANSITIONS = {
    初稿待改: ["待验收"],
    待验收: ["已验收", "验收退回", "初稿待改"],
    验收退回: ["初稿待改", "待验收"],
    已验收: ["已交稿"],
    已交稿: [],
};
export const FIXED_DELIVERY_ENDING = "——AI 到此止步。是否采用、何时发布由你决定。";
export function assertArticleTransition(from, to) {
    if (!ARTICLE_TRANSITIONS[from].includes(to)) {
        throw new AppError("gate.denied", `不允许从「${from}」直接流转到「${to}」`, {
            from,
            to,
        });
    }
}
