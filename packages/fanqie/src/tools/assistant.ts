import { obj, str } from "@zhizhang/core/schema";
import { defineTool, type ToolDefinition } from "@zhizhang/core/tool";

export const fanqieReadChapterTool = defineTool({
  name: "fanqie_read_chapter",
  description: "只读读取指定章节正文与状态",
  params: obj({ chapterId: str({ min: 1 }) }),
  jsonSchema: {
    type: "object",
    properties: { chapterId: { type: "string" } },
    required: ["chapterId"],
  },
  roles: ["assistant"],
  async run(args) {
    return { chapterId: args.chapterId, status: "drafted" };
  },
});

export function fanqieAssistantTools(): ToolDefinition[] {
  return [fanqieReadChapterTool as ToolDefinition];
}
