/** 设定集与待确认命令组；A-02 保留既有读写，新命令为 D-02 占位。 */
import { AppError } from "@zhizhang/core/errors";
import { arr, bool, int, lit, obj, opt, str, type Parser } from "@zhizhang/core/schema";
import { commands as fanqie } from "@zhizhang/fanqie";
import {
  AnyOpSchema,
  BibleIndexFilesSchema,
  BibleOpSchema,
  EntityKindSchema,
  FacetSchema,
} from "@zhizhang/fanqie/bible";
import { ProvenanceSchema } from "@zhizhang/fanqie/outline";
import type { Entity, PendingItem, StateEntry } from "@zhizhang/fanqie/bible";
import type { Provenance } from "@zhizhang/fanqie/outline";
import type { CommandInput, CommandResult, WorkbenchCommand } from "@zhizhang/workbench/contract";
import type { CommandCtx } from "./commands.js";
import { commandId, notImplemented, numberPair, page, workPath } from "./commands-shared.js";

type Group<P extends string> = Extract<WorkbenchCommand, `${P}.${string}`>;
type Handler<K extends WorkbenchCommand> = (
  input: CommandInput<K>,
  ctx: CommandCtx,
) => Promise<CommandResult<K>>;

const bibleFilter: Parser<EmbeddedFilter> = obj({
  kind: opt(EntityKindSchema),
  facet: opt(FacetSchema),
  source: opt(lit("author", "plan", "import", "ledger", "assistant")),
  status: opt(lit("planned", "confirmed")),
  conflict: opt(bool),
  stale: opt(bool),
  appearIn: opt(numberPair),
  q: opt(str({ max: 200 })),
});

interface EmbeddedFilter {
  kind?: Entity["kind"];
  facet?: StateEntry["facet"];
  source?: Provenance["source"];
  status?: StateEntry["status"];
  conflict?: boolean;
  stale?: boolean;
  appearIn?: [number, number];
  q?: string;
}

export const BIBLE_INPUTS: { [K in Group<"fanqie.bible">]: Parser<CommandInput<K>> } = {
  "fanqie.bible.get": obj({ work: workPath }),
  "fanqie.bible.query": obj({
    work: workPath,
    filter: bibleFilter,
    position: opt(int({ min: 1 })),
    page,
  }),
  "fanqie.bible.entity": obj({
    work: workPath,
    id: commandId,
    position: opt(int({ min: 1 })),
  }),
  "fanqie.bible.view": obj({ work: workPath, position: int({ min: 1 }) }),
  "fanqie.bible.propose": obj({
    work: workPath,
    ops: arr(BibleOpSchema, { max: 200 }),
    from: ProvenanceSchema,
  }),
  "fanqie.bible.apply": obj({
    work: workPath,
    ops: arr(BibleOpSchema, { max: 200 }),
    expectedRev: int({ min: 0 }),
  }),
  "fanqie.bible.changes": obj({
    work: workPath,
    before: opt(str({ max: 80 })),
    limit: opt(int({ min: 1, max: 100 })),
    source: opt(lit("author", "plan", "import", "ledger", "assistant")),
  }),
  "fanqie.bible.revert": obj({
    work: workPath,
    changeId: commandId,
    force: opt(bool),
  }),
  "fanqie.bible.audit": obj({ work: workPath, upTo: int({ min: 1 }) }),
};

export const BIBLE_HANDLERS: { [K in Group<"fanqie.bible">]: Handler<K> } = {
  async "fanqie.bible.get"(input, ctx) {
    return fanqie.readBible(ctx.inside(input.work), ctx.locks);
  },
  async "fanqie.bible.query"() {
    return notImplemented("D-02");
  },
  async "fanqie.bible.entity"() {
    return notImplemented("D-02");
  },
  async "fanqie.bible.view"(input, ctx) {
    return fanqie.viewBibleAt(ctx.inside(input.work), input.position, ctx.locks);
  },
  async "fanqie.bible.propose"(input, ctx) {
    return {
      items: await fanqie.proposeBibleOps(ctx.inside(input.work), input.ops, input.from, ctx.locks),
    };
  },
  async "fanqie.bible.apply"() {
    return notImplemented("D-02");
  },
  async "fanqie.bible.changes"() {
    return notImplemented("D-02");
  },
  async "fanqie.bible.revert"() {
    return notImplemented("D-02");
  },
  async "fanqie.bible.audit"(input, ctx) {
    return { findings: await fanqie.auditBible(ctx.inside(input.work), input.upTo, ctx.locks) };
  },
};

