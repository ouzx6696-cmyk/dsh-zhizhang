import { classify, isAppError } from "@zhizhang/core/errors";
import { createArticleCommand, deliverArticleCommand, listArticleRowsCommand, transitionArticleCommand, } from "../commands/article.js";
const TOUTIAO_WORKBENCH_COMMANDS = [
    "toutiao.articles",
    "toutiao.article.create",
    "toutiao.article.transition",
    "toutiao.article.deliver",
];
export function isToutiaoCommand(operation) {
    return TOUTIAO_WORKBENCH_COMMANDS.includes(operation);
}
export async function runToutiaoCommand(operation, input) {
    try {
        if (operation === "toutiao.articles") {
            const req = input;
            const data = await listArticleRowsCommand(req.root);
            return { ok: true, data };
        }
        if (operation === "toutiao.article.create") {
            const req = input;
            const { articleDir } = await createArticleCommand(req);
            return { ok: true, data: { articleDir } };
        }
        if (operation === "toutiao.article.transition") {
            const req = input;
            const { status } = await transitionArticleCommand(req);
            return { ok: true, data: { status } };
        }
        const req = input;
        const { deliveryPath } = await deliverArticleCommand(req);
        return { ok: true, data: { deliveryPath } };
    }
    catch (err) {
        const appErr = isAppError(err) ? err : classify(err);
        return {
            ok: false,
            code: appErr.code,
            error: appErr.message,
        };
    }
}
