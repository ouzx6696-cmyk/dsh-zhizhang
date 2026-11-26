import { AppError } from "@zhizhang/core/errors";
import { atomicWrite } from "@zhizhang/core/fs";
import type { StageSpec } from "@zhizhang/core/pipeline";
import { parseJson } from "@zhizhang/core/schema";
import type { ClaimCandidate } from "../../domain/claims.js";
import type { MotifSpec } from "../../domain/motifs.js";
import type { QaCheckResult, RulesLimits } from "../../rules/bridge.js";
import {
  mergeFactResults,
  resolveDraftTrack,
  validateTitleMatrix,
  type RegisteredSourceRef,
} from "./rules.js";
import {
  BlueprintOutputSchema,
  CardOutputSchema,
  FactCheckOutputSchema,
  ReviewOutputSchema,
  TitleMatrixOutputSchema,
  type ArticlePipelineState,
  type ArticleReq,
  type BlueprintOutput,
  type FactCheckOutput,
  type ReviewOutput,
  type TitleCandidate,
  type TitleMatrixOutput,
} from "./schemas.js";

type ArticleStage<I, O> = StageSpec<I, O, ArticleReq, ArticlePipelineState>;

export function buildCardStage(deps: {
  req: ArticleReq;
  sourceText: string;
  cardPath: string;
  checkCard: (cardPath: string) => Promise<{ ok: boolean; errors: string[] }>;
}): ArticleStage<
  {
    articleId: string;
    genre: string;
    driver: string;
    line?: string;
    note?: string;
    source: string;
  },
  Record<string, unknown>
> {
  return {
    id: "card",
    title: "立项卡生成与预检",
    role: "planner",
    method: { stage: "toutiao.article.card" },
    input: () => ({
      articleId: deps.req.articleId,
      genre: deps.req.genre,
      driver: deps.req.driver,
      line: deps.req.line,
      note: deps.req.note,
      source: deps.sourceText,
    }),
    shape:
      "输出合法 JSON 立项卡对象，须包含 主问题、核心事实、读者、体裁、内容线、主驱动；若体裁为长图文须包含 延伸（含 起始小标题、接的问题、接法）。",
    format: "json",
    parse: (raw) => parseJson(raw, CardOutputSchema),
    async accept(card) {
      const enriched = {
        体裁: deps.req.genre,
        主驱动: deps.req.driver,
        ...(deps.req.line ? { 内容线: deps.req.line } : {}),
        ...card,
      };
      await atomicWrite(deps.cardPath, JSON.stringify(enriched, null, 2));
      const check = await deps.checkCard(deps.cardPath);
      if (!check.ok) {
        throw new AppError("model.output_invalid", `立项卡预检未通过：${check.errors.join("；")}`, {
          errors: check.errors,
        });
      }
      return enriched;
    },
    retries: 1,
  };
}

export function buildTitleStage(deps: {
  card: Record<string, unknown>;
  limits: RulesLimits;
  motifs: MotifSpec[];
}): ArticleStage<
  { card: Record<string, unknown>; titleMax: number; motifs: MotifSpec[] },
  TitleMatrixOutput
> {
  return {
    id: "title",
    title: "标题矩阵与母体校验",
    role: "writer",
    method: { stage: "toutiao.article.title" },
    input: () => ({
      card: deps.card,
      titleMax: deps.limits.title_max,
      motifs: deps.motifs,
    }),
    shape: `输出 JSON：{ "main": { "text": "...", "motif": "..." }, "alternatives": [{ "text": "...", "motif": "..." }] }，至少 5 个标题且覆盖 ≥3 个母体，单标题 ≤${deps.limits.title_max} 字。`,
    format: "json",
    parse: (raw) => {
      const parsed = parseJson(raw, TitleMatrixOutputSchema);
      return { main: parsed.main, alternatives: parsed.alternatives ?? [] };
    },
    accept(out) {
      const all = [out.main, ...out.alternatives];
      const validated = validateTitleMatrix(all, deps.limits.title_max);
      if (deps.motifs.length > 0) {
        const validMotifNames = new Set(deps.motifs.map((m) => m.name));
        const unknown = validated.valid.filter((item) => !validMotifNames.has(item.motif));
        if (unknown.length > 0) {
          return {
            value: { main: validated.valid[0], alternatives: validated.valid.slice(1) },
            notes: [
              `存在未在 s3-headline 列表中的母体名：${unknown.map((u) => u.motif).join("、")}`,
            ],
          };
        }
      }
      return {
        value: { main: validated.valid[0], alternatives: validated.valid.slice(1) },
        notes: validated.dropped,
      };
    },
    retries: 1,
  };
}

export function buildBlueprintStage(deps: {
  card: Record<string, unknown>;
  title: TitleCandidate;
  recommendedOpening: string;
  recommendedEnding: string;
  recentOpenings: string[];
  recentEndings: string[];
}): ArticleStage<
  {
    card: Record<string, unknown>;
    title: TitleCandidate;
    recommendedOpening: string;
    recommendedEnding: string;
    recentOpenings: string[];
    recentEndings: string[];
  },
  BlueprintOutput
