import { AppError } from "@zhizhang/core/errors";
import { arr, int, lit, obj, opt, str, type Infer } from "@zhizhang/core/schema";
import {
  assertWorkspaceWritable,
  defineTool,
  type ToolCtx,
  type ToolDefinition,
} from "@zhizhang/core/tool";
import { readCandidate } from "../commands/candidate.js";
function requireHost(ctx: ToolCtx) {
  if (!ctx.host) {
    throw new AppError("gate.denied", "当前会话不能发起流水线");
  }
  return ctx.host;
}
const StartChapterArgs = obj({
  chapterId: str({ min: 1 }),
  note: opt(str({ max: 2000 })),
  grade: opt(lit("economy", "standard", "premium")),
});
const StartReviewArgs = obj({ chapterId: str({ min: 1 }), note: opt(str({ max: 2000 })) });
const StartReviseArgs = obj({
  chapterId: str({ min: 1 }),
  note: str({ min: 1, max: 2000 }),
  issues: opt(
    arr(
      obj({
        kind: lit("continuity", "reader"),
        quote: str(),
        issue: str({ min: 1 }),
        fix: str({ min: 1 }),
      }),
      { max: 20 },
    ),
  ),
});
const StartHealthArgs = obj({ upToChapter: int({ min: 1 }) });
const stringProp = (description: string) => ({ type: "string", description });
const intProp = (description: string) => ({ type: "integer", description });
export function startAssistantTools(work: string): ToolDefinition[] {
  const startChapterTool = defineTool({
    name: "fanqie_start_chapter",
    description: "发起章节流水线（起稿→择优→连续性检查→审读→修订），结果交付为候选稿，不改正文。",
    params: StartChapterArgs,
    jsonSchema: {
      type: "object",
      properties: {
        chapterId: stringProp("要写的章节 id"),
        note: stringProp("作者的写作要求"),
        grade: { type: "string", enum: ["economy", "standard", "premium"] },
      },
      required: ["chapterId"],
    },
    roles: ["assistant"],
    async run(args: Infer<typeof StartChapterArgs>, ctx: ToolCtx) {
      assertWorkspaceWritable(ctx.readonly);
      const request = {
        chapterId: args.chapterId,
        ...(args.note ? { note: args.note } : {}),
        ...(args.grade ? { grade: args.grade } : {}),
      };
      return requireHost(ctx).startPipeline("fanqie.chapter", request);
    },
  });
  const startReviewTool = defineTool({
    name: "fanqie_start_review",
    description: "派独立编辑审读指定章节（发起审读流水线），审读报告交付到候选目录。",
    params: StartReviewArgs,
    jsonSchema: {
      type: "object",
      properties: { chapterId: stringProp("章节 id"), note: stringProp("审读侧重点") },
      required: ["chapterId"],
    },
    roles: ["assistant"],
    async run(args: Infer<typeof StartReviewArgs>, ctx: ToolCtx) {
      assertWorkspaceWritable(ctx.readonly);
      return requireHost(ctx).startPipeline("fanqie.review", {
        chapterId: args.chapterId,
        ...(args.note ? { note: args.note } : {}),
      });
    },
  });
  const startReviseTool = defineTool({
    name: "fanqie_start_revise",
    description: "按作者意见发起定向修订流水线；修订稿交付为候选稿，由作者对照采纳。",
    params: StartReviseArgs,
    jsonSchema: {
      type: "object",
      properties: {
        chapterId: stringProp("章节 id"),
        note: stringProp("修改要求"),
        issues: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["continuity", "reader"] },
              quote: { type: "string" },
              issue: { type: "string" },
              fix: { type: "string" },
            },
            required: ["kind", "quote", "issue", "fix"],
          },
        },
      },
      required: ["chapterId", "note"],
    },
    roles: ["assistant"],
    async run(args: Infer<typeof StartReviseArgs>, ctx: ToolCtx) {
      assertWorkspaceWritable(ctx.readonly);
      return requireHost(ctx).startPipeline("fanqie.revise", {
        chapterId: args.chapterId,
        note: args.note,
        ...(args.issues ? { issues: args.issues } : {}),
      });
    },
  });
  const startHealthTool = defineTool({
    name: "fanqie_start_health",
    description: "发起全书体检流水线（截至第 N 章），报告写入 plan/health。",
    params: StartHealthArgs,
    jsonSchema: {
      type: "object",
      properties: { upToChapter: intProp("体检截至的章序号") },
      required: ["upToChapter"],
    },
    roles: ["assistant"],
    async run(args: Infer<typeof StartHealthArgs>, ctx: ToolCtx) {
      assertWorkspaceWritable(ctx.readonly);
      return requireHost(ctx).startPipeline("fanqie.health", { upToChapter: args.upToChapter });
    },
  });
  const openCompareTool = defineTool({
    name: "fanqie_open_compare",
    description: "在中栏打开正文与候选稿的对照视图，供作者决定是否采纳。",
    params: obj({ chapterId: str({ min: 1 }), candidateId: str({ min: 1 }) }),
    jsonSchema: {
      type: "object",
      properties: { chapterId: stringProp("章节 id"), candidateId: stringProp("候选 id") },
      required: ["chapterId", "candidateId"],
    },
    roles: ["assistant"],
    async run(args: { chapterId: string; candidateId: string }, ctx: ToolCtx) {
      await readCandidate(work, args.chapterId, args.candidateId);
      requireHost(ctx).navigate({
        chapter: args.chapterId,
        candidate: args.candidateId,
        source: "split",
      });
      return { opened: true };
    },
  });
  return [startChapterTool, startReviewTool, startReviseTool, startHealthTool, openCompareTool].map(
    (tool): ToolDefinition => tool,
  );
}
