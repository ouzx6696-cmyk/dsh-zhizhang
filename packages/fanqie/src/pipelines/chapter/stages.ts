import { AppError } from "@zhizhang/core/errors";
import type { RunCtx, StageSpec } from "@zhizhang/core/pipeline";
import { parseJson } from "@zhizhang/core/schema";
import { draftCountForGrade, filterLocatedIssues, parsePlainDraft } from "./rules.js";
import {
  BeatsSchema,
  CompareResultSchema,
  ContinuityResultSchema,
  ReviewResultSchema,
  ScoreResultSchema,
  type BeatsOutput,
  type ChapterPipelineState,
  type ChapterReq,
  type CompareResult,
  type DraftOutput,
  type ReviewIssue,
  type ReviewResult,
  type ScoreResult,
} from "./schemas.js";

type ChapterStage<I, O> = StageSpec<I, O, ChapterReq, ChapterPipelineState>;

function getCurrentDraftFromState(ctx: RunCtx<unknown, ChapterPipelineState>): DraftOutput {
  const candidate = ctx.state.currentDraft;
  if (!candidate || !candidate.body) {
    throw new AppError("internal", "流水线状态缺少当前待审稿件");
  }
  return candidate;
}

export const beatsStage: ChapterStage<
  { chapterId: string; outline: string; note?: string },
  BeatsOutput
> = {
  id: "beats",
  title: "分场节拍",
  role: "planner",
  method: { stage: "fanqie.chapter.beats" },
  input: (ctx) => ({
    chapterId: ctx.request.chapterId,
    outline: ctx.state.outlineText ?? "",
    note: ctx.request.note,
  }),
  shape: 'JSON 格式：{"scenes":[{"title":"场景名","goal":"目标","conflict":"冲突","hook":"钩子"}]}',
  format: "json",
  parse: (raw) => parseJson(raw, BeatsSchema, "beats"),
};

export const draftStage: ChapterStage<
  { chapterId: string; beats?: BeatsOutput; note?: string },
  DraftOutput
> = {
  id: "draft",
  title: "起稿",
  role: "writer",
  method: { stage: "fanqie.chapter.draft" },
  input: (ctx) => ({
    chapterId: ctx.request.chapterId,
    beats: ctx.state.beats,
    note: ctx.request.note,
  }),
  shape: "纯文本输出：首行 `# 章名`，正文段落，末尾单独一行 `<<<END>>>`。",
  format: "text",
  parse: parsePlainDraft,
  fanOut: {
    count: (ctx) =>
      draftCountForGrade(
        ctx.request.grade ?? ctx.state.grade ?? "standard",
        ctx.request.golden === "true",
      ),
  },
};

export function makeScoreStage(
  index: number,
): ChapterStage<{ title: string; body: string }, ScoreResult> {
  return {
    id: `select-score-${index}`,
    title: `独立评分 #${index + 1}`,
    role: "judge",
    method: { stage: "fanqie.chapter.select" },
    input: (ctx) => {
      const candidates = ctx.state.passingDrafts ?? [];
      const target = candidates[index];
      if (!target) {
        throw new AppError("internal", `缺少评分候选稿 #${index}`);
      }
      return target;
    },
    shape:
      'JSON 格式：{"score":0-100,"strengths":["优点"],"weaknesses":["不足"],"summary":"一句话总评"}',
    format: "json",
    parse: (raw) => parseJson(raw, ScoreResultSchema, "select-score"),
  };
}

export function makeCompareStage(
  label: string,
  aFirst: boolean,
): ChapterStage<{ A: DraftOutput; B: DraftOutput }, CompareResult> {
  return {
    id: `select-compare-${label}`,
    title: `换位盲评 (${label})`,
    role: "judge",
    method: { stage: "fanqie.chapter.select" },
    input: (ctx) => {
      const topTwo = ctx.state.topTwo;
      if (!topTwo) {
        throw new AppError("internal", "缺少换位比较的前二候选稿");
      }
      return aFirst ? { A: topTwo[0], B: topTwo[1] } : { A: topTwo[1], B: topTwo[0] };
    },
    shape: 'JSON 格式：{"winner":"A|B|tie","reason":"比较结论"}',
    format: "json",
    parse: (raw) => parseJson(raw, CompareResultSchema, "select-compare"),
  };
}

export const continuityStage: ChapterStage<
  { chapterId: string; title: string; body: string },
  { issues: ReviewIssue[] }
> = {
  id: "continuity-check",
  title: "连续性核查",
  role: "editor",
  method: { stage: "fanqie.chapter.review" },
  input: (ctx) => {
    const draft = getCurrentDraftFromState(ctx);
    return { chapterId: ctx.request.chapterId, title: draft.title, body: draft.body };
  },
  shape:
    'JSON 格式：{"issues":[{"kind":"continuity","quote":"原文精确引文","issue":"问题","fix":"修改建议"}]}',
  format: "json",
  parse: (raw) => parseJson(raw, ContinuityResultSchema, "continuity-check"),
  accept: (o, ctx) => {
    const draft = getCurrentDraftFromState(ctx);
    const filtered = filterLocatedIssues(o.issues, draft.body);
    return { value: { issues: filtered.value }, notes: filtered.notes };
  },
};

export function makeReviewStage<Req extends { chapterId: string } = ChapterReq>(
  round: number,
): StageSpec<
  { chapterId: string; round: number; title: string; body: string },
  ReviewResult,
  Req,
  ChapterPipelineState
> {
  return {
    id: round === 1 ? "review" : `review-r${round}`,
    title: `编辑审读（第 ${round} 轮）`,
    role: "editor",
    method: { stage: "fanqie.chapter.review" },
    input: (ctx) => {
      const draft = getCurrentDraftFromState(ctx);
      return { chapterId: ctx.request.chapterId, round, title: draft.title, body: draft.body };
    },
    shape:
      'JSON 格式：{"verdict":"pass|revise|reject","issues":[{"kind":"continuity|reader","quote":"原文精确引文","issue":"问题","fix":"修改建议"}],"summary":"审读总结"}',
    format: "json",
    parse: (raw) => parseJson(raw, ReviewResultSchema, "review"),
    accept: (o, ctx) => {
      const draft = getCurrentDraftFromState(ctx);
      const filtered = filterLocatedIssues(o.issues, draft.body);
      return {
        value: { ...o, issues: filtered.value },
        notes: filtered.notes,
      };
    },
  };
}

export const reviewStage = makeReviewStage(1);

export function makeReviseStage<Req extends { chapterId: string; note?: string } = ChapterReq>(
  round: number,
): StageSpec<
  { chapterId: string; round: number; draft: DraftOutput; issues: ReviewIssue[]; note?: string },
  DraftOutput,
  Req,
  ChapterPipelineState
> {
  return {
    id: round === 1 ? "revise" : `revise-r${round}`,
    title: `按回报修改（第 ${round} 轮）`,
    role: "writer",
    method: { stage: "fanqie.chapter.revise" },
    input: (ctx) => {
      const draft = getCurrentDraftFromState(ctx);
      const issues = ctx.state.pendingIssues ?? [];
      return {
        chapterId: ctx.request.chapterId,
        round,
        draft,
        issues,
        note: ctx.request.note,
      };
    },
    shape: "纯文本输出：首行 `# 章名`，修改后的完整正文段落，末尾单独一行 `<<<END>>>`。",
    format: "text",
    parse: parsePlainDraft,
  };
}

export const reviseStage = makeReviseStage(1);
