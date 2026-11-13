import { Type } from "typebox";
import { parseWorkflowRequest } from "../../../../packages/core/src/workflow-config";
import type { WorkflowService } from "./service";
import type { Target } from "../context";
import type { AgentSession, ToolDefinition } from "../session/pi-adapter";
export function workflowTools(
  host: { workflows: Pick<WorkflowService, "start" | "status" | "stop"> },
  target: Target,
  getSession: () => AgentSession,
): ToolDefinition[] {
  const result = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    details: value,
  });
  return [
    {
      name: "writer_pipeline_start",
      label: "启动写作流水线",
      description: "用代码编排本书规划、当前章节或文章，从阶段边界保存进度；不替作者采纳或定稿。",
      parameters: Type.Object({
        kind: Type.Union([Type.Literal("book"), Type.Literal("chapter"), Type.Literal("article")]),
        chapter: Type.String(),
        instruction: Type.String(),
        source: Type.String(),
        line: Type.Union([Type.Literal("news"), Type.Literal("story"), Type.Literal("micro")]),
        grade: Type.Union([
          Type.Literal("economy"),
          Type.Literal("standard"),
          Type.Literal("premium"),
        ]),
      }),
      execute: async (_id, args) =>
        result(await host.workflows.start(target, parseWorkflowRequest(args), false, getSession())),
    },
    {
      name: "writer_pipeline_status",
      label: "读取流水线进度",
      description: "读取当前流水线阶段、候选和失败原因；运行中无需循环查询，界面会持续显示进度。",
      parameters: Type.Object({}),
      execute: async () => result((await host.workflows.status(target)) ?? { state: "尚未开始" }),
    },
    {
      name: "writer_pipeline_pause",
      label: "暂停流水线",
      description: "暂停当前流水线并保留已完成阶段。",
      parameters: Type.Object({}),
      execute: async () => {
        await host.workflows.stop(target);
        return result(await host.workflows.status(target));
      },
    },
  ];
}
