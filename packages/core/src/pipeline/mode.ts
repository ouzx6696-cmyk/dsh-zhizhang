import type { ToolDefinition } from "../tool/define.js";
import type { Role } from "../tool/roles.js";
import type { PipelineDefinition } from "./stage.js";

export interface ModeTarget {
  mode: string;
  path: string;
  subId?: string;
}

/**
 * 一种写作模式对组合根暴露的能力：流水线表、助手工具与默认方法方案。
 * 写作区命令按 WorkbenchCommandMap 由组合根分派（命令契约在 workbench 层）。
 */
export interface ModeModule<M extends string = string> {
  mode: M;
  pipelines: Record<string, PipelineDefinition<unknown, unknown>>;
  tools(role: Role, target: ModeTarget): ToolDefinition[];
  profiles: { mode: M; defaultId: string };
}
