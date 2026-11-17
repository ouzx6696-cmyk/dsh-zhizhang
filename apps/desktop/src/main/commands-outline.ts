/** 大纲命令组（A-02 只冻结输入契约与分组，实现在 D-01 / D-03）。 */
import { arr, int, obj, str, type Parser } from "@zhizhang/core/schema";
import type { OutlineOp } from "@zhizhang/fanqie/outline";
import { OutlineOpSchema } from "@zhizhang/fanqie/outline";
import type { CommandInput, CommandResult, WorkbenchCommand } from "@zhizhang/workbench/contract";
import type { CommandCtx } from "./commands.js";
import { commandId, notImplemented, workPath } from "./commands-shared.js";

type Group<P extends string> = Extract<WorkbenchCommand, `${P}.${string}`>;
type Handler<K extends WorkbenchCommand> = (
  input: CommandInput<K>,
  ctx: CommandCtx,
) => Promise<CommandResult<K>>;

const outlineOps: Parser<OutlineOp[]> = arr(OutlineOpSchema, { max: 50 });

export const OUTLINE_INPUTS: {
  [K in Group<"fanqie.outline"> | "fanqie.chapter.createFromPlan"]: Parser<CommandInput<K>>;
} = {
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
  async "fanqie.outline.get"() {
    return notImplemented("D-01");
  },
  async "fanqie.outline.apply"() {
    return notImplemented("D-01");
  },
  async "fanqie.outline.remapPreview"() {
    return notImplemented("D-03");
  },
  async "fanqie.outline.remapCommit"() {
    return notImplemented("D-03");
  },
  async "fanqie.chapter.createFromPlan"() {
    return notImplemented("D-03");
  },
};
