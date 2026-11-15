import path from "node:path";
import { Type } from "typebox";
import { localDay, rootIdentity, sha256 } from "@zhizhang/core";
import { AppError, classify, isAppError } from "@zhizhang/core/errors";
import {
  executeTool,
  type ToolCtx,
  type ToolDefinition as CoreToolDefinition,
  type ToolResult,
} from "@zhizhang/core/tool";
import type { SessionManager, ToolDefinition } from "./pi-adapter.js";
import type { Target } from "../shared/ipc.js";

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AppError("input.invalid", `${label}格式无效`);
  }
  return value as Record<string, unknown>;
}

function renderToolResult<V extends object>(
  def: CoreToolDefinition<unknown, V>,
  result: ToolResult<V>,
): string {
  if (!result.ok) {
    return `[${result.code}] ${result.message}`;
  }
  if (def.render) {
    return def.render(result);
  }
  return JSON.stringify(result);
}

export function createSessionTools(options: {
  target: Target;
  role: "writer" | "editor" | "planner";
  manager: SessionManager;
  definitions: CoreToolDefinition<unknown, object>[];
  readonly?: boolean;
  onResult?: (name: string, result: ToolResult<object>) => void;
}): ToolDefinition[] {
  const { target, definitions, readonly = false, onResult } = options;

  return definitions.map((def) => ({
    name: def.name,
    label: def.name,
    description: def.description,
    parameters: Type.Unsafe<Record<string, unknown>>(def.jsonSchema),
    execute: async (_callId, raw, signal) => {
      signal?.throwIfAborted();
      const args = asRecord(raw, "工具参数");

      if (
        args.working_dir &&
        rootIdentity(path.resolve(target.path, String(args.working_dir))) !==
          rootIdentity(target.path)
      ) {
        const failed: ToolResult<object> = {
          ok: false,
          code: "input.invalid",
          message: "本次任务不能切换项目目录",
        };
        return {
          content: [{ type: "text", text: renderToolResult(def, failed) }],
          details: { toolResult: failed },
        };
      }

      const ctx: ToolCtx = {
        workspaceRoot: target.path,
        readonly,
        signal,
      };

      let result: ToolResult<object>;
      try {
        result = await executeTool(def, args, ctx);
      } catch (err) {
        const appErr = isAppError(err) ? err : classify(err);
        if (appErr.spec.kind === "infra" || appErr.spec.kind === "bug") {
          throw appErr;
        }
        result = { ok: false, code: appErr.code, message: appErr.message };
      }

      onResult?.(def.name, result);

      return {
        content: [{ type: "text", text: renderToolResult(def, result) }],
        details: {
          toolResult: result,
          hash: sha256(JSON.stringify(result)),
        },
      };
    },
  }));
}

export function createRememberTool(options: {
  read: () => Promise<string>;
  save: (text: string) => Promise<void>;
}): ToolDefinition {
  const { read, save } = options;
  return {
    name: "writer_remember",
    label: "记住作者约束",
    description:
      "作者明确说“记住/以后都要/别再”这类跨任务的长期约束时，把约束原文追加进作者偏好，后续任务会自动带上。",
    parameters: Type.Object({ text: Type.String({ description: "作者约束原文" }) }),
    execute: async (_id, raw) => {
      const text = String(asRecord(raw, "约束参数").text ?? "").trim();
      if (!text) {
        const failed: ToolResult<object> = {
          ok: false,
          code: "input.invalid",
          message: "约束内容不能为空",
        };
        return {
          content: [{ type: "text", text: failed.message }],
          details: { toolResult: failed },
        };
      }
      if (Array.from(text).length > 500) {
        const failed: ToolResult<object> = {
          ok: false,
          code: "input.invalid",
          message: "作者约束请控制在 500 字以内",
        };
        return {
          content: [{ type: "text", text: failed.message }],
          details: { toolResult: failed },
        };
      }
      const previous = (await read()).replace(/\n+$/, "");
      const line = `- ${localDay()} ${text}`;
      await save(previous ? `${previous}\n${line}\n` : `${line}\n`);
      const okResult: ToolResult<{ saved: string }> = { ok: true, saved: line };
      return {
        content: [
          { type: "text", text: `已记住作者约束并写入作者偏好，后续任务会自动带上：${text}` },
        ],
        details: { toolResult: okResult },
      };
    },
  };
}
