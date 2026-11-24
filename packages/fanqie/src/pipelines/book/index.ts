import fs from "node:fs/promises";
import path from "node:path";
import { systemClock, type Clock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, readJson, readTextIfExists, sha256 } from "@zhizhang/core/fs";
import { commitIntent, type IntentWrite } from "@zhizhang/core/journal";
import { createLockService, type LockService } from "@zhizhang/core/lock";
import { FORMAT_VERSION } from "@zhizhang/core/paths";
import {
  buildDeliveryMarker,
  definePipeline,
  isAlreadyDelivered,
  type ContextPacket,
  type DeliveryReceipt,
  type PipelineDefinition,
  type RunCtx,
  type RunRecord,
} from "@zhizhang/core/pipeline";
import { arr } from "@zhizhang/core/schema";
import { createBibleStore } from "../../bible/store.js";
import type { Entity, StateEntry } from "../../bible/types.js";
import { readLibraryCards, readWorkReferenceBindings } from "../../commands/library.js";
import {
  BookCardFileSchema,
  BookFoundationSchema,
  BookPipelineReq,
  BookVolumeSchema,
  ChapterOutlineSchema,
  type BookPipelineState,
  type BookPlanResult,
  type BookReq,
} from "./schemas.js";
import { cardStage, foundationStage, outlineStage, structureStage } from "./stages.js";

export * from "./schemas.js";
export * from "./stages.js";

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null;
}

function isBookPlanResult(val: unknown): val is BookPlanResult {
  if (!isRecord(val)) return false;
  return (
    isRecord(val.card) &&
    isRecord(val.foundation) &&
    isRecord(val.structure) &&
    isRecord(val.outline)
  );
}

function proposalDirOf(workPath: string, runId: string): string {
  return path.join(workPath, "plan", "proposals", runId);
}

async function readBookProposal(
  workPath: string,
  runId: string,
): Promise<BookPlanResult | undefined> {
  const dir = proposalDirOf(workPath, runId);
  const [card, foundation, volumes, chapters] = await Promise.all([
    readJson(path.join(dir, "card.json"), BookCardFileSchema).catch(() => undefined),
    readJson(path.join(dir, "foundation.json"), BookFoundationSchema).catch(() => undefined),
    readJson(path.join(dir, "structure.json"), arr(BookVolumeSchema)).catch(() => undefined),
    readJson(path.join(dir, "outline.json"), arr(ChapterOutlineSchema)).catch(() => undefined),
  ]);
  if (!card || !foundation || !volumes || !chapters) return undefined;
  return {
    card: {
      title: card.title,
      genre: card.genre,
      hook: card.hook,
      sellingPoints: card.sellingPoints,
      targetAudience: card.targetAudience,
    },
    foundation,
    structure: { volumes },
    outline: { chapters },
    outlineCount: chapters.length,
  };
}

async function resolveBookPlanChoice(
  choice: unknown,
  ctx: RunCtx<BookReq, BookPipelineState>,
  runId: string,
): Promise<BookPlanResult | undefined> {
  if (isBookPlanResult(choice)) return choice;
  if (isRecord(choice) && isBookPlanResult(choice.plan)) return choice.plan;
  if (ctx.state.result) return ctx.state.result;
  if (ctx.state.card && ctx.state.foundation && ctx.state.structure && ctx.state.outline) {
    return {
      card: ctx.state.card,
      foundation: ctx.state.foundation,
      structure: ctx.state.structure,
      outline: ctx.state.outline,
      outlineCount: ctx.state.outline.chapters.length,
    };
  }
  return readBookProposal(ctx.target.path, runId);
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...list, item];
  const next = [...list];
  next[idx] = item;
  return next;
}

async function intentWrite(file: string, after: string): Promise<IntentWrite> {
  const prev = await readTextIfExists(file);
  return {
    path: file,
    beforeHash: prev === undefined ? null : sha256(prev),
    after,
  };
}

