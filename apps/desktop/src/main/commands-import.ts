/** 导入命令组（A-02 占位，实现在 I-01 → I-04）。 */
import { arr, bool, int, lit, obj, opt, str, type Parser } from "@zhizhang/core/schema";
import { TextEncodingSchema } from "@zhizhang/core/text";
import { SectionKindSchema } from "@zhizhang/fanqie/import";
import type { PendingItem } from "@zhizhang/fanqie/bible";
import type { SegmentRules } from "@zhizhang/core/text";
import type { CommandInput, CommandResult, WorkbenchCommand } from "@zhizhang/workbench/contract";
import type { CommandCtx } from "./commands.js";
import { commandId, notImplemented, page, workPath } from "./commands-shared.js";

type Group<P extends string> = Extract<WorkbenchCommand, `${P}.${string}`>;
type Handler<K extends WorkbenchCommand> = (
  input: CommandInput<K>,
  ctx: CommandCtx,
) => Promise<CommandResult<K>>;

const SegmentRulesSchema: Parser<SegmentRules> = obj({
  volume: opt(arr(str({ max: 200 }), { max: 50 })),
  act: opt(arr(str({ max: 200 }), { max: 50 })),
  chapter: opt(arr(str({ max: 200 }), { max: 50 })),
  ignore: opt(arr(str({ max: 200 }), { max: 50 })),
});

const proposalFilter: Parser<{
  change?: PendingItem["change"];
  decision?: PendingItem["decision"];
}> = obj({
  change: opt(lit("new", "update", "same", "conflict", "fulfill", "diverge")),
  decision: opt(lit("undecided", "accept", "reject", "edit")),
});

export const IMPORT_INPUTS: { [K in Group<"fanqie.import">]: Parser<CommandInput<K>> } = {
  "fanqie.import.stage": obj({
    work: workPath,
    token: str({ min: 1, max: 200 }),
    rules: opt(SegmentRulesSchema),
  }),
  "fanqie.import.resegment": obj({
    work: workPath,
    batch: commandId,
    rules: SegmentRulesSchema,
    encoding: opt(TextEncodingSchema),
  }),
  "fanqie.import.select": obj({
    work: workPath,
    batch: commandId,
    sections: arr(
      obj({
        id: str({ min: 1, max: 60 }),
        selected: bool,
        kind: opt(SectionKindSchema),
      }),
    ),
  }),
  "fanqie.import.proposal": obj({
    work: workPath,
    batch: commandId,
    filter: opt(proposalFilter),
    page,
  }),
  "fanqie.import.source": obj({
    work: workPath,
    batch: commandId,
    section: str({ min: 1, max: 60 }),
    around: opt(str({ max: 80 })),
  }),
  "fanqie.import.list": obj({ work: workPath }),
  "fanqie.import.finish": obj({ work: workPath, batch: commandId }),
  "fanqie.import.revert": obj({
    work: workPath,
    batch: commandId,
    force: opt(bool),
  }),
  "fanqie.import.retryChunks": obj({
    work: workPath,
    batch: commandId,
    chunks: arr(int({ min: 0 })),
  }),
};

export const IMPORT_HANDLERS: { [K in Group<"fanqie.import">]: Handler<K> } = {
  async "fanqie.import.stage"() {
    return notImplemented("I-01");
  },
  async "fanqie.import.resegment"() {
    return notImplemented("I-01");
  },
  async "fanqie.import.select"() {
    return notImplemented("I-01");
  },
  async "fanqie.import.proposal"() {
    return notImplemented("I-03");
  },
  async "fanqie.import.source"() {
    return notImplemented("I-03");
  },
  async "fanqie.import.list"() {
    return notImplemented("I-01");
  },
  async "fanqie.import.finish"() {
    return notImplemented("I-03");
  },
  async "fanqie.import.revert"() {
    return notImplemented("I-03");
  },
  async "fanqie.import.retryChunks"() {
    return notImplemented("I-04");
  },
};
