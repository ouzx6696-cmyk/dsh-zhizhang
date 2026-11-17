import { proposeBookPlan } from "./proposal.js";
import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { readTextIfExists, sha256 } from "@zhizhang/core/fs";
import { createLockService, type LockService } from "@zhizhang/core/lock";
import type {
  ContextPacket,
  DeliveryReceipt,
  PipelineDefinition,
  RunCtx,
  RunRecord,
  StageSpec,
} from "@zhizhang/core/pipeline";
import { arr, int, lit, obj, opt, parseJson, str, type Infer } from "@zhizhang/core/schema";

export const BookPipelineReq = obj({
  title: str({ min: 1 }),
  premise: str({ min: 1 }),
  genre: opt(str()),
  grade: opt(lit("economy", "standard", "premium")),
  outlineCount: opt(int({ min: 1, max: 100 })),
});

export type BookReq = Infer<typeof BookPipelineReq>;

export interface BookCardOutput {
  title: string;
  genre: string;
  hook: string;
  sellingPoints: string[];
  targetAudience: string;
}

export interface BookFoundationOutput {
  protagonist: { name: string; goal: string; flaw: string; goldenFinger: string };
  worldview: string;
  powerSystem: string;
  coreConflict: string;
}

export interface BookVolume {
  volume: number;
  title: string;
  summary: string;
  startChapter: number;
  endChapter: number;
}

export interface BookStructureOutput {
  volumes: BookVolume[];
}

export interface ChapterOutlineItem {
  position: number;
  title: string;
  synopsis: string;
  conflict: string;
  hook: string;
}

export interface BookOutlineOutput {
  chapters: ChapterOutlineItem[];
}

export interface BookPlanResult {
  card: BookCardOutput;
  foundation: BookFoundationOutput;
  structure: BookStructureOutput;
  outline: BookOutlineOutput;
  outlineCount: number;
}

const BookCardSchema = obj({
  title: str({ min: 1 }),
  genre: str({ min: 1 }),
  hook: str({ min: 1 }),
  sellingPoints: arr(str({ min: 1 }), { max: 10 }),
  targetAudience: str({ min: 1 }),
});

const BookFoundationSchema = obj({
  protagonist: obj({
    name: str({ min: 1 }),
    goal: str({ min: 1 }),
    flaw: str({ min: 1 }),
    goldenFinger: str({ min: 1 }),
  }),
  worldview: str({ min: 1 }),
  powerSystem: str({ min: 1 }),
  coreConflict: str({ min: 1 }),
});

const BookStructureSchema = obj({
  volumes: arr(
    obj({
      volume: int({ min: 1 }),
      title: str({ min: 1 }),
      summary: str({ min: 1 }),
      startChapter: int({ min: 1 }),
      endChapter: int({ min: 1 }),
    }),
    { max: 30 },
  ),
});

const BookOutlineSchema = obj({
  chapters: arr(
    obj({
      position: int({ min: 1 }),
      title: str({ min: 1 }),
      synopsis: str({ min: 1 }),
      conflict: str({ min: 1 }),
      hook: str({ min: 1 }),
    }),
    { max: 100 },
  ),
});

export const cardStage: StageSpec<BookReq, BookCardOutput> = {
  id: "card",
  title: "书卡定位",
  role: "planner",
  method: { stage: "fanqie.book.card" },
  input: (ctx) => ctx.request as BookReq,
  shape:
    'JSON 格式：{"title":"书名","genre":"题材","hook":"核心看点","sellingPoints":["卖点"],"targetAudience":"目标读者"}',
  format: "json",
  parse: (raw) => parseJson(raw, BookCardSchema, "book.card"),
};

export const foundationStage: StageSpec<
  { req: BookReq; card: BookCardOutput },
  BookFoundationOutput
> = {
  id: "foundation",
  title: "世界与人物基石",
  role: "planner",
  method: { stage: "fanqie.book.foundation" },
  input: (ctx) => ({
    req: ctx.request as BookReq,
    card: ctx.state.card as BookCardOutput,
  }),
  shape:
    'JSON 格式：{"protagonist":{"name":"主角名","goal":"目标","flaw":"弱点","goldenFinger":"金手指"},"worldview":"世界观","powerSystem":"升级体系","coreConflict":"主线冲突"}',
  format: "json",
  parse: (raw) => parseJson(raw, BookFoundationSchema, "book.foundation"),
};

export const structureStage: StageSpec<
  { req: BookReq; card: BookCardOutput; foundation: BookFoundationOutput },
  BookStructureOutput
