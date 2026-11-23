/**
 * WorkbenchCommand 分派：44 条命令一一对应（编译期由映射类型检查齐全）。
 * 输入先经 COMMAND_INPUTS 解析；所有路径必须位于写作文件夹内；
 * 领域写入逻辑统一下沉至 @zhizhang/fanqie 与 @zhizhang/toutiao 命令层。
 */
import { AppError } from "@zhizhang/core/errors";
import type { Parser } from "@zhizhang/core/schema";
import type { CommandInput, CommandResult, WorkbenchCommand } from "@zhizhang/workbench/contract";
import type { WorkbenchCall } from "../shared/ipc.js";
import { FANQIE_HANDLERS, LIBRARY_HANDLERS } from "./commands-fanqie.js";
import { COMMAND_INPUTS } from "./commands-inputs.js";
import { PROFILE_HANDLERS } from "./commands-profiles.js";
import type { CommandCtx, CommandGroup, CommandHandler } from "./commands-shared.js";
import { TOUTIAO_HANDLERS } from "./commands-toutiao.js";

export type { CommandCtx } from "./commands-shared.js";

const PROFILES: { [K in CommandGroup<"profiles">]: CommandHandler<K> } = {
  "profiles.list": (input, ctx) =>
    PROFILE_HANDLERS["profiles.list"](input, ctx.profiles, ctx.clock.now),
  "profiles.detail": (input, ctx) =>
    PROFILE_HANDLERS["profiles.detail"](input, ctx.profiles, ctx.clock.now),
  "profiles.method": (input, ctx) =>
    PROFILE_HANDLERS["profiles.method"](input, ctx.profiles, ctx.clock.now),
  "profiles.use": (input, ctx) =>
    PROFILE_HANDLERS["profiles.use"](input, ctx.profiles, ctx.clock.now),
  "profiles.create": (input, ctx) =>
    PROFILE_HANDLERS["profiles.create"](input, ctx.profiles, ctx.clock.now),
  "profiles.save": (input, ctx) =>
    PROFILE_HANDLERS["profiles.save"](input, ctx.profiles, ctx.clock.now),
  "profiles.reset": (input, ctx) =>
    PROFILE_HANDLERS["profiles.reset"](input, ctx.profiles, ctx.clock.now),
  "profiles.rename": (input, ctx) =>
    PROFILE_HANDLERS["profiles.rename"](input, ctx.profiles, ctx.clock.now),
  "profiles.delete": (input, ctx) =>
    PROFILE_HANDLERS["profiles.delete"](input, ctx.profiles, ctx.clock.now),
};

const HANDLERS: { [K in WorkbenchCommand]: CommandHandler<K> } = {
  ...FANQIE_HANDLERS,
  ...TOUTIAO_HANDLERS,
  ...PROFILES,
  ...LIBRARY_HANDLERS,
};

/** 已知命令 id 的运行时判定（IPC 边界解析用）。 */
export function isWorkbenchCommand(value: unknown): value is WorkbenchCommand {
  return typeof value === "string" && Object.hasOwn(HANDLERS, value);
}

async function run<K extends WorkbenchCommand>(
  command: K,
  raw: unknown,
  ctx: CommandCtx,
): Promise<CommandResult<K>> {
  const parse: Parser<CommandInput<K>> = COMMAND_INPUTS[command];
  const handler: CommandHandler<K> = HANDLERS[command];
  return handler(parse(raw, "$input"), ctx);
}

export async function dispatchWorkbenchCommand(
  call: WorkbenchCall,
  ctx: CommandCtx,
): Promise<CommandResult<WorkbenchCommand>> {
  if (!isWorkbenchCommand(call.command)) {
    throw new AppError("input.invalid", `未知命令：${String(call.command)}`, {
      command: String(call.command),
    });
  }
  return run(call.command, call.input, ctx);
}
