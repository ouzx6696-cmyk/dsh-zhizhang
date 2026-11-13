import { COMMANDS, sendError } from "../../../workbench/src/commands.js";
import type { ToutiaoConfig } from "../env.js";
import { str } from "../../../core/src/parse.js";
import { adopt, articleDetail, listArticles, saveAuthorDraft, TOUTIAO_ACTIONS } from "./data.js";

export type ToutiaoCommand =
  | typeof COMMANDS.articles
  | typeof COMMANDS.article
  | typeof COMMANDS.adoptArticle
  | typeof COMMANDS.saveArticle;

export function isToutiaoCommand(operation: string): operation is ToutiaoCommand {
  return [COMMANDS.articles, COMMANDS.article, COMMANDS.adoptArticle, COMMANDS.saveArticle].some(
    (name) => name === operation,
  );
}

/** Desktop commands share the same author actions as the writer tools. */
export async function runToutiaoCommand(
  operation: ToutiaoCommand,
  input: Record<string, unknown>,
  config: ToutiaoConfig,
  canDeliver: boolean,
): Promise<{ data: unknown }> {
  try {
    if (operation === COMMANDS.articles) {
      return {
        data: {
          ok: true,
          ...(await listArticles()),
          actions: [...TOUTIAO_ACTIONS],
          deliver: canDeliver,
          deliverReason: canDeliver ? undefined : "请先保存模型连接",
        },
      };
    }
    const root = str(input.root),
      id = str(input.id);
    if (operation === COMMANDS.article) {
      if (!root || !id)
        return {
          data: { ok: false, code: "bad_request", error: "须指明 root 与 id" },
        };
      return { data: { ok: true, article: await articleDetail(root, id) } };
    }
    const sha256 = typeof input.expectedSha256 === "string" ? input.expectedSha256 : "";
    const valid =
      root &&
      id &&
      Number.isInteger(input.expectedRev) &&
      Number(input.expectedRev) >= 1 &&
      /^[a-f0-9]{64}$/.test(sha256);
    if (operation === COMMANDS.adoptArticle) {
      if (!valid || input.confirm !== true)
        return {
          data: {
            ok: false,
            code: "bad_args",
            error: "须明确确认、数据目录、文章及实际已读版本。",
          },
        };
      const meta = await adopt(root, id, { rev: Number(input.expectedRev), sha256 }, config);
      return { data: { ok: true, id: meta.id, status: meta.status } };
    }
    const text = typeof input.text === "string" ? input.text : "";
    if (!valid || !text.trim())
      return {
        data: {
          ok: false,
          code: "bad_args",
          error: "须指明数据目录、文章、非空正文及实际已读版本。",
        },
      };
    const saved = await saveAuthorDraft(
      root,
      id,
      text,
      { rev: Number(input.expectedRev), sha256 },
      config,
    );
    return { data: { ok: true, id, ...saved } };
  } catch (error) {
    let result: { data: unknown } = { data: {} };
    sendError({ reply: (data) => (result = { data }) }, error);
    return result;
  }
}