export async function applyBookPlan(
  workPath: string,
  runId: string,
  plan: BookPlanResult,
  lock: LockService = createLockService(systemClock),
  clock: Clock = systemClock,
): Promise<{ backupDir: string; backedUpFiles: string[]; writtenPlanFiles: string[] }> {
  const bibleStore = createBibleStore(lock, clock);
  return lock.write({ kind: "work", path: workPath }, async () => {
    const planDir = path.join(workPath, "plan");
    const backupDir = path.join(workPath, ".zhizhang", "trash", `plan-${runId}`);
    const planFiles = ["card.json", "foundation.json", "structure.json", "outline.json"];
    const backedUpFiles: string[] = [];

    await fs.mkdir(backupDir, { recursive: true });
    for (const file of planFiles) {
      const src = path.join(planDir, file);
      const existing = await readTextIfExists(src);
      if (existing !== undefined) {
        const dst = path.join(backupDir, file);
        await atomicWrite(dst, existing);
        backedUpFiles.push(dst);
      }
    }

    const cardFile = path.join(planDir, "card.json");
    const foundationFile = path.join(planDir, "foundation.json");
    const structureFile = path.join(planDir, "structure.json");
    const outlineFile = path.join(planDir, "outline.json");

    const nowIso = clock.iso();
    const provenance = { source: "plan" as const, run: runId, at: nowIso };
    const bible = await bibleStore.read(workPath);

    const protagonistEntity: Entity = {
      id: "ent-protagonist",
      kind: "character",
      name: plan.foundation.protagonist.name,
      aliases: [],
      summary: `目标：${plan.foundation.protagonist.goal}；弱点：${plan.foundation.protagonist.flaw}；金手指：${plan.foundation.protagonist.goldenFinger}`,
      locked: [],
      provenance,
    };
    const worldviewEntity: Entity = {
      id: "ent-worldview",
      kind: "rule",
      name: "世界观与主线冲突",
      aliases: [],
      summary: `${plan.foundation.worldview}；主线冲突：${plan.foundation.coreConflict}`,
      locked: [],
      global: true,
      provenance,
    };
    const powerEntity: Entity = {
      id: "ent-power-system",
      kind: "rule",
      name: "升级体系",
      aliases: [],
      summary: plan.foundation.powerSystem,
      locked: [],
      global: true,
      provenance,
    };

    let nextEntities = upsertById(bible.entities, protagonistEntity);
    nextEntities = upsertById(nextEntities, worldviewEntity);
    nextEntities = upsertById(nextEntities, powerEntity);

    const plannedStates: StateEntry[] = [
      {
        id: "st-plan-protagonist-goal",
        entity: "ent-protagonist",
        field: "目标",
        value: plan.foundation.protagonist.goal,
        since: 1,
        mode: "replace",
        status: "planned",
        provenance,
      },
      {
        id: "st-plan-protagonist-goldenfinger",
        entity: "ent-protagonist",
        field: "金手指",
        value: plan.foundation.protagonist.goldenFinger,
        since: 1,
        mode: "replace",
        status: "planned",
        provenance,
      },
      {
        id: "st-plan-core-conflict",
        entity: "ent-worldview",
        field: "主线冲突",
        value: plan.foundation.coreConflict,
        since: 1,
        mode: "replace",
        status: "planned",
        provenance,
      },
    ];

    let nextStates = bible.states;
    for (const entry of plannedStates) {
      nextStates = upsertById(nextStates, entry);
    }

    const bibleDir = path.join(workPath, "bible");
    const hashes = {
      entities: sha256(JSON.stringify(nextEntities)),
      states: sha256(JSON.stringify(nextStates)),
      threads: sha256(JSON.stringify(bible.threads)),
      knowledge: sha256(JSON.stringify(bible.knowledge)),
      chapters: sha256(JSON.stringify(bible.chapters)),
      style: sha256(JSON.stringify(bible.style)),
      pending: sha256(JSON.stringify(bible.pending)),
    };

    const writes = await Promise.all([
      intentWrite(cardFile, JSON.stringify({ format: FORMAT_VERSION, ...plan.card }, null, 2)),
      intentWrite(foundationFile, JSON.stringify(plan.foundation, null, 2)),
      intentWrite(structureFile, JSON.stringify(plan.structure.volumes, null, 2)),
      intentWrite(outlineFile, JSON.stringify(plan.outline.chapters, null, 2)),
      intentWrite(path.join(bibleDir, "entities.json"), JSON.stringify(nextEntities, null, 2)),
      intentWrite(path.join(bibleDir, "states.json"), JSON.stringify(nextStates, null, 2)),
      intentWrite(
        path.join(bibleDir, "index.json"),
        JSON.stringify({ format: FORMAT_VERSION, hashes }, null, 2),
      ),
    ]);

    await commitIntent(
      path.join(workPath, ".journal"),
      {
        format: FORMAT_VERSION,
        id: `book-apply-${runId}`,
        writes,
        meta: { operation: "book.apply", runId },
      },
      lock,
      { kind: "work", path: workPath },
    );

    return {
      backupDir,
      backedUpFiles,
      writtenPlanFiles: [cardFile, foundationFile, structureFile, outlineFile],
    };
  });
}

