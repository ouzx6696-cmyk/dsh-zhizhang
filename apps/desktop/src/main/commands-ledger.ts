/** 体检命令与定稿后的记账触发。 */
import { int, obj, type Parser } from "@zhizhang/core/schema";
import type { CommandInput, CommandResult, WorkbenchCommand } from "@zhizhang/workbench/contract";
import type { CommandCtx } from "./commands.js";
import { auditWork } from "@zhizhang/fanqie/bible";
import { commands as fanqie } from "@zhizhang/fanqie";
import { workPath } from "./commands-shared.js";

type Group<P extends string> = Extract<WorkbenchCommand, `${P}.${string}`>;
type Handler<K extends WorkbenchCommand> = (
  input: CommandInput<K>,
  ctx: CommandCtx,
) => Promise<CommandResult<K>>;

export const CHECK_INPUTS: { [K in Group<"fanqie.check">]: Parser<CommandInput<K>> } = {
  "fanqie.check.run": obj({ work: workPath, upTo: int({ min: 1 }) }),
};

export const CHECK_HANDLERS: { [K in Group<"fanqie.check">]: Handler<K> } = {
  async "fanqie.check.run"(input, ctx) {
    return auditWork(ctx.inside(input.work), input.upTo);
  },
};

/** 自动记账只生成提案，由作者统一提交。 */
export async function afterFinalize(
  ctx: CommandCtx,
  work: string,
  chapterId: string,
): Promise<void> {
  const meta = await fanqie.getWork(work);
  if ((meta.settings.ledger ?? "auto") !== "auto") return;
  const enqueue = ctx.workflow.enqueueAndWait ?? ctx.workflow.startAndWait;
  void enqueue
    .call(ctx.workflow, { mode: "fanqie", path: work }, "fanqie.ledger", {
      chapterId,
      trigger: "auto",
    })
    .catch((error: unknown) =>
      ctx.log?.("ledger_auto_failed", {
        chapterId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
}
