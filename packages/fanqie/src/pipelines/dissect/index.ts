import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import {
  atomicWrite,
  resolveInside,
  resolveResourcePath,
  readTextIfExists,
  sha256,
} from "@zhizhang/core/fs";
import { FORMAT_VERSION } from "@zhizhang/core/paths";
import type {
  ContextPacket,
  DeliveryReceipt,
  PipelineDefinition,
  StageSpec,
} from "@zhizhang/core/pipeline";
import { buildDeliveryMarker, isAlreadyDelivered } from "@zhizhang/core/pipeline";
import { parseJson } from "@zhizhang/core/schema";
import {
  auditTechniqueCards,
  stratifiedSampleSource,
  type QuoteAuditStatus,
  type SamplingReport,
} from "./sampling.js";
import {
  DissectAnalyzeSchema,
  DissectCardsSchema,
  DissectPlanSchema,
  DissectReq,
  type DissectAnalyzeOutput,
  type DissectCardsOutput,
  type DissectInput,
  type DissectPlanOutput,
  type DissectResult,
} from "./schemas.js";

export * from "./sampling.js";
export {
  DissectReq,
  TechniqueCardSchema,
  type DissectAnalyzeOutput,
  type DissectCardsOutput,
  type DissectInput,
  type DissectPlanOutput,
  type DissectResult,
  type TechniqueCard,
  type TechniqueDimension,
  type TechniqueLayer,
} from "./schemas.js";

interface DissectPipelineState extends Record<string, unknown> {
  sampling?: SamplingReport;
  sample?: string;
  chunks?: string[];
  plan?: DissectPlanOutput;
  analysis?: DissectAnalyzeOutput;
}

type DissectStage<I, O> = StageSpec<I, O, DissectInput, DissectPipelineState>;

export const dissectPlanStage: DissectStage<
  { sourceId: string; title: string; sample: string; readScope: string; hookSummary: string },
  DissectPlanOutput
> = {
  id: "plan",
  title: "拆书方案",
  role: "planner",
  method: { stage: "library.dissect" },
  input: (ctx) => {
    const req = ctx.request;
    const report = ctx.state.sampling;
    return {
      sourceId: req.sourceId,
      title: req.title,
      sample: report?.sample ?? "",
      readScope: report?.readScope === "full" ? "全文已读" : "分层抽样（结论不得外推全书）",
      hookSummary: report?.hookSummary ?? "",
    };
  },
  shape: 'JSON 格式：{"dimensions":["拆解维度"],"focusQuestions":["关键问题"]}',
  format: "json",
  parse: (raw) => parseJson(raw, DissectPlanSchema, "dissect.plan"),
};

export const dissectAnalyzeStage: DissectStage<
  { sourceId: string; title: string; plan?: DissectPlanOutput; chunks: string[] },
  DissectAnalyzeOutput
> = {
  id: "analyze",
  title: "逐维拆解",
  role: "extractor",
  method: { stage: "library.dissect" },
  input: (ctx) => ({
    sourceId: ctx.request.sourceId,
    title: ctx.request.title,
    plan: ctx.state.plan,
    chunks: ctx.state.chunks ?? [],
  }),
  shape:
    'JSON 格式：{"observations":[{"dimension":"维度","finding":"发现","evidence":"原文逐字例证"}],"pacingNotes":"节奏总评"}',
  format: "json",
  parse: (raw) => parseJson(raw, DissectAnalyzeSchema, "dissect.analyze"),
};

export const dissectCardsStage: DissectStage<
  { sourceId: string; title: string; analysis?: DissectAnalyzeOutput },
  DissectCardsOutput
> = {
  id: "cards",
  title: "提炼技法卡",
  role: "planner",
  method: { stage: "library.dissect" },
  input: (ctx) => ({
    sourceId: ctx.request.sourceId,
    title: ctx.request.title,
    analysis: ctx.state.analysis,
  }),
  shape:
    'JSON 格式：{"cards":[{"id":"card-1","title":"具体叙事动作名","category":"类别","layer":"book|arc|unit|chapter|scene|line","dimension":"structure|character|rhythm|hook|prose|commercial","pattern":"去专名机制公式","readerWant":"读者期待","emotionArc":"建立→延迟→触发→兑现→余波","steps":["步骤1","步骤2","步骤3"],"transfer":"迁到新作需重造的条件","mustNotCopy":["不可照搬的专名或桥段"],"failWhen":"什么条件下失效","example":"原文逐字例证","usage":"适用场景"}],"summary":"拆书总结"}',
  format: "json",
  parse: (raw) => parseJson(raw, DissectCardsSchema, "dissect.cards"),
};

