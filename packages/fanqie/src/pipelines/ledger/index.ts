import { createIdSource } from "@zhizhang/core/id";
import { nodesOf, readOutline, derivePositions } from "../../outline/store.js";
import { listChapters } from "../../commands/chapter.js";
import { buildLookup } from "../../import/extract.js";
import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, resolveResourcePath, readTextIfExists, sha256 } from "@zhizhang/core/fs";
import { createLockService } from "@zhizhang/core/lock";
import type { ContextPacket, DeliveryReceipt, PipelineDefinition } from "@zhizhang/core/pipeline";
import { buildDeliveryMarker, isAlreadyDelivered } from "@zhizhang/core/pipeline";
import { int, lit, obj, opt, str, type Infer } from "@zhizhang/core/schema";
import { createBibleStore } from "../../bible/store.js";
import type { PendingItem } from "../../bible/types.js";
import { parseChapterMarkdown } from "../../domain/chapter.js";

export const LedgerReq = obj({
  chapterId: str({ min: 1 }),
  position: opt(int({ min: 1 })),
  trigger: opt(lit("manual", "auto")),
});

export type LedgerInput = Infer<typeof LedgerReq>;

export { ledgerExtractStage } from "./delta.js";
import {
  ledgerExtractStage,
  deltaToBibleOp,
  buildLedgerEntry,
  type ExtractedDelta,
} from "./delta.js";
export interface LedgerResult {
  chapterId: string;
  position: number;
  extractedCount: number;
  locatedCount: number;
  unlocatedCount: number;
  droppedCount: number;
  opsCount: number;
  pending: PendingItem[];
  notes: string[];
}