export const bookPipeline: PipelineDefinition<BookReq, BookPlanResult, BookPipelineState> =
  definePipeline<BookReq, BookPlanResult, BookPipelineState>({
    kind: "fanqie.book",
    request: BookPipelineReq,
    async context(target, req, env) {
      const clock = env.clock ?? systemClock;
      const lock = env.lock ?? createLockService(clock);
      return {
        runId: `book-${clock.now()}`,
        target,
        request: req,
        state: {},
        clock,
        lock,
        budget: env.budget,
        profileId: env.profileId,
        profile: env.profile,
        profileRoots: env.profileRoots,
      };
    },
    async run(runner, ctx) {
      const req = ctx.request;
      const macroCardsText = await runner.local("load-references", async () => {
        if (!ctx.libraryRoot) return "";
        const bindings = (await readWorkReferenceBindings(ctx.target.path)).filter(
          (b) => (b.scope ?? "work") === "work",
        );
        if (bindings.length === 0) return "";
        const loaded = (
          await Promise.all(
            bindings.map(async (binding) => {
              const { cards } = await readLibraryCards(ctx.libraryRoot ?? "", binding.sourceId);
              return cards.filter((c) => binding.cardIds.includes(c.id));
            }),
          )
        ).flat();
        const macro = loaded.filter(
          (c) => !c.layer || c.layer === "book" || c.layer === "arc" || c.layer === "unit",
        );
        const picked = macro.length > 0 ? macro : loaded.slice(0, 6);
        if (picked.length === 0) return "";
        return [
          "【全书绑定参考技法卡（只迁机制，严禁洗稿）】",
          ...picked.map((c) => {
            const parts = [`- [${c.layer ?? c.category}] ${c.title}：${c.pattern}`];
            if (c.transfer) parts.push(`  迁移重造：${c.transfer}`);
            if (c.mustNotCopy?.length) parts.push(`  严禁照搬：${c.mustNotCopy.join("；")}`);
            if (c.failWhen) parts.push(`  失效边界：${c.failWhen}`);
            return parts.join("\n");
          }),
        ].join("\n");
      });

      const prefix = [
        {
          id: "book-premise",
          layer: 0 as const,
          text: `书名：${req.title}\n题材：${req.genre ?? "未指定"}\n核心设定：${req.premise}`,
          required: true,
          tokens: Math.ceil((req.title.length + req.premise.length) / 2),
          reason: "全书立项输入",
          source: { kind: "author" as const, ref: "premise" },
        },
        ...(macroCardsText
          ? [
              {
                id: "book-reference-cards",
                layer: 2 as const,
                text: macroCardsText,
                required: false,
                tokens: Math.ceil(macroCardsText.length / 2),
                reason: "作品绑定的宏观技法参考卡",
                source: { kind: "reference" as const, ref: "work-cards" },
              },
            ]
          : []),
      ];
      const packet: ContextPacket = {
        prefix,
        suffix: [],
        omitted: [],
        estimate: prefix.reduce((sum, b) => sum + b.tokens, 0),
      };

      const card = await runner.stage(cardStage, packet);
      ctx.state.card = card;

      const foundation = await runner.stage(foundationStage, packet);
      ctx.state.foundation = foundation;

      const structure = await runner.stage(structureStage, packet);
      ctx.state.structure = structure;

      const outline = await runner.stage(outlineStage, packet);
      ctx.state.outline = outline;

      const result: BookPlanResult = {
        card,
        foundation,
        structure,
        outline,
        outlineCount: outline.chapters.length,
      };
      ctx.state.result = result;
      return result;
    },
    async deliver(res, ctx): Promise<DeliveryReceipt> {
      const proposalDir = proposalDirOf(ctx.target.path, ctx.runId);
      const marker = path.join(proposalDir, "marker.json");
      const cardPayload = JSON.stringify({ format: FORMAT_VERSION, ...res.card }, null, 2);
      if (await isAlreadyDelivered(marker, ctx.runId)) {
        return {
          runId: ctx.runId,
          deliveredPaths: [],
          contentHash: sha256(cardPayload),
          summary: "已幂等交付全书规划提案",
        };
      }

      const cardFile = path.join(proposalDir, "card.json");
      const foundationFile = path.join(proposalDir, "foundation.json");
      const structureFile = path.join(proposalDir, "structure.json");
      const outlineFile = path.join(proposalDir, "outline.json");

      await atomicWrite(cardFile, cardPayload);
      await atomicWrite(foundationFile, JSON.stringify(res.foundation, null, 2));
      await atomicWrite(structureFile, JSON.stringify(res.structure.volumes, null, 2));
      await atomicWrite(outlineFile, JSON.stringify(res.outline.chapters, null, 2));
      await atomicWrite(marker, buildDeliveryMarker(ctx.runId, cardPayload));

      return {
        runId: ctx.runId,
        deliveredPaths: [cardFile, foundationFile, structureFile, outlineFile],
        contentHash: sha256(cardPayload),
        summary: `已生成全书规划提案（${res.structure.volumes.length} 卷，前 ${res.outlineCount} 章纲，待作者确认应用）`,
      };
    },
    async recover(record, ctx) {
      const marker = path.join(proposalDirOf(ctx.target.path, record.id), "marker.json");
      return (await isAlreadyDelivered(marker, record.id)) ? "delivered" : "resume";
    },
    async apply(
      record: RunRecord,
      choice: unknown,
      ctx: RunCtx<BookReq, BookPipelineState>,
    ): Promise<void> {
      if (choice === "reject") return;
      if (isRecord(choice) && choice.adopt === false) return;
      const runId = record.id || ctx.runId;
      const plan = await resolveBookPlanChoice(choice, ctx, runId);
      if (!plan) {
        throw new AppError("input.invalid", "缺少可应用的全书规划提案", { runId });
      }
      const clock = ctx.clock ?? systemClock;
      const lock = ctx.lock ?? createLockService(clock);
      await applyBookPlan(ctx.target.path, runId, plan, lock, clock);
    },
  });