function formatQuoteStatus(status: QuoteAuditStatus | undefined, line?: number): string {
  if (status === "verified") return line ? `逐字命中（L${line}）` : "逐字命中";
  if (status === "partial") return line ? `部分命中（L${line}附近，建议核对原文）` : "部分命中";
  return "未核验原文逐字";
}

export const dissectPipeline: PipelineDefinition<
  DissectInput,
  DissectResult,
  DissectPipelineState
> = {
  kind: "library.dissect",
  request: DissectReq,
  async context(target, req, env) {
    const clock = env?.clock ?? systemClock;
    return {
      runId: `dissect-${clock.now()}`,
      target,
      request: req,
      state: {},
      clock,
      lock: env?.lock,
      budget: env?.budget,
      profileId: env?.profileId,
      profile: env?.profile,
      profileRoots: env?.profileRoots,
    };
  },
  async run(runner, ctx) {
    const req = ctx.request;

    // 1. import + 分层章节测绘抽样
    const imported = await runner.local("import", async () => {
      const candidates = [
        req.sourcePath
          ? resolveInside(
              ctx.target.path,
              path.relative(ctx.target.path, path.resolve(req.sourcePath)),
            )
          : undefined,
        resolveResourcePath(ctx.target.path, "sources", `${req.sourceId}.txt`),
        resolveResourcePath(ctx.target.path, "sources", `${req.sourceId}.md`),
      ].filter((p): p is string => Boolean(p));

      let text: string | undefined;
      for (const candidate of candidates) {
        text = await readTextIfExists(candidate);
        if (text) break;
      }
      if (!text) {
        throw new AppError("input.not_found", `未找到拆书源文件：${req.sourceId}`, {
          sourceId: req.sourceId,
        });
      }
      const sampling = stratifiedSampleSource(text, 10, 4000);
      return { text, sampling };
    });

    ctx.state.sampling = imported.sampling;
    ctx.state.sample = imported.sampling.sample;
    ctx.state.chunks = imported.sampling.chunks;

    const scopeNote =
      imported.sampling.readScope === "full"
        ? `全文已读（${imported.sampling.totalChars} 字，${imported.sampling.chapterCount || 1} 段/章）`
        : `分层抽样（全书 ${imported.sampling.totalChars} 字 / ${imported.sampling.chapterCount} 章，抽样 ${imported.sampling.sampledCount} 块，结论仅限已读范围）`;

    const packet: ContextPacket = {
      prefix: [
        {
          id: "dissect-sample",
          layer: 0,
          text: `拆书作品：《${req.title}》\n阅读范围：${scopeNote}\n章末特征：${imported.sampling.hookSummary}\n\n${imported.sampling.sample}`,
          required: true,
          tokens: Math.ceil(imported.sampling.sample.length / 2),
          reason: "拆书样本导入与量化测绘",
          source: { kind: "library", ref: req.sourceId },
        },
      ],
      suffix: [],
      omitted: [],
      estimate: Math.ceil(imported.sampling.sample.length / 2),
    };

    // 2. plan
    const plan = await runner.stage(dissectPlanStage, packet);
    ctx.state.plan = plan;

    // 3. analyze
    const analysis = await runner.stage(dissectAnalyzeStage, packet);
    ctx.state.analysis = analysis;

    // 4. cards
    const cardOutput = await runner.stage(dissectCardsStage, packet);

    // 5. quote-audit (逐字引文核对，防幻觉例证)
    const audited = await runner.local("quote-audit", async () =>
      auditTechniqueCards(imported.text, cardOutput.cards),
    );

    return {
      sourceId: req.sourceId,
      title: req.title,
      plan,
      analysis,
      cards: audited.cards,
      cardCount: audited.cards.length,
      summary: cardOutput.summary,
      sampling: {
        totalChars: imported.sampling.totalChars,
        chapterCount: imported.sampling.chapterCount,
        sampledCount: imported.sampling.sampledCount,
        readScope: imported.sampling.readScope,
        hookSummary: imported.sampling.hookSummary,
      },
      quoteAudit: audited.stats,
    };
  },
  async deliver(res, ctx): Promise<DeliveryReceipt> {
    const outDir = resolveResourcePath(ctx.target.path, "analyses", res.sourceId);
    const marker = path.join(outDir, `${ctx.runId}.marker.json`);
    const cardsJson = JSON.stringify(res.cards, null, 2);

    if (await isAlreadyDelivered(marker, ctx.runId)) {
      return {
        runId: ctx.runId,
        deliveredPaths: [],
        contentHash: sha256(cardsJson),
        summary: "已幂等交付拆书结果",
      };
    }

    const reportPath = path.join(outDir, "report.md");
    const cardsPath = path.join(outDir, "cards.json");
    const manifestPath = path.join(outDir, "manifest.json");
    const scopeLabel = res.sampling.readScope === "full" ? "全文已读" : "分层抽样";
    const reportText = [
      `# ${res.title} 拆书报告`,
      "",
      `> ${res.summary}`,
      "",
      `## 测绘与证据底座`,
      `- 阅读范围：${scopeLabel}（共 ${res.sampling.totalChars} 字，识别 ${res.sampling.chapterCount} 章，抽样 ${res.sampling.sampledCount} 块）`,
      `- 章末钩子分布：${res.sampling.hookSummary}`,
      `- 引文核验：逐字命中 ${res.quoteAudit.verified} / 部分命中 ${res.quoteAudit.partial} / 未核验 ${res.quoteAudit.unverified}`,
      "",
      `## 拆解维度`,
      ...res.plan.dimensions.map((d) => `- ${d}`),
      "",
      `## 节奏总评`,
      res.analysis.pacingNotes,
      "",
      `## 技法卡（${res.cardCount} 张）`,
      ...res.cards.map((c) => {
        const meta = [c.layer, c.dimension, c.category].filter(Boolean).join(" / ");
        const lines = [
          `### ${c.title}（${meta}）`,
          `- 模式：${c.pattern}`,
          ...(c.readerWant ? [`- 读者期待：${c.readerWant}`] : []),
          ...(c.emotionArc ? [`- 情绪曲线：${c.emotionArc}`] : []),
          ...(c.steps?.length ? [`- 实操步骤：${c.steps.join(" → ")}`] : []),
          ...(c.transfer ? [`- 迁移重造：${c.transfer}`] : []),
          ...(c.mustNotCopy?.length ? [`- 严禁照搬：${c.mustNotCopy.join("；")}`] : []),
          ...(c.failWhen ? [`- 失效边界：${c.failWhen}`] : []),
          `- 例证：${c.example}［${formatQuoteStatus(c.quoteStatus, c.quoteLine)}］`,
          `- 用法：${c.usage}`,
        ];
        return lines.join("\n");
      }),
      "",
    ].join("\n");

    const manifestJson = JSON.stringify(
      {
        format: FORMAT_VERSION,
        sourceId: res.sourceId,
        title: res.title,
        runId: ctx.runId,
        cardCount: res.cardCount,
        sampling: res.sampling,
        quoteAudit: res.quoteAudit,
      },
      null,
      2,
    );

    await atomicWrite(cardsPath, cardsJson);
    await atomicWrite(reportPath, reportText);
    await atomicWrite(manifestPath, manifestJson);
    await atomicWrite(marker, buildDeliveryMarker(ctx.runId, cardsJson));

    return {
      runId: ctx.runId,
      deliveredPaths: [reportPath, cardsPath, manifestPath],
      contentHash: sha256(cardsJson),
      summary: `拆书完成，生成技法卡 ${res.cardCount} 张（引文逐字命中 ${res.quoteAudit.verified}）`,
    };
  },
  async recover(record, ctx) {
    const req = ctx.request;
    const marker = resolveResourcePath(
      ctx.target.path,
      "analyses",
      req.sourceId,
      `${record.id}.marker.json`,
    );
    return (await isAlreadyDelivered(marker, record.id)) ? "delivered" : "resume";
  },
};