> {
  return {
    id: "blueprint",
    title: "结构蓝图（开头/结尾轮换）",
    role: "planner",
    method: { stage: "toutiao.article.blueprint" },
    input: () => deps,
    shape:
      '输出 JSON：{ "openingStyle": "...", "endingStyle": "...", "sections": [{ "heading": "...", "question": "...", "action": "..." }], "extensionStart": "..." }。须避开最近用过的开头/结尾式实现轮换。',
    format: "json",
    parse: (raw) => parseJson(raw, BlueprintOutputSchema),
    retries: 1,
  };
}

export function buildDraftStage(deps: {
  card: Record<string, unknown>;
  title: TitleCandidate;
  blueprint: BlueprintOutput;
  sourceText: string;
}): ArticleStage<
  {
    card: Record<string, unknown>;
    title: TitleCandidate;
    blueprint: BlueprintOutput;
    source: string;
  },
  string
> {
  return {
    id: "draft",
    title: "多路起稿",
    role: "writer",
    method: {
      stage: "toutiao.article.draft",
      vars: (ctx) => ({ draftTrack: resolveDraftTrack(ctx.request) }),
    },
    input: () => ({
      card: deps.card,
      title: deps.title,
      blueprint: deps.blueprint,
      source: deps.sourceText,
    }),
    shape: `输出完整 Markdown 正文，首行以 "# ${deps.title.text}" 开头，小标题使用 "## "。`,
    format: "text",
    parse: (raw) => {
      const text = raw.trim();
      if (!text) throw new AppError("model.output_invalid", "起稿输出为空");
      return text;
    },
    fanOut: {
      count: (ctx) => ctx.request.draftCount ?? 2,
      allowPartial: true,
    },
  };
}

export function buildFactsStage(
  stepId: string,
  claims: ClaimCandidate[],
  sourceText: string,
  sources?: readonly RegisteredSourceRef[],
): ArticleStage<{ claims: ClaimCandidate[]; source: string }, ClaimCandidate[]> {
  return {
    id: stepId,
    title: "逐条事实证据核验",
    role: "extractor",
    input: () => ({ claims, source: sourceText }),
    shape:
      '输出 JSON：{ "claims": [{ "id": "...", "status": "supported"|"unsupported"|"unlocated", "sourceId": "...", "evidence": "..." }] }。找不到出处标为 unlocated，不要编造出处。',
    format: "json",
    parse: (raw): ClaimCandidate[] => {
      const out: FactCheckOutput = parseJson(raw, FactCheckOutputSchema);
      return mergeFactResults(claims, out, sources).merged;
    },
  };
}

export function buildReviewStage(deps: {
  draft: string;
  card: Record<string, unknown>;
  claims: ClaimCandidate[];
}): ArticleStage<
  { draft: string; card: Record<string, unknown>; facts: ClaimCandidate[] },
  ReviewOutput
> {
  return {
    id: "review",
    title: "编辑审读",
    role: "editor",
    method: { stage: "toutiao.article.review" },
    input: () => ({ draft: deps.draft, card: deps.card, facts: deps.claims }),
    shape:
      '输出 JSON：{ "issues": [{ "kind": "skeleton"|"ai-taste"|"fact"|"pacing", "quote": "...", "issue": "...", "fix": "..." }], "summary": "..." }。',
    format: "json",
    parse: (raw) => parseJson(raw, ReviewOutputSchema),
  };
}

export function buildReviseStage(deps: {
  draft: string;
  review: ReviewOutput;
  claims: ClaimCandidate[];
}): ArticleStage<
  { draft: string; review: ReviewOutput; claims: ClaimCandidate[]; guide: string },
  string
> {
  return {
    id: "revise",
    title: "按 s5-editing 红笔修订",
    role: "editor",
    method: { stage: "toutiao.article.revise" },
    input: () => ({
      ...deps,
      guide: "严格按 s5-editing.md 骨架、病型库与人味标准修订",
    }),
    shape: "输出修订后的完整 Markdown 正文。",
    format: "text",
    parse: (raw) => {
      const text = raw.trim();
      if (!text) throw new AppError("model.output_invalid", "s5-editing 修订输出为空");
      return text;
    },
  };
}

export function buildQaReviseStage(deps: {
  draft: string;
  qa: QaCheckResult;
  round: number;
}): ArticleStage<{ draft: string; qa: QaCheckResult; round: number }, string> {
  return {
    id: `qa-revise-${deps.round}`,
    title: `质检回改第 ${deps.round} 轮`,
    role: "editor",
    method: { stage: "toutiao.article.qa" },
    input: () => deps,
    shape:
      "仅针对 fails 与 hard_gates 指出的位置修改，不靠堆砌口语词或拆小标题凑分，输出完整 Markdown 正文。",
    format: "text",
    parse: (raw) => {
      const text = raw.trim();
      if (!text) {
        throw new AppError("model.output_invalid", `qa-revise 第 ${deps.round} 轮输出为空`);
      }
      return text;
    },
  };
}
