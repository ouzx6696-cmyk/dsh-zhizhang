import path from "node:path";
import type { Clock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import type { LockService } from "@zhizhang/core/lock";
import type { CommandInput, CommandResult, WorkbenchCommand } from "@zhizhang/workbench/contract";
import type { WorkspaceRoots } from "../shared/views.js";
import type { ProfileDirs } from "./commands-profiles.js";
import type { WorkflowService } from "./workflow.js";

export interface CommandCtx {
  clock: Clock;
  locks: LockService;
  /** 把输入路径约束在写作文件夹内，返回规范化的绝对路径。 */
  inside(target: string): string;
  roots(): WorkspaceRoots;
  profiles: ProfileDirs;
  scriptsDir?: string;
  workflow: Pick<WorkflowService, "startAndWait">;
  log?(event: string, data: Record<string, unknown>): void;
}

export type CommandHandler<K extends WorkbenchCommand> = (
  input: CommandInput<K>,
  ctx: CommandCtx,
) => Promise<CommandResult<K>>;

export type CommandGroup<P extends string> = Extract<WorkbenchCommand, `${P}.${string}`>;

export function safeId(value: string, field: string): string {
  if (!/^[\w\u4e00-\u9fff-]{1,80}$/.test(value)) {
    throw new AppError("input.invalid", `${field} 只能包含字母、数字、汉字、下划线与连字符`, {
      field,
    });
  }
  return value;
}

/** 书名转目录名：去掉文件系统保留字符，保留汉字。 */
export function workDirName(title: string): string {
  const name = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "");
  if (!name) throw new AppError("input.invalid", "书名不能只包含特殊字符", { field: "title" });
  return name;
}

export function assertOutPath(outPath: string, ext: string): string {
  const resolved = path.resolve(outPath);
  if (!path.isAbsolute(outPath) || path.extname(resolved).toLowerCase() !== `.${ext}`) {
    throw new AppError("input.invalid", `导出路径须为 .${ext} 文件的绝对路径`, {
      field: "outPath",
    });
  }
  return resolved;
}
