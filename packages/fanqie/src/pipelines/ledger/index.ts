import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, resolveResourcePath, readTextIfExists, sha256 } from "@zhizhang/core/fs";
import { createLockService } from "@zhizhang/core/lock";
import type {
  ContextPacket,
  DeliveryReceipt,
  PipelineDefinition,
  StageSpec,
} from "@zhizhang/core/pipeline";
import { buildDeliveryMarker, isAlreadyDelivered } from "@zhizhang/core/pipeline";
import { arr, int, lit, obj, opt, parseJson, str, type Infer } from "@zhizhang/core/schema";
import { createBibleStore, type ProposeOpMeta } from "../../bible/store.js";
import type { BibleOp, PendingItem, SettlementKind } from "../../bible/types.js";
import { parseChapterMarkdown } from "../../domain/chapter.js";

export const LedgerReq = obj({
  chapterId: str({ min: 1 }),
  position: opt(int({ min: 1 })),
});

export type LedgerInput = Infer<typeof LedgerReq>;

interface ExtractedDelta {
  quote: string;
  kind: "entity" | "state" | "thread" | "knowledge";
  targetId: string;
  name: string;
  detail: string;
  field?: string;
  value?: string;
  level?: "不知" | "怀疑" | "误认" | "知情" | "公开";
  settlement?: SettlementKind;
}

const ExtractedDeltaSchema = obj({
  deltas: arr(
    obj({
      quote: str({ min: 1 }),
      kind: lit("entity", "state", "thread", "knowledge"),
      targetId: str({ min: 1 }),
      name: str({ min: 1 }),
      detail: str({ min: 1 }),
      field: opt(str()),
      value: opt(str()),
      level: opt(lit("不知", "怀疑", "误认", "知情", "公开")),
      settlement: opt(lit("resolve_short_term", "settle_long_term", "update_profile")),
    }),
    { max: 40 },
  ),
});

export interface LedgerResult {
  chapterId: string;
  position: number;
  extractedCount: number;
  locatedCount: number;
  unlocatedCount: number;
  droppedCount: number;
  opsCount: number;
  pending: PendingItem[];
}

export const ledgerExtractStage: StageSpec<
  { chapterId: string; position: number; body: string },
  Infer<typeof ExtractedDeltaSchema>
> = {
  id: "extract",
  title: "抽取账本增量",
  role: "extractor",
  method: { stage: "fanqie.ledger.extract" },
  input: (ctx) => ({
    chapterId: String(ctx.state.chapterId ?? ""),
    position: Number(ctx.state.position ?? 1),
    body: String(ctx.state.chapterBody ?? ""),
  }),
  shape:
    'JSON 格式：{"deltas":[{"quote":"原文精确引文","kind":"entity|state|thread|knowledge","targetId":"实体ID","name":"名称或事实","detail":"说明","field":"状态字段","value":"状态值","level":"知情","settlement":"resolve_short_term|settle_long_term|update_profile"}]}',
  format: "json",
  parse: (raw) => parseJson(raw, ExtractedDeltaSchema, "ledger.extract"),
};

const UNLOCATED_TAG = "【待核对：原文未定位到引文】";

function deltaToBibleOp(
  delta: ExtractedDelta,
  position: number,
  runId: string,
  nowIso: string,
  isLocated: boolean,
): { op: BibleOp; meta: ProposeOpMeta } {
  const provenance = { source: "ledger" as const, run: runId, chapter: position, at: nowIso };
  const evidence = { chapter: position, quote: delta.quote, located: isLocated };
  const annotatedDetail = isLocated ? delta.detail : `${delta.detail} ${UNLOCATED_TAG}`;
  const meta: ProposeOpMeta = {
    evidence,
    located: isLocated,
    ...(delta.settlement ? { settlement: delta.settlement } : {}),
  };

  if (delta.kind === "entity") {
    return {
      op: {
        type: "entity.upsert",
        entity: {
          id: delta.targetId,
          kind: "character",
          name: delta.name,
          aliases: [],
          summary: annotatedDetail,
          locked: [],
          provenance,
        },
      },
      meta,
    };
  }
  if (delta.kind === "state") {
    return {
      op: {
        type: "state.add",
        entry: {
          id: `st-${delta.targetId}-${position}`,
          entity: delta.targetId,
          field: delta.field ?? "状态",
          value: isLocated
            ? (delta.value ?? delta.detail)
            : `${delta.value ?? delta.detail} ${UNLOCATED_TAG}`,
          since: position,
          mode: "replace",
          status: "planned",
          evidence,
          provenance,
        },
      },
      meta,
    };
  }
  if (delta.kind === "thread") {
    const resolved = delta.settlement === "resolve_short_term";
    return {
      op: {
        type: "thread.upsert",
        thread: {
          id: delta.targetId,
          title: delta.name,
          kind: "foreshadow",
          opened: position,
          beats: [
            {
              chapter: position,
              kind: resolved ? "pay" : "plant",
              note: annotatedDetail,
              evidence,
            },
          ],
          status: resolved ? "paid" : "open",
        },
      },
      meta,
    };
  }
  return {
    op: {
      type: "knowledge.set",
      row: {
        id: `kn-${delta.targetId}-${position}`,
        fact: annotatedDetail,
        holder: delta.name,
        level: delta.level ?? "知情",
        since: position,
        evidence,
      },
    },
    meta,
  };
}