const pendingFilter: Parser<{
  change?: PendingItem["change"];
  decision?: PendingItem["decision"];
}> = obj({
  change: opt(lit("new", "update", "same", "conflict", "fulfill", "diverge")),
  decision: opt(lit("undecided", "accept", "reject", "edit")),
});

export const PENDING_INPUTS: {
  [K in Group<"fanqie.pending">]: Parser<CommandInput<K>>;
} = {
  "fanqie.pending.list": obj({
    work: workPath,
    source: opt(lit("import", "ledger", "plan", "assistant")),
    status: opt(lit("open", "partial", "closed")),
  }),
  "fanqie.pending.get": obj({
    work: workPath,
    batch: commandId,
    filter: opt(pendingFilter),
    page,
  }),
  "fanqie.pending.decide": obj({
    work: workPath,
    batch: commandId,
    decisions: arr(
      obj({
        id: commandId,
        decision: lit("accept", "reject", "edit"),
        edited: opt(AnyOpSchema),
        effectiveFrom: opt(int({ min: 0 })),
      }),
    ),
  }),
  "fanqie.pending.commit": obj({
    work: workPath,
    batch: commandId,
    expectedRevs: BibleIndexFilesSchema,
  }),
};

export const PENDING_HANDLERS: {
  [K in Group<"fanqie.pending">]: Handler<K>;
} = {
  async "fanqie.pending.list"(input, ctx) {
    const batches = await fanqie.listPendingBatches(ctx.inside(input.work), ctx.locks);
    return {
      batches: batches
        .filter((batch) => !input.source || batch.source === input.source)
        .filter((batch) => !input.status || batch.status === input.status)
        .map((batch) => ({ ...batch, items: batch.items.length })),
    };
  },
  async "fanqie.pending.get"(input, ctx) {
    const batch = await fanqie.readPendingBatch(ctx.inside(input.work), input.batch, ctx.locks);
    if (!batch) {
      throw new AppError("input.not_found", `未找到待确认批次：${input.batch}`, {
        batch: input.batch,
      });
    }
    const filtered = batch.items.filter(
      (item) =>
        (!input.filter?.change || item.change === input.filter.change) &&
        (!input.filter?.decision || item.decision === input.filter.decision),
    );
    const stats: Record<string, number> = {};
    for (const item of batch.items) {
      stats[`change:${item.change}`] = (stats[`change:${item.change}`] ?? 0) + 1;
      stats[`decision:${item.decision}`] = (stats[`decision:${item.decision}`] ?? 0) + 1;
    }
    return {
      items: filtered.slice(input.page.offset, input.page.offset + input.page.limit),
      total: filtered.length,
      stats,
    };
  },
  async "fanqie.pending.decide"(input, ctx) {
    const work = ctx.inside(input.work);
    let decided = 0;
    for (const decision of input.decisions) {
      if (decision.decision === "edit") {
        if (!decision.edited) {
          throw new AppError("input.invalid", "edit 必须提供 edited", { path: "decisions.edited" });
        }
        await fanqie.decideBiblePending(
          work,
          decision.id,
          { edit: BibleOpSchema(decision.edited, "$.decisions.edited") },
          ctx.locks,
        );
      } else {
        await fanqie.decideBiblePending(work, decision.id, decision.decision, ctx.locks);
      }
      decided += 1;
    }
    return { decided };
  },
  async "fanqie.pending.commit"() {
    return notImplemented("D-02");
  },
};