export const ledgerPipeline: PipelineDefinition<LedgerInput, LedgerResult> = {
  kind: "fanqie.ledger",
  request: LedgerReq,
  async context(target, req) {
    return { runId: createIdSource().next("run"), target, request: req, state: {} };
  },
  async run(runner, ctx) {
    const req = LedgerReq(ctx.request);
    const lock = createLockService(systemClock);
    const bibleStore = createBibleStore(lock);

    const prepared = await runner.local("prepare", async () => {
      const chapterPath = resolveResourcePath(ctx.target.path, "chapters", `${req.chapterId}.md`);
      const raw = await readTextIfExists(chapterPath);
      if (!raw) {
        throw new AppError("input.not_found", `未找到章节文件：${req.chapterId}`, {
          chapterId: req.chapterId,
        });
      }
      const doc = parseChapterMarkdown(raw);
      const ledgers = await bibleStore.ledgers(ctx.target.path);
      const existing = ledgers.find((c) => c.chapter === req.chapterId);
      const outline = await readOutline(ctx.target.path);
      const rows = await listChapters(ctx.target.path);
      const position =
        derivePositions(outline, rows).chapters.get(req.chapterId) ??
        req.position ??
        existing?.position ??
        ledgers.length + 1;
      return {
        body: doc.body,
        title: doc.meta.title || req.chapterId,
        revision: doc.meta.revision,
        position,
      };
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

    const currentBible = await bibleStore.read(ctx.target.path);
    const outline = await readOutline(ctx.target.path);
    const plan = nodesOf(outline).find(
      ({ node }) => "chapterId" in node && node.chapterId === req.chapterId,
    )?.node;
    packet.prefix.push({
      id: "ledger-lookup",
      layer: 2,
      text:
        buildLookup(currentBible, prepared.body) +
        "\n" +
        JSON.stringify({
          plan: plan
            ? Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "notes"))
            : undefined,
          previousHandoff: (await bibleStore.ledgers(ctx.target.path))
            .filter((entry) => entry.position < prepared.position)
            .at(-1)?.handoff,
          states: bibleStore.asOf(currentBible, Math.max(1, prepared.position - 1)).states,
          threads: currentBible.threads.filter((thread) => thread.status === "open"),
        }),
      required: true,
      tokens: 4000,
      reason: "截至本章的实体与章纲速查",
      source: { kind: "bible", ref: "ledger-lookup" },
    });
    // 1. extract
    const extracted = await runner.stage(ledgerExtractStage, packet);

    const names = new Map(
      currentBible.entities.flatMap((entity) =>
        [entity.name, ...entity.aliases, entity.id].map((name) => [name, entity.id]),
      ),
    );
    const supplementalEntities: ExtractedDelta[] = [];
    for (const delta of extracted.deltas)
      if (delta.kind === "entity") {
        const id =
          names.get(delta.targetId) ??
          names.get(delta.name) ??
          (/^ent-/u.test(delta.targetId) ? delta.targetId : createIdSource().next("ent"));
        names.set(delta.name, id);
        names.set(delta.targetId, id);
      }
    for (const delta of extracted.deltas) {
      if (delta.kind === "state" || delta.kind === "knowledge") {
        const known = names.get(delta.targetId) ?? names.get(delta.name);
        if (known) delta.targetId = known;
        else {
          const id = /^ent-/u.test(delta.targetId) ? delta.targetId : createIdSource().next("ent");
          names.set(delta.targetId, id);
          names.set(delta.name, id);
          supplementalEntities.push({
            kind: "entity",
            targetId: id,
            name: delta.name,
            entityKind: delta.entityKind ?? "character",
            detail: "本章出现的新增实体",
            quote: delta.quote,
          });
          delta.targetId = id;
        }
      } else delta.targetId = names.get(delta.targetId) ?? names.get(delta.name) ?? delta.targetId;
    }
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
    let missedPayoffs: string[] = [];
    const pending = await runner.local("propose", async () => {
      const nowIso = systemClock.iso();
      const resolvedItems = [
        ...supplementalEntities.map((delta) => ({
          delta,
          isLocated: prepared.body.includes(delta.quote),
        })),
        ...located.items,
      ];
      const built = resolvedItems.map(({ delta, isLocated }) =>
        deltaToBibleOp(delta, prepared.position, prepared.revision, ctx.runId, nowIso, isLocated),
      );
      for (const entry of built) {
        if (entry.op.type === "thread.upsert") {
          const value = entry.op.thread;
          const before = currentBible.threads.find((thread) => thread.id === value.id);
          if (before)
            entry.op = {
              type: "thread.upsert",
              expectedRev: before.rev,
              thread: { ...before, beats: [...before.beats, ...value.beats], status: value.status },
            };
        }
      }
      const planPays = plan && "chapterId" in plan ? (plan.pay ?? []) : [];
      missedPayoffs = planPays.flatMap((ref) => {
        const thread = ref.thread
          ? currentBible.threads.find((item) => item.id === ref.thread)
          : currentBible.threads.find((item) => item.title === ref.title);
        const id = thread?.id ?? ref.thread;
        const observed = located.items.some(
          (item) =>
            item.delta.kind === "thread" &&
            item.delta.beat === "pay" &&
            item.isLocated &&
            item.delta.targetId === id,
        );
        return observed ? [] : [thread?.title ?? ref.title ?? ref.thread ?? "未命名伏笔"];
      });
      const ledgerEntry = buildLedgerEntry({
        chapterId: req.chapterId,
        revision: prepared.revision,
        position: prepared.position,
        body: prepared.body,
        runId: ctx.runId,
        items: located.items,
      });
      ledgerEntry.handoff.openQuestions.push(
        ...missedPayoffs.map((title) => `计划回收未在正文确认：${title}`),
      );
      built.push({
        op: {
          type: "ledger.write",
          entry: ledgerEntry,
        },
        meta: {},
      });
      const ledger = built.find((item) => item.op.type === "ledger.write");
      if (ledger?.op.type === "ledger.write") {
        const entities = new Map(currentBible.entities.map((entity) => [entity.id, entity]));
        for (const item of resolvedItems)
          if (item.delta.kind === "entity" && !entities.has(item.delta.targetId))
            entities.set(item.delta.targetId, {
              id: item.delta.targetId,
              kind: item.delta.entityKind ?? "character",
              name: item.delta.name,
              aliases: [],
              summary: "",
              locked: [],
              provenance: {
                source: "ledger",
                run: ctx.runId,
                chapter: prepared.position,
                at: nowIso,
              },
              rev: 0,
            });
        ledger.op.entry.appearances = [...entities.values()]
          .map((entity) => ({
            entity: entity.id,
            count: countMentions(prepared.body, [entity.name, ...entity.aliases]),
          }))
          .filter((item) => item.count > 0);
      }
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
      notes: missedPayoffs.map((title) => `计划回收未在正文确认：${title}`),
    };
  },
  async deliver(res, ctx): Promise<DeliveryReceipt> {
    const bibleDir = path.join(ctx.target.path, "bible");
    const pendingFile = path.join(bibleDir, "pending");
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
      summary: `记账完成（抽取 ${res.extractedCount} 条，定位 ${res.locatedCount} 条，未定位保留 ${res.unlocatedCount} 条，新增待确认增量 ${res.opsCount} 条${res.notes.length ? `；${res.notes.length} 项计划回收未确认` : ""}）`,
    };
  },
  async recover(record, ctx) {
    const marker = path.join(ctx.target.path, "bible", `${record.id}.marker.json`);
    return (await isAlreadyDelivered(marker, record.id)) ? "delivered" : "resume";
  },
};

function countMentions(text: string, rawNames: string[]): number {
  const names = [...new Set(rawNames.filter(Boolean))].sort((a, b) => b.length - a.length);
  const spans: Array<[number, number]> = [];
  for (const name of names) {
    let start = 0;
    while ((start = text.indexOf(name, start)) >= 0) {
      const end = start + name.length;
      if (!spans.some(([left, right]) => start < right && end > left)) spans.push([start, end]);
      start = end;
    }
  }
  return spans.length;
}