export const ledgerPipeline: PipelineDefinition<LedgerInput, LedgerResult> = {
  kind: "fanqie.ledger",
  request: LedgerReq,
  async context(target, req, env) {
    const clock = env?.clock ?? systemClock;
    return {
      runId: `ledger-${clock.now()}`,
      target,
      request: req,
      state: {},
      clock,
      lock: env?.lock,
      budget: env?.budget,
    };
  },
  async run(runner, ctx) {
    const req = ctx.request;
    const clock = ctx.clock ?? systemClock;
    const lock = ctx.lock ?? createLockService(clock);
    const bibleStore = createBibleStore(lock, clock);

    const prepared = await runner.local("prepare", async () => {
      const chapterPath = resolveResourcePath(ctx.target.path, "chapters", `${req.chapterId}.md`);
      const raw = await readTextIfExists(chapterPath);
      if (!raw) {
        throw new AppError("input.not_found", `未找到章节文件：${req.chapterId}`, {
          chapterId: req.chapterId,
        });
      }
      const doc = parseChapterMarkdown(raw);
      const bible = await bibleStore.read(ctx.target.path);
      const existing = bible.chapters.find((c) => c.chapter === req.chapterId);
      const position = req.position ?? existing?.position ?? bible.chapters.length + 1;
      return { body: doc.body, title: doc.meta.title || req.chapterId, position };
    });

    ctx.state.chapterId = req.chapterId;
    ctx.state.position = prepared.position;
    ctx.state.chapterBody = prepared.body;

    const packet: ContextPacket = {
      prefix: [
        {
          id: "ledger-chapter",
          layer: 0,
          text: `# ${prepared.title}\n\n${prepared.body}`,
          required: true,
          tokens: Math.ceil(prepared.body.length / 2),
          reason: "记账目标章节正文",
          source: { kind: "chapter", ref: req.chapterId },
        },
      ],
      suffix: [],
      omitted: [],
      estimate: Math.ceil(prepared.body.length / 2),
    };

    // 1. extract
    const extracted = await runner.stage(ledgerExtractStage, packet);

    // 2. locate (verify every quote; keep unlocated items with located=false and annotation)
    const located = await runner.local("locate", async () => {
      const items = extracted.deltas.map((delta) => ({
        delta,
        isLocated: Boolean(delta.quote && prepared.body.includes(delta.quote)),
      }));
      const locatedCount = items.filter((item) => item.isLocated).length;
      return {
        items,
        locatedCount,
        unlocatedCount: items.length - locatedCount,
      };
    });

    // 3. bible.propose
    const pending = await runner.local("propose", async () => {
      const nowIso = clock.iso();
      const built = located.items.map(({ delta, isLocated }) =>
        deltaToBibleOp(delta, prepared.position, ctx.runId, nowIso, isLocated),
      );
      if (built.length === 0) return [] as PendingItem[];
      return bibleStore.propose(
        ctx.target.path,
        built.map((b) => b.op),
        {
          source: "ledger",
          run: ctx.runId,
          chapter: prepared.position,
          at: nowIso,
        },
        built.map((b) => b.meta),
      );
    });

    return {
      chapterId: req.chapterId,
      position: prepared.position,
      extractedCount: extracted.deltas.length,
      locatedCount: located.locatedCount,
      unlocatedCount: located.unlocatedCount,
      droppedCount: 0,
      opsCount: pending.length,
      pending,
    };
  },
  async deliver(res, ctx): Promise<DeliveryReceipt> {
    const bibleDir = path.join(ctx.target.path, "bible");
    const pendingFile = path.join(bibleDir, "pending.json");
    const marker = path.join(bibleDir, `${ctx.runId}.marker.json`);
    const summaryPayload = JSON.stringify(res, null, 2);

    if (await isAlreadyDelivered(marker, ctx.runId)) {
      return {
        runId: ctx.runId,
        deliveredPaths: [],
        contentHash: sha256(summaryPayload),
        summary: "已幂等交付记账结果",
      };
    }

    await atomicWrite(marker, buildDeliveryMarker(ctx.runId, summaryPayload));
    return {
      runId: ctx.runId,
      deliveredPaths: [pendingFile],
      contentHash: sha256(summaryPayload),
      summary: `记账完成（抽取 ${res.extractedCount} 条，定位 ${res.locatedCount} 条，未定位保留 ${res.unlocatedCount} 条，新增待确认增量 ${res.opsCount} 条）`,
    };
  },
  async recover(record, ctx) {
    const marker = path.join(ctx.target.path, "bible", `${record.id}.marker.json`);
    return (await isAlreadyDelivered(marker, record.id)) ? "delivered" : "resume";
  },
};
