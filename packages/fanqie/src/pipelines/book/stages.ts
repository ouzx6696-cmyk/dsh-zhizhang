import { AppError } from "@zhizhang/core/errors";
import type { StageSpec } from "@zhizhang/core/pipeline";
import { parseJson } from "@zhizhang/core/schema";
import {
  BookCardSchema,
  BookFoundationSchema,
  BookOutlineSchema,
  BookStructureSchema,
  type BookCardOutput,
  type BookFoundationOutput,
  type BookOutlineOutput,
  type BookPipelineState,
  type BookReq,
  type BookStructureOutput,
} from "./schemas.js";

type BookStage<I, O> = StageSpec<I, O, BookReq, BookPipelineState>;

export const cardStage: BookStage<BookReq, BookCardOutput> = {
  id: "card",
  title: "书卡定位",
  role: "planner",
  method: { stage: "fanqie.book.card" },
  input: (ctx) => ctx.request,
  shape:
    'JSON 格式：{"title":"书名","genre":"题材","hook":"核心看点","sellingPoints":["卖点"],"targetAudience":"目标读者"}',
  format: "json",
  parse: (raw) => parseJson(raw, BookCardSchema, "book.card"),
};

export const foundationStage: BookStage<
  { req: BookReq; card: BookCardOutput },
  BookFoundationOutput
> = {
  id: "foundation",
  title: "世界与人物基石",
  role: "planner",
  method: { stage: "fanqie.book.foundation" },
  input: (ctx) => {
    if (!ctx.state.card) throw new AppError("internal", "全书立项状态缺少书卡");
    return { req: ctx.request, card: ctx.state.card };
  },
  shape:
    'JSON 格式：{"protagonist":{"name":"主角名","goal":"目标","flaw":"弱点","goldenFinger":"金手指"},"worldview":"世界观","powerSystem":"升级体系","coreConflict":"主线冲突"}',
  format: "json",
  parse: (raw) => parseJson(raw, BookFoundationSchema, "book.foundation"),
};

export const structureStage: BookStage<
  { req: BookReq; card: BookCardOutput; foundation: BookFoundationOutput },
  BookStructureOutput
> = {
  id: "structure",
  title: "分卷结构",
  role: "planner",
  method: { stage: "fanqie.book.structure" },
  input: (ctx) => {
    if (!ctx.state.card || !ctx.state.foundation) {
      throw new AppError("internal", "全书立项状态缺少书卡或基石");
    }
    return { req: ctx.request, card: ctx.state.card, foundation: ctx.state.foundation };
  },
  shape:
    'JSON 格式：{"volumes":[{"volume":1,"title":"卷名","summary":"卷梗概","startChapter":1,"endChapter":50}]}',
  format: "json",
  parse: (raw) => parseJson(raw, BookStructureSchema, "book.structure"),
};

export const outlineStage: BookStage<
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
    if (!ctx.state.card || !ctx.state.foundation || !ctx.state.structure) {
      throw new AppError("internal", "全书立项状态缺少前置规划产物");
    }
    return {
      req: ctx.request,
      card: ctx.state.card,
      foundation: ctx.state.foundation,
      structure: ctx.state.structure,
      outlineCount: ctx.request.outlineCount ?? 10,
    };
  },
  shape:
    'JSON 格式：{"chapters":[{"position":1,"title":"章名","synopsis":"梗概","conflict":"冲突","hook":"章末钩子"}]}',
  format: "json",
  parse: (raw) => parseJson(raw, BookOutlineSchema, "book.outline"),
};
