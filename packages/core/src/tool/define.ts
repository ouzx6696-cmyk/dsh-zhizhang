import type { Clock } from "../clock.js";
import type { ErrorCode } from "../errors/codes.js";
import type { LockService } from "../lock/service.js";
import type { ProfileRoots } from "../methods/profiles.js";
import { toJsonSchema, type JsonSchema, type Parser } from "../schema/parse.js";
import type { Role } from "./roles.js";

export type { JsonSchema };

/**
 * 宿主为助手工具提供的能力：工具只能发起流水线或请求界面跳转，不能直接写正文。
 * 流水线只把产物交付为候选稿/报告，采纳与否始终由作者决定。
 */
export interface ToolHost {
  startPipeline(kind: string, request: unknown): Promise<{ runId: string; kind: string }>;
  navigate(focus: Record<string, string>): void;
}

export interface ToolCtx {
  workspaceRoot: string;
  readonly: boolean;
  signal?: AbortSignal;
  profileRoots?: ProfileRoots;
  host?: ToolHost;
  lock?: LockService;
  clock?: Clock;
}

export interface ToolSpec<A, V extends object> {
  name: string;
  description: string;
  params: Parser<A>;
  jsonSchema?: JsonSchema;
  roles: readonly Role[];
  /** 标记为纯只读工具时，助手单轮可并发执行多个只读调用。 */
  readonly?: boolean;
  run(args: NoInfer<A>, ctx: ToolCtx): Promise<V>;
  render?(value: V): string;
}

export interface ToolDefinition<A = unknown, V extends object = object> extends Omit<
  ToolSpec<A, V>,
  "jsonSchema"
> {
  jsonSchema: JsonSchema;
}

export type ToolResult<V extends object = object> =
  ({ ok: true } & V) | { ok: false; code: ErrorCode; message: string };

export function defineTool<A, V extends object>(spec: ToolSpec<A, V>): ToolDefinition<A, V> {
  return {
    ...spec,
    jsonSchema: spec.jsonSchema ?? toJsonSchema(spec.params),
  };
}