> = {
  id: "structure",
  title: "分卷结构",
  role: "planner",
  method: { stage: "fanqie.book.structure" },
  input: (ctx) => ({
    req: ctx.request as BookReq,
    card: ctx.state.card as BookCardOutput,
    foundation: ctx.state.foundation as BookFoundationOutput,
  }),
  shape:
    'JSON 格式：{"volumes":[{"volume":1,"title":"卷名","summary":"卷梗概","startChapter":1,"endChapter":50}]}',
  format: "json",
  parse: (raw) => parseJson(raw, BookStructureSchema, "book.structure"),
};

export const outlineStage: StageSpec<
  {
    req: BookReq;
    card: BookCardOutput;
    foundation: BookFoundationOutput;
    structure: BookStructureOutput;
    outlineCount: number;
  },
  BookOutlineOutput
> = {
  id: "outline",
  title: "前序章纲",
  role: "planner",
  method: { stage: "fanqie.book.outline" },
  input: (ctx) => {
    const req = ctx.request as BookReq;
    return {
      req,
      card: ctx.state.card as BookCardOutput,
      foundation: ctx.state.foundation as BookFoundationOutput,
      structure: ctx.state.structure as BookStructureOutput,
      outlineCount: req.outlineCount ?? 10,
    };
  },
  shape:
    'JSON 格式：{"chapters":[{"position":1,"title":"章名","synopsis":"梗概","conflict":"冲突","hook":"章末钩子"}]}',
  format: "json",
  parse: (raw) => parseJson(raw, BookOutlineSchema, "book.outline"),
};

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

function resolveBookPlanChoice(choice: unknown, ctx: RunCtx): BookPlanResult | undefined {
  if (isBookPlanResult(choice)) return choice;
  if (isRecord(choice) && isBookPlanResult(choice.plan)) {
    return choice.plan;
  }
  if (isBookPlanResult(ctx.state.result)) return ctx.state.result;
  if (isBookPlanResult(ctx.state)) {
    return {
      card: ctx.state.card,
      foundation: ctx.state.foundation,
      structure: ctx.state.structure,
      outline: ctx.state.outline,
      outlineCount: ctx.state.outline.chapters.length,
    };
  }
  return undefined;
}

export async function applyBookPlan(
  workPath: string,
  runId: string,
  plan: BookPlanResult,
  lock: LockService = createLockService(systemClock),
) {
  return proposeBookPlan(workPath, runId, plan, lock);
}

export const bookPipeline: PipelineDefinition<BookReq, BookPlanResult> = {
  kind: "fanqie.book",
  request: BookPipelineReq,
  async context(target, req) {
    return { runId: `book-${Date.now()}`, target, request: req, state: {} };
  },
  async run(runner, ctx) {
    const req = ctx.request as BookReq;
    const packet: ContextPacket = {
      prefix: [
        {
          id: "book-premise",
          layer: 0,
          text: `书名：${req.title}\n题材：${req.genre ?? "未指定"}\n核心设定：${req.premise}`,
          required: true,
          tokens: Math.ceil((req.title.length + req.premise.length) / 2),
          reason: "全书立项输入",
          source: { kind: "author", ref: "premise" },
        },
      ],
      suffix: [],
      omitted: [],
      estimate: Math.ceil((req.title.length + req.premise.length) / 2),
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
    const result = await proposeBookPlan(
      ctx.target.path,
      ctx.runId,
      res,
      createLockService(systemClock),
    );
    return {
      runId: ctx.runId,
      deliveredPaths: result.writtenPlanFiles,
      contentHash: sha256(JSON.stringify(res)),
      summary: `规划已生成待确认提案（${res.structure.volumes.length} 卷，${res.outlineCount} 章纲）`,
    };
  },
  async recover(record, ctx) {
    const marker = path.join(ctx.target.path, ".cache", "planning", `${record.id}.json`);
    return (await readTextIfExists(marker)) ? "delivered" : "resume";
  },
  async apply(record: RunRecord, choice: unknown, ctx: RunCtx): Promise<void> {
    if (choice === "reject") return;
    if (isRecord(choice) && choice.adopt === false) {
      return;
    }
    const plan = resolveBookPlanChoice(choice, ctx);
    if (!plan) {
      throw new AppError("input.invalid", "缺少可应用的全书规划结果", { runId: record.id });
    }
    await applyBookPlan(ctx.target.path, record.id || ctx.runId, plan);
  },
};
