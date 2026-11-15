import { classify, isAppError } from "@zhizhang/core/errors";
import type { WorkbenchCommand, WorkbenchCommandMap } from "@zhizhang/workbench/contract";
import {
  createArticleCommand,
  deliverArticleCommand,
  listArticleRowsCommand,
  transitionArticleCommand,
} from "../commands/article.js";

export type ToutiaoWorkbenchCommand = Extract<
  WorkbenchCommand,
  | "toutiao.articles"
  | "toutiao.article.create"
  | "toutiao.article.transition"
  | "toutiao.article.deliver"
>;

const TOUTIAO_WORKBENCH_COMMANDS: readonly ToutiaoWorkbenchCommand[] = [
  "toutiao.articles",
  "toutiao.article.create",
  "toutiao.article.transition",
  "toutiao.article.deliver",
];

export function isToutiaoCommand(operation: string): operation is ToutiaoWorkbenchCommand {
  return (TOUTIAO_WORKBENCH_COMMANDS as readonly string[]).includes(operation);
}

export async function runToutiaoCommand<K extends ToutiaoWorkbenchCommand>(
  operation: K,
  input: WorkbenchCommandMap[K]["input"],
): Promise<
  { ok: true; data: WorkbenchCommandMap[K]["result"] } | { ok: false; code: string; error: string }
> {
  try {
    if (operation === "toutiao.articles") {
      const req = input as WorkbenchCommandMap["toutiao.articles"]["input"];
      const data = await listArticleRowsCommand(req.root);
      return { ok: true, data };
    }
    if (operation === "toutiao.article.create") {
      const req = input as WorkbenchCommandMap["toutiao.article.create"]["input"];
      const { articleDir } = await createArticleCommand(req);
      return { ok: true, data: { articleDir } };
    }
    if (operation === "toutiao.article.transition") {
      const req = input as WorkbenchCommandMap["toutiao.article.transition"]["input"];
      const { status } = await transitionArticleCommand(req);
      return { ok: true, data: { status } };
    }
    const req = input as WorkbenchCommandMap["toutiao.article.deliver"]["input"];
    const { deliveryPath } = await deliverArticleCommand(req);
    return { ok: true, data: { deliveryPath } };
  } catch (err) {
    const appErr = isAppError(err) ? err : classify(err);
    return {
      ok: false,
      code: appErr.code,
      error: appErr.message,
    };
  }
}
