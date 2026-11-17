import { AppError } from "@zhizhang/core/errors";
/** 大纲命令组（A-02 只冻结输入契约与分组，实现在 D-01 / D-03）。 */
import { arr, int, obj, str, type Parser } from "@zhizhang/core/schema";
import type { OutlineOp } from "@zhizhang/fanqie/outline";
import {
  createOutlineStore,
  readOutline,
  nodesOf,
  OutlineOpSchema,
} from "@zhizhang/fanqie/outline";
import type { CommandInput, CommandResult, WorkbenchCommand } from "@zhizhang/workbench/contract";
import type { CommandCtx } from "./commands.js";
import { commandId, workPath } from "./commands-shared.js";

type Group<P extends string> = Extract<WorkbenchCommand, `${P}.${string}`>;
type Handler<K extends WorkbenchCommand> = (
  input: CommandInput<K>,
  ctx: CommandCtx,
) => Promise<CommandResult<K>>;

const outlineOps: Parser<OutlineOp[]> = arr(OutlineOpSchema, { max: 50 });

export const OUTLINE_INPUTS: {
  [K in Group<"fanqie.outline"> | "fanqie.chapter.createFromPlan"]: Parser<CommandInput<K>>;
} = {
  "fanqie.outline.node": obj({ work: workPath, id: commandId }),
  "fanqie.outline.get": obj({ work: workPath }),
  "fanqie.outline.apply": obj({
    work: workPath,
    ops: outlineOps,
    expectedRev: int({ min: 0 }),
  }),
  "fanqie.outline.remapPreview": obj({ work: workPath, ops: outlineOps }),
  "fanqie.outline.remapCommit": obj({
    work: workPath,
    token: str({ min: 1, max: 200 }),
    ops: outlineOps,
  }),
  "fanqie.chapter.createFromPlan": obj({ work: workPath, plan: commandId }),
};

export const OUTLINE_HANDLERS: {
  [K in Group<"fanqie.outline"> | "fanqie.chapter.createFromPlan"]: Handler<K>;
} = {
  async "fanqie.outline.node"(input, ctx) {
    const found = nodesOf(await readOutline(ctx.inside(input.work))).find(
      ({ node }) => node.id === input.id,
    );
    if (!found) throw new AppError("input.not_found", "大纲节点不存在");
    return found.node;
  },
  async "fanqie.outline.get"(input, ctx) {
    return createOutlineStore(ctx.locks).get(ctx.inside(input.work));
  },
  async "fanqie.outline.apply"(input, ctx) {
    return createOutlineStore(ctx.locks).apply(
      ctx.inside(input.work),
      input.ops,
      input.expectedRev,
    );
  },
  async "fanqie.outline.remapPreview"(input, ctx) {
    return createOutlineStore(ctx.locks).preview(ctx.inside(input.work), input.ops);
  },
  async "fanqie.outline.remapCommit"(input, ctx) {
    return createOutlineStore(ctx.locks).apply(
      ctx.inside(input.work),
      input.ops,
      undefined,
      input.token,
    );
  },
  async "fanqie.chapter.createFromPlan"(input, ctx) {
    return createOutlineStore(ctx.locks).createFromPlan(ctx.inside(input.work), input.plan);
  },
};
