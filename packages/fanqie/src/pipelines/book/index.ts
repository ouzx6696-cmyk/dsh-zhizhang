import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, sha256 } from "@zhizhang/core/fs";
import { createLockService } from "@zhizhang/core/lock";
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
import { readLibraryCards, readWorkReferenceBindings } from "../../commands/library.js";
import { applyBookPlan, isRecord, proposalDirOf, resolveBookPlanChoice } from "./apply.js";
import {
  BookPipelineReq,
  type BookPipelineState,
  type BookPlanResult,
  type BookReq,
} from "./schemas.js";
import { cardStage, foundationStage, outlineStage, structureStage } from "./stages.js";

export * from "./schemas.js";
export * from "./stages.js";
export { applyBookPlan } from "./apply.js";

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
