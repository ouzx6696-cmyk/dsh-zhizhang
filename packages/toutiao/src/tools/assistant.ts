import { obj, str } from "@zhizhang/core/schema";
import { defineTool, type ToolDefinition } from "@zhizhang/core/tool";

export const toutiaoReadArticleTool = defineTool({
  name: "toutiao_read_article",
  description: "只读读取头条文章状态与来源登记",
  params: obj({ articleId: str({ min: 1 }) }),
  jsonSchema: {
    type: "object",
    properties: { articleId: { type: "string" } },
    required: ["articleId"],
  },
  roles: ["assistant"],
  async run(args) {
    return { articleId: args.articleId, status: "初稿待改" };
  },
});

export function toutiaoAssistantTools(): ToolDefinition[] {
  return [toutiaoReadArticleTool as ToolDefinition];
}
