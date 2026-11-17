import { createBibleStore } from "@zhizhang/fanqie/bible";
/** 导入命令：暂存、选择、来源、确认与失败块恢复。 */
import { arr, bool, int, lit, obj, opt, str, type Parser } from "@zhizhang/core/schema";
import { TextEncodingSchema } from "@zhizhang/core/text";
import {
  createImportStore,
  readBatch,
  readSegments,
  readProposal,
  persistBatch,
  SectionKindSchema,
} from "@zhizhang/fanqie/import";
import type { PendingItem } from "@zhizhang/fanqie/bible";
import type { SegmentRules } from "@zhizhang/core/text";
import type { CommandInput, CommandResult, WorkbenchCommand } from "@zhizhang/workbench/contract";
import type { CommandCtx } from "./commands.js";
import { AppError } from "@zhizhang/core/errors";
import { commandId, page, workPath } from "./commands-shared.js";

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
  async "fanqie.import.stage"(input, ctx) {
    if (!ctx.takeImportToken)
      throw new AppError("input.invalid", "导入令牌不可用", { reason: "token_expired" });
    return createImportStore(ctx.locks, ctx.importBudget, () => ctx.clock.iso()).stage(
      ctx.inside(input.work),
      ctx.takeImportToken(input.token),
      input.rules,
    );
  },
  async "fanqie.import.resegment"(input, ctx) {
    return createImportStore(ctx.locks, ctx.importBudget).resegment(
      ctx.inside(input.work),
      input.batch,
      input.rules,
      input.encoding,
    );
  },
  async "fanqie.import.select"(input, ctx) {
    return createImportStore(ctx.locks, ctx.importBudget).select(
      ctx.inside(input.work),
      input.batch,
      input.sections,
    );
  },
  async "fanqie.import.proposal"(input, ctx) {
    const proposal = await readProposal(ctx.inside(input.work), input.batch);
    const batch = await createBibleStore(ctx.locks).readPendingBatch(
      ctx.inside(input.work),
      input.batch,
    );
    const items = (batch?.items ?? proposal.items).filter(
      (item) =>
        (!input.filter?.change || item.change === input.filter.change) &&
        (!input.filter?.decision || item.decision === input.filter.decision),
    );
    return {
      items: items.slice(input.page.offset, input.page.offset + input.page.limit),
      total: items.length,
      stats: proposal.stats,
    };
  },
  async "fanqie.import.source"(input, ctx) {
    const source = await readSegments(ctx.inside(input.work), input.batch),
      section = source.segments.find((section) => section.id === input.section);
    if (!section) throw new AppError("input.not_found", "分节不存在");
    return { text: source.text.slice(section.start, section.end), paras: section.paras };
  },
  async "fanqie.import.list"(input, ctx) {
    return { batches: await createImportStore(ctx.locks).list(ctx.inside(input.work)) };
  },
  async "fanqie.import.finish"(input, ctx) {
    const work = ctx.inside(input.work),
      view = await readBatch(work, input.batch);
    view.status = "closed";
    await persistBatch(work, input.batch, { "view.json": view }, ctx.locks);
    return { status: view.status };
  },
  async "fanqie.import.revert"(input, ctx) {
    const work = ctx.inside(input.work),
      store = createBibleStore(ctx.locks),
      batch = await store.readPendingBatch(work, input.batch);
    if (!batch) throw new AppError("input.not_found", "待确认批次不存在");
    const result: {
      changeIds: string[];
      skipped: Array<{ target: string; reason: "rev_changed" | "missing" }>;
    } = {
      changeIds: [],
      skipped: [],
    };
    for (const id of [...batch.commits].reverse()) {
      const reverted = await store.revert(work, id, input.force);
      result.changeIds.push(...reverted.changeIds);
      result.skipped.push(...reverted.skipped);
    }
    const view = await readBatch(work, input.batch);
    if (!result.skipped.length) view.status = "reverted";
    await persistBatch(work, input.batch, { "view.json": view }, ctx.locks);
    return result;
  },
  async "fanqie.import.retryChunks"(input, ctx) {
    const work = ctx.inside(input.work),
      view = await readBatch(work, input.batch);
    if (!input.chunks.length || input.chunks.some((index) => !view.failedChunks.includes(index)))
      throw new AppError("input.invalid", "只能重试失败块");
    if (!view.runId || !ctx.workflow.retryImport)
      throw new AppError("input.invalid", "导入运行记录不可用");
    const run = await ctx.workflow.retryImport(
      { target: { mode: "fanqie", path: work }, runId: view.runId },
      input.chunks,
    );
    return { runId: run.runId };
  },
};
