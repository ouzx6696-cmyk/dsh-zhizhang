/**
 * 番茄写作助手扩展只读洞察工具：参考卡绑定、改稿学习偏好、候选稿段落差异摘要。
 * 全为 readonly: true，严守“作者是裁判、助手零直写”红线。
 */
import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { createLockService } from "@zhizhang/core/lock";
import { desc, obj, str, type Infer } from "@zhizhang/core/schema";
import { defineTool, type ToolCtx, type ToolDefinition } from "@zhizhang/core/tool";
import { createBibleStore } from "../bible/store.js";
import { readCandidate } from "../commands/candidate.js";
import { readChapter } from "../commands/chapter.js";
import {
  listLibrarySources,
  readLibraryCards,
  readWorkReferenceBindings,
} from "../commands/library.js";
import { alignParagraphs, createLearningStore } from "../learning/index.js";

const NoArgs = obj({});
const DiffCandidateArgs = obj({
  chapterId: desc(str({ min: 1 }), "章节 id"),
  candidateId: desc(str({ min: 1 }), "候选 id"),
});

export function fanqieInsightTools(work: string): ToolDefinition[] {
  let fallbackLock: ReturnType<typeof createLockService> | undefined;
  const lockFor = (ctx: ToolCtx) =>
    ctx.lock ?? (fallbackLock ??= createLockService(ctx.clock ?? systemClock));

  const listLibraryCardsTool = defineTool({
    name: "fanqie_list_library_cards",
    description: "查看当前作品已绑定的拆书参考卡与写作文件夹拆书库可用素材。",
    params: NoArgs,
    roles: ["assistant"],
    readonly: true,
    async run(_args, ctx: ToolCtx) {
      const bindings = await readWorkReferenceBindings(work);
      const libraryRoot = ctx.workspaceRoot ? path.join(ctx.workspaceRoot, "拆书库") : "";
      const sources = libraryRoot ? await listLibrarySources(libraryRoot).catch(() => []) : [];
      const boundCards = [];
      if (libraryRoot) {
        for (const b of bindings) {
          const { cards } = await readLibraryCards(libraryRoot, b.sourceId).catch(() => ({
            cards: [],
          }));
          for (const c of cards) {
            if (b.cardIds.includes(c.id)) {
              boundCards.push({
                id: c.id,
                sourceId: b.sourceId,
                scope: b.scope ?? "work",
                chapterId: b.chapterId ?? null,
                title: c.title,
                category: c.category,
                usage: c.usage,
              });
            }
          }
        }
      }
      return { bindings, boundCards, sources };
    },
  });

  const readLearningTool = defineTool({
    name: "fanqie_read_learning",
    description: "读取本书已生效的风格契约规则与从作者改稿中识别出的偏好模式。",
    params: NoArgs,
    roles: ["assistant"],
    readonly: true,
    async run(_args, ctx: ToolCtx) {
      const lock = lockFor(ctx);
      const [state, bible] = await Promise.all([
        createLearningStore(lock).read(work),
        createBibleStore(lock, ctx.clock ?? systemClock).read(work),
      ]);
      return {
        rules: bible.style.rules,
        patterns: state.patterns.slice(0, 20).map((p) => ({
          signature: p.signature,
          kind: p.kind,
          condition: p.condition,
          change: p.change,
          count: p.count,
          promoted: p.promoted,
          status: p.status ?? (p.promoted ? "accepted" : "observing"),
        })),
      };
    },
  });

  const diffCandidateTool = defineTool({
    name: "fanqie_diff_candidate",
    description: "对比正式稿与候选稿的段落级改动摘要，返回新增、修改与删减条数及关键片段。",
    params: DiffCandidateArgs,
    roles: ["assistant"],
    readonly: true,
    async run(args: Infer<typeof DiffCandidateArgs>) {
      const [official, cand] = await Promise.all([
        readChapter(work, args.chapterId).catch(() => null),
        readCandidate(work, args.chapterId, args.candidateId),
      ]);
      const hunks = alignParagraphs(official?.body ?? "", cand.body);
      return {
        chapterId: args.chapterId,
        candidateId: args.candidateId,
        officialWords: official ? official.body.replace(/\s+/g, "").length : 0,
        candidateWords: cand.wordCount,
        totalChanges: hunks.length,
        samples: hunks.slice(0, 8).map((h) => ({
          kind: h.kind,
          before: h.before.slice(0, 120),
          after: h.after.slice(0, 120),
        })),
      };
    },
  });

  return [listLibraryCardsTool, readLearningTool, diffCandidateTool];
}
