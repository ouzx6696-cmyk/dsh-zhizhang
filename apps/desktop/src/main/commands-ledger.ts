/** 体检与记账接线；A-02 只提供 finalize 后的空钩子与命令占位。 */
import { int, obj, type Parser } from "@zhizhang/core/schema";
import type { CommandInput, CommandResult, WorkbenchCommand } from "@zhizhang/workbench/contract";
import type { CommandCtx } from "./commands.js";
import { notImplemented, workPath } from "./commands-shared.js";

type Group<P extends string> = Extract<WorkbenchCommand, `${P}.${string}`>;
type Handler<K extends WorkbenchCommand> = (
  input: CommandInput<K>,
  ctx: CommandCtx,
) => Promise<CommandResult<K>>;

export const CHECK_INPUTS: { [K in Group<"fanqie.check">]: Parser<CommandInput<K>> } = {
  "fanqie.check.run": obj({ work: workPath, upTo: int({ min: 1 }) }),
};

export const CHECK_HANDLERS: { [K in Group<"fanqie.check">]: Handler<K> } = {
  async "fanqie.check.run"() {
    return notImplemented("L-02");
  },
};

/** 定稿后的自动记账入口（F4 §2）：L-01 接管前保持无行为。 */
export async function afterFinalize(
  _ctx: CommandCtx,
  _work: string,
  _chapterId: string,
): Promise<void> {
  // L-01：按 settings.ledger 决定 auto / ask / off。
}
