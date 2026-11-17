import { prepareChapter } from "./prepare.js";
import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, resolveResourcePath, sha256 } from "@zhizhang/core/fs";
import { createLockService } from "@zhizhang/core/lock";
import type {
  ContextPacket,
  DeliveryReceipt,
  PipelineDefinition,
  RunCtx,
  StageSpec,
} from "@zhizhang/core/pipeline";
import { buildDeliveryMarker, isAlreadyDelivered } from "@zhizhang/core/pipeline";
import { arr, int, lit, num, obj, opt, parseJson, str, type Infer } from "@zhizhang/core/schema";
import { createBibleStore } from "../../bible/store.js";
import { MAX_EDITOR_REJECTIONS } from "../../domain/status.js";

export const ChapterPipelineReq = obj({
  chapterId: str({ min: 1 }),
  position: opt(str()),
  grade: opt(lit("economy", "standard", "premium")),
  golden: opt(lit("true", "false")),
  note: opt(str()),
  targetWords: opt(int({ min: 500, max: 20000 })),
});

export type ChapterReq = Infer<typeof ChapterPipelineReq>;

export interface DraftOutput {
  title: string;
  body: string;
}

export interface BeatsOutput {
  scenes: Array<{
    title: string;
    goal: string;
    conflict: string;
    hook?: string;
  }>;
}

export interface ReviewIssue {
  kind: "continuity" | "reader";
  quote: string;
  issue: string;
  fix: string;
}

export interface ReviewResult {
  verdict: "pass" | "revise" | "reject";
  issues: ReviewIssue[];
  summary: string;
}

export interface ScoreResult {
  score: number;
  strengths: string[];
  weaknesses: string[];
  summary: string;
}

export interface CompareResult {
  winner: "A" | "B" | "tie";
  reason: string;
}

export interface GateReport {
  passed: boolean;
  wordCount: number;
  reasons: string[];
  hits: string[];
}

export interface ChapterRunResult {
  title: string;
  body: string;
  beats: BeatsOutput;
  gate: GateReport;
  review: ReviewResult;
  editorPass: boolean;
  editorRejections: number;
}

const BeatsSchema = obj({
  scenes: arr(
    obj({
      title: str({ min: 1 }),
      goal: str({ min: 1 }),
      conflict: str({ min: 1 }),
      hook: opt(str()),
    }),
    { max: 20 },
  ),
});

const ReviewIssueSchema = obj({
  kind: lit("continuity", "reader"),
  quote: str(),
  issue: str({ min: 1 }),
  fix: str({ min: 1 }),
});

export const ReviewResultSchema = obj({
  verdict: lit("pass", "revise", "reject"),
  issues: arr(ReviewIssueSchema, { max: 50 }),
  summary: str({ min: 1 }),
});

const ContinuityResultSchema = obj({
  issues: arr(ReviewIssueSchema, { max: 50 }),
});

const ScoreResultSchema = obj({
  score: num({ min: 0, max: 100 }),
  strengths: arr(str(), { max: 10 }),
  weaknesses: arr(str(), { max: 10 }),
  summary: str({ min: 1 }),
});

const CompareResultSchema = obj({
  winner: lit("A", "B", "tie"),
  reason: str({ min: 1 }),
});

const DraftJsonSchema = obj({
  title: str({ min: 1 }),
  body: str({ min: 1 }),
});

const PLACEHOLDER_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "TODO", pattern: /\bTODO\b/i },
  { label: "TBD", pattern: /\bTBD\b/i },
  { label: "XXX", pattern: /\bXXX\b/ },
  { label: "待补占位", pattern: /【待[^】]{0,20}】|\[待[^\]]{0,20}\]/ },
  { label: "待续占位", pattern: /（待补|待写|待完善|略写）/ },
];

const FORBIDDEN_HIT_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "终止符泄漏", pattern: /<<<END>>>/ },
  { label: "AI自述", pattern: /作为(?:一个)?(?:AI|人工智能|语言模型)/ },
  { label: "元提示泄漏", pattern: /^(?:以下是(?:修改后的)?正文|好的，为您)/m },
  { label: "未命名章号", pattern: /^第[X\?]+章/m },
];

export function draftCountForGrade(
  grade: "economy" | "standard" | "premium",
  golden: boolean,
): number {
  if (grade === "economy") return 1;
  if (grade === "standard") return golden ? 5 : 2;
  return golden ? 8 : 3;
}

export function countChineseWords(text: string): number {
  return text.replace(/\s+/g, "").length;
}

export function parsePlainDraft(raw: string): DraftOutput {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      return parseJson(trimmed, DraftJsonSchema, "draft");
    } catch {
      // Fall through to plain text parsing
    }
  }
  const endIdx = raw.indexOf("<<<END>>>");
  if (endIdx === -1) {
    throw new AppError("model.output_invalid", "起稿输出缺少 <<<END>>> 终止符");
  }
  const content = raw.slice(0, endIdx).trim();
  const lines = content.split(/\r?\n/);
  const first = lines[0]?.trim() ?? "";
  if (!first.startsWith("#")) {
    throw new AppError("model.output_invalid", "起稿输出首行缺少 # 章名");
  }
  const title = first.replace(/^#+\s*/, "").trim();
  const body = lines.slice(1).join("\n").trim();
  if (!title || !body) {
    throw new AppError("model.output_invalid", "起稿输出标题或正文为空");
  }
  return { title, body };
}

export function gateDraft(
  draft: DraftOutput,
  opts: { targetWords?: number; minRatio?: number; maxRatio?: number } = {},
): GateReport {
  const target = opts.targetWords ?? 3000;
  const minWords = Math.floor(target * (opts.minRatio ?? 0.5));
  const maxWords = Math.ceil(target * (opts.maxRatio ?? 1.8));
  const wordCount = countChineseWords(draft.body);
  const reasons: string[] = [];
  const hits: string[] = [];

  if (wordCount < minWords) {
    reasons.push(`篇幅不足：当前 ${wordCount} 字，低于下限 ${minWords} 字`);
  } else if (wordCount > maxWords) {
    reasons.push(`篇幅过长：当前 ${wordCount} 字，高于上限 ${maxWords} 字`);
  }

  for (const rule of PLACEHOLDER_PATTERNS) {
    if (rule.pattern.test(draft.body) || rule.pattern.test(draft.title)) {
      hits.push(`占位符:${rule.label}`);
      reasons.push(`存在未替换占位符（${rule.label}）`);
    }
  }

  for (const rule of FORBIDDEN_HIT_PATTERNS) {
    if (rule.pattern.test(draft.body)) {
      hits.push(`命中项:${rule.label}`);
      reasons.push(`命中禁区词条（${rule.label}）`);
    }
  }

  return {
    passed: reasons.length === 0,
    wordCount,
    reasons,
    hits,
  };
}

export function filterLocatedIssues(
  issues: ReviewIssue[],
  body: string,
): { value: ReviewIssue[]; notes: string[] } {
  if (issues.length === 0) return { value: [], notes: [] };
  const kept: ReviewIssue[] = [];
  const notes: string[] = [];
  for (const item of issues) {
    if (item.quote && body.includes(item.quote)) {
      kept.push(item);
    } else {
      notes.push(`已剔除不可定位引文：${item.quote || "(空)"}`);
    }
  }
  if (kept.length === 0 && notes.length > 0) {
    throw new AppError("model.output_invalid", "审读引文全部不可定位，触发内容重试");
  }
  return { value: kept, notes };
}

function getCurrentDraftFromState(ctx: RunCtx): DraftOutput {
  const candidate = ctx.state.currentDraft as DraftOutput | undefined;
  if (!candidate || !candidate.body) {
    throw new AppError("internal", "流水线状态缺少当前待审稿件");
  }
  return candidate;
}

export const beatsStage: StageSpec<
  { chapterId: string; outline: string; note?: string },
  BeatsOutput
> = {
  id: "beats",
  title: "分场节拍",
  role: "planner",
  method: { stage: "fanqie.chapter.beats" },
  input: (ctx) => {
    const req = ctx.request as ChapterReq;
    return {
      chapterId: req.chapterId,
      outline: String(ctx.state.outlineText ?? ""),
      note: req.note,
    };
  },
  shape: 'JSON 格式：{"scenes":[{"title":"场景名","goal":"目标","conflict":"冲突","hook":"钩子"}]}',
  format: "json",
  parse: (raw) => parseJson(raw, BeatsSchema, "beats"),
};

export const draftStage: StageSpec<
  { chapterId: string; beats?: BeatsOutput; note?: string },
  DraftOutput
> = {
  id: "draft",
  title: "起稿",
  role: "writer",
  method: { stage: "fanqie.chapter.draft" },
  input: (ctx) => {
    const req = ctx.request as ChapterReq;
    return {
      chapterId: req.chapterId,
      beats: ctx.state.beats as BeatsOutput | undefined,
      note: req.note,
    };
  },
  shape: "纯文本输出：首行 `# 章名`，正文段落，末尾单独一行 `<<<END>>>`。",
  format: "text",
  parse: parsePlainDraft,
  fanOut: {
    count: (ctx) => {
      const req = ctx.request as ChapterReq;
      return draftCountForGrade(
        req.grade ?? lit("economy", "standard", "premium")(ctx.state.grade ?? "standard"),
        req.golden === "true",
      );
    },
  },
};

export function makeScoreStage(
  index: number,
): StageSpec<{ title: string; body: string }, ScoreResult> {
  return {
    id: `select-score-${index}`,
    title: `独立评分 #${index + 1}`,
    role: "judge",
    method: { stage: "fanqie.chapter.select" },
    input: (ctx) => {
      const candidates = (ctx.state.passingDrafts as DraftOutput[] | undefined) ?? [];
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
): StageSpec<{ A: DraftOutput; B: DraftOutput }, CompareResult> {
  return {
    id: `select-compare-${label}`,
    title: `换位盲评 (${label})`,
    role: "judge",
    method: { stage: "fanqie.chapter.select" },
    input: (ctx) => {
      const topTwo = ctx.state.topTwo as [DraftOutput, DraftOutput] | undefined;
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

export const continuityStage: StageSpec<
  { chapterId: string; title: string; body: string },
  { issues: ReviewIssue[] }
> = {
  id: "continuity-check",
  title: "连续性核查",
  role: "editor",
  method: { stage: "fanqie.chapter.review" },
  input: (ctx) => {
    const req = ctx.request as { chapterId: string };
    const draft = getCurrentDraftFromState(ctx);
    return { chapterId: req.chapterId, title: draft.title, body: draft.body };
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

export function makeReviewStage(
  round: number,
): StageSpec<{ chapterId: string; round: number; title: string; body: string }, ReviewResult> {
  return {
    id: round === 1 ? "review" : `review-r${round}`,
    title: `编辑审读（第 ${round} 轮）`,
    role: "editor",
    method: { stage: "fanqie.chapter.review" },
    input: (ctx) => {
      const req = ctx.request as { chapterId: string };
      const draft = getCurrentDraftFromState(ctx);
      return { chapterId: req.chapterId, round, title: draft.title, body: draft.body };
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

export function makeReviseStage(
  round: number,
): StageSpec<
  { chapterId: string; round: number; draft: DraftOutput; issues: ReviewIssue[]; note?: string },
  DraftOutput
> {
  return {
    id: round === 1 ? "revise" : `revise-r${round}`,
    title: `按回报修改（第 ${round} 轮）`,
    role: "writer",
    method: { stage: "fanqie.chapter.revise" },
    input: (ctx) => {
      const req = ctx.request as { chapterId: string; note?: string };
      const draft = getCurrentDraftFromState(ctx);
      const issues = (ctx.state.pendingIssues as ReviewIssue[] | undefined) ?? [];
      return { chapterId: req.chapterId, round, draft, issues, note: req.note };
    },
    shape: "纯文本输出：首行 `# 章名`，修改后的完整正文段落，末尾单独一行 `<<<END>>>`。",
    format: "text",
    parse: parsePlainDraft,
  };
}

export const reviseStage = makeReviseStage(1);

export const chapterPipeline: PipelineDefinition<ChapterReq, ChapterRunResult> = {
  kind: "fanqie.chapter",
  request: ChapterPipelineReq,
  async context(target, req) {
    return {
      runId: `run-${Date.now()}`,
      target,
      request: req,
      state: {},
    };
  },
  async run(runner, ctx) {
    const req = ctx.request as ChapterReq;
    const lock = createLockService(systemClock);
    const bibleStore = createBibleStore(lock);

    const prepared = await runner.local("prepare", () => prepareChapter(ctx, req, bibleStore));

    ctx.state.outlineText = prepared.outlineText;
    ctx.state.grade = prepared.grade;
    const packet: ContextPacket = prepared.packet;

    // 1. beats
    const beats = await runner.stage(beatsStage, packet);
    ctx.state.beats = beats;

    // 2. draft × N
    const drafts = await runner.fanOut(draftStage, packet);

    // 3. gate (篇幅 / 占位符 / 命中项)
    const gateResults = await runner.local("gate", async () => {
      const reports = drafts.map((draft, idx) => ({
        idx,
        draft,
        report: gateDraft(draft, { targetWords: prepared.targetWords }),
      }));
      const passing = reports.filter((r) => r.report.passed);
      if (passing.length === 0) {
        const reasons = reports.flatMap((r) => r.report.reasons).slice(0, 6);
        throw new AppError(
          "model.output_invalid",
          `所有候选稿未通过基础门禁：${reasons.join("；")}`,
          {
            reasons,
          },
        );
      }
      return passing;
    });

    const passingDrafts = gateResults.map((g) => g.draft);
    ctx.state.passingDrafts = passingDrafts;

    // 4. select (逐稿独立打分 + 前二换位比较)
    let chosen = passingDrafts[0];
    let chosenGate = gateResults[0].report;

    if (passingDrafts.length > 1) {
      const scored: Array<{ idx: number; draft: DraftOutput; gate: GateReport; score: number }> =
        [];
      for (let i = 0; i < passingDrafts.length; i++) {
        const res = await runner.stage(makeScoreStage(i), packet);
        scored.push({
          idx: i,
          draft: passingDrafts[i],
          gate: gateResults[i].report,
          score: res.score,
        });
      }
      scored.sort((a, b) => b.score - a.score);

      ctx.state.topTwo = [scored[0].draft, scored[1].draft] as [DraftOutput, DraftOutput];
      const ab = await runner.stage(makeCompareStage("ab", true), packet);
      const ba = await runner.stage(makeCompareStage("ba", false), packet);

      if (ab.winner === "B" && ba.winner === "A") {
        chosen = scored[1].draft;
        chosenGate = scored[1].gate;
      } else {
        chosen = scored[0].draft;
        chosenGate = scored[0].gate;
      }
    }

    ctx.state.currentDraft = chosen;

    // 5. continuity-check
    const continuity = await runner.stage(continuityStage, packet);

    // 6. review & revise loop (<= MAX_EDITOR_REJECTIONS = 2)
    let editorPass = false;
    let editorRejections = 0;
    let latestReview: ReviewResult = {
      verdict: "pass",
      issues: [],
      summary: "尚未审读",
    };

    for (let round = 1; round <= MAX_EDITOR_REJECTIONS + 1; round++) {
      latestReview = await runner.stage(makeReviewStage(round), packet);
      const combinedIssues =
        round === 1 ? [...continuity.issues, ...latestReview.issues] : latestReview.issues;

      if (latestReview.verdict === "pass" && combinedIssues.length === 0) {
        editorPass = true;
        break;
      }

      if (round > MAX_EDITOR_REJECTIONS) {
        editorRejections = MAX_EDITOR_REJECTIONS;
        break;
      }

      editorRejections = round;
      ctx.state.pendingIssues = combinedIssues;
      const revised = await runner.stage(makeReviseStage(round), packet);
      const revisedGate = await runner.local(`gate-revise-${round}`, async () =>
        gateDraft(revised, { targetWords: prepared.targetWords }),
      );
      if (!revisedGate.passed) {
        throw new AppError(
          "model.output_invalid",
          `第 ${round} 轮修稿未通过门禁：${revisedGate.reasons.join("；")}`,
          { reasons: revisedGate.reasons },
        );
      }
      chosen = revised;
      chosenGate = revisedGate;
      ctx.state.currentDraft = chosen;
    }

    return {
      title: chosen.title,
      body: chosen.body,
      beats,
      gate: chosenGate,
      review: latestReview,
      editorPass,
      editorRejections,
    };
  },
  async deliver(res, ctx): Promise<DeliveryReceipt> {
    const req = ctx.request as ChapterReq;
    const candDir = resolveResourcePath(ctx.target.path, "candidates", req.chapterId);
    const marker = path.join(candDir, `${ctx.runId}.marker.json`);
    if (await isAlreadyDelivered(marker, ctx.runId)) {
      return {
        runId: ctx.runId,
        deliveredPaths: [],
        contentHash: sha256(res.body),
        summary: "已幂等交付",
      };
    }
    const candFile = path.join(candDir, `${ctx.runId}.md`);
    const metaFile = path.join(candDir, `${ctx.runId}.meta.json`);
    await atomicWrite(candFile, `# ${res.title}\n\n${res.body}`);
    await atomicWrite(
      metaFile,
      JSON.stringify(
        {
          runId: ctx.runId,
          chapterId: req.chapterId,
          title: res.title,
          wordCount: res.gate.wordCount,
          editorPass: res.editorPass,
          editorRejections: res.editorRejections,
          bodyHash: sha256(res.body),
          review: res.review,
          beats: res.beats,
        },
        null,
        2,
      ),
    );
    await atomicWrite(marker, buildDeliveryMarker(ctx.runId, res.body));
    return {
      runId: ctx.runId,
      deliveredPaths: [candFile, metaFile],
      contentHash: sha256(res.body),
      summary: `已交付候选稿「${res.title}」（${res.gate.wordCount} 字，${res.editorPass ? "编辑通过" : `待作者裁决，打回 ${res.editorRejections} 轮`}）`,
    };
  },
  async recover(record, ctx) {
    const req = ctx.request as ChapterReq;
    const marker = resolveResourcePath(
      ctx.target.path,
      "candidates",
      req.chapterId,
      `${record.id}.marker.json`,
    );
    return (await isAlreadyDelivered(marker, record.id)) ? "delivered" : "resume";
  },
};
